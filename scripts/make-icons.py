#!/usr/bin/env python3
"""Generate PWA icons for Pages Reader.

Draws a document icon on a blue/gold gradient — matches the in-app brand mark.
Outputs:
  images/favicon.png        (64x64)
  images/apple-touch-icon.png (180x180)
  images/icon-192.png       (192x192)
  images/icon-512.png       (512x512)
  images/icon-512-maskable.png (512x512, safe zone aware)
"""
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "images"
OUT.mkdir(parents=True, exist_ok=True)

# Brand colours (match index.html)
ACCENT = (44, 111, 184)        # slate blue
ACCENT_DEEP = (31, 78, 133)
GOLD = (212, 160, 76)
PAPER = (255, 253, 248)
INK_SOFT = (140, 100, 50)

def make_icon(size: int, maskable: bool = False) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background — rounded square with diagonal blue gradient
    corner = int(size * (0.22 if not maskable else 0.50))  # full-round mask if maskable
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bg_draw = ImageDraw.Draw(bg)
    # Diagonal gradient approximation by stacking thin rectangles
    grad = Image.new("RGB", (size, size), ACCENT)
    gd = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / size
        r = int(ACCENT[0] * (1 - t) + ACCENT_DEEP[0] * t)
        g = int(ACCENT[1] * (1 - t) + ACCENT_DEEP[1] * t)
        b = int(ACCENT[2] * (1 - t) + ACCENT_DEEP[2] * t)
        gd.line([(0, y), (size, y)], fill=(r, g, b))
    # Mask to rounded square
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, size, size], radius=corner, fill=255)
    bg.paste(grad, (0, 0), mask)

    # Soft gold glow in top-left
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse(
        [-size * 0.2, -size * 0.2, size * 0.6, size * 0.6],
        fill=(*GOLD, 110),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(radius=size * 0.08))
    bg = Image.alpha_composite(bg, Image.composite(glow, Image.new("RGBA", (size, size), (0, 0, 0, 0)), mask))

    img = Image.alpha_composite(img, bg)
    draw = ImageDraw.Draw(img)

    # Safe zone for maskable: shrink the doc into ~80% of canvas
    inset_factor = 0.30 if maskable else 0.22
    doc_w = int(size * (1 - 2 * inset_factor))
    doc_h = int(doc_w * 1.28)
    doc_x = (size - doc_w) // 2
    doc_y = (size - doc_h) // 2

    # Page shadow
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    radius = int(doc_w * 0.10)
    sd.rounded_rectangle(
        [doc_x + size * 0.02, doc_y + size * 0.025, doc_x + doc_w + size * 0.02, doc_y + doc_h + size * 0.025],
        radius=radius, fill=(0, 0, 0, 70),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=size * 0.025))
    img = Image.alpha_composite(img, shadow)
    draw = ImageDraw.Draw(img)

    # Page body
    fold = int(doc_w * 0.26)
    # Main rectangle (rounded)
    draw.rounded_rectangle(
        [doc_x, doc_y, doc_x + doc_w, doc_y + doc_h],
        radius=radius, fill=PAPER,
    )
    # Folded top-right corner
    corner_poly = [
        (doc_x + doc_w - fold, doc_y),
        (doc_x + doc_w, doc_y + fold),
        (doc_x + doc_w - fold, doc_y + fold),
    ]
    draw.polygon(corner_poly, fill=(235, 222, 200))

    # Text lines
    line_x = doc_x + int(doc_w * 0.12)
    line_x2 = doc_x + int(doc_w * 0.88)
    line_thickness = max(2, int(size * 0.012))
    start_y = doc_y + int(doc_h * 0.45)
    gap = int(doc_h * 0.10)
    for i in range(4):
        y = start_y + i * gap
        # Last line shorter
        x_end = line_x2 if i < 3 else doc_x + int(doc_w * 0.62)
        colour = ACCENT if i == 0 else INK_SOFT
        # Round-capped line via two ellipses + rect
        draw.line([(line_x, y), (x_end, y)], fill=colour, width=line_thickness)

    return img

def save(img: Image.Image, name: str):
    p = OUT / name
    img.save(p, "PNG", optimize=True)
    print(f"wrote {p}  ({p.stat().st_size} bytes)")

if __name__ == "__main__":
    save(make_icon(64), "favicon.png")
    save(make_icon(180), "apple-touch-icon.png")
    save(make_icon(192), "icon-192.png")
    save(make_icon(512), "icon-512.png")
    save(make_icon(512, maskable=True), "icon-512-maskable.png")
    print("done.")
