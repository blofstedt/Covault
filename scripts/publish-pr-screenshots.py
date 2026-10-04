"""Publish bounded PNG review evidence without executing pull-request artifacts."""

import base64
import io
import json
import os
import re
import struct
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib

WORKFLOW = ".github/workflows/pr-screenshots.yml"
IMAGE_BRANCH = "pr-screenshots"
MARKER = "<!-- covault-pr-screenshots -->"
SCREENS = {
    "mobile-dashboard-dark.png": "Dashboard, dark",
    "mobile-dashboard-light.png": "Dashboard, light",
    "mobile-manual-filled-dark.png": "Filled expense, dark",
    "mobile-manual-filled-light.png": "Filled expense, light",
    "mobile-manual-invalid-dark.png": "Invalid amount, dark",
    "mobile-manual-invalid-light.png": "Invalid amount, light",
    "mobile-review-dark.png": "Review, dark",
    "mobile-review-filing-dark.png": "Review filing pending, dark",
    "mobile-review-rejected-dark.png": "Review filing rejected, dark",
    "mobile-settings-light.png": "Settings, light",
}
MAX_PNG = 2 * 1024 * 1024
MAX_ARCHIVE = 32 * 1024 * 1024
SHA = re.compile(r"[0-9a-f]{40}")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GitHub:
    def __init__(self, repository, token):
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", repository):
            raise ValueError("Invalid repository")
        self.repository = repository
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect)

    def request(self, path, data=None, method=None):
        request = urllib.request.Request(
            f"https://api.github.com/repos/{self.repository}/{path}",
            data=None if data is None else json.dumps(data).encode(),
            method=method,
            headers={"Authorization": f"Bearer {self.token}",
                     "Accept": "application/vnd.github+json",
                     "Content-Type": "application/json",
                     "X-GitHub-Api-Version": "2022-11-28"},
        )
        with self.opener.open(request, timeout=30) as response:
            raw = response.read(MAX_ARCHIVE + 1)
        if len(raw) > MAX_ARCHIVE:
            raise ValueError("Oversized API response")
        return json.loads(raw) if raw else None

    def download(self, artifact_id):
        # GitHub redirects to a signed blob URL. Never forward our token there.
        try:
            self.request(f"actions/artifacts/{artifact_id}/zip")
        except urllib.error.HTTPError as error:
            if error.code != 302:
                raise
            location = error.headers.get("Location", "")
        else:
            raise ValueError("Artifact API did not return a signed download URL")
        url = urllib.parse.urlparse(location)
        if url.scheme != "https" or not url.hostname or not (
            url.hostname.endswith(".blob.core.windows.net")
            or url.hostname.endswith(".githubusercontent.com")
        ):
            raise ValueError("Unexpected artifact download host")
        with self.opener.open(location, timeout=30) as response:
            raw = response.read(MAX_ARCHIVE + 1)
        if len(raw) > MAX_ARCHIVE:
            raise ValueError("Oversized artifact")
        return raw


def png_only(raw):
    """Validate dimensions, CRCs and bounded pixel data; strip ancillary chunks."""
    if len(raw) > MAX_PNG or raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Invalid or oversized PNG")
    position, core, compressed, channels = 8, [], bytearray(), None
    ended = False
    while position < len(raw):
        if position + 12 > len(raw):
            raise ValueError("Truncated PNG")
        length = struct.unpack(">I", raw[position:position + 4])[0]
        end = position + length + 12
        if end > len(raw):
            raise ValueError("Truncated PNG chunk")
        kind = raw[position + 4:position + 8]
        payload = raw[position + 8:end - 4]
        crc = struct.unpack(">I", raw[end - 4:end])[0]
        if zlib.crc32(kind + payload) != crc:
            raise ValueError("PNG checksum mismatch")
        if channels is None:
            if kind != b"IHDR" or length != 13:
                raise ValueError("PNG lacks its image header")
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", payload)
            if (width, height, depth, compression, filtering, interlace) != (393, 852, 8, 0, 0, 0) or color not in (2, 6):
                raise ValueError("Unexpected PNG dimensions or format")
            channels = 3 if color == 2 else 4
        elif kind == b"IHDR":
            raise ValueError("Duplicate image header")
        if kind == b"IDAT":
            compressed.extend(payload)
        elif kind == b"IEND":
            if length or end != len(raw):
                raise ValueError("Data after PNG end")
            ended = True
        elif kind != b"IHDR" and not (kind[0] & 32):
            raise ValueError("Unknown critical PNG chunk")
        if kind in (b"IHDR", b"IDAT", b"IEND"):
            core.append(raw[position:end])
        position = end
    if not ended or channels is None:
        raise ValueError("Incomplete PNG")
    stride = 393 * channels + 1
    limit = 852 * stride
    decoder = zlib.decompressobj()
    pixels = decoder.decompress(compressed, limit + 1)
    if len(pixels) != limit or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
        raise ValueError("Invalid or excessive PNG pixel data")
    if any(pixels[offset] > 4 for offset in range(0, limit, stride)):
        raise ValueError("Invalid PNG row filter")
    return b"\x89PNG\r\n\x1a\n" + b"".join(core)


def image_pixels(raw):
    """Decode validated RGB/RGBA PNG filters into comparable RGBA pixels."""
    raw = png_only(raw)
    channels = 3 if raw[25] == 2 else 4
    position, compressed = 8, bytearray()
    while position < len(raw):
        length = struct.unpack(">I", raw[position:position + 4])[0]
        if raw[position + 4:position + 8] == b"IDAT":
            compressed.extend(raw[position + 8:position + 8 + length])
        position += length + 12
    filtered = zlib.decompress(compressed)
    stride = 393 * channels
    previous = bytearray(stride)
    result = bytearray()
    for offset in range(0, len(filtered), stride + 1):
        kind = filtered[offset]
        row = bytearray(filtered[offset + 1:offset + 1 + stride])
        for index in range(stride) if kind else ():
            left = row[index - channels] if index >= channels else 0
            above = previous[index]
            upper_left = previous[index - channels] if index >= channels else 0
            if kind == 1:
                predictor = left
            elif kind == 2:
                predictor = above
            elif kind == 3:
                predictor = (left + above) // 2
            elif kind == 4:
                estimate = left + above - upper_left
                distances = (abs(estimate - left), abs(estimate - above), abs(estimate - upper_left))
                predictor = (left, above, upper_left)[distances.index(min(distances))]
            else:
                predictor = 0
            row[index] = (row[index] + predictor) & 255
        for index in range(0, stride, channels):
            alpha = row[index + 3] if channels == 4 else 255
            result.extend(row[index:index + 3] if alpha else b"\0\0\0")
            result.append(alpha)
        previous = row
    return bytes(result)


def pixel_changed(before, after):
    # Ignore one-level channel rounding from repeat-rendered shadows.
    return any(abs(left - right) > 1 for left, right in zip(before, after))


def difference_image(before, after):
    """Highlight changed pixels in magenta over a faded proposed screen."""
    rows = bytearray()
    for row in range(852):
        rows.append(0)
        for offset in range(row * 393 * 4, (row + 1) * 393 * 4, 4):
            pixel = after[offset:offset + 4]
            if pixel_changed(before[offset:offset + 4], pixel):
                rows.extend((255, 0, 160))
            else:
                shade = 180 + (sum(pixel[:3]) * pixel[3] // (3 * 255)) // 4
                rows.extend((shade, shade, shade))

    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", 393, 852, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


def changed_images(images):
    selected = {}
    for filename in SCREENS:
        if images[f"before/{filename}"] == images[f"after/{filename}"]:
            continue
        before = image_pixels(images[f"before/{filename}"])
        after = image_pixels(images[f"after/{filename}"])
        if any(pixel_changed(before[offset:offset + 4], after[offset:offset + 4])
               for offset in range(0, len(before), 4)):
            for side in ("before", "after"):
                selected[f"{side}/{filename}"] = images[f"{side}/{filename}"]
            selected[f"difference/{filename}"] = difference_image(before, after)
    return selected


def read_artifact(raw):
    expected = {f"{side}/{name}" for side in ("before", "after") for name in SCREENS} | {"manifest.json"}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(names) != len(expected) or set(names) != expected:
            raise ValueError("Artifact has missing, duplicate or unexpected files")
        for entry in entries:
            mode = entry.external_attr >> 16
            cap = 4096 if entry.filename == "manifest.json" else MAX_PNG
            if entry.file_size > cap or entry.flag_bits & 1 or (mode & 0o170000) == 0o120000:
                raise ValueError("Unsafe artifact entry")
        manifest = json.loads(archive.read("manifest.json"))
        if not isinstance(manifest, dict) or set(manifest) != {"version", "pr", "base", "head"}:
            raise ValueError("Invalid comparison manifest")
        if type(manifest["version"]) is not int or manifest["version"] != 1 or type(manifest["pr"]) is not int or manifest["pr"] < 1:
            raise ValueError("Invalid comparison version or PR")
        if not all(isinstance(manifest[key], str) and SHA.fullmatch(manifest[key]) for key in ("base", "head")):
            raise ValueError("Invalid comparison commits")
        images = {name: png_only(archive.read(name)) for name in expected if name != "manifest.json"}
    return manifest, images


def current_pr(api, run, number):
    pr = api.request(f"pulls/{number}")
    if pr["state"] != "open" or pr["base"]["ref"] != "main" or pr["base"]["repo"]["full_name"] != api.repository:
        return None
    head_repo = pr["head"].get("repo")
    run_repo = run.get("head_repository")
    if (not head_repo or not run_repo or pr["head"]["sha"] != run["head_sha"]
            or pr["head"]["ref"] != run["head_branch"] or head_repo["id"] != run_repo["id"]):
        return None
    return pr


def comment(api, pr, body):
    for page in range(1, 101):
        comments = api.request(f"issues/{pr['number']}/comments?per_page=100&page={page}")
        existing = next((item for item in comments if item["user"]["login"] == "github-actions[bot]" and item["body"].startswith(MARKER)), None)
        if existing:
            if body is None:
                api.request(f"issues/comments/{existing['id']}", method="DELETE")
                return
            api.request(f"issues/comments/{existing['id']}", {"body": body}, "PATCH")
            return
        if len(comments) < 100:
            if body is None:
                return
            api.request(f"issues/{pr['number']}/comments", {"body": body})
            return
    raise ValueError("Too many comments to locate existing evidence safely")


def publish(api, run_id):
    run = api.request(f"actions/runs/{run_id}")
    workflow = api.request(f"actions/workflows/{run['workflow_id']}")
    if run["event"] != "pull_request" or run["status"] != "completed" or workflow["path"] != WORKFLOW or run["path"] != WORKFLOW:
        raise ValueError("Run is not a completed PR screenshots workflow")
    associated = api.request(f"commits/{run['head_sha']}/pulls?per_page=100")
    candidates = {item["number"] for item in associated} | {item["number"] for item in run["pull_requests"]}
    prs = [pr for number in candidates if (pr := current_pr(api, run, number))]
    if not prs:
        print("No current open PR matches this run; nothing published.")
        return
    run_url = f"https://github.com/{api.repository}/actions/runs/{run['id']}"
    if run["conclusion"] != "success":
        for pr in prs:
            comment(api, pr, f"{MARKER}\nMobile screenshot capture did not complete for `{run['head_sha'][:12]}`. [See the failed capture]({run_url}). No current before/after evidence is available.")
        return
    artifacts = api.request(f"actions/runs/{run['id']}/artifacts?per_page=100")["artifacts"]
    name = f"pr-screenshots-{run['id']}-{run['run_attempt']}"
    matches = [artifact for artifact in artifacts if artifact["name"] == name and not artifact["expired"]]
    try:
        if len(matches) != 1 or matches[0]["size_in_bytes"] > MAX_ARCHIVE:
            raise ValueError("Missing, ambiguous or oversized screenshot artifact")
        manifest, images = read_artifact(api.download(matches[0]["id"]))
    except (ValueError, zipfile.BadZipFile, zlib.error):
        for pr in prs:
            comment(api, pr, f"{MARKER}\nMobile screenshot evidence could not be validated for `{run['head_sha'][:12]}`. [See the capture run]({run_url}). No current before/after evidence is available.")
        raise
    pr = next((item for item in prs if item["number"] == manifest["pr"]), None)
    if pr is None or manifest["head"] != pr["head"]["sha"] or manifest["base"] != pr["base"]["sha"]:
        print("Comparison is stale or not associated with this PR; nothing published.")
        return
    images = changed_images(images)
    if not images:
        # Remove obsolete bot evidence, but leave all author content untouched.
        latest = current_pr(api, run, pr["number"])
        if latest is not None and latest["base"]["sha"] == manifest["base"]:
            comment(api, latest, None)
        print("No captured screens changed; no images or comparison published.")
        return
    try:
        parent = api.request(f"git/ref/heads/{IMAGE_BRANCH}")["object"]["sha"]
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        parent = None
    prefix = f"pr-{pr['number']}/{manifest['head']}/{manifest['base']}"
    tree_entries = []
    for path, image in sorted(images.items()):
        blob = api.request("git/blobs", {"content": base64.b64encode(image).decode(), "encoding": "base64"})
        tree_entries.append({"path": f"{prefix}/{path}", "mode": "100644", "type": "blob", "sha": blob["sha"]})
    tree_input = {"tree": tree_entries}
    if parent:
        tree_input["base_tree"] = api.request(f"git/commits/{parent}")["tree"]["sha"]
    tree = api.request("git/trees", tree_input)
    commit = api.request("git/commits", {"message": f"Mobile review images for PR #{pr['number']} at {manifest['head'][:12]}", "tree": tree["sha"], "parents": [parent] if parent else []})
    if parent:
        api.request(f"git/refs/heads/{IMAGE_BRANCH}", {"sha": commit["sha"], "force": False}, "PATCH")
    else:
        api.request("git/refs", {"ref": f"refs/heads/{IMAGE_BRANCH}", "sha": commit["sha"]})
    # Never replace newer evidence if a commit arrived during publication.
    latest = current_pr(api, run, pr["number"])
    if latest is None or latest["base"]["sha"] != manifest["base"]:
        print("PR changed while images were published; comment not changed.")
        return
    raw_url = f"https://raw.githubusercontent.com/{api.repository}/{commit['sha']}/{prefix}"
    lines = [MARKER, "### Mobile screenshots", "",
             f"Before `{manifest['base'][:12]}` · After `{manifest['head'][:12]}` · [Capture run]({run_url})", "",
             "393 × 852 browser viewport, dark/light themes, artificial household data. Static images do not verify Android keyboards, device performance or motion. Authors must add scenarios for changed screens outside this set.", "",
             "Difference images mark changed pixels in magenta. Unchanged captured states are omitted.", "",
             "| Screen or state | Before | After | Difference |", "| --- | --- | --- | --- |"]
    for filename, caption in SCREENS.items():
        if f"after/{filename}" not in images:
            continue
        lines.append(f'| {caption} | <img src="{raw_url}/before/{filename}" width="240" alt="Before: {caption}"> | <img src="{raw_url}/after/{filename}" width="240" alt="After: {caption}"> | <img src="{raw_url}/difference/{filename}" width="240" alt="Changed pixels: {caption}"> |')
    comment(api, latest, "\n".join(lines))
    print(f"Published mobile screenshot comparison on PR #{pr['number']}.")


if __name__ == "__main__":
    identifier = os.environ["COVAULT_SCREENSHOT_RUN_ID"]
    if not re.fullmatch(r"[1-9][0-9]*", identifier):
        raise ValueError("Invalid workflow run id")
    try:
        publish(GitHub(os.environ["GITHUB_REPOSITORY"], os.environ["GH_TOKEN"]), int(identifier))
    except urllib.error.HTTPError as error:
        raise SystemExit(f"Screenshot publication failed with HTTP status {error.code}.") from None
    except urllib.error.URLError:
        raise SystemExit("Screenshot publication failed during a network request.") from None
