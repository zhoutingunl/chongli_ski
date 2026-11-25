"""Resize large graphics to the offline tool's mobile texture budget."""
from pathlib import Path
from sys import argv

from PIL import Image

assets = Path(argv[1]) / 'assets'
for relative, width, quality in (
    ('art/ridgeline.webp', 1500, 78),
    ('art/fitting-ski.webp', 800, 82),
    ('art/fitting-board.webp', 800, 82),
    ('art/treeline.webp', 1536, 80),
    ('geo/winter.jpg', 864, 82),
    ('geo/horizon.jpg', 864, 80),
):
    filename = assets / relative
    with Image.open(filename) as original:
        height = round(original.height * width / original.width)
        image = original.resize((width, height), Image.Resampling.LANCZOS)
    if filename.suffix == '.webp':
        image.save(filename, quality=quality, method=6, exact=True)
    else:
        image.save(filename, quality=quality, optimize=True, progressive=True)


# The near crowns are geometry. At the handoff distance the mobile renderer
# can sample a smaller tree card; the art pack still works entirely offline.
root = assets.parent
for pattern, max_width in [('chongli-grove-*.webp', 768),
                           ('chongli-paint-*-sky-*.webp', 1536),
                           ('chongli-paint-*-snow-*.webp', 640)]:
    for filename in root.glob(pattern):
        with Image.open(filename) as original:
            scaled = original.copy()
        scaled.thumbnail((max_width, max_width), Image.Resampling.LANCZOS)
        scaled.save(filename, quality=83, method=6, exact=True)
