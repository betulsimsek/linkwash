#!/usr/bin/env python3
# Run: python3 icons/generate.py   (requires Pillow)
# Draws a chain link with a sparkle on a green tile at 1024px, then downsamples.
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).parent
S = 1024
GREEN = (15, 110, 86, 255)
WHITE = (255, 255, 255, 255)
MINT = (157, 230, 205, 255)


def link_piece(size, w, h, stroke, angle, offset):
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy = size / 2 + offset[0], size / 2 + offset[1]
    d.rounded_rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], radius=h / 2, outline=WHITE, width=stroke)
    return layer.rotate(angle, resample=Image.BICUBIC, center=(size / 2, size / 2))


def sparkle(d, cx, cy, r, color):
    k = r * 0.22
    d.polygon([(cx, cy - r), (cx + k, cy - k), (cx + r, cy), (cx + k, cy + k),
               (cx, cy + r), (cx - k, cy + k), (cx - r, cy), (cx - k, cy - k)], fill=color)


img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(img).rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.22, fill=GREEN)

stroke = int(S * 0.085)
w, h = S * 0.46, S * 0.25
img.alpha_composite(link_piece(S, w, h, stroke, 45, (-S * 0.13, 0)))
img.alpha_composite(link_piece(S, w, h, stroke, 45, (S * 0.13, 0)))

d = ImageDraw.Draw(img)
sparkle(d, S * 0.76, S * 0.24, S * 0.11, MINT)
sparkle(d, S * 0.25, S * 0.77, S * 0.06, MINT)

for size in (16, 32, 48, 128):
    img.resize((size, size), Image.LANCZOS).save(HERE / f"icon{size}.png")
img.resize((512, 512), Image.LANCZOS).save(HERE / "icon512.png")
print("icons written")
