"""Bake distant forest cards from the same six three-dimensional trees used nearby."""
from hashlib import sha256
import json
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
catalogue = {}
manifest = root / 'src' / 'grove-atlases.json'
previous = json.loads(manifest.read_text()) if manifest.exists() else {}
extract = """
import {designs} from './art/woodland-palettes.js';
import {woodlandTree} from './art/woodland-mesh.js';
const style=designs[process.argv[1]];
console.log(JSON.stringify({palette:style.palette,trees:[0,1,2].map(s=>woodlandTree(style,s,0))}));
"""
for style in ['ink', 'starry', 'monet', 'woodblock', 'mineral', 'galaxy']:
    data = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', extract, style], cwd=root))
    scale = 2
    width, height = 384 * scale, 520 * scale
    atlas = Image.new('RGBA', (width * 3, height))
    palette = np.array([tuple(bytes.fromhex(c)) for c in data['palette']])
    for species, tree in enumerate(data['trees']):
        tri = np.array(tree['positions']).reshape((-1, 3, 3))
        depth = tri[:, :, 2] * .92 + tri[:, :, 0] * .39
        px = (tri[:, :, 0] * .92 - tri[:, :, 2] * .39 + .5) * width
        py = (1 - tri[:, :, 1]) * (height - 2) + 1
        normal = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        normal /= np.maximum(1.e-8, np.linalg.norm(normal, axis=1))[:, None]
        shades = np.array(tree['shades'][::3]) * (.93 + .13 * np.abs(normal @ np.array([-.56, .74, .37])))
        colours = np.clip(palette[tree['pigments'][::3]] * shades[:, None], 0, 255).astype('uint8')
        sprite = Image.new('RGBA', (width, height))
        draw = ImageDraw.Draw(sprite)
        for i in np.argsort(depth.mean(axis=1), kind='stable'):
            draw.polygon(list(zip(px[i], py[i])), tuple(colours[i]) + (255,))
        atlas.paste(sprite, (width * species, 0))
    atlas = atlas.resize((width * 3 // scale, height // scale), Image.Resampling.LANCZOS)
    target = root / 'public' / ('grove-' + style + '.webp')
    atlas.save(target, method=6, quality=91, exact=True)
    name = 'chongli-grove-' + style + '-' + sha256(target.read_bytes()).hexdigest()[:10] + '.webp'
    target.replace(target.with_name(name))
    catalogue[style] = name
for old in set(previous.values()) - set(catalogue.values()):
    (root / 'public' / old).unlink(missing_ok=True)
manifest.write_text(json.dumps(catalogue, indent=2) + '\n')
