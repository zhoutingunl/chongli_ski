"""Resize large graphics to the offline tool's mobile texture budget."""
from pathlib import Path
from sys import argv

from PIL import Image

assets = Path(argv[1]) / 'assets'
for relative, width, quality in (
    ('art/ridgeline.webp', 1500, 78),
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

