"""Exercise startup success and failure through the preflight CLI."""

import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/android-emulator-preflight.py"


class EmulatorPreflightTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="covault-emulator-preflight-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.config = self.root / "responses.json"
        self.adb = self.root / "adb"
        self.adb.write_text(f"#!{sys.executable}\n" + r'''
import json
from pathlib import Path
import sys
import time

root = Path(__file__).parent
config = json.loads(root.joinpath("responses.json").read_text())
arguments = sys.argv[1:]
if arguments[:3] != ["-s", "emulator-5554", "shell"]:
    sys.exit("Unexpected device command")
command = " ".join(arguments[3:])
response = config.get(command, {"code": 1, "stderr": "Inspection unavailable"})
if isinstance(response, list):
    counter = root / "phone-check-count"
    count = int(counter.read_text()) if counter.exists() else 0
    counter.write_text(str(count + 1))
    response = response[min(count, len(response) - 1)]
time.sleep(response.get("delay", 0))
print(response.get("stdout", ""), end="")
print(response.get("stderr", ""), end="", file=sys.stderr)
sys.exit(response.get("code", 0))
''')
        self.adb.chmod(0o755)

    def run_cli(self, action, responses, serial="emulator-5554"):
        capabilities = {
            "getprop ro.kernel.qemu": {"stdout": "1"},
            "getprop ro.debuggable": {"stdout": "1"},
            "getprop ro.build.type": {"stdout": "userdebug"},
            "su 0 id -u": {"stdout": "0"},
        }
        self.config.write_text(json.dumps({**capabilities, **responses}))
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--adb", str(self.adb), "--serial", serial, *action],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )

    def phone(self, response, timeout="0.15"):
        return self.run_cli(
            ["wait-phone", "--timeout", timeout, "--interval", "0.01"],
            {"service check phone": response},
        )

    def free_host_port(self, family=socket.AF_INET):
        reservation = socket.socket(family, socket.SOCK_STREAM)
        address = ("::1", 0) if family == socket.AF_INET6 else ("127.0.0.1", 0)
        reservation.bind(address)
        if reservation.getsockname()[1] == 65535:
            reservation.close()
            return self.free_host_port(family)
        self.addCleanup(reservation.close)
        return reservation, reservation.getsockname()[1]

    def port(self, port, sockets="", limits="65535 65535", code=0):
        return self.run_cli(
            ["check-port", str(port)],
            {
                "cat /proc/sys/net/ipv4/ip_local_port_range": {"stdout": limits},
                "su 0 ss -tanH": {"stdout": sockets, "code": code, "stderr": "" if code == 0 else "Permission denied"},
            },
        )

    def test_phone_can_proceed_after_actual_registration(self):
        result = self.phone([
            {"stdout": "Service phone: not found\r\n"},
            {"stdout": "Service phone: found\r\n"},
        ], timeout="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("phone Binder check: Service phone: not found", result.stdout)
        self.assertIn("Phone service is registered; mobile-data shutdown may proceed.", result.stdout)

    def test_missing_phone_even_with_success_exit_is_a_bounded_failure(self):
        result = self.phone({"stdout": "Service phone: not found\n"})
        self.assertEqual(result.returncode, 1)
        self.assertIn("Phone service did not register within 0.15 seconds.", result.stderr)

    def test_failed_command_cannot_claim_phone_registration(self):
        result = self.phone({"stdout": "Service phone: found\n", "code": 20})
        self.assertEqual(result.returncode, 1)
        self.assertIn("Phone service did not register", result.stderr)

    def test_hung_binder_check_cannot_exceed_readiness_deadline(self):
        result = self.phone({"stdout": "Service phone: found\n", "delay": 2})
        self.assertEqual(result.returncode, 1)
        self.assertIn("phone Binder check timed out", result.stdout)
        self.assertIn("Phone service did not register", result.stderr)

    def test_available_local_port_ignores_a_matching_remote_peer(self):
        reservation, port = self.free_host_port()
        reservation.close()
        result = self.port(port,
            f"ESTAB 0 0 127.0.0.1:16000 127.0.0.1:{port}\n"
            f"TIME-WAIT 0 0 [::1]:16001 [::1]:{port}\n"
            "LISTEN 0 0 [::]:16002 *:*\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Selected debug emulator verified: qemu=1, debuggable=1, su 0 UID=0.", result.stdout)
        self.assertIn(f"Driver TCP port {port} is available on host and emulator.", result.stdout)

    def test_empty_readable_socket_inventory_is_available(self):
        reservation, port = self.free_host_port()
        reservation.close()
        result = self.port(port)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("available on host and emulator", result.stdout)

    def test_occupied_device_ports_fail_in_every_tcp_state_and_address_family(self):
        for state, address in [
            ("LISTEN", "0.0.0.0:17001"),
            ("ESTAB", "127.0.0.1:17001"),
            ("TIME-WAIT", "[::ffff:127.0.0.1]:17001"),
            ("CLOSE-WAIT", "[::]:17001"),
        ]:
            with self.subTest(state=state):
                result = self.port(17001, f"{state} 0 0 {address} *:*\n")
                self.assertEqual(result.returncode, 1)
                self.assertIn(f"Emulator TCP port 17001 is occupied in state {state}.", result.stderr)

    def test_occupied_host_ipv4_and_ipv6_ports_fail_without_disturbing_the_owner(self):
        families = [socket.AF_INET]
        if socket.has_ipv6:
            families.append(socket.AF_INET6)
        for family in families:
            with self.subTest(family=family):
                reservation, port = self.free_host_port(family)
                result = self.port(port)
                self.assertEqual(result.returncode, 1)
                self.assertIn(f"Host TCP port {port} is unavailable", result.stderr)
                self.assertEqual(reservation.getsockname()[1], port)

    def test_ports_in_or_above_device_ephemeral_range_are_rejected(self):
        for port in [17001, 50000]:
            with self.subTest(port=port):
                result = self.port(port, limits="17000 49000")
                self.assertEqual(result.returncode, 1)
                self.assertIn("must be below the emulator ephemeral range", result.stderr)

    def test_unavailable_or_unparseable_socket_inspection_is_a_failure(self):
        for sockets, code, expected in [
            ("", 1, "Cannot inspect emulator su 0 ss -tanH: Permission denied"),
            ("Permission denied", 0, "Cannot interpret emulator TCP socket row"),
            ("LISTEN 0 0 broken *:*", 0, "Cannot interpret emulator TCP local endpoint"),
        ]:
            with self.subTest(expected=expected):
                result = self.port(17001, sockets, code=code)
                self.assertEqual(result.returncode, 1)
                self.assertIn(expected, result.stderr)

    def test_unparseable_or_invalid_ephemeral_range_is_a_failure(self):
        for limits in ["Permission denied", "32768", "65000 10000", "0 65535"]:
            with self.subTest(limits=limits):
                result = self.port(17001, limits=limits)
                self.assertEqual(result.returncode, 1)
                self.assertIn("emulator TCP ephemeral port range", result.stderr)

    def test_inspection_warning_cannot_pass_as_an_empty_socket_inventory(self):
        result = self.run_cli(["check-port", "17001"], {
            "cat /proc/sys/net/ipv4/ip_local_port_range": {"stdout": "32768 60999"},
            "su 0 ss -tanH": {"stdout": "", "stderr": "Cannot open netlink socket", "code": 0},
        })
        self.assertEqual(result.returncode, 1)
        self.assertIn("Cannot inspect emulator su 0 ss -tanH: Cannot open netlink socket", result.stderr)

    def test_privileged_inventory_requires_a_selected_emulator_serial(self):
        result = self.run_cli(["check-port", "17001"], {}, serial="physical-device")
        self.assertEqual(result.returncode, 1)
        self.assertIn("Privileged socket inspection requires a selected emulator serial.", result.stderr)

    def test_privileged_inventory_requires_actual_emulator_property(self):
        result = self.run_cli(["check-port", "17001"], {
            "getprop ro.kernel.qemu": {"stdout": "0"},
        })
        self.assertEqual(result.returncode, 1)
        self.assertIn("requires ro.kernel.qemu=1; observed '0'", result.stderr)

    def test_privileged_inventory_requires_debuggable_property(self):
        result = self.run_cli(["check-port", "17001"], {
            "getprop ro.debuggable": {"stdout": "0"},
        })
        self.assertEqual(result.returncode, 1)
        self.assertIn("requires ro.debuggable=1; observed '0'", result.stderr)

    def test_privileged_inventory_requires_debug_build_type(self):
        result = self.run_cli(["check-port", "17001"], {
            "getprop ro.build.type": {"stdout": "user"},
        })
        self.assertEqual(result.returncode, 1)
        self.assertIn("requires a userdebug or eng build; observed 'user'", result.stderr)

    def test_privileged_inventory_requires_proven_root_uid(self):
        result = self.run_cli(["check-port", "17001"], {
            "su 0 id -u": {"stdout": "2000"},
        })
        self.assertEqual(result.returncode, 1)
        self.assertIn("requires su 0 UID 0; observed '2000'", result.stderr)

    def test_failed_or_warning_privilege_probe_cannot_claim_uid_zero(self):
        for response, expected in [
            ({"stdout": "0", "code": 1}, "Cannot inspect emulator su 0 id -u: 0"),
            ({"stdout": "0", "stderr": "Privilege denied"}, "Cannot inspect emulator su 0 id -u: Privilege denied"),
        ]:
            with self.subTest(response=response):
                result = self.run_cli(["check-port", "17001"], {"su 0 id -u": response})
                self.assertEqual(result.returncode, 1)
                self.assertIn(expected, result.stderr)

    def test_denied_diagnostic_privilege_preserves_other_failure_evidence(self):
        result = self.run_cli(["diagnostics"], {
            "su 0 id -u": {"stdout": "2000"},
            "service check phone": {"stdout": "Service phone: not found"},
            "ps -A": {"stdout": "radio 2336 621 com.android.phone"},
        })
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Service phone: not found", result.stdout)
        self.assertIn("radio 2336 621 com.android.phone", result.stdout)
        self.assertIn("Privileged socket diagnostic unavailable: Privileged socket inspection requires su 0 UID 0", result.stdout)

    def test_failure_diagnostics_preserve_available_service_and_process_evidence(self):
        result = self.run_cli(["diagnostics"], {
            "service check phone": {"stdout": "Service phone: not found"},
            "service list": {"stdout": "Found 1 services:\n0 connectivity: [android.net.IConnectivityManager]"},
            "ps -A": {"stdout": "USER PID PPID NAME\nradio 2336 621 com.android.phone"},
            "su 0 ss -tanp": {"code": 1, "stderr": "Socket inspection unavailable"},
        })
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Service phone: not found", result.stdout)
        self.assertIn("radio 2336 621 com.android.phone", result.stdout)
        self.assertIn("Socket inspection unavailable", result.stdout)


if __name__ == "__main__":
    unittest.main()
