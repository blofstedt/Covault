#!/usr/bin/env python3
"""
Render the Covault status-bar notification icon at all Android
mipmap densities.

This is a faithful port of components/CovaultIcon.tsx — the React
component that renders the actual Covault brand mark on the login
screen and inside the app. We deliberately do NOT use
icons/icon-512.png because that file is stale and does not match
the installed launcher.

Layout (from CovaultIcon.tsx, viewBox 0 0 24):
  - Rounded square outline:  <rect x=3 y=3 w=18 h=18 rx=2 strokeWidth=2.5/>
  - Centered circle:         <circle cx=12 cy=12 r=4 strokeWidth=2.5/>
  - Four tiny ticks:         M12 8v1 / M12 15v1 / M8 12h1 / M15 12h1
  - Diagonal handle:         M12 12l2 2

For the small status bar icon we render this as white-on-transparent
so Android can tint it via iconColor at runtime. The artwork is
inset to the inner 66% safe zone so the status-bar mask doesn't
clip the outer rounded rectangle.
"""
from PIL import Image, ImageDraw
import os

OUT_DIR = "/workspace/Covault/android-custom/res"
DPI_TO_DIR = {
    "mdpi": "mipmap-mdpi",
    "hdpi": "mipmap-hdpi",
    "xhdpi": "mipmap-xhdpi",
    "xxhdpi": "mipmap-xxhdpi",
    "xxxhdpi": "mipmap-xxxhdpi",
}
DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
SAFE = 0.66
STROKE_W = 2.5
RENDER = 512  # render at high res, downsample for AA

def rounded_rect_outline(canvas_size, rect, radius, stroke_w):
    """White rounded-rect outline (outer fill, inner transparent)."""
    img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(rect, radius=radius, fill=(255, 255, 255, 255))
    x0, y0, x1, y1 = rect
    inner = (x0 + stroke_w, y0 + stroke_w, x1 - stroke_w, y1 - stroke_w)
    inner_r = max(0, radius - stroke_w)
    d.rounded_rectangle(inner, radius=inner_r, fill=(0, 0, 0, 0))
    return img

def circle_ring(canvas_size, cx, cy, r_outer, stroke_w):
    """White circle outline (outer fill, inner transparent)."""
    img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer),
              fill=(255, 255, 255, 255))
    r_inner = r_outer - stroke_w
    if r_inner > 0:
        d.ellipse((cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner),
                  fill=(0, 0, 0, 0))
    return img

def tick(canvas_size, bbox):
    """Small filled rect (one of the four compass-point ticks)."""
    img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle(bbox, fill=(255, 255, 255, 255))
    return img

def diagonal_line(canvas_size, p0, p1, width):
    """Thick line with round caps (the 'handle' element)."""
    img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.line([p0, p1], fill=(255, 255, 255, 255), width=width)
    # Round caps by stamping small circles at the endpoints
    r = width // 2
    if r > 0:
        d.ellipse((p0[0] - r, p0[1] - r, p0[0] + r, p0[1] + r),
                  fill=(255, 255, 255, 255))
        d.ellipse((p1[0] - r, p1[1] - r, p1[0] + r, p1[1] + r),
                  fill=(255, 255, 255, 255))
    return img

def render(px):
    s = px / 24.0
    sw = max(1, round(STROKE_W * s))

    # Rounded square outline (rect x=3 y=3 w=18 h=18 rx=2)
    rx0 = round(3 * s); ry0 = round(3 * s)
    rx1 = round(21 * s) - 1; ry1 = round(21 * s) - 1
    radius = round(2 * s)
    layer_rect = rounded_rect_outline(px, (rx0, ry0, rx1, ry1), radius, sw)

    # Centered circle ring (cx=12 cy=12 r=4)
    cx = round(12 * s); cy = round(12 * s)
    r_outer = round(4 * s)
    layer_circle = circle_ring(px, cx, cy, r_outer, sw)

    # Diagonal handle (M12 12 l2 2) — from center to (14,14)
    hx0, hy0 = round(12 * s), round(12 * s)
    hx1, hy1 = round(14 * s), round(14 * s)
    layer_handle = diagonal_line(px, (hx0, hy0), (hx1, hy1), sw)

    # Ticks (M12 8 v1 / M12 15 v1 / M8 12 h1 / M15 12 h1) — at 24dp
    # these collapse to sub-pixel and add nothing useful. Skip them
    # in the small icon; the user reads the outer rect + center dot
    # + handle just fine without them, and it stays clean at mdpi.

    out = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    for layer in (layer_rect, layer_circle, layer_handle):
        out.alpha_composite(layer)

    # Inset to the inner safe zone (66% of canvas).
    safe = int(round(px * SAFE))
    pad = (px - safe) // 2
    inset = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    inset.paste(out, (pad, pad), out)
    return inset

def main():
    hires = render(RENDER)
    for dpi, size in DENSITIES.items():
        out_dir = os.path.join(OUT_DIR, DPI_TO_DIR[dpi])
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, "ic_stat_covault.png")
        final = hires.resize((size, size), Image.LANCZOS)
        final.save(out_path, "PNG", optimize=True)
        print(f"wrote {out_path} ({size}x{size})")

if __name__ == "__main__":
    main()
