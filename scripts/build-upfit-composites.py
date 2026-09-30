"""
Combine the five per-side vehicle photos (driver / passenger / front / rear /
top) into ONE diagram image per vehicle, laid out like the single-image
templates: roof view down the left, both sides in the middle, front and rear
on the right.

    pip install pillow
    python3 scripts/build-upfit-composites.py

Writes public/upfit-templates/<slug>.jpg for each folder template and prints
the per-view placement map that src/lib/upfit/composites.ts needs, so pins
saved on the old one-page-per-side diagrams can be moved onto the combined
picture. Re-run only when a source photo changes, then paste the map.
"""
import json
from PIL import Image

ROOT = "public/upfit-templates"
# Logical view -> file, matching sideViews() overrides in templates.ts
# (these folders saved the passenger and rear photos under swapped names).
SWAPPED = {"passenger": "rear.jpg", "rear": "passenger.jpg"}
TEMPLATES = {
    "tahoe": SWAPPED,
    "tahoe_2026": SWAPPED,
    "tahoe_1520": SWAPPED,
    "silverado": SWAPPED,
    "explorer": {},
}
VIEWS = ["driver", "passenger", "front", "rear", "top"]

SIDE_W = 1400      # px width of each side view in the composite
GAP = 50
MARGIN = 40
WHITE = (255, 255, 255)


def vehicle_box(im):
    """Bounding box of the vehicle: non-white pixels between the branded
    header (top ~12%) and the footer badge (below ~80%)."""
    w, h = im.size
    # Skip the thin page border drawn round each photo.
    x0, x1 = int(w * 0.015), int(w * 0.985)
    y0, y1 = int(h * 0.12), int(h * 0.80)
    band = im.crop((x0, y0, x1, y1)).convert("L")
    mask = band.point(lambda p: 255 if p < 236 else 0)
    bx = mask.getbbox()
    if not bx:
        return (x0, y0, x1, y1)
    pad = 12
    return (
        max(x0, bx[0] + x0 - pad),
        max(y0, bx[1] + y0 - pad),
        min(x1, bx[2] + x0 + pad),
        min(y1, bx[3] + y0 + pad),
    )


def fit(im, box_w, box_h):
    s = min(box_w / im.width, box_h / im.height)
    return im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS), s


def build(slug, files):
    src = {}
    for v in VIEWS:
        im = Image.open(f"{ROOT}/{slug}/{files.get(v, v + '.jpg')}").convert("RGB")
        box = vehicle_box(im)
        src[v] = (im, box)

    # Scale the sides to SIDE_W; that fixes the row height.
    crops = {v: im.crop(box) for v, (im, box) in src.items()}
    side_h = max(round(crops[v].height * SIDE_W / crops[v].width) for v in ("driver", "passenger"))
    row_h = side_h
    placed = {}
    driver, _ = fit(crops["driver"], SIDE_W, row_h)
    passenger, _ = fit(crops["passenger"], SIDE_W, row_h)
    front, _ = fit(crops["front"], SIDE_W, row_h)
    rear, _ = fit(crops["rear"], SIDE_W, row_h)
    # Roof view turned so the nose points down, spanning both rows.
    top_rot = crops["top"].rotate(-90, expand=True)
    top, _ = fit(top_rot, SIDE_W, 2 * row_h + GAP)
    fr_w = max(front.width, rear.width)

    W = MARGIN + top.width + GAP + SIDE_W + GAP + fr_w + MARGIN
    H = MARGIN + 2 * row_h + GAP + MARGIN
    # Keep the branded title strip from the driver photo across the top.
    dim, _ = src["driver"]
    header = dim.crop((0, 0, dim.width, int(dim.height * 0.105)))
    header = header.resize((W, round(header.height * W / header.width)), Image.LANCZOS)
    HH = header.height
    out = Image.new("RGB", (W, H + HH), WHITE)
    out.paste(header, (0, 0))

    def put(v, im, x, y):
        out.paste(im, (x, y + HH))
        placed[v] = (x, y + HH, im.width, im.height)

    colA = MARGIN
    colB = colA + top.width + GAP
    colC = colB + SIDE_W + GAP
    put("top", top, colA, MARGIN + (2 * row_h + GAP - top.height) // 2)
    put("driver", driver, colB + (SIDE_W - driver.width) // 2, MARGIN + (row_h - driver.height) // 2)
    put("passenger", passenger, colB + (SIDE_W - passenger.width) // 2, MARGIN + row_h + GAP + (row_h - passenger.height) // 2)
    put("front", front, colC + (fr_w - front.width) // 2, MARGIN + (row_h - front.height) // 2)
    put("rear", rear, colC + (fr_w - rear.width) // 2, MARGIN + row_h + GAP + (row_h - rear.height) // 2)
    out.save(f"{ROOT}/{slug}.jpg", quality=88, optimize=True)

    CW, CH = out.size
    mapping = {}
    for v in VIEWS:
        im, (x0, y0, x1, y1) = src[v]
        px, py, pw, ph = placed[v]
        mapping[v] = {
            # Where the vehicle sat in the old one-side photo (fractions).
            "src": [round(x0 / im.width, 5), round(y0 / im.height, 5), round((x1 - x0) / im.width, 5), round((y1 - y0) / im.height, 5)],
            # Where it sits in the combined picture (fractions).
            "dst": [round(px / CW, 5), round(py / CH, 5), round(pw / CW, 5), round(ph / CH, 5)],
            "rotate": 90 if v == "top" else 0,
        }
    return {"size": [CW, CH], "views": mapping}


if __name__ == "__main__":
    result = {slug: build(slug, files) for slug, files in TEMPLATES.items()}
    print(json.dumps(result, indent=2))
