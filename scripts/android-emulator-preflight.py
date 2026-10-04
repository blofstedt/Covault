#!/usr/bin/env python3
"""Readiness checks for the single disposable Android CI emulator."""

import argparse
import os
import socket
import subprocess
import sys
import time


def device_command(adb, serial, arguments, timeout=5):
    return subprocess.run(
        [adb, "-s", serial, *arguments],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def wait_for_phone(adb, serial, timeout, interval):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        try:
            result = device_command(
                adb,
                serial,
                ["shell", "service", "check", "phone"],
                timeout=min(5, remaining),
            )
            response = result.stdout.strip()
            print(f"phone Binder check: {response or result.stderr.strip() or 'no response'} (exit {result.returncode})", flush=True)
            # Android's service command exits successfully even when absent.
            if result.returncode == 0 and response == "Service phone: found":
                print("Phone service is registered; mobile-data shutdown may proceed.")
                return
        except subprocess.TimeoutExpired:
            print("phone Binder check timed out", flush=True)
        remaining = deadline - time.monotonic()
        if remaining > 0:
            time.sleep(min(interval, remaining))
    raise RuntimeError(f"Phone service did not register within {timeout:g} seconds.")


def inspect_device(adb, serial, arguments):
    result = device_command(adb, serial, ["shell", *arguments])
    if result.returncode != 0 or result.stderr.strip():
        raise RuntimeError(f"Cannot inspect emulator {' '.join(arguments)}: {result.stderr.strip() or result.stdout.strip()}")
    return result.stdout.strip()


def check_host_port(port):
    families = [socket.AF_INET]
    if socket.has_ipv6:
        families.append(socket.AF_INET6)
    for family in families:
        with socket.socket(family, socket.SOCK_STREAM) as probe:
            if family == socket.AF_INET6:
                probe.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
                address = ("::", port)
            else:
                address = ("0.0.0.0", port)
            try:
                # No SO_REUSEADDR: Maestro must be able to bind this port afresh.
                probe.bind(address)
            except OSError as error:
                raise RuntimeError(f"Host TCP port {port} is unavailable: {error}") from error


def check_port(adb, serial, port):
    limits = inspect_device(adb, serial, ["cat", "/proc/sys/net/ipv4/ip_local_port_range"]).split()
    if len(limits) != 2 or not all(value.isdigit() for value in limits):
        raise RuntimeError("Cannot interpret the emulator TCP ephemeral port range.")
    lower, upper = map(int, limits)
    if not 0 < lower <= upper <= 65535:
        raise RuntimeError("Invalid emulator TCP ephemeral port range.")
    print(f"Emulator TCP ephemeral range: {lower} {upper}")
    if port >= lower:
        raise RuntimeError(f"Driver port {port} must be below the emulator ephemeral range.")

    # -a includes connected, closing and TIME-WAIT sockets, not just listeners.
    # Numeric output and no header make IPv4 and IPv6 local endpoints unambiguous.
    sockets = inspect_device(adb, serial, ["ss", "-tanH"])
    for row in sockets.splitlines():
        fields = row.split()
        if len(fields) < 5 or not fields[1].isdigit() or not fields[2].isdigit():
            raise RuntimeError(f"Cannot interpret emulator TCP socket row: {row}")
        local_port = fields[3].rsplit(":", 1)[-1]
        if local_port != "*" and not local_port.isdigit():
            raise RuntimeError(f"Cannot interpret emulator TCP local endpoint: {fields[3]}")
        if local_port == str(port):
            raise RuntimeError(f"Emulator TCP port {port} is occupied in state {fields[0]}.")
    check_host_port(port)
    print(f"Driver TCP port {port} is available on host and emulator.")


def diagnostics(adb, serial):
    # Only the selected synthetic emulator is inspected. Do not enumerate host
    # processes or unrelated host connections, which may belong to other work.
    for arguments in [
        ["shell", "service", "check", "phone"],
        ["shell", "service", "list"],
        ["shell", "ps", "-A"],
        ["shell", "ss", "-tanp"],
        ["shell", "cat", "/proc/sys/net/ipv4/ip_local_port_range"],
        ["shell", "settings", "get", "global", "airplane_mode_on"],
    ]:
        print(f"\nSelected emulator diagnostic: {' '.join(arguments)}", flush=True)
        try:
            result = device_command(adb, serial, arguments)
            print(f"Exit status: {result.returncode}\n{result.stdout}{result.stderr}", flush=True)
        except (OSError, subprocess.TimeoutExpired) as error:
            print(f"Diagnostic unavailable: {error}", flush=True)
    for port in [17001, 17002]:
        try:
            check_host_port(port)
            print(f"Host TCP port {port}: available", flush=True)
        except RuntimeError as error:
            print(error, flush=True)


def positive_seconds(value):
    number = float(value)
    if not 0 < number <= 60:
        raise argparse.ArgumentTypeError("Use a positive duration of at most 60 seconds.")
    return number


def tcp_port(value):
    number = int(value)
    if not 1024 <= number <= 65535:
        raise argparse.ArgumentTypeError("Use an unprivileged TCP port.")
    return number


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--serial", default=os.environ.get("ANDROID_SERIAL", "emulator-5554"))
    actions = parser.add_subparsers(dest="action", required=True)
    phone = actions.add_parser("wait-phone")
    phone.add_argument("--timeout", type=positive_seconds, default=60)
    phone.add_argument("--interval", type=positive_seconds, default=1)
    port = actions.add_parser("check-port")
    port.add_argument("port", type=tcp_port)
    actions.add_parser("diagnostics")
    arguments = parser.parse_args()
    try:
        if arguments.action == "wait-phone":
            wait_for_phone(arguments.adb, arguments.serial, arguments.timeout, arguments.interval)
        elif arguments.action == "check-port":
            check_port(arguments.adb, arguments.serial, arguments.port)
        else:
            diagnostics(arguments.adb, arguments.serial)
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(f"Android emulator preflight failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
