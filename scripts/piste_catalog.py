"""Public piste names, aliases and playable directed routes for the Chongli mountain.

A trail segment is physical geometry. A catalogue row is an operator-named run
and can cover part of a segment or share a race venue. A route adds a verified
downhill exit to a snowfront when a directed connection exists.
"""

from collections import defaultdict
from heapq import heappop, heappush
from itertools import count
from math import dist


SOURCES = {
    'wanlong-map': {
        'title': '张家口市万龙运动旅游有限公司 · 万龙度假天堂雪道全景图（2026.09版）',
        'url': 'https://www.chonglihuaxue.cn/uploadfile/image/x/xdt/2000wlqq.jpg',
        'list': 'https://www.chonglihuaxue.cn/info.asp?id=170',
    },
    'genting-map': {
        'title': '密苑云顶乐园 · 雪道全景图及32条公众雪道参数',
        'url': 'https://www.chonglihuaxue.cn/uploadfile/image/x/xdt/2000ydqq.jpg',
        'list': 'https://www.chonglihuaxue.cn/info.asp?id=169',
    },
    'wanlong-registration': {
        'title': '66ski 万泉河水 · 万龙全景图与2026-10-24地理控制点',
        'url': 'https://66ski.com/tools/locator/2.html?resort=wanlong',
        'controls': 'https://66ski.com/tools/locator/data/wanlong/wanlong.json',
        'image': 'https://66ski.com/img/trailmap/wanlong.jpg',
    },
    'genting-registration': {
        'title': '66ski 万泉河水 · 云顶全景图与2026-10-24地理控制点',
        'url': 'https://66ski.com/tools/locator/2.html?resort=yunding',
        'controls': 'https://66ski.com/tools/locator/data/yunding/yunding.json',
        'image': 'https://66ski.com/img/trailmap/yunding.jpg',
    },
}

# Resort map numbers, not the older numbers embedded in several OSM way names.
# Tuples specify only the named section. The builder follows directed shared
# vertices from its lower end to the closest suitable base return.
WANLONG = [
    ('1', '长龙道', 'Long Dragon', 'easy', [1353185032, 771169386]),
    ('2', '短龙道', 'Short Dragon', 'easy', [771169387]),
    ('3', '游龙道', 'Wandering Dragon', 'intermediate', [259700924]),
    ('4', '中华龙道', 'Chinese Dragon', 'advanced', [483990517]),
    ('5', '卧龙道', 'Sleeping Dragon', 'easy', [1155259832]),
    ('6', '玉龙道', 'Jade Dragon', 'intermediate', [483990518]),
    ('7', '金龙道', 'Golden Dragon', 'advanced', [259702567]),
    ('8', '恐龙道', 'Dinosaur', 'advanced', [878706033]),
    ('9', '翔龙道', 'Soaring Dragon', 'advanced', [639930438]),
    ('10', '飞龙道', 'Flying Dragon', 'intermediate', [259702568]),
    ('11', '小龙道', 'Little Dragon', 'intermediate', [483990516]),
    ('12', '酷龙道', 'Cool Dragon', 'intermediate', [483990515]),
    ('13', '炫龙道', 'Dazzling Dragon', 'advanced', [483990512]),
    ('14', '猛龙道', 'Mighty Dragon', 'advanced', [483990514]),
    ('15', '银龙道', 'Silver Dragon', 'intermediate', [259702565]),
    ('16', '大奔头', 'Da Bentou', 'advanced', [1353185034]),
    ('17', '威龙道', 'Grand Dragon', 'advanced', [639930437]),
    ('18', '雨龙道', 'Rain Dragon', 'intermediate', [878706030]),
    ('19', '娇龙道', 'Graceful Dragon', 'easy', [483990519]),
    ('20', '腾龙道', 'Rising Dragon', 'advanced', [259702566]),
    ('21', '逸龙道', 'Leisure Dragon', 'advanced', [1155263102]),
    ('22', '海龙道', 'Sea Dragon', 'advanced', [259702570, 483990511]),
    ('23', '雾龙道', 'Mist Dragon', 'advanced', ['diagram-wanlong-mist']),
    ('24', '霜龙道', 'Frost Dragon', 'advanced', [483990510]),
    ('25', '雪龙道', 'Snow Dragon', 'advanced', [483990509]),
    ('26', '风龙道', 'Wind Dragon', 'advanced', [259702569]),
    ('27', '云龙道', 'Cloud Dragon', 'advanced', [259702571]),
    ('28', '绿龙道', 'Green Dragon', 'advanced', [639930439]),
    ('29', '紫龙道', 'Purple Dragon', 'intermediate', [1353185033]),
    # The two mapped rainbow sections meet through the first 15 m of Purple Dragon.
    ('30', '五彩龙道', 'Rainbow Dragon', 'intermediate', [582002978, (1353185033, 0, 1), 1280793047]),
    ('31', '赤龙道', 'Red Dragon', 'advanced', ['diagram-wanlong-red']),
    ('32', '黄龙道', 'Yellow Dragon', 'advanced', [639930440]),
]

GENTING = [
    ('1A', '曼陀罗', 'Datura', 'intermediate', [771168506]),
    ('1B', '玉竹', 'Solomon’s Seal', 'intermediate', [771168508]),
    ('1C', '花锚', 'Felwort', 'intermediate', [771168509]),
    ('1D', '野罂粟', 'Wild Poppy', 'advanced', [771168510]),
    ('1E', '蒲公英', 'Dandelion', 'advanced', [771168493]),
    ('1F', '田旋花', 'Bindweed', 'intermediate', [771168507]),
    # The resort calls this upper crest Fireweed. OSM's Peony continues on the same crest.
    ('1G', '柳兰', 'Fireweed', 'intermediate', [(878706035, 0, 5)]),
    ('2A', '剪秋萝', 'Catchfly', 'intermediate', [1353185035]),
    ('3A', '锦带花', 'Weigela', 'easy', [771168492]),
    ('5A', '雪绒花', 'Edelweiss', 'easy', [771168491]),
    ('6A', '芍药花', 'Peony', 'intermediate', [878706035]),
    ('6B', '薰衣草', 'Lavender', 'intermediate', [771168496]),
    ('6C', '紫丁香', 'Lilac', 'intermediate', [771168494]),
    # The published venue table assigns Slopestyle and Golden Lotus the same 6D and 720 m.
    ('6D', '金莲花', 'Golden Lotus', 'advanced', [771168497]),
    ('6E', '银莲花', 'Anemone', 'advanced', [771168498]),
    ('6F', '野玫瑰', 'Wild Rose', 'advanced', [771168499]),
    ('6G', '狼毒花', 'Spurge', 'advanced', [771168503]),
    ('6K', '翠菊花', 'Aster Traverse', 'intermediate', [1349252976]),
    ('6L', '山丹丹', 'Lily Traverse', 'intermediate', [878706034]),
    ('6O', '花苜蓿', 'White Clover', 'intermediate', ['diagram-genting-clover']),
    ('8A', '铁线莲', 'Clematis', 'advanced', [771168514]),
    ('8B', '凤仙花', 'Balsam', 'advanced', [771168515]),
    ('8C', '向日葵', 'Sunflower', 'intermediate', [771168513]),
    ('8D', '太浩岩壁', 'Tahoe Wall', 'advanced', [771168518]),
    ('8E', '水杨梅', 'Water Avens', 'intermediate', [771168512]),
    ('22A', '蓝刺头', 'Globe Thistle', 'advanced', [1349252979, 771168520]),
    ('22B', '野蔷薇', 'Wild Briar', 'advanced', [771168525]),
    ('22C', '天仙子', 'Henbane', 'advanced', [771168526]),
    ('22D', '百里香', 'Thyme', 'intermediate', [771168524]),
    ('22E', '风铃草', 'Bellflower', 'easy', [771168522]),
    ('22F', '白芷花', 'Angelica', 'advanced', [771168521]),
    ('22G', '布勒道', 'Buller', 'intermediate', [771168523]),
]

# The operators' printed lengths can include shared approaches and runouts.
# They are intentionally kept apart from the calculated centreline distances.
WANLONG_LENGTHS = (4160, 800, 3500, 3000, 300, 2500, 1900, 1100, 900, 1300, 600, 799, 1900, 1800,
                   1300, 400, 2000, 850, 700, 1900, 650, 1880, 400, 650, 550, 2600, 2200, 1800,
                   700, 1800, 200, 850)
GENTING_LENGTHS = {
    '1A': 2094, '1B': 881, '1C': 1296, '1D': 603, '1E': 1524, '1F': 749, '1G': 399,
    '2A': 313, '3A': 775, '5A': 631, '6A': 2032, '6B': 1721, '6C': 786, '6D': 720, '6E': 670,
    '6F': 1321, '6G': 473, '6K': 396, '6L': 602, '6O': 489, '8A': 463, '8B': 540, '8C': 712,
    '8D': 1468, '8E': 302, '22A': 465, '22B': 906, '22C': 474, '22D': 1906, '22E': 952,
    '22F': 865, '22G': 505,
}

# These are activities / course alignments, not additional public named pistes.
# Course ref and public piste ref can coincide. Do not infer unrestricted access.
VENUES = [
    ('ski-cross', '追逐道', 'Ski Cross', '6A', 1349252977, '障碍追逐'),
    ('parallel-gs', '平行大回转', 'Parallel Giant Slalom', '6C', 771168494, ''),
    ('slopestyle', '坡面障碍技巧', 'Slopestyle', '6D', 771168497, ''),
    ('halfpipe', 'U型池', 'Halfpipe', '6E', 771169115, 'U型场地'),
    ('aerials', '空中技巧', 'Aerials', '7A', 984421415, ''),
    ('moguls', '雪上技巧', 'Moguls', '7B', 956358946, ''),
    ('zipper-moguls', '拉链蘑菇', 'Zipper Moguls', '', 1349252978, ''),
]

ALIASES = {
    '翔龙道': ['祥龙道'], '银龙道': ['银龙道（上段）'], '大奔头': ['银龙道（大奔头）'],
    '蓝刺头': ['迪桑特挑战之道'], '野玫瑰': ['野玫瑰/红旗'], '薰衣草': ['薰衣草/红旗'], '蒲公英': ['LAAX'],
}
SPECIAL_IDS = {'海龙道': 'wanlong-sea'}
SOURCE_NOTES = {
    '柳兰': '云顶全景图把柳兰标在6索山顶至薰衣草岔口的山脊。其单独中心线未见公开测量，按同走廊芍药花的前五段表示。',
    '金莲花': '公众雪道表与比赛场地表的6D同长。沿用OSM坡面障碍技巧测线，入场短接按图和卫星雪面估绘。',
    '花苜蓿': '根据6O公众雪道图从追逐区穿向6B、6C下段，全景图配准后向已有雪道节点收口。',
    '雾龙道': '图上从霜龙谷内起步。按全景图配准，其下口接霜龙与海龙的汇合雪面。上部林区没有独立测绘接入。',
    '赤龙道': '图上从黄龙道下段分出，在8索下站雪面与黄龙道汇合。按全景图配准和冬季影像估绘。',
    '风铃草': '在云顶大酒店前与太浩岩壁的山脚雪面相通。两条OSM测线间的24米由全景图与冬季影像补齐。',
}


def osm_id(value):
    return f'w{value}' if isinstance(value, int) else value


def add_diagram_sections(trails):
    by_id = {t['id']: t for t in trails}

    def at(way, index):
        return by_id[osm_id(way)]['points'][index]

    # Manual centerlines were registered against the 66ski control mesh and
    # checked on the 2025-01-21 Sentinel-2 winter scene. Snapped endpoints
    # reference physical trail vertices; an unconnected start stays unconnected.
    diagrams = [
        ('diagram-wanlong-mist', 'wanlong', '23', '雾龙道', 'advanced', 19, 'piste',
         [[-867, -454], [-883, -493], [-900, -535], [-915, -566], [-939, -616], [-961, -659],
          [-977, -676], at(483990510, 5)]),
        ('diagram-wanlong-red', 'wanlong', '31', '赤龙道', 'advanced', 25, 'piste',
         [at(639930440, 4), [-2270, -1283], [-2280, -1307], [-2285, -1326], [-2295, -1351],
          [-2308, -1373], [-2324, -1387], [-2343, -1400], at(639930440, -1)]),
        ('diagram-genting-clover', 'genting', '6O', '花苜蓿', 'intermediate', 43, 'piste',
         [at(1349252977, 12), [807, -671], [849, -679], [882, -677], [924, -665], [971, -645],
          [1011, -620], [1052, -587], at(771168496, -1)]),
        # The 6D launch lies on an open snowfield between Lilac and Dandelion.
        # The published diagram shows the race start, not a surveyed access path.
        ('access-genting-golden-lotus', 'genting', '', '金莲花入口', 'advanced', 16, 'access',
         [at(771168494, 6), [724, -68], [763, -72], [803, -73], at(771168497, 0)]),
        ('access-genting-bellflower', 'genting', '', '风铃草入口', 'easy', 18, 'access',
         [at(771168518, -1), [2432.2, 927.1], at(771168522, 0)]),
    ]
    for ident, side, ref, name, grade, width, kind, points in diagrams:
        trails.append({'id': ident, 'resort': side, 'ref': ref, 'name': name, 'difficulty': grade,
                       'width': width, 'kind': kind, 'points': points, 'geometrySource': 'resort-diagram',
                       'sources': [side + '-map', side + '-registration', 'sentinel-2']})


def edge_list(recipe, by_id):
    edges = []
    last = None
    for item in recipe:
        way, start, end = item if isinstance(item, tuple) else (item, 0, -1)
        ident = osm_id(way)
        points = by_id[ident]['points']
        end = len(points) + end if end < 0 else end
        if last is not None and last != points[start]:
            raise ValueError(f'Catalogue sections do not share a vertex: {ident}:{start} vs {last}')
        edges.extend((ident, i) for i in range(start, end))
        last = points[end]
    return edges


def downstream_network(trails):
    graph = defaultdict(list)
    for t in trails:
        for i, (a, b) in enumerate(zip(t['points'], t['points'][1:])):
            graph[tuple(a)].append((t, i, tuple(b), dist(a, b)))
    return graph


def base_return(start, side, grade, graph, bases):
    # Distance with a penalty for taking a harder return. No proximity-only
    # links, reverse directions or station-to-station jumps enter this graph.
    serial = count()
    heap = [(0, next(serial), start)]
    costs, previous = {start: 0}, {}
    while heap:
        cost, _, here = heappop(heap)
        if costs[here] != cost:
            continue
        if here in bases[side]:
            result = []
            while here in previous:
                here, edge = previous[here]
                result.append(edge)
            return result[::-1]
        for trail, i, there, length in graph.get(here, ()):
            if trail['resort'] != side or trail.get('kind') in ('venue', 'access'):
                continue
            difficulty = trail.get('publicDifficulty', trail['difficulty'])
            penalty = 4 if grade != 'advanced' and difficulty == 'advanced' else 1
            new_cost = cost + length * penalty
            if new_cost < costs.get(there, float('inf')):
                costs[there] = new_cost
                previous[there] = here, (trail['id'], i)
                heappush(heap, (new_cost, next(serial), there))
    return None


def playable_route(ident, name, resort, destination, difficulty, primary, approach, by_id, graph, bases, height, venue=False):
    last_way, last_i = primary[-1]
    named_end = tuple(by_id[last_way]['points'][last_i + 1])
    exit_edges = base_return(named_end, destination, difficulty, graph, bases)
    if exit_edges is None and not venue:
        raise ValueError(f'No downhill snowfront from public piste {ident}')
    edges = approach + primary + (exit_edges or [])
    first_way, first_i = edges[0]
    points = [by_id[first_way]['points'][first_i]]
    legs = []
    for way_id, i in edges:
        way = by_id[way_id]
        if points[-1] != way['points'][i]:
            raise ValueError(f'Teleport in {ident} at {way_id}:{i}')
        if not legs or legs[-1]['trailId'] != way_id:
            legs.append({'trailId': way_id, 'startIndex': len(points) - 1, 'endIndex': len(points)})
        else:
            legs[-1]['endIndex'] = len(points)
        points.append(way['points'][i + 1])
    start, end = len(approach), len(approach) + len(primary)
    length = lambda line: round(sum(dist(a, b) for a, b in zip(line, line[1:])))
    return {
        'id': ident, 'name': name, 'resort': resort, 'destination': destination, 'difficulty': difficulty,
        'trailIds': [leg['trailId'] for leg in legs], 'legs': legs, 'points': points,
        'distance': length(points), 'drop': round(height(*points[0]) - height(*points[-1])),
        'primaryTrailIds': list(dict.fromkeys(w for w, i in primary)), 'primaryStartIndex': start,
        'primaryEndIndex': end, 'pisteDistance': length(points[start:end+1]),
        'finishKind': 'base' if exit_edges is not None else 'training-runout',
    }


def add_piste_catalog(features, height):
    trails = features['trails']
    add_diagram_sections(trails)
    by_id = {t['id']: t for t in trails}
    public_venues = {'parallel-gs': 'genting-piste-6c', 'slopestyle': 'genting-piste-6d'}
    for code, name, en, ref, way, alias in VENUES:
        if code not in public_venues:
            by_id[osm_id(way)]['kind'] = 'venue'
    graph = downstream_network(trails)
    # Each is an actual mapped piste endpoint on the base snowfield. Some sites
    # have several endpoints, e.g. the main hotel, Prince Town and Wanlong lift 8.
    base_ways = {'wanlong': [483990518, 483990519, 639930440],
                 'genting': [771168492, 1353185035, 771168513, 771168518, 771168520, 771168522]}
    bases = {side: {tuple(by_id[osm_id(w)]['points'][-1]) for w in ways}
             for side, ways in base_ways.items()}
    approaches = {'金莲花': 'access-genting-golden-lotus', '风铃草': 'access-genting-bellflower'}

    catalog, routes, venues = [], [], []
    definitions = [(side, *entry) for side, rows in [('wanlong', WANLONG), ('genting', GENTING)] for entry in rows]
    # Attach current operator numbers and grades without overwriting historic
    # OSM names/refs or the established simulation's difficulty conventions.
    for side, ref, name, en, grade, recipe in definitions:
        for way in recipe:
            if isinstance(way, tuple):
                continue
            trail = by_id[osm_id(way)]
            trail.update({'publicName': name, 'publicRef': ref, 'publicDifficulty': grade})
    for side, ref, name, en, grade, recipe in definitions:
        ident = SPECIAL_IDS.get(name, f'{side}-piste-{ref.lower()}')
        origin = 'wanlong' if name == '山丹丹' else side
        destination = 'wanlong' if name == '翠菊花' else side
        primary = edge_list(recipe, by_id)
        approach = edge_list([approaches[name]], by_id) if name in approaches else []
        route = playable_route(ident, name, origin, destination, grade, primary, approach, by_id, graph, bases, height)
        source = ('resort-diagram' if any(by_id[w].get('geometrySource') == 'resort-diagram' for w, _ in primary)
                  else 'shared-alignment' if name in ('金莲花', '柳兰') else 'osm')
        kind = 'connector' if name in ('山丹丹', '翠菊花') else 'piste'
        aliases = ALIASES.get(name, [])
        entry = {'id': ident, 'routeId': ident, 'name': name, 'en': en, 'resort': side, 'ref': ref, 'difficulty': grade,
                 'kind': kind, 'geometrySource': source, 'trailIds': route['primaryTrailIds'], 'aliases': aliases,
                 'publicSource': side + '-map',
                 'publishedLength': WANLONG_LENGTHS[int(ref)-1] if side == 'wanlong' else GENTING_LENGTHS[ref]}
        route.update({'geometrySource': source, 'kind': kind, 'en': en, 'ref': ref})
        if approach:
            entry['approachSource'] = 'resort-diagram'
        if name in SOURCE_NOTES:
            entry['geometryNote'] = SOURCE_NOTES[name]
        if name == '雾龙道':
            entry['entryKind'] = 'glade'
        if name == '金莲花':
            entry['venueId'] = 'genting-venue-slopestyle'
        if source == 'resort-diagram':
            entry['sources'] = [side + '-map', side + '-registration', 'sentinel-2']
        elif source == 'shared-alignment':
            entry['sources'] = [side + '-map', 'osm']
        catalog.append(entry)
        routes.append(route)
    for code, name, en, ref, way, alias in VENUES:
        ident = 'genting-venue-' + code
        shared = public_venues.get(code)
        row = {'id': ident, 'name': name, 'en': en, 'ref': ref, 'resort': 'genting', 'kind': 'venue',
               'trailIds': [osm_id(way)], 'geometrySource': 'osm', 'routeId': shared or ident,
               'aliases': [alias] if alias else []}
        if shared:
            row['sharesPiste'] = shared
        else:
            trail = by_id[osm_id(way)]
            route = playable_route(ident, name, 'genting', 'genting', trail['difficulty'], edge_list([way], by_id),
                                   [], by_id, graph, bases, height, venue=True)
            route.update({'geometrySource': 'osm', 'kind': 'venue', 'en': en, 'ref': ref})
            routes.append(route)
        venues.append(row)

    # In the operator tables the 8C training facility is listed apart from
    # the 7A aerials course. Its footprint is not a second surveyed downhill.
    areas = [
        {'id': 'genting-area-8c-aerials', 'name': '空中技巧训练基地', 'en': 'Aerials training area', 'ref': '8C',
         'resort': 'genting', 'kind': 'training-area', 'nearTrailIds': ['w771168513']},
        {'id': 'genting-terrain-park', 'name': '云顶滑雪地形公园', 'en': 'Genting Terrain Park',
         'resort': 'genting', 'kind': 'terrain-park', 'nearTrailIds': ['w1349252977', 'w771168494', 'w771168497', 'w771169115']},
        {'id': 'wanlong-snowboard-practice', 'name': '单板练习区', 'en': 'Snowboard practice area',
         'resort': 'wanlong', 'kind': 'training-area', 'nearTrailIds': ['w1155259832']},
        {'id': 'wanlong-frost-glade', 'name': '霜龙谷', 'en': 'Frost Dragon Glade',
         'resort': 'wanlong', 'kind': 'glade', 'nearTrailIds': ['diagram-wanlong-mist', 'w483990510']},
    ]
    for route in routes:
        side_lifts = [l for l in features['lifts'] if l['resort'] == route['destination']]
        route['finishLiftId'] = min(side_lifts, key=lambda l: dist(l['points'][0], route['points'][-1]))['id']
    features.update({'pisteRoutes': routes, 'trailCatalog': catalog, 'venues': venues, 'skiAreas': areas, 'pisteSources': SOURCES})
