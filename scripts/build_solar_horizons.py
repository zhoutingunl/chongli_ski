"""Bake a small directional horizon atlas from the same DEM used by the skis."""
import json
from pathlib import Path

import numpy as np
from PIL import Image

assets = Path(__file__).resolve().parents[1] / 'public' / 'assets' / 'geo'
mountain = json.loads((assets / 'mountain.json').read_text())
dem, bounds = mountain['dem'], mountain['bounds']
heights = np.asarray(dem['heights'], dtype=float).reshape(dem['rows'], dem['cols'])
spacing = (bounds['maxX'] - bounds['minX']) / (dem['cols'] - 1)
size = 192

def terrain(x, z):
    column = np.clip(x, 0, dem['cols'] - 1.000001)
    row = np.clip(z, 0, dem['rows'] - 1.000001)
    i, j = column.astype(int), row.astype(int)
    u, v = column - i, row - j
    return np.where(u + v < 1,
        heights[j, i] + (heights[j, i + 1] - heights[j, i]) * u
                      + (heights[j + 1, i] - heights[j, i]) * v,
        heights[j + 1, i + 1] + (heights[j + 1, i] - heights[j + 1, i + 1]) * (1 - u)
                              + (heights[j, i + 1] - heights[j + 1, i + 1]) * (1 - v))

x, z = np.meshgrid((np.arange(size) + .5) / size * (dem['cols'] - 1),
                   (np.arange(size) + .5) / size * (dem['rows'] - 1))
surface = terrain(x, z)
atlas = np.zeros((size * 2, size * 2), np.uint8)
azimuths = (-1.36, -.45, .45, 1.36)
for index, angle in enumerate(azimuths):
    blocked = np.zeros_like(surface)
    # Short and long distances account for terrain immediately in front of
    # a ray as well as higher ridges across the next valley.
    for distance in np.geomspace(32, 4200, 39):
        rise = terrain(x + np.sin(angle) * distance / spacing, z + np.cos(angle) * distance / spacing) - surface
        blocked = np.maximum(blocked, (rise - 2) / distance)
    i, j = index % 2 * size, index // 2 * size
    # The transition in the shader is wider than one of these 64 levels.
    levels = np.rint(np.clip(blocked, 0, .95) * (63 / .95))
    atlas[j:j+size, i:i+size] = np.rint(levels * (255 / 63)).astype(np.uint8)
Image.fromarray(atlas).save(assets / 'solar-horizons.png', optimize=True)

