import base64
import importlib.util
import io
import json
from pathlib import Path
import struct
import unittest
import zipfile
import zlib

spec = importlib.util.spec_from_file_location("publisher", Path(__file__).parents[1] / "publish-pr-screenshots.py")
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)

BASE, HEAD = "a" * 40, "b" * 40


def chunk(kind, payload):
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))


def png(color=0, width=393):
    header = struct.pack(">IIBBBBB", width, 852, 8, 2, 0, 0, 0)
    pixels = (b"\0" + bytes([color]) * width * 3) * 852
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")


def artifact(extra=None, manifest=None, after_images=None):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest or {"version": 1, "pr": 7, "base": BASE, "head": HEAD}))
        for side in ("before", "after"):
            for name in publisher.SCREENS:
                archive.writestr(f"{side}/{name}", (after_images.get(name, png())
                                 if side == "after" and after_images is not None
                                 else png(0 if side == "before" else 20)))
        if extra:
            archive.writestr(*extra)
    return output.getvalue()


class FakeGitHub:
    repository = "owner/Covault"

    def __init__(self):
        self.writes = []
        self.data = artifact()
        self.pr = {"number": 7, "state": "open", "head": {"sha": HEAD, "ref": "change", "repo": {"id": 42}},
                   "base": {"sha": BASE, "ref": "main", "repo": {"full_name": self.repository}}}
        self.run = {"id": 99, "workflow_id": 5, "path": publisher.WORKFLOW, "event": "pull_request",
                    "status": "completed", "conclusion": "success", "run_attempt": 2,
                    "head_sha": HEAD, "head_branch": "change", "head_repository": {"id": 42}, "pull_requests": []}
        self.comments = []

    def request(self, path, data=None, method=None):
        if data is not None or method == "DELETE":
            self.writes.append((path, data, method))
            return {"sha": "c" * 40}
        responses = {
            "actions/runs/99": self.run,
            "actions/workflows/5": {"path": publisher.WORKFLOW},
            f"commits/{HEAD}/pulls?per_page=100": [{"number": 7}],
            "pulls/7": self.pr,
            "actions/runs/99/artifacts?per_page=100": {"artifacts": [{"id": 15, "name": "pr-screenshots-99-2", "expired": False, "size_in_bytes": len(self.data)}]},
            "git/ref/heads/pr-screenshots": {"object": {"sha": "d" * 40}},
            f"git/commits/{'d' * 40}": {"tree": {"sha": "e" * 40}},
            "issues/7/comments?per_page=100&page=1": self.comments,
            "issues/7/comments?per_page=100&page=2": [],
        }
        return responses[path]

    def download(self, identifier):
        if identifier != 15:
            raise AssertionError("Wrong artifact")
        return self.data


class EvidenceTests(unittest.TestCase):
    def test_reads_complete_comparison_and_preserves_distinct_pixels(self):
        manifest, images = publisher.read_artifact(artifact())
        self.assertEqual(manifest, {"version": 1, "pr": 7, "base": BASE, "head": HEAD})
        self.assertEqual(images["before/mobile-dashboard-dark.png"], png(0))
        self.assertEqual(images["after/mobile-dashboard-dark.png"], png(20))

    def test_rejects_unexpected_file_and_traversal_without_extraction(self):
        for name in ("run.py", "../publish-pr-screenshots.py", "after/mobile-dashboard-dark.png"):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "unexpected files"):
                publisher.read_artifact(artifact((name, "untrusted")))
        self.assertEqual(publisher.png_only(png()), png())

    def test_rejects_symlink(self):
        info = zipfile.ZipInfo("after/mobile-dashboard-dark.png")
        info.external_attr = (0o120777 << 16)
        source = zipfile.ZipFile(io.BytesIO(artifact()))
        output = io.BytesIO()
        with source, zipfile.ZipFile(output, "w") as target:
            for entry in source.infolist():
                if entry.filename == info.filename:
                    target.writestr(info, "../../somewhere")
                else:
                    target.writestr(entry.filename, source.read(entry.filename))
        with self.assertRaisesRegex(ValueError, "Unsafe artifact"):
            publisher.read_artifact(output.getvalue())
        self.assertEqual(len(publisher.read_artifact(artifact())[1]), 16)

    def test_rejects_wrong_dimensions_trailing_bytes_and_corrupt_chunks(self):
        for image in (png(width=394), png() + b"script", png()[:-1] + b"X"):
            with self.subTest(size=len(image)), self.assertRaises(ValueError):
                publisher.png_only(image)
        self.assertEqual(publisher.png_only(png(20)), png(20))

    def test_publishes_fixed_image_paths_and_commit_pinned_comment_only(self):
        api = FakeGitHub()
        publisher.publish(api, 99)
        trees = [data for path, data, _ in api.writes if path == "git/trees"]
        self.assertEqual(len(trees[0]["tree"]), 24)
        self.assertEqual({entry["mode"] for entry in trees[0]["tree"]}, {"100644"})
        self.assertEqual([path for path, _, _ in api.writes if path.startswith("git/refs")], ["git/refs/heads/pr-screenshots"])
        self.assertEqual(next(data for path, data, _ in api.writes if path == "git/refs/heads/pr-screenshots"), {"sha": "c" * 40, "force": False})
        body = next(data["body"] for path, data, _ in api.writes if path == "issues/7/comments")
        self.assertEqual(body.count("<img src="), 24)
        self.assertIn(f"https://raw.githubusercontent.com/owner/Covault/{'c' * 40}/pr-7/{HEAD}/{BASE}/before/mobile-dashboard-dark.png", body)
        self.assertIn("artificial household data", body)

    def test_unchanged_capture_publishes_nothing_and_removes_only_old_bot_evidence(self):
        api = FakeGitHub()
        api.data = artifact(after_images={})
        publisher.publish(api, 99)
        self.assertEqual(api.writes, [])
        api.comments = [{"id": 3, "body": publisher.MARKER, "user": {"login": "human"}},
                        {"id": 4, "body": publisher.MARKER, "user": {"login": "github-actions[bot]"}}]
        publisher.publish(api, 99)
        self.assertEqual(api.writes, [("issues/comments/4", None, "DELETE")])
        changed = FakeGitHub()
        changed.data = artifact(after_images={"mobile-review-dark.png": png(20)})
        publisher.publish(changed, 99)
        body = changed.writes[-1][1]["body"]
        self.assertEqual(body.count("<img src="), 3)
        self.assertIn("| Review, dark |", body)
        self.assertNotIn("Dashboard, dark", body)
        tree = next(data for path, data, _ in changed.writes if path == "git/trees")
        self.assertEqual([entry["path"].split("/")[-2:] for entry in tree["tree"]],
                         [["after", "mobile-review-dark.png"],
                          ["before", "mobile-review-dark.png"],
                          ["difference", "mobile-review-dark.png"]])
        diff_blob = next(data for path, data, _ in changed.writes if path == "git/blobs"
                         and publisher.image_pixels(base64.b64decode(data["content"]))[:4] == bytes([255, 0, 160, 255]))
        self.assertEqual(diff_blob["encoding"], "base64")

    def test_same_pixels_with_different_png_encoding_are_omitted(self):
        raw = png(20)
        # A Sub-filter encoding of the same solid RGB screen.
        row = b"\x01" + bytes([20, 20, 20]) + bytes(392 * 3)
        encoded = raw[:33] + chunk(b"IDAT", zlib.compress(row * 852, 1)) + chunk(b"IEND", b"")
        self.assertEqual(publisher.image_pixels(encoded)[:8], bytes([20, 20, 20, 255]) * 2)
        images = {f"{side}/{name}": raw if side == "before" else encoded
                  for side in ("before", "after") for name in publisher.SCREENS}
        self.assertEqual(publisher.changed_images(images), {})
        images["after/mobile-review-dark.png"] = png(30)
        self.assertEqual(set(publisher.changed_images(images)),
                         {"before/mobile-review-dark.png", "after/mobile-review-dark.png", "difference/mobile-review-dark.png"})

    def test_all_png_filters_and_opaque_rgba_match_rgb(self):
        for channels in (3, 4):
            original = bytes([20, 40, 60] + ([255] if channels == 4 else [])) * 393
            for kind in range(5):
                with self.subTest(channels=channels, filter=kind):
                    rows = bytearray()
                    previous = bytes(len(original))
                    for _ in range(852):
                        rows.append(kind)
                        for index, value in enumerate(original):
                            left = original[index - channels] if index >= channels else 0
                            above = previous[index]
                            diagonal = previous[index - channels] if index >= channels else 0
                            if kind == 4:
                                estimate = left + above - diagonal
                                candidates = [left, above, diagonal]
                                predictor = min(candidates, key=lambda candidate: abs(estimate - candidate))
                            else:
                                predictor = [0, left, above, (left + above) // 2][kind]
                            rows.append((value - predictor) % 256)
                        previous = original
                    header = struct.pack(">IIBBBBB", 393, 852, 8, 2 if channels == 3 else 6, 0, 0, 0)
                    image = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
                    self.assertEqual(publisher.image_pixels(image), bytes([20, 40, 60, 255]) * (393 * 852))

    def test_rounding_noise_is_ignored_but_a_real_pixel_change_is_kept(self):
        api = FakeGitHub()
        api.data = artifact(after_images={"mobile-review-dark.png": png(1)})
        publisher.publish(api, 99)
        self.assertEqual(api.writes, [])
        raw = png()
        rows = bytearray((b"\0" + bytes(393 * 3)) * 852)
        rows[1:4] = bytes([10, 20, 30])
        one_pixel = raw[:33] + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
        api.data = artifact(after_images={"mobile-review-dark.png": one_pixel})
        publisher.publish(api, 99)
        self.assertEqual(api.writes[-1][1]["body"].count("<img src="), 3)

    def test_stale_head_or_wrong_repository_cannot_write(self):
        for key, value in (("sha", "f" * 40), ("repo", {"id": 999})):
            api = FakeGitHub()
            api.pr["head"][key] = value
            publisher.publish(api, 99)
            self.assertEqual(api.writes, [])
        control = FakeGitHub()
        publisher.publish(control, 99)
        self.assertEqual(control.writes[-1][0], "issues/7/comments")

    def test_wrong_manifest_cannot_publish_to_another_pr_or_stale_base(self):
        for changes in ({"pr": 8}, {"base": "f" * 40}):
            api = FakeGitHub()
            api.data = artifact(manifest={"version": 1, "pr": 7, "base": BASE, "head": HEAD, **changes})
            publisher.publish(api, 99)
            self.assertEqual(api.writes, [])
        control = FakeGitHub()
        publisher.publish(control, 99)
        self.assertEqual(control.writes[-1][0], "issues/7/comments")

    def test_failure_replaces_bot_evidence_without_touching_author_comments(self):
        api = FakeGitHub()
        api.run["conclusion"] = "failure"
        api.comments = [{"id": 3, "body": publisher.MARKER, "user": {"login": "human"}},
                        {"id": 4, "body": publisher.MARKER, "user": {"login": "github-actions[bot]"}}]
        publisher.publish(api, 99)
        self.assertEqual([path for path, _, _ in api.writes], ["issues/comments/4"])
        self.assertIn("did not complete", api.writes[0][1]["body"])

    def test_old_bot_comment_after_first_page_is_updated(self):
        api = FakeGitHub()
        api.comments = [{"id": n, "body": "Discussion", "user": {"login": "human"}} for n in range(100)]
        original_request = api.request

        def request(path, data=None, method=None):
            if path == "issues/7/comments?per_page=100&page=2" and data is None:
                return [{"id": 200, "body": publisher.MARKER, "user": {"login": "github-actions[bot]"}}]
            return original_request(path, data, method)

        api.request = request
        publisher.publish(api, 99)
        self.assertEqual(api.writes[-1][0], "issues/comments/200")
        self.assertEqual(api.writes[-1][1]["body"].count("<img src="), 24)

    def test_invalid_artifact_reports_missing_current_evidence_without_image_writes(self):
        api = FakeGitHub()
        api.data = artifact(("run.py", "untrusted"))
        with self.assertRaisesRegex(ValueError, "unexpected files"):
            publisher.publish(api, 99)
        self.assertEqual([path for path, _, _ in api.writes], ["issues/7/comments"])
        self.assertIn("could not be validated", api.writes[0][1]["body"])
        control = FakeGitHub()
        publisher.publish(control, 99)
        self.assertEqual(control.writes[-1][1]["body"].count("<img src="), 24)

    def test_other_workflow_cannot_publish(self):
        api = FakeGitHub()
        api.run["event"] = "push"
        with self.assertRaisesRegex(ValueError, "not a completed PR"):
            publisher.publish(api, 99)
        self.assertEqual(api.writes, [])
        control = FakeGitHub()
        publisher.publish(control, 99)
        self.assertEqual(control.writes[-1][0], "issues/7/comments")


if __name__ == "__main__":
    unittest.main()
