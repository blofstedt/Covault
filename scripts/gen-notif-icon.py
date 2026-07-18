#!/usr/bin/env python3
"""
Generate Android notification small-icon PNGs from icons/icon-512.png.

The source icon is the brand vault (emerald background, white strokes).
For Android status bar icons we need a monochrome white-on-transparent
version so the system can tint it at render time via iconColor.
We keep the same proportions as the launcher icon, but inset the
artwork to the inner ~66% safe zone so status-bar masks don't clip it.
"""
from PIL import Image
import os

SRC = "/workspace/Covault/icons/icon-512.png"
OUT_DIR = "/workspace/Covault/android-custom/res"
DPI_TO_DIR = {
    "mdpi": "mipmap-mdpi",
    "hdpi": "mipmap-hdpi",
    "xhdpi": "mipmap-xhdpi",
    "xxhdpi": "mipmap-xxhdpi",
    "xxxhdpi": "mipmap-xxxhdpi",
}
DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
# Inner safe zone fraction (the system applies a circular/squircle mask
# at render time; anything outside this gets clipped on most devices).
SAFE = 0.66

def render(brand_img, target_size):
    # Downsample the brand PNG to the target size, with a high-quality
    # filter so the strokes stay smooth.
    small = brand_img.resize((target_size, target_size), Image.LANCZOS).convert("RGBA")
    px = small.load()
    # Phase 1: turn every white-ish pixel into pure white, everything
    # else (the emerald background) into fully transparent. Anti-aliased
    # edge pixels become partial white = clean alpha falloff.
    mono = Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))
    mpx = mono.load()
    for y in range(target_size):
        for x in range(target_size):
            r, g, b, _ = px[x, y]
            # White strokes in the source have high R, G, and B. The
            # emerald background is low R / high G / mid B. Using the
            # minimum of (R, B) versus G picks the strokes cleanly.
            whiteness = min(r, b) / max(g, 1)
            if whiteness > 0.85:
                # Solid white stroke
                mpx[x, y] = (255, 255, 255, 255)
            else:
                # Compute alpha from whiteness so anti-aliased edges
                # render smoothly against any background.
                if whiteness > 0.6:
                    a = int((whiteness - 0.6) / 0.25 * 255)
                    mpx[x, y] = (255, 255, 255, max(0, min(255, a)))
                else:
                    mpx[x, y] = (0, 0, 0, 0)
    # Phase 2: inset to safe zone so status-bar masks don't clip the
    # outer vault rectangle.
    safe_size = int(round(target_size * SAFE))
    pad = (target_size - safe_size) // 2
    final = Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))
    final.paste(mono, (pad, pad), mono)
    return final

def main():
    brand = Image.open(SRC).convert("RGBA")
    for dpi, size in DENSITIES.items():
        out_dir = os.path.join(OUT_DIR, DPI_TO_DIR[dpi])
        os.makedirs(out_dir, exist_ok=True)
        out = os.path.join(out_dir, "ic_stat_covault.png")
        render(brand, size).save(out, "PNG", optimize=True)
        print(f"wrote {out} ({size}x{size})")

if __name__ == "__main__":
    main()
