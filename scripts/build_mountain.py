"""Build the bundled Chongli terrain and ski geometry from public source data.

Usage: python3 scripts/build_mountain.py [--cache /path/to/download-cache]
Requires Pillow. The game reads the resulting JSON without network services.
"""

import argparse
import json
import math
import re
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

from PIL import Image
if __package__:
    from .piste_catalog import add_piste_catalog
else:
    from piste_catalog import add_piste_catalog

ORIGIN_LON, ORIGIN_LAT = 115.400, 40.954
RADIANS = math.pi / 180
# Linear true-ground grid, using the local WGS84 ellipsoid radii of curvature.
A = 6378137
E2 = 6.6943799901413165e-3
LAT_FACTOR = 1 - E2 * math.sin(ORIGIN_LAT * RADIANS) ** 2
EAST_SCALE = RADIANS * A * math.cos(ORIGIN_LAT * RADIANS) / math.sqrt(LAT_FACTOR)
NORTH_SCALE = RADIANS * A * (1 - E2) / LAT_FACTOR ** 1.5
OSM_MAP = 'https://api.openstreetmap.org/api/0.6/map?bbox=115.35,40.905,115.456,40.99'
# Three mapped buildings at the north end of the Wanlong arrival road.
# Include them without widening the ski-way filter or changing any terrain.
WANLONG_ARRIVAL_BUILDINGS = {1153883034, 1153883035, 1153883036}
TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{}/{}/{}.png'
DEST = Path(__file__).resolve().parents[1] / 'public' / 'assets' / 'geo'


def local(lon, lat):
    return [round((lon - ORIGIN_LON) * EAST_SCALE, 1), round((ORIGIN_LAT - lat) * NORTH_SCALE, 1)]


def download(path, url):
    if not path.exists():
        request = urllib.request.Request(url, headers={'User-Agent': 'Chongli-Ski-Terrain/1.0'})
        with urllib.request.urlopen(request, timeout=70) as response:
            data = response.read()
        staging = path.with_suffix(path.suffix + '.part')
        staging.write_bytes(data)
        staging.replace(path)
    return path


class Terrain:
    def __init__(self, cache, half_size, step, zoom):
        self.zoom = zoom
        self.half_size = half_size
        self.step = step
        self.pixel_width = 256 * 2 ** zoom
        self.cols = 2 * half_size // step + 1
        assert (self.cols - 1) * step == half_size * 2
        # Load all source tiles that contribute pixels to the target grid.
        west, north = self.pixel(-half_size, -half_size)
        east, south = self.pixel(half_size, half_size)
        keys = [(i, j) for i in range(math.floor(west / 256), math.floor((east + 1) / 256) + 1)
                for j in range(math.floor(north / 256), math.floor((south + 1) / 256) + 1)]

        def tile(key):
            tx, ty = key
            source = download(cache / f'{zoom}_{tx}_{ty}.png', TILE_URL.format(zoom, tx, ty))
            with Image.open(source) as image:
                return key, image.convert('RGB').tobytes()

        with ThreadPoolExecutor(max_workers=4) as workers:
            self.tiles = dict(workers.map(tile, keys))
        self.heights = [round(self.source_height(x, z))
                        for z in range(-half_size, half_size + 1, step)
                        for x in range(-half_size, half_size + 1, step)]

    def pixel(self, x, z):
        lon = ORIGIN_LON + x / EAST_SCALE
        lat = ORIGIN_LAT - z / NORTH_SCALE
        # Terrarium values sit at pixel centers.
        return ((lon + 180) / 360 * self.pixel_width - 0.5,
                (1 - math.asinh(math.tan(lat * RADIANS)) / math.pi) * self.pixel_width / 2 - 0.5)

    def sample(self, u, v):
        data = self.tiles[(u // 256, v // 256)]
        index = 3 * ((v % 256) * 256 + (u % 256))
        return data[index] * 256 + data[index + 1] + data[index + 2] / 256 - 32768

    def source_height(self, x, z):
        u, v = self.pixel(x, z)
        a, b = math.floor(u), math.floor(v)
        fx, fz = u - a, v - b
        north = self.sample(a, b) * (1 - fx) + self.sample(a + 1, b) * fx
        south = self.sample(a, b + 1) * (1 - fx) + self.sample(a + 1, b + 1) * fx
        return north * (1 - fz) + south * fz

    def export(self):
        return {'bounds': {'minX': -self.half_size, 'maxX': self.half_size,
                           'minZ': -self.half_size, 'maxZ': self.half_size},
                'dem': {'rows': self.cols, 'cols': self.cols, 'step': self.step, 'heights': self.heights}}


def tags(element):
    return {t.get('k'): t.get('v') for t in element.findall('tag')}


def on_mountain(point):
    x, z = point
    return -2910 < x < 3020 and -2050 < z < 2170


def polygon_center(points):
    pairs = list(zip(points, points[1:]))
    crosses = [a[0] * b[1] - b[0] * a[1] for a, b in pairs]
    double_area = sum(crosses)
    if abs(double_area) < 1:
        return points[0]
    return [round(sum((a[i] + b[i]) * cross for (a, b), cross in zip(pairs, crosses))
                  / (3 * double_area), 1) for i in (0, 1)]


def points_length(points):
    return sum(math.dist(a, b) for a, b in zip(points, points[1:]))


def trail_width(name, tags_, difficulty):
    if tags_.get('width', '').replace('.', '', 1).isdigit():
        return float(tags_['width'])
    # Approximate prepared widths, in metres, where the centerline lacks a survey width.
    if '连接道' in name:
        return 15
    overrides = {'芍药花': 30, '翠菊花': 15, '长龙道': 26, '玉龙道': 42,
                 '金龙道': 45, '蒲公英': 35, '曼陀罗': 45, '雪绒花': 36, '锦带花': 32}
    return overrides.get(name, {'advanced': 38, 'intermediate': 34, 'easy': 30}[difficulty])


def split_ref(name):
    match = re.match(r'^(\d+[A-Za-z]?)\s*(.+)$', name)
    return (match[1], match[2].strip()) if match else ('', name)


# Each consecutive pair below has a verified common OSM node. Using node ids to
# join the ways preserves both crossover directions and their shared branches.
LONG_UP = 1353185032
LONG_LOW = 771169386
JADE = 483990518
GOLD = 259702567
SILVER_UP = 259702565
SILVER_STEEP = 1353185034
PEONY = 878706035
EDELWEISS = 771168491
WEIGELA = 771168492
LOUNGE = 1155259832
LILY = 878706034
ASTER = 1349252976
DATURA = 771168506
LYCHNIS = 1353185035

ITINERARIES = [
    ('wanlong-classic', '长龙道 · 玉龙道', 'wanlong', 'wanlong', 'intermediate', [LONG_UP, JADE]),
    ('genting-classic', '芍药花 · 雪绒花', 'genting', 'genting', 'intermediate', [PEONY, EDELWEISS, WEIGELA]),
    ('wanlong-to-genting', '山丹丹联滑线', 'wanlong', 'genting', 'intermediate', [LONG_UP, LILY, PEONY, EDELWEISS, WEIGELA]),
    ('genting-to-wanlong', '翠菊花联滑线', 'genting', 'wanlong', 'intermediate', [PEONY, ASTER, LONG_UP, JADE]),
    ('wanlong-long', '长龙道 · 卧龙道', 'wanlong', 'wanlong', 'intermediate', [LONG_UP, LONG_LOW, LOUNGE]),
    ('genting-valley', '曼陀罗 · 剪秋萝', 'genting', 'genting', 'intermediate', [DATURA, LYCHNIS]),
    ('wanlong-gold', '金龙道 · 玉龙道', 'wanlong', 'wanlong', 'advanced', [GOLD, JADE]),
    ('wanlong-silver', '银龙道 · 大奔头', 'wanlong', 'wanlong', 'advanced', [SILVER_UP, SILVER_STEEP, JADE]),
]


def itinerary(recipe, way_nodes, coordinates, height):
    ident, name, resort, destination, difficulty, ids = recipe
    points, legs, way_lists = [], [], [way_nodes[i] for i in ids]
    joins = []
    for a, b in zip(way_lists, way_lists[1:]):
        shared = set(a).intersection(b)
        if len(shared) != 1:
            raise ValueError(f'Snow route junction changed in {ident}: {shared}')
        joins.append(shared.pop())
    for i, way in enumerate(way_lists):
        start = way.index(joins[i - 1]) if i else 0
        end = way.index(joins[i]) if i < len(joins) else len(way) - 1
        if start >= end:
            raise ValueError(f'Non-descending way order in {ident}')
        segment = [coordinates[node] for node in way[start:end + 1]]
        start_index = max(0, len(points) - 1)
        if i and points[-1] != segment[0]:
            raise ValueError(f'Disconnected itinerary in {ident}')
        points.extend(segment[1:] if i else segment)
        legs.append({'trailId': f'w{ids[i]}', 'startIndex': start_index, 'endIndex': len(points) - 1})
    return {'id': ident, 'name': name, 'resort': resort, 'destination': destination,
            'difficulty': difficulty, 'trailIds': [l['trailId'] for l in legs], 'legs': legs,
            'points': points, 'distance': round(points_length(points)),
            'drop': round(height(*points[0]) - height(*points[-1]))}


def mapped_features(xml, terrain):
    root = ET.parse(xml).getroot()
    nodes = {int(n.get('id')): n for n in root.findall('node')}
    coordinates = {i: local(float(n.get('lon')), float(n.get('lat'))) for i, n in nodes.items()}
    ways = {int(w.get('id')): w for w in root.findall('way')}
    way_nodes = {i: [int(n.get('ref')) for n in w.findall('nd')] for i, w in ways.items()}
    trails, lifts, buildings, water = [], [], [], []
    for osm_id, way in ways.items():
        attributes = tags(way)
        points = [coordinates[i] for i in way_nodes[osm_id]]
        extra_building = 'building' in attributes and osm_id in WANLONG_ARRIVAL_BUILDINGS
        if not points or not (on_mountain(points[0]) or extra_building):
            continue
        obj_id = f'w{osm_id}'
        source_name = attributes.get('name', '')
        if attributes.get('piste:type') == 'downhill' and points[0] != points[-1]:
            ref, name = split_ref(source_name)
            difficulty = {'novice': 'easy', 'expert': 'advanced'}.get(
                attributes.get('piste:difficulty'), attributes.get('piste:difficulty', 'intermediate'))
            resort = ('link' if '连接道' in name else 'wanlong' if '龙' in name or not name and points[0][0] < 0 else 'genting')
            trails.append({'id': obj_id, 'name': name or '山脊连接道', 'ref': ref,
                           'resort': resort, 'difficulty': difficulty, 'points': points,
                           'width': trail_width(name, attributes, difficulty)})
        lift_type = attributes.get('aerialway')
        if lift_type in ('chair_lift', 'gondola', 'mixed_lift') and (source_name or osm_id == 956358945):
            ascending = terrain.source_height(*points[0]) <= terrain.source_height(*points[-1])
            lift_nodes = way_nodes[osm_id] if ascending else way_nodes[osm_id][::-1]
            sorted_points = points if ascending else points[::-1]
            resort = 'wanlong' if points[0][0] < 0 else 'genting'
            kind = ('mixed' if osm_id == 469393391 else 'chair' if lift_type == 'chair_lift' else 'gondola')
            lifts.append({'id': obj_id, 'name': source_name or '雪上技巧索道', 'resort': resort, 'kind': kind,
                          'bubble': attributes.get('aerialway:bubble') == 'yes', 'points': sorted_points,
                          'towerIndices': [j for j, n in enumerate(lift_nodes) if tags(nodes[n]).get('aerialway') == 'pylon']})
        if 'building' in attributes and len(points) >= 4 and points[0] == points[-1]:
            x, z = polygon_center(points)
            building = {'id': obj_id, 'x': x, 'z': z, 'footprint': points[:-1],
                        'kind': attributes['building'], 'name': source_name}
            if attributes.get('building:levels', '').isdigit():
                building['levels'] = int(attributes['building:levels'])
            buildings.append(building)
        if attributes.get('natural') == 'water' and points[0] == points[-1]:
            water.append({'id': obj_id, 'footprint': points[:-1]})

    def landmark(ident, region, kind, name, osm_id, node=False, placement=None):
        way_id = f'w{osm_id}'
        building = next((b for b in buildings if b['id'] == way_id), None) if not node else None
        x, z = (local(*placement) if placement else (coordinates[osm_id] if node else [building['x'], building['z']]))
        data = {'id': ident, 'resort': region, 'kind': kind, 'name': name, 'x': x, 'z': z,
                'osm': f'{"node" if node else "way"}/{osm_id}'}
        if building:
            data.update({'buildingId': way_id, 'footprint': building['footprint']})
        return data

    landmarks = [
        landmark('wanlong-summit', 'wanlong', 'summit', '红花梁', 5119670350, node=True),
        landmark('wanlong-lodge', 'wanlong', 'lodge', '万龙山顶木屋', 259554545),
        # The hall and Dragon Palace Hotel occupy adjacent wings of one mapped structure.
        landmark('wanlong-hall', 'wanlong', 'hall', '万龙雪具大厅', 1153883032, placement=(115.39066, 40.96816)),
        landmark('wanlong-hotel', 'wanlong', 'hotel', '龙宫酒店', 12679534559, node=True),
        landmark('genting-summit', 'genting', 'summit', '云顶', 10580855923, node=True),
        landmark('genting-lodge', 'genting', 'lodge', '金花阁', 1153883028),
        # The main ski hall is inside the Genting Grand, at the snowfront entrance.
        landmark('genting-hall', 'genting', 'hall', '云顶滑雪大厅', 468688715, placement=(115.42899, 40.94721)),
        landmark('genting-hotel', 'genting', 'hotel', '云顶大酒店', 468688715, placement=(115.42980, 40.94687)),
    ]
    hall = next(b for b in buildings if b['id'] == 'w1153883032')
    landmarks[3].update({'buildingId': hall['id'], 'footprint': hall['footprint']})
    routes = [itinerary(r, way_nodes, coordinates, terrain.source_height) for r in ITINERARIES]
    features = {'trails': trails, 'lifts': lifts, 'routes': routes, 'landmarks': landmarks,
                'buildings': buildings, 'water': water, 'summitPlaces': summit_places()}
    add_piste_catalog(features, terrain.source_height)
    return features


def summit_places():
    # Open snow on the downhill lip of each unloading area. Keep the lookout
    # camera on the boot bearing so forward means the same thing in every view.
    def place(x, z, degrees, lodge, lift):
        heading = math.radians(degrees)
        def along(metres):
            return [round(x + metres * math.sin(heading), 3),
                    round(z - metres * math.cos(heading), 3)]
        return {'position': [x, z], 'heading': heading, 'lodgeId': lodge,
                'liftId': lift, 'stationEnd': 'top',
                'camera': {'position': along(-6), 'height': 2.65,
                           'target': along(8), 'targetHeight': 1.1}}

    # The crest at this DEM vertex falls away on every side. The flower outlets
    # skirt the adjacent saddle and terminals before joining their surveyed ways.
    genting = place(448, 64, 2.51, 'genting-lodge', 'w469393393')
    genting['upperLiftIds'] = ['w469393393', 'w469393391']
    genting['outlets'] = {
        'peony': {'trailId': 'w878706035', 'via': [], 'join': 2},
        'datura': {'trailId': 'w771168506', 'via': [
            [464, 76], [488, 184], [520, 184], [548, 220], [572, 320]], 'join': 1},
        'felwort': {'trailId': 'w771168509', 'via': [
            [456, 88], [488, 184], [520, 184], [548, 220], [580, 320],
            [604, 344], [608, 352], [608, 480], [613.94, 492.04]], 'join': 3},
    }
    return {'wanlong': place(-219, -33, 55, 'wanlong-lodge', 'w1564657050'), 'genting': genting}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path(tempfile.gettempdir()) / 'chongli-ski-geodata')
    cache = parser.parse_args().cache
    cache.mkdir(parents=True, exist_ok=True)
    osm = download(cache / 'area.osm', OSM_MAP)
    nearby = Terrain(cache, 4992, 32, 12)
    horizon = Terrain(cache, 24480, 240, 10)
    origin = {'lon': ORIGIN_LON, 'lat': ORIGIN_LAT, 'metresPerDegreeLongitude': EAST_SCALE,
              'metresPerDegreeLatitude': NORTH_SCALE}
    credits = [
        {'title': '© OpenStreetMap contributors', 'url': 'https://www.openstreetmap.org/copyright',
         'license': 'ODbL 1.0', 'download': 'mountain.json'},
        {'title': 'Mapzen Terrain Tiles · SRTM / USGS', 'url': 'https://registry.opendata.aws/terrain-tiles/',
         'attribution': 'SRTM data courtesy of the U.S. Geological Survey.',
         'details': 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md'},
    ]
    imagery = [
        {'title': 'Copernicus Sentinel-2 · 2025-01-21', 'attribution': 'Contains modified Copernicus Sentinel data (2025).',
         'url': 'https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/S2B_50TLL_20250121_0_L2A'},
        {'title': 'ESA WorldCover 2021 v200', 'license': 'CC BY 4.0', 'url': 'https://esa-worldcover.org/en/data-access',
         'attribution': '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium.'},
    ]
    data = {'origin': origin, **nearby.export(), **mapped_features(osm, nearby),
            'rasters': {'winter': 'winter.jpg', 'forest': 'forest.png', 'size': 1024,
                        'extent': 'bounds', 'upperLeft': ['minX', 'minZ'], 'forestValue': 255},
            'attribution': credits + imagery, 'compiled': date.today().isoformat()}
    DEST.mkdir(parents=True, exist_ok=True)
    far = {'origin': origin, **horizon.export(),
           'rasters': {'winter': 'horizon.jpg', 'size': 1024, 'extent': 'bounds', 'upperLeft': ['minX', 'minZ']},
           'attribution': [credits[1], imagery[0]]}
    for name, contents in [('mountain', data), ('horizon', far)]:
        (DEST / f'{name}.json').write_text(json.dumps(contents, separators=(',', ':'), ensure_ascii=False) + '\n', encoding='utf-8')
    print(f"{len(data['trails'])} trail sections, {len(data['lifts'])} lifts, {len(data['buildings'])} building footprints")
    print(f"{len(data['trailCatalog'])} named public pistes; {len(data['venues'])} venue records")
    for route in data['routes']:
        print(route['id'], route['distance'], route['drop'])


if __name__ == '__main__':
    main()
