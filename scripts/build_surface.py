"""Reproject the winter photograph and forest classification onto the game's meter grid.

Run after build_mountain.py with Pillow, NumPy and rasterio installed. GDAL
requests only the intersecting image blocks from the public Cloud Optimized TIFFs.
"""

import json

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.vrt import WarpedVRT

from build_mountain import DEST, EAST_SCALE, NORTH_SCALE, ORIGIN_LAT, ORIGIN_LON

SCENE_ID = 'S2B_50TLL_20250121_0_L2A'
WINTER_URL = ('https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/'
              f'50/T/LL/2025/1/{SCENE_ID}/TCI.tif')
COVER_URL = ('https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/'
             'ESA_WorldCover_10m_2021_v200_N39E114_Map.tif')
SIZE = 1024


def projected(url, indexes, transform, method, overview=None):
    options = {'overview_level': overview} if overview is not None else {}
    with rasterio.open(url, **options) as src, WarpedVRT(src, crs='EPSG:4326', transform=transform,
                                                       width=SIZE, height=SIZE, resampling=method) as vrt:
        return vrt.read(indexes)


def grid_transform(key):
    bounds = json.loads((DEST / f'{key}.json').read_text())['bounds']
    return from_bounds(ORIGIN_LON + bounds['minX'] / EAST_SCALE,
                       ORIGIN_LAT - bounds['maxZ'] / NORTH_SCALE,
                       ORIGIN_LON + bounds['maxX'] / EAST_SCALE,
                       ORIGIN_LAT - bounds['minZ'] / NORTH_SCALE, SIZE, SIZE)


def main():
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', VSI_CACHE='TRUE'):
        # Use the 40 m source overview for the 48 m distant terrain pixels.
        for key, filename, level in [('mountain', 'winter.jpg', None), ('horizon', 'horizon.jpg', 1)]:
            rgb = projected(WINTER_URL, [1, 2, 3], grid_transform(key), Resampling.bilinear, level)
            Image.fromarray(np.moveaxis(rgb, 0, -1)).save(DEST / filename, quality=91, optimize=True)
        classes = projected(COVER_URL, 1, grid_transform('mountain'), Resampling.nearest)
        Image.fromarray(np.uint8(classes == 10) * 255).save(DEST / 'forest.png', optimize=True)


if __name__ == '__main__':
    main()
