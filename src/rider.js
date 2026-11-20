import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const colorOf = value => value?.isColor ? value : new THREE.Color(value);
const tone = (color, amount) => colorOf(color).clone().multiplyScalar(amount);
const wash = (color, other, amount) => colorOf(color).clone().lerp(colorOf(other), amount);
const basisMatrix = new THREE.Matrix4();
const basisX = v3(), basisY = v3(), basisZ = v3();
const axisY = v3(0, 1, 0);
const axisDown = v3(0, -1, 0);

function child(parent, name) {
  const node = new THREE.Group();
  node.name = name;
  parent.add(node);
  return node;
}

// Bake the tailoring and hardware into a small set of independently moving pieces.
class Batch {
  constructor(node) {
    this.node = node;
    this.layers = new Map();
  }

  add(geometry, material, color, position, rotation, scale) {
    if (position || rotation || scale) {
      const matrix = new THREE.Matrix4().compose(
        v3(...(position || [0, 0, 0])),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation || [0, 0, 0]))),
        v3(...(scale || [1, 1, 1]))
      );
      geometry.applyMatrix4(matrix);
    }
    if (!this.layers.has(material)) {
      this.layers.set(material, { p: [], n: [], c: [], uv: [], ix: [] });
    }
    const dst = this.layers.get(material);
    const a = geometry.attributes;
    const base = dst.p.length / 3;
    const fixed = colorOf(color || '#ffffff');
    for (let i = 0; i < a.position.count; i++) {
      dst.p.push(a.position.getX(i), a.position.getY(i), a.position.getZ(i));
      dst.n.push(a.normal.getX(i), a.normal.getY(i), a.normal.getZ(i));
      dst.c.push(
        fixed.r * (a.color?.getX(i) ?? 1),
        fixed.g * (a.color?.getY(i) ?? 1),
        fixed.b * (a.color?.getZ(i) ?? 1)
      );
      dst.uv.push(a.uv?.getX(i) ?? 0, a.uv?.getY(i) ?? 0);
    }
    if (geometry.index) {
      for (let i = 0; i < geometry.index.count; i++) dst.ix.push(base + geometry.index.getX(i));
    } else {
      for (let i = 0; i < a.position.count; i++) dst.ix.push(base + i);
    }
    geometry.dispose();
  }

  finish() {
    for (const [material, d] of this.layers) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(d.p, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(d.n, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(d.c, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
      geometry.setIndex(d.ix);
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.node.add(mesh);
    }
    this.layers.clear();
  }
}

function geometry(p, uv, ix, c) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (c?.length) g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  g.setIndex(ix);
  g.computeVertexNormals();
  return g;
}

function surface(nu, nv, sample, reverse = false) {
  const p = [], uv = [], ix = [], c = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv;
      const point = sample(u, v);
      p.push(point[0], point[1], point[2]);
      uv.push(u, v);
      if (point[3]) c.push(point[3].r, point[3].g, point[3].b);
      if (i === nu || j === nv) continue;
      const a = j * (nu + 1) + i, b = a + nu + 1;
      if (reverse) ix.push(a, a + 1, b, a + 1, b + 1, b);
      else ix.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return geometry(p, uv, ix, c);
}

// Sections ascend from bottom to top. Each section gives y, half-width, half-depth,
// fore/aft centre and lateral centre. A duplicated seam allows a continuous fabric UV.
function loft(rows, segments = 20, sculpt, capBottom = true) {
  const p = [], uv = [], ix = [], c = [];
  const bottom = rows[0][0], height = rows[rows.length - 1][0] - bottom;
  for (let j = 0; j < rows.length; j++) {
    const [y, rx, rz, cz = 0, cx = 0] = rows[j];
    for (let i = 0; i <= segments; i++) {
      const a = i / segments * TAU;
      const point = {
        x: cx + Math.cos(a) * rx, y, z: cz + Math.sin(a) * rz,
        a, t: (y - bottom) / height, cx, cz, color: null, light: 1
      };
      if (sculpt) sculpt(point);
      p.push(point.x, point.y, point.z);
      uv.push(i / segments, (y - bottom) / height);
      c.push(
        (point.color?.r ?? 1) * point.light,
        (point.color?.g ?? 1) * point.light,
        (point.color?.b ?? 1) * point.light
      );
      if (i === segments || j === rows.length - 1) continue;
      const a0 = j * (segments + 1) + i, b0 = a0 + segments + 1;
      ix.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
    }
  }
  for (let i = 1; i < segments - 1; i++) {
    const top = (rows.length - 1) * (segments + 1);
    if (capBottom) ix.push(0, i, i + 1);
    ix.push(top, top + i + 1, top + i);
  }
  const g = geometry(p, uv, ix, c);
  const normals = g.attributes.normal;
  for (let j = 0; j < rows.length; j++) {
    const i = j * (segments + 1), k = i + segments;
    const normal = v3().fromBufferAttribute(normals, i).add(v3().fromBufferAttribute(normals, k)).normalize();
    normals.setXYZ(i, normal.x, normal.y, normal.z);
    normals.setXYZ(k, normal.x, normal.y, normal.z);
  }
  return g;
}

function fabricRows(rows, step) {
  const dense = [rows[0]];
  for (let i = 1; i < rows.length; i++) {
    const lo = rows[i - 1], hi = rows[i];
    const count = Math.ceil((hi[0] - lo[0]) / step);
    for (let j = 1; j <= count; j++) {
      dense.push(Array.from({ length: Math.max(lo.length, hi.length) }, (_, k) => mix(lo[k] ?? 0, hi[k] ?? 0, j / count)));
    }
  }
  return dense;
}

function projectedSeam(batch, material, color, shell, path, side, radius) {
  const probe = new THREE.Mesh(shell, material), cast = new THREE.Raycaster();
  const curve = new THREE.CatmullRomCurve3(path.map(([y, z]) => v3(0, y, z)), false, 'centripetal');
  const points = [];
  for (const pt of curve.getPoints((path.length - 1) * 4)) {
    cast.set(v3(side, pt.y, pt.z), v3(-side, 0, 0));
    const face = cast.intersectObject(probe, false)[0];
    if (face) points.push([face.point.x + side * radius * .56, pt.y, pt.z]);
  }
  if (points.length > 1) cord(batch, material, color, points, radius, 4);
}

function ellipsoid(batch, mat, color, center, radii, angles, seg = 14) {
  batch.add(new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * .56))), mat, color, center, angles, radii);
}

function block(batch, mat, color, center, size, angles) {
  batch.add(new THREE.BoxGeometry(...size), mat, color, center, angles);
}

function cord(batch, mat, color, points, radius, sides = 5) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => v3(...p)), false, 'centripetal');
  batch.add(new THREE.TubeGeometry(curve, Math.max(3, (points.length - 1) * 3), radius, sides, false), mat, color);
}

function band(batch, mat, color, y, rx, rz, cz, thickness) {
  batch.add(loft([
    [y - thickness / 2, rx * .988, rz * .988, cz],
    [y - thickness * .29, rx, rz, cz],
    [y + thickness * .29, rx, rz, cz],
    [y + thickness / 2, rx * .988, rz * .988, cz]
  ], 26), mat, color);
}

function makeClothTexture() {
  const size = 64, bytes = new Uint8Array(size * size * 4);
  const thread = (x, y) => {
    const warp = Math.sin(TAU * x / 4);
    const weft = Math.sin(TAU * y / 4);
    const bias = Math.cos(TAU * (x + y) / 16);
    return (warp * (.69 + .23 * bias) + weft * (.63 - .25 * bias)) * .41;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = 4 * (y * size + x);
    bytes[i] = 128 + 62 * (thread(x - 1, y) - thread(x + 1, y));
    bytes[i + 1] = 128 + 62 * (thread(x, y - 1) - thread(x, y + 1));
    bytes[i + 2] = 249; bytes[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(bytes, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 3);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function lensTexture() {
  const w = 128, h = 48, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / (w - 1), v = y / (h - 1);
    const ridge = .39 + .075 * Math.sin(u * 23.7) + .043 * Math.sin(u * 57.2 + .9) + .018 * Math.sin(u * 108);
    const lower = v < ridge + .055;
    const t = lower ? clamp(v / (ridge + .055), 0, 1) : (v - ridge - .055) / (1 - ridge - .055);
    const edgeLight = lower ? THREE.MathUtils.smoothstep(v - ridge, -.035, .055) : 1;
    const a = lower ? [44, 73, 91] : [213, 170, 106];
    const b = lower ? [mix(114, 213, edgeLight), mix(137, 170, edgeLight), mix(148, 106, edgeLight)] : [42, 91, 125];
    const edge = .70 + .29 * Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2));
    const sun = Math.exp(-((u - .67) ** 2 * 950 + (v - .54) ** 2 * 420)) * .75;
    const i = (y * w + x) * 4;
    for (let k = 0; k < 3; k++) data[i + k] = Math.min(255, mix(a[k], b[k], t) * edge + 110 * sun);
    data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, w, h);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function materials() {
  const weave = makeClothTexture(), mirror = lensTexture();
  return {
    cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .83, metalness: .015,
      normalMap: weave, normalScale: new THREE.Vector2(.17, .17) }),
    hard: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .50, metalness: .13 }),
    alloy: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .32, metalness: .52 }),
    lens: new THREE.MeshStandardMaterial({ vertexColors: true, map: mirror, roughness: .17, metalness: .14,
      emissive: 0xffffff, emissiveMap: mirror, emissiveIntensity: .14 }),
    textures: [weave, mirror]
  };
}

function jacket(batch, m, palette, female) {
  const shoulder = female ? .916 : 1, waist = female ? .91 : 1;
  const cut = [
    [-.080, .158, .113, .016], [-.069, .178, .132, .017], [-.053, .181, .139, .019],
    [-.035, .174, .129, .018], [-.012, .177, .136, .016], [.012, .18, .137, .014],
    [.030, .172, .129, .012], [.052, .177, .136, .012], [.082, .174, .132, .013],
    [.119, .176, .131, .012], [.161, .18, .131, .008], [.209, .187, .138, .003],
    [.253, .196, .145, .002], [.297, .202, .147, .003], [.339, .214, .143, .008],
    [.379, .224, .139, .013], [.405, .224, .128, .016], [.43, .206, .120, .016],
    [.455, .159, .108, .012], [.474, .102, .078, .004]
  ];
  for (const row of cut) {
    const flare = clamp(1 - (row[0] + .07) / .25, 0, 1);
    row[1] *= mix(waist, shoulder, clamp((row[0] + .03) / .35, 0, 1));
    row[1] += .010 + .031 * flare;
    row[2] += .007 + .034 * flare;
    row[3] += .009 * flare;
  }
  const shell = loft(fabricRows(cut, .016), 32, p => {
    const back = Math.sin(p.a), side = Math.abs(Math.cos(p.a));
    const gathering = Math.max(0, 1 - Math.abs(p.y - .03) / .23);
    const ripple = Math.cos(5 * p.a + 20 * p.y + .65 * Math.sin(2 * p.a));
    const crease = gathering * Math.sin(84 * p.y + 2.4 * Math.cos(p.a) + Math.sin(2 * p.a)) * .0038;
    const fold = gathering * ripple * .007 + Math.sin(8 * p.a + p.y * 26) * .0018 + crease;
    p.x += fold * Math.cos(p.a);
    p.z += fold * Math.sin(p.a);
    p.y += .010 * gathering * THREE.MathUtils.smoothstep(p.t, 0, .07) * Math.sin(2 * p.a + 5.7 * p.y);
    const hem = Math.max(0, 1 - p.t * 4.8);
    p.y += hem * (.032 - back * .047);
    const acrossYoke = .346 + .041 * side - .025 * back;
    p.color = p.y > acrossYoke ? palette.yoke : side > .933 && p.y > .09 && p.y < .345 ? palette.underarm : palette.coat;
    p.light = .97 + .035 * ripple * gathering + .017 * Math.cos(3 * p.a) + crease * 8.0;
  }, false);
  batch.add(shell, m.cloth);
  const probe = new THREE.Mesh(shell, m.cloth), ray = new THREE.Raycaster();
  function onShell(x, y, rear, lift = .002) {
    const sign = rear ? 1 : -1;
    ray.set(v3(x, y, sign), v3(0, 0, -sign));
    const hit = ray.intersectObject(probe, false)[0];
    return [x, y, hit ? hit.point.z + sign * lift : sign * .14];
  }
  function seam(points, rear, shade, radius) {
    const line = new THREE.CatmullRomCurve3(points.map(([x, y]) => v3(x, y, 0)), false, 'centripetal');
    const projected = line.getPoints((points.length - 1) * 4).map(pt => onShell(pt.x, pt.y, rear, radius * .63));
    cord(batch, m.cloth, shade, projected, radius, 4);
  }

  // The folded hood drops down the shoulder blades; its storm collar closes under the chin.
  batch.add(loft([
    [.270, .024, .013, .140], [.279, .059, .021, .148], [.296, .092, .027, .150],
    [.321, .115, .033, .151], [.351, .134, .039, .147], [.383, .138, .044, .136],
    [.410, .137, .054, .119], [.437, .131, .060, .102], [.458, .119, .052, .088],
    [.480, .098, .039, .077], [.486, .083, .026, .075]
  ], 28, pt => {
    const back = Math.sin(pt.a), fold = .005 * Math.sin(3 * pt.a + 15 * pt.y);
    pt.y += .015 * Math.cos(pt.a * 2) * (1 - pt.t * .7);
    pt.z += fold * back;
    pt.color = back < -.45 ? palette.underarm : palette.coat;
    pt.light = .965 + .035 * Math.cos(3 * pt.a - 10 * pt.y);
  }), m.cloth);
  const hoodSeam = [[0, .279, .169], [.006, .312, .184], [.010, .351, .188], [.008, .386, .182], [0, .422, .167]];
  cord(batch, m.cloth, palette.stitch, hoodSeam, .00175);
  batch.add(loft([
    [.434, .122, .091, .006], [.448, .121, .094, .008], [.473, .110, .092, .010],
    [.503, .106, .089, .010], [.519, .098, .084, .010]
  ], 26, pt => {
    pt.y += .008 * Math.cos(2 * pt.a + .7);
    pt.color = pt.t > .91 ? palette.lining : palette.underarm;
  }), m.cloth);
  band(batch, m.cloth, palette.lining, .507, .095, .084, .009, .014);
  for (const s of [-1, 1]) {
    const w = s * shoulder;
    seam([[w * .200, .390], [w * .165, .355], [w * .105, .334], [w * .023, .325]],
      true, palette.stitch, .0021);
    seam([[w * .157, .195], [w * .150, .151], [w * .133, .098], [w * .114, .058]],
      false, palette.underarm, .0041);
    const pocketTab = onShell(w * .156, .188, false, .006);
    block(batch, m.hard, palette.dark, pocketTab, [.008, .021, .004], [0, 0, -s * .22]);
  }
  seam([[0, .016], [.002, .086], [.001, .190], [0, .297], [.001, .398], [0, .453]],
    false, palette.dark, .0039);
  seam([[-.067, .340], [-.079, .285], [-.091, .233]], false, palette.underarm, .0032);
  block(batch, m.alloy, '#929088', onShell(-.069, .33, false, .0055), [.007, .014, .004], [0, 0, -.2]);
  cord(batch, m.hard, palette.dark, [[0, .445, -.079], [0, .480, -.084], [0, .515, -.076]], .0032);
  block(batch, m.alloy, '#928b78', [.003, .494, -.085], [.008, .013, .004]);

}

function pelvisShape(batch, m, p, female) {
  const w = female ? .154 : .150;
  batch.add(loft([
    [-.100, w * .78, .086, .032], [-.066, w, .106, .022],
    [-.025, w * 1.04, .119, .018], [.017, w, .113, .012], [.055, w * .87, .099, .006]
  ], 24, pt => {
    pt.color = Math.sin(pt.a) > .24 ? p.seat : p.pants;
    pt.y -= Math.max(0, Math.sin(pt.a)) * .012;
  }), m.cloth);
}

function legGarment(batch, m, p, side, l1, l2) {
  const all = l1 + l2, k = -l1;
  const rows = [
    [-all - .062, .076, .085, -.001], [-all - .054, .087, .098, -.002], [-all - .040, .089, .102, .001],
    [-all - .024, .084, .098, .004], [-all - .008, .086, .102, .006], [-all + .015, .085, .101, .004],
    [-all + .030, .080, .094, .005], [-all + .048, .084, .096, .007], [-all + .078, .078, .088, .010],
    [-all + .117, .078, .086, .014], [-all + .155, .082, .090, .016], [k - .187, .084, .091, .018],
    [k - .142, .082, .092, .016], [k - .102, .081, .089, .006], [k - .072, .082, .089, -.001],
    [k - .046, .082, .091, -.006], [k - .025, .083, .094, -.009], [k + .001, .086, .095, -.010],
    [k + .025, .087, .094, -.006], [k + .046, .086, .091, -.002], [k + .066, .09, .096, .003],
    [k + .092, .087, .095, .005], [k + .119, .093, .100, .008], [k + .16, .099, .104, .012],
    [-.182, .104, .111, .014], [-.131, .103, .105, .013], [-.089, .092, .093, .011],
    [-.058, .081, .085, .011], [-.021, .064, .072, .009], [.011, .052, .059, .008], [.027, .039, .050, .008]
  ].sort((a, b) => a[0] - b[0]);
  const pant = loft(fabricRows(rows, .015), 26, pt => {
    const y = pt.y, a = pt.a;
    const knee = Math.exp(-((y - k - .024) ** 2) / .008);
    const cuff = Math.exp(-((y + all - .008) ** 2) / .016);
    const inside = Math.cos(a) * side;
    const wave = Math.sin(3 * a + 23 * y + .7 * side);
    const back = THREE.MathUtils.smoothstep(Math.sin(a), -.22, .86);
    const pleat = (knee * (.24 + back * .76) + cuff * (.45 + .25 * Math.cos(a * 2 + side))) *
      Math.cos(121 * y + 2.8 * Math.cos(a) + 1.0 * Math.sin(3 * a + 8 * y));
    const fold = (knee + cuff) * (.0051 * wave + .0026 * Math.sin(5 * a - 13 * y)) + .0064 * pleat;
    pt.x += Math.cos(a) * fold;
    pt.z += Math.sin(a) * fold;
    pt.y += (knee + cuff) * (.0075 * Math.sin(a * 2 + y * 5) + .0045 * Math.sin(a * 3 - y * 7));
    pt.color = inside < -.54 && y < -all + .135 ? p.guard : Math.sin(a) > .50 && y > -.159 ? p.seat : p.pants;
    const frontKnee = Math.sin(a) < -.58 && y > k - .10 + .021 * Math.cos(a) && y < k + .095 - .018 * Math.cos(a);
    if (frontKnee) pt.color = p.knee;
    pt.light = .98 + (.039 * knee + .034 * cuff) * wave + pleat * .072;
  });
  batch.add(pant, m.cloth);
  projectedSeam(batch, m.cloth, p.pantSeam, pant, [
    [-.136, .049], [-.215, .052], [k + .058, .047], [k - .042, .034],
    [k - .138, .041], [k - .232, .035], [-all + .038, .036], [-all - .032, .034]
  ], side, .0019);
  if (side < 0) {
    projectedSeam(batch, m.cloth, p.guard, pant, [[-.134, -.033], [-.175, -.015], [-.237, .013]], side, .0034);
  }
}

function armGarment(batch, m, p, side, l1, l2) {
  const all = l1 + l2, e = -l1;
  const rows = [
    [-all + .009, .038, .042], [-all + .019, .046, .050], [-all + .030, .048, .052],
    [-all + .044, .047, .049], [-all + .059, .052, .056], [-all + .079, .050, .054],
    [e - .143, .054, .059, .001], [e - .107, .058, .062, .004], [e - .074, .059, .064, .006],
    [e - .050, .060, .065, .007], [e - .026, .057, .063, .007], [e + .003, .059, .066, .006],
    [e + .025, .059, .065, .004], [e + .047, .062, .069, .006], [e + .071, .060, .068, .007],
    [e + .103, .065, .074, .005], [-.117, .069, .079, .002], [-.081, .073, .082, .001],
    [-.041, .075, .082, -.001], [-.010, .073, .079, -.001], [.016, .064, .071, .001],
    [.035, .052, .058, .001], [.050, .030, .034, .002]
  ].sort((a, b) => a[0] - b[0]);
  batch.add(loft(fabricRows(rows, .016), 22, pt => {
    const y = pt.y, a = pt.a, elbow = Math.exp(-((y - e) ** 2) / .009), cuff = Math.exp(-((y + all - .034) ** 2) / .004);
    const wave = Math.sin(3 * a + 19 * y + side * .4);
    const compressed = .58 + .42 * Math.sin(a);
    const pleat = Math.sin(118 * y + 2.3 * Math.cos(a) + .44 * side) * (elbow * compressed + cuff * .65);
    const fold = .0042 * wave * (elbow + cuff * .8) + .0055 * pleat;
    pt.x += Math.cos(a) * fold;
    pt.z += Math.sin(a) * fold;
    pt.y += .0055 * Math.sin(2 * a + 9 * y) * (elbow + cuff * .6);
    pt.color = Math.cos(a) * side < -.72 && y < -.06 ? p.underarm : y > -.054 + .022 * Math.sin(a) ? p.yoke : p.coat;
    pt.light = .98 + .036 * wave * (elbow + cuff * .7) + .045 * pleat;
  }), m.cloth);
  band(batch, m.cloth, p.lining, -all + .022, .047, .051, .001, .014);
  block(batch, m.hard, p.dark, [side * .042, -all + .025, .024], [.008, .015, .035], [0, side * .37, side * .015]);
  if (side < 0) {
    ellipsoid(batch, m.cloth, p.underarm, [side * .070, -.101, .010], [.006, .027, .022], [0, 0, .09]);
    cord(batch, m.cloth, p.silver, [
      [side * .075, -.105, .026], [side * .077, -.091, .014],
      [side * .077, -.101, .004], [side * .076, -.094, -.003]
    ], .0015, 4);
  }
}

function tailoredLimb(parent, name, restLength, blend, build) {
  const cloth = child(parent, name);
  const rig = [new THREE.Bone(), new THREE.Bone()];
  rig[0].name = name + ' upper joint';
  rig[1].name = name + ' lower joint';
  rig[1].position.y = -restLength;
  cloth.add(...rig);
  cloth.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(rig);
  const parts = new THREE.Group(), batch = new Batch(parts);
  build(batch);
  batch.finish();
  for (const mesh of parts.children) {
    const g = mesh.geometry, a = g.attributes.position;
    const indices = new Uint16Array(a.count * 4), weights = new Float32Array(a.count * 4);
    for (let i = 0; i < a.count; i++) {
      const distance = -a.getY(i) - restLength;
      const amount = THREE.MathUtils.smoothstep(distance, -blend, blend);
      indices[i * 4 + 1] = 1;
      weights[i * 4] = 1 - amount; weights[i * 4 + 1] = amount;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    const skin = new THREE.SkinnedMesh(g, mesh.material);
    skin.bind(skeleton, new THREE.Matrix4());
    skin.castShadow = true;
    skin.receiveShadow = true;
    // A single player stays in view as its shell deforms through a deep carve.
    skin.frustumCulled = false;
    cloth.add(skin);
  }
  return rig;
}

function glove(batch, m, p, side) {
  batch.add(loft([
    [-.122, .018, .021, -.003], [-.113, .030, .030, -.006], [-.094, .038, .037, -.008],
    [-.070, .042, .040, -.010], [-.042, .043, .039, -.005], [-.013, .038, .037, .003],
    [.014, .037, .038, .003], [.033, .037, .04, .004]
  ], 16, pt => { pt.color = pt.z > .01 ? p.glove : p.dark; }), m.cloth);
  ellipsoid(batch, m.cloth, p.glove, [-side * .038, -.061, -.025], [.016, .037, .017], [-.38, 0, -side * .41]);
  for (let f = -1; f <= 1; f++) {
    const x = f * .015;
    cord(batch, m.cloth, p.guard, [[x, -.095, .024], [x, -.075, .029], [x - side * .002, -.054, .029]], .0018, 4);
  }
  band(batch, m.hard, p.guard, -.011, .039, .039, .003, .011);
}

function buildHead(batch, m, p, female) {
  const skin = colorOf('#bb8e73'), mask = colorOf('#353c3f');
  batch.add(loft([
    [-.015, .057, .056, .013], [.01, .066, .061, .009], [.053, .066, .065, .002],
    [.073, .062, .083, -.016], [.094, .073, .094, -.014], [.122, .082, .100, -.009],
    [.147, .087, .103, -.003], [.176, .087, .102, .002], [.207, .083, .096, .006],
    [.231, .064, .079, .012], [.248, .022, .028, .012]
  ], 28, pt => {
    pt.color = pt.y > .126 && Math.sin(pt.a) < -.44 ? skin : mask;
    pt.light = .95 + .045 * Math.sin(pt.a * 4 + pt.y * 65);
  }), m.cloth);
  // Mask, nose bridge and ear liners sit under the lens and shell.
  batch.add(loft([
    [.103, .010, .010, -.100], [.109, .018, .018, -.104], [.116, .017, .023, -.105],
    [.128, .013, .023, -.104], [.148, .010, .015, -.102], [.160, .006, .007, -.101]
  ], 14), m.cloth, '#414748');
  for (const s of [-1, 1]) {
    ellipsoid(batch, m.cloth, '#292e31', [s * .083, .126, .019], [.024, .057, .045], [-.18, 0, s * .10]);
    cord(batch, m.cloth, p.guard, [
      [s * .093, .151, -.037], [s * .088, .103, -.029], [s * .062, .071, -.021], [s * .037, .063, -.050]
    ], .0039);
  }
  const outer = colorOf('#383e40'), matte = colorOf('#474d4d');
  const helmetShape = pt => {
    const f = (-Math.sin(pt.a) + 1) / 2;
    pt.y += (1 - pt.t) ** 1.7 * (f * .043 - (1 - f) * .017);
    pt.z -= f * Math.max(0, 1 - pt.t * 3.5) * .012;
    const sidePanel = Math.abs(Math.cos(pt.a)) > .70 && pt.t < .61;
    pt.color = sidePanel ? outer : matte;
  };
  batch.add(loft([
    [.123, .081, .103, .017], [.129, .100, .119, .014], [.139, .106, .126, .014],
    [.153, .110, .130, .013], [.174, .111, .131, .013], [.202, .109, .129, .014],
    [.228, .104, .122, .015], [.251, .094, .111, .017], [.273, .076, .092, .017],
    [.290, .052, .064, .018], [.300, .027, .034, .018], [.303, .004, .006, .018]
  ], 32, helmetShape), m.hard);
  for (const s of [-1, 1]) {
    ellipsoid(batch, m.hard, '#20272a', [s * .043, .2817, .027], [.009, .003, .038], [-.12, 0, -s * .54], 12);
    ellipsoid(batch, m.hard, '#242a2b', [s * .041, .2624, -.044], [.008, .003, .024], [.66, 0, -s * .44], 12);
    ellipsoid(batch, m.hard, '#262d2f', [s * .053, .193, .126], [.019, .0043, .0028],
      [-.15, s * .51, -s * .19], 12);
    ellipsoid(batch, m.hard, '#272d2f', [s * .052, .202, .125], [.017, .0025, .0026],
      [-.19, s * .50, -s * .19], 12);
    cord(batch, m.hard, '#2a3032', [
      [s * .095, .200, -.050], [s * .104, .207, -.010], [s * .106, .201, .052], [s * .094, .184, .087]
    ], .00195);
  }
  // Elastic strap wraps the nape. Its buckle and keeper face the chase camera.
  const strapRows = [[.137, .107, .126, .014], [.139, .110, .130, .014], [.165, .111, .131, .014], [.168, .107, .126, .014]];
  batch.add(loft(strapRows, 32, pt => { pt.y += .017 * -Math.sin(pt.a); }), m.cloth, '#22292c');
  for (const s of [-1, 1]) {
    cord(batch, m.cloth, '#667575', [
      [s * .110, .153, .025], [s * .106, .149, .054], [s * .090, .143, .088], [s * .071, .140, .113]
    ], .0015, 4);
  }
  block(batch, m.hard, '#171e20', [0, .134, .144], [.038, .028, .012], [-.09, 0, 0]);
  block(batch, m.hard, '#667070', [0, .136, .151], [.019, .006, .003], [-.09, 0, 0]);
  block(batch, m.hard, '#798281', [-.035, .170, .140], [.018, .004, .002], [-.12, -.24, .1]);
  const shield = (u, v, frame) => {
    const a = 2 * u - 1, s = Math.abs(a);
    const taper = s ** 3.7;
    const bridge = Math.exp(-a * a * 54) * .017;
    const low = .123 + .011 * s + bridge + .012 * taper;
    const high = .180 + .009 * (1 - s * s) - .008 * taper;
    const x = a * (frame ? .102 : .0975);
    const y = mix(low - (frame ? .004 : 0), high + (frame ? .004 : 0), v);
    const z = -.130 + .066 * (s ** 2) - .004 * Math.sin(v * Math.PI) + (frame ? .0032 : 0);
    return [x, y, z];
  };
  batch.add(surface(34, 6, (u, v) => shield(u, v, true)), m.hard, '#242c2e');
  batch.add(surface(36, 8, (u, v) => shield(u, v, false)), m.lens, '#ffffff');
  for (const s of [-1, 1]) {
    cord(batch, m.hard, '#343b3a', [
      [s * .096, .178, -.067], [s * .106, .172, -.047], [s * .110, .158, -.023]
    ], .007);
  }
  if (female) {
    const hair = ['#493c32', '#56463a', '#443a33'];
    for (let i = 0; i < 5; i++) {
      ellipsoid(batch, m.cloth, hair[i % 3],
        [Math.sin(i * 2.4) * .005 + .017, .090 - i * .015, .101 + .003 * i],
        [.0195 - .0018 * i, .019, .0168 - .0015 * i], [.18, -.2, Math.sin(i) * .24]);
    }
    block(batch, m.cloth, p.guard, [.018, .030, .110], [.023, .008, .019]);
  }
}

function buildBoot(batch, m, p, side, snowboard) {
  // Local origin is the centre of the binding, sole on its footbed.
  const boot = colorOf(snowboard ? '#3e4445' : '#414c51');
  const toe = colorOf('#363b3c'), shell = colorOf(snowboard ? '#292f32' : '#546169');
  batch.add(loft([
    [.044, .044, .137, -.013], [.049, .053, .151, -.014], [.061, .055, .151, -.014],
    [.067, .053, .146, -.013]
  ], 22, pt => {
    if (pt.z < -.026) pt.x *= 1.07;
    pt.color = toe;
  }), m.hard);
  batch.add(loft([
    [.063, .050, .143, -.014], [.076, .054, .146, -.018], [.087, .055, .141, -.016],
    [.100, .055, .130, -.012], [.115, .054, .104, .001], [.128, .054, .083, .015],
    [.152, .055, .064, .027], [.176, .057, .063, .032], [.206, .059, .066, .034],
    [.232, .061, .067, .034], [.245, .057, .061, .035]
  ], 22, pt => {
    pt.color = pt.z > .055 && pt.y < .216 ? shell : boot;
    if (pt.z < -.05) pt.x *= 1.05;
  }), snowboard ? m.cloth : m.hard);
  band(batch, m.cloth, p.lining, .239, .058, .064, .034, .014);
  const latch = snowboard ? [ [ .098,-.086], [.121,-.042], [.147,-.023], [.169,-.020], [.186,-.020] ]
    : [ [.097,-.090], [.121,-.055], [.159,-.022], [.197,-.025] ];
  latch.forEach(([y, z], i) => {
    if (snowboard) {
      cord(batch, m.cloth, '#93918a', [[-.032, y, z + .011], [0, y + .006, z - .007], [.032, y + .014, z + .006]], .0025);
      cord(batch, m.cloth, '#787873', [[.032, y, z + .011], [.001, y + .007, z - .007], [-.032, y + .014, z + .006]], .0023);
    } else {
      cord(batch, m.hard, p.guard, [[-.046, y, z + .027], [-.026, y + .008, z], [.016, y + .008, z - .007], [.048, y - .001, z + .016]], .0057);
      block(batch, m.alloy, i === 2 ? '#c19a68' : '#a8acaa', [side * .048, y, z + .025], [.007, .012, .031], [0, side * -.38, .10]);
    }
  });
}

function buildBinding(batch,m,p,side,snowboard) {
  if (snowboard) {
    // Highback, heel cup, ankle strap and toe cap rotate with the boot.
    batch.add(surface(15, 8, (u, v) => {
      const a = (u - .5) * 2.50;
      return [.068 * Math.sin(a) * (1 - v * .20), .057 + .153 * v * (.70 + .30 * Math.cos(a)),
        .041 + (.084 - .023 * v) * Math.cos(a) + .005 * v];
    }, true), m.hard, '#454e51');
    cord(batch, m.hard, p.guard, [[-.064, .072, .013], [-.054, .112, -.032], [0, .141, -.046],
      [.053, .117, -.029], [.065, .077, .013]], .0096, 6);
    cord(batch, m.hard, p.guard, [[-.061, .071, -.095], [-.048, .088, -.112], [0, .100, -.124],
      [.048, .089, -.110], [.061, .071, -.096]], .0078, 6);
    block(batch, m.alloy, '#adb3ae', [side * .060, .111, -.025], [.009, .015, .031], [0, side * .18, 0]);
    block(batch, m.hard, p.guard, [0, .040, -.009], [.13, .021, .273]);
  } else {
    block(batch, m.hard, p.guard, [0, .035, -.010], [.079, .018, .335]);
    for (const s of [-1, 1]) {
      block(batch, m.hard, '#4c5355', [s * .031, .066, -.153], [.022, .039, .041], [.16, -s * .23, 0]);
      cord(batch, m.alloy, '#acb0aa', [[s * .043, .049, .068], [s * .052, .055, .087], [s * .058, .027, .113]], .0030);
    }
    block(batch, m.hard, '#555f62', [0, .069, .146], [.068, .052, .048], [-.24, 0, 0]);
    block(batch, m.alloy, '#8c9698', [0, .088, .166], [.047, .016, .032], [-.28, 0, 0]);
  }
}

function makeDeck(batch, m, p, board, side) {
  // Full-width values taper through a cambered waist to rounded shovel and tail.
  const profile = board ? [
    [-.80, .008, .098], [-.790, .105, .086], [-.77, .174, .069], [-.738, .236, .050],
    [-.694, .276, .031], [-.630, .288, .023], [-.48, .278, .020], [-.23, .257, .022],
    [0, .25, .026], [.23, .259, .022], [.48, .277, .020], [.625, .284, .022],
    [.689, .274, .030], [.732, .232, .044], [.760, .16, .057], [.779, .086, .069], [.785, .009, .075]
  ] : [
    [-.96, .004, .119], [-.94, .054, .097], [-.912, .094, .078], [-.864, .119, .051],
    [-.811, .127, .035], [-.732, .124, .024], [-.55, .110, .020], [-.32, .092, .022],
    [-.14, .084, .024], [.05, .079, .025], [.32, .090, .023], [.52, .103, .020],
    [.655, .107, .020], [.735, .101, .024], [.769, .081, .030], [.788, .040, .038], [.793, .005, .042]
  ];
  const base = board ? colorOf('#384d59') : colorOf('#3c535c');
  const paper = board ? colorOf('#d5c7a0') : colorOf('#d9cba9');
  const printed = wash(p.coat, '#d3a46e', .34);
  function panel(u, z) {
    const q = u * 2 - 1;
    const sign = board ? 1 : side;
    const cut = z + q * sign * (board ? .115 : .075);
    if (cut < -.67) return printed;
    if (cut < -.60) return paper;
    if (cut < -.49) return base;
    if (cut < -.454 || (cut > .488 && cut < .511)) return printed;
    if (cut > .518) return paper;
    if (Math.abs(q) > .91) return tone(base, .71);
    return base;
  }
  function sample(z) {
    let i = 1;
    while (i < profile.length - 1 && profile[i][0] < z) i++;
    const a = profile[i - 1], b = profile[i], f = (z - a[0]) / (b[0] - a[0]);
    return [mix(a[1], b[1], f), mix(a[2], b[2], f)];
  }
  const start = profile[0][0], end = profile.at(-1)[0], thickness = board ? .0105 : .013;
  const stations = Array.from(new Set([...profile.map(q => q[0]),
    ...Array.from({ length: 47 }, (_, i) => start + (end - start) * i / 46)])).sort((a, b) => a - b);
  const deckPoint = (u, v, bottom) => {
    const z = stations[Math.round(v * (stations.length - 1))], [width, y] = sample(z);
    const q = 2 * u - 1;
    return [q * width / 2, bottom ? y - thickness : y + .0017 * (1 - q * q), z,
      bottom ? colorOf('#303736') : panel(u, z)];
  };
  batch.add(surface(8, stations.length - 1, (u, v) => deckPoint(u, v, false)), m.hard);
  batch.add(surface(2, stations.length - 1, (u, v) => deckPoint(u, v, true), true), m.hard);
  for (const s of [-1, 1]) {
    batch.add(surface(2, stations.length - 1, (u, v) => {
      const z = stations[Math.round(v * (stations.length - 1))], [width, y] = sample(z);
      return [s * width * .5, y - thickness * (1 - u), z];
    }, s > 0), m.alloy, '#9aa4a9');
  }
  if (board) {
    const ink = '#d3bf91';
    cord(batch, m.hard, ink, [[-.043, .025, .37], [-.015, .025, .335], [.024, .025, .367], [.043, .025, .347]], .0020, 4);
  }
}

function flexibleDeck(node, board) {
  const skins = node.children.filter(m => m.isMesh);
  for (const skin of skins) {
    const geometry = skin.geometry, a = geometry.attributes.position;
    const nose = new Float32Array(a.count*3), tail = new Float32Array(a.count*3);
    for (let i = 0; i < a.count; i++) {
      const z = a.getZ(i);
      const before = THREE.MathUtils.smoothstep(-z,.18,board ? .75:.90);
      const after = THREE.MathUtils.smoothstep(z,.18,.73);
      nose[i*3+1] = -.021*before + .008*after;
      tail[i*3+1] = -.016*after + .012*before;
    }
    geometry.morphTargetsRelative = true;
    geometry.morphAttributes.position = [
      new THREE.BufferAttribute(nose,3),new THREE.BufferAttribute(tail,3)
    ];
    skin.updateMorphTargets();
  }
  return (front,back) => {
    for (const skin of skins) {
      skin.morphTargetInfluences[0] = front;
      skin.morphTargetInfluences[1] = back;
    }
  };
}

function skiPole(batch, m, p, side) {
  const l = 1.135;
  batch.add(loft([
    [-l, .0014, .0014], [-l + .026, .0025, .0025], [-l + .054, .0038, .0038],
    [-.65, .0050, .0050], [-.19, .0064, .0064], [-.095, .0065, .0065]
  ], 8, pt => { pt.color = pt.y > -.46 && pt.y < -.19 ? p.pole : p.shaft; }), m.alloy);
  batch.add(loft([
    [-.123, .009, .009], [-.104, .016, .015], [-.091, .013, .014], [-.051, .014, .016],
    [-.018, .012, .013], [.012, .015, .014], [.023, .014, .013]
  ], 12), m.hard, p.dark);
  const basket = new THREE.TorusGeometry(.026, .0030, 5, 16);
  batch.add(basket, m.hard, '#333b41', [0, -l + .062, 0], [Math.PI / 2, 0, 0]);
  for (let k = 0; k < 3; k++) {
    const a = k * TAU / 3;
    cord(batch, m.hard, p.guard, [[0, -l + .064, 0], [.026 * Math.cos(a), -l + .062, .026 * Math.sin(a)]], .0022, 4);
  }
  cord(batch, m.cloth, p.guard, [
    [side * .008, .009, .002], [side * .022, .029, .017], [side * .040, .023, .036],
    [side * .039, -.010, .032], [side * .012, -.054, .010]
  ], .0029, 5);
}

const dirScratch = v3(), poleScratch = v3();

function solveJoint(hip, ankle, bend, thigh, shin, knee) {
  dirScratch.subVectors(ankle, hip);
  const dist = Math.max(.001, dirScratch.length());
  dirScratch.multiplyScalar(1 / dist);
  poleScratch.copy(bend).addScaledVector(dirScratch, -bend.dot(dirScratch)).normalize();
  const reach = clamp(dist, Math.abs(thigh - shin) + .0001, thigh + shin - .0001);
  const along = (thigh * thigh - shin * shin + reach * reach) / (2 * reach);
  const high = Math.sqrt(Math.max(0, thigh * thigh - along * along));
  knee.copy(hip).addScaledVector(dirScratch, along).addScaledVector(poleScratch, high);
}

function aimBone(node, from, to, length, yaw) {
  basisY.subVectors(from, to);
  const dist = basisY.length();
  basisY.multiplyScalar(1 / Math.max(.0001, dist));
  basisX.set(Math.cos(yaw), 0, -Math.sin(yaw));
  basisZ.crossVectors(basisX, basisY).normalize();
  basisX.crossVectors(basisY, basisZ).normalize();
  basisMatrix.makeBasis(basisX, basisY, basisZ);
  node.position.copy(from);
  node.quaternion.setFromRotationMatrix(basisMatrix);
  node.scale.y = dist / length;
}

function makePart(parent, name, build) {
  const node = child(parent, name);
  const b = new Batch(node);
  build(b);
  b.finish();
  return node;
}

/**
 * An articulated alpine skier or regular-stance snowboarder. The neutral deck
 * points down local -Z. All joint and gear positions are in metres.
 */
export function createRider(options = {}) {
  const board = options.gear === 'board', female = options.gender === 'female';
  const m = materials();
  const coat = colorOf(options.color ?? '#bd643c');
  const palette = {
    coat, yoke: wash(coat, '#deb78d', .24), underarm: wash(coat, '#353d3f', .38),
    lining: colorOf('#303a3e'), stitch: wash(coat, '#a49883', .42), dark: colorOf('#232b2d'),
    pants: colorOf('#323f47'), knee: colorOf('#344149'), seat: colorOf('#35424a'), guard: colorOf('#283237'),
    glove: colorOf('#394246'), pantSeam: colorOf('#424e54'), silver: colorOf('#aca995'),
    shaft: colorOf('#838f8c'), pole: wash(coat, '#a09e8d', .32)
  };
  const group = new THREE.Group();
  group.name = board ? 'Snowboarder' : 'Alpine skier';
  const pelvis = makePart(group, 'Snow pants', b => pelvisShape(b, m, palette, female));
  const torso = makePart(group, 'Shell jacket', b => jacket(b, m, palette, female));
  const head = makePart(torso, 'Helmet and goggles', b => buildHead(b, m, palette, female));
  head.position.set(0, .475, -.003);

  const leg1 = female ? .412 : .432, leg2 = female ? .387 : .403;
  const arm1 = female ? .265 : .28, arm2 = female ? .244 : .254;
  const width = female ? .178 : .192, hipWidth = female ? .098 : .104;
  const deck = board ? makePart(group, 'Snowboard', b => makeDeck(b, m, palette, true, 0)) : null;
  const limbs = [];
  for (const s of [-1, 1]) {
    const prefix = s < 0 ? 'Left ' : 'Right ';
    const plank = deck || makePart(group, prefix + 'ski', b => makeDeck(b, m, palette, false, s));
    let foot;
    if (board) {
      const binding = makePart(plank, prefix + 'binding', b => buildBinding(b,m,palette,s,true));
      binding.position.set(0,0,s*.275); binding.rotation.y = s < 0 ? -1.22 : -1.66;
      foot = makePart(plank, prefix + 'boot', b => buildBoot(b,m,palette,s,true));
      foot.position.copy(binding.position); foot.rotation.copy(binding.rotation);
    } else {
      foot = makePart(plank, prefix + 'boot and binding', b => {
        buildBoot(b,m,palette,s,false); buildBinding(b,m,palette,s,false);
      });
    }
    const [thigh, shin] = tailoredLimb(group, prefix + 'trouser leg', leg1, .132,
      b => legGarment(b, m, palette, s, leg1, leg2));
    const [arm, forearm] = tailoredLimb(group, prefix + 'jacket sleeve', arm1, .102,
      b => armGarment(b, m, palette, s, arm1, arm2));
    const hand = makePart(group, prefix + 'glove', b => glove(b, m, palette, s));
    const pole = board ? null : makePart(group, prefix + 'pole', b => skiPole(b, m, palette, s));
    limbs.push({
      s, plank, foot, thigh, shin, arm, forearm, hand, pole,
      flex: !board ? flexibleDeck(plank, false) : null, plant: null, lastStroke: 0,
      hip: v3(), ankle: v3(), knee: v3(),
      shoulder: v3(), elbow: v3(), wrist: v3(), poleDirection: v3()
    });
  }
  const bend = v3(), tmp = v3(), contact = v3(), grip = v3(), leanQ = new THREE.Quaternion();
  const deckFlex = board ? flexibleDeck(deck,true) : null;
  const posed = {edge:0, chest:0, speed:0, t:0, turnSign:0, swing:0, lastSwap:-2};
  const leanAxis = v3(0,0,-1);
  let disposed = false;

  function update(state = {}, frameDt, clock) {
    if (disposed) return;
    const dt = clamp(frameDt ?? state.dt ?? 1/60, 0, .1);
    const time = clock ?? state.time ?? (posed.t + dt);
    const rewound = time < posed.t - .05;
    posed.t = time;
    const drive = state.mode ? state.mode === 'run' : true;
    const targetEdge = drive ? (state.edge ?? state.steer ?? 0) : 0;
    const speed = drive ? Math.max(0,state.speed || 0) : 0;
    const snapPose = !dt || rewound;
    const ease = rate => snapPose ? 1 : 1-Math.exp(-dt*rate);
    posed.edge = mix(posed.edge,targetEdge,ease(15));
    posed.speed = mix(posed.speed,speed,ease(12));
    const edge = posed.edge, turn = state.steer || 0, fast = clamp(posed.speed/21,0,1);
    const moving = THREE.MathUtils.smoothstep(speed,.20,4);
    const air = drive ? clamp(state.air ?? (state.airHeight || 0),0,1) : 0;
    const inFlight = drive && (state.airborne ?? (air>.025));
    const charge = drive ? (state.charge || 0) : 0, launch = drive ? (state.launch || 0) : 0;
    const land = drive ? clamp(state.landing || 0,0,1.22) : 0;
    const brake = drive ? (state.brake || 0) : 0, skid = drive ? (state.skid ?? brake*.73) : 0;
    const boost = drive ? (state.boost || 0) : 0, trim = drive ? (state.trim || 0) : 0;
    const cutSide = state.cutSide || Math.sign(edge || turn) || 1;
    const slip = drive ? state.slipAngle || 0 : 0;
    const pressure = drive ? clamp(state.pressure ?? Math.abs(edge)*moving,0,1.25) : 0;
    const swap = drive ? state.bankSwap || 0 : 0;
    const terrain = drive ? state.terrainFlex || 0 : 0;
    const push = drive ? clamp(state.push ?? boost*(1-fast),0,1) : 0;
    const stride = state.stride ?? (time*.91)%1;
    const wave = Math.sin(stride*TAU), kick = THREE.MathUtils.smoothstep(stride,.08,.19) *
      (1-THREE.MathUtils.smoothstep(stride,.82,.97));
    const edgeSign = Math.abs(edge)>.12 ? Math.sign(edge) : 0;
    if (edgeSign && edgeSign!==posed.turnSign) {
      if (posed.turnSign && moving>.6 && time-posed.lastSwap>.30) posed.lastSwap=time;
      posed.turnSign=edgeSign;
    }
    if (!drive || rewound) {posed.lastSwap=-2;posed.turnSign=0;}
    const transferPlant = Math.max(0,1-(time-posed.lastSwap)/.23);
    const compression = clamp(.13*fast+.071*pressure+.056*skid+.170*charge+.146*land+
      .090*air+.038*terrain+.036*boost-.040*swap*pressure,0,.398);
    const surfaceRide = moving*(.0045*Math.sin((state.travel??time*speed)*.69)+.003*Math.sin(time*7.2+.3))*(1-air);
    const idle = .0045*Math.sin(time*1.75+.48);
    const height = (female ? .867:.908) - (board ? .063:0) - compression + launch*.102 + surfaceRide + idle;
    const lean = edge*(.13+.71*moving)*(.60+pressure*.24) + cutSide*skid*.060;
    const intoX = .43+.57*Math.cos(slip), intoZ = -.57*Math.sin(slip);
    const crossSlope = Math.sin(state.roll||0)*moving;
    const hipX = (board?-.015:0) + lean*(board ? .302:.337)*intoX + wave*push*(board ? .055:.049)+crossSlope*.052;
    const fore = trim*(board ? .174:.145);
    const hipZ = (board?-.020:.052) + (board?-.025:.036)*fast - fore + lean*intoZ*.255 + .039*charge + .037*land;
    const gearYaw = -edge*.024;
    const pelvisYaw = (board?-1.33:0)+gearYaw+slip*(board ? .25:.28) - edge*(board ? .19:.092);
    const chestTarget = (board?-.94:0) + slip*(board ? .73:.69) + edge*(board ? .25:.14)
      + (board ? wave*push*.12 : wave*push*.091);
    posed.chest = mix(posed.chest,chestTarget,ease(6.3));
    const chestYaw = posed.chest;
    const tuck = boost*(.28+.72*fast);
    const bodyPitch = -.115-.235*fast-.205*tuck-.160*charge-.065*land-.060*pressure;
    leanAxis.set(intoZ,0,-intoX).normalize();
    pelvis.position.set(hipX,height,hipZ);
    pelvis.rotation.set(-.078-.06*fast-.052*trim,pelvisYaw,.012*push*wave,'YXZ');
    leanQ.setFromAxisAngle(leanAxis,lean*(board ? .295:.335)+crossSlope*.062);pelvis.quaternion.premultiply(leanQ);
    torso.position.copy(pelvis.position);
    torso.rotation.set(bodyPitch-(board?0:trim*.145),chestYaw,(board?-trim*.11:0)+.012*Math.sin(time*1.82),'YXZ');
    leanQ.setFromAxisAngle(leanAxis,lean*(board ? .65:.61)+crossSlope*.135);torso.quaternion.premultiply(leanQ);
    head.rotation.set(-bodyPitch*.66+air*.065,(board ? .76:0) - turn*.18+slip*.16,
      lean*.23,'YXZ');

    const press = drive ? (state.press ?? Math.sign(trim)*THREE.MathUtils.smoothstep(Math.abs(trim),.57,.98)) : 0;
    const pressPitch = -press*(board ? .150 : .064);
    const contactLift = Math.abs(Math.sin(pressPitch))*(board ? .62 : .65);
    const boardPitch = air*(-.13 + (state.upSpeed<0 ? .19:0)) - trim*.010 + pressPitch + launch*.083;
    const boardLift = air*.132;
    const noseLoad=clamp(Math.max(0,trim)*.88+pressure*.24+land*.18,0,1);
    const tailLoad=clamp(Math.max(0,-trim)*.85+charge*.28,0,1);
    if (deck) {
      const roll = -(edge*(.28+.65*moving) + cutSide*skid*.08)*(1-.69*air);
      deck.rotation.set(boardPitch,gearYaw,roll,'YXZ');
      deck.position.set(0,.002+Math.abs(Math.sin(roll))*.116+boardLift+contactLift,0);
      deckFlex(noseLoad,tailLoad);
    }

    for (const limb of limbs) {
      const {s,plank,foot,hip,knee,ankle,shoulder,elbow,wrist}=limb;
      const inside = s*edge, outside = Math.max(0,-inside), insideLoad = Math.max(0,inside);
      const phase = (stride+(s<0 ? .5:0))%1;
      const stroke = Math.sin(phase*TAU), poling = push*stroke;
      const recovered = phase>.53 ? Math.sin((phase-.53)/.47*Math.PI) : 0;
      if (board) {
        if (s>0) {
          const reach = kick*push;
          foot.position.set(reach*(.245+.036*Math.sin(stride*Math.PI)),
            reach*(stride>.6 ? .145*Math.sin((stride-.6)/.4*Math.PI):-.013),
            .275+reach*(-.230+.64*THREE.MathUtils.smoothstep(stride,.17,.72)));
          foot.rotation.y = -1.66 + reach*.89;
        }
      } else {
        const step = state.walking ? s*Math.sin(time*5.05) : push*stroke;
        const roll = -(edge*(.28+moving*(.47+.16*outside)) + cutSide*skid*.085) * (1-.76*air);
        plank.rotation.set(boardPitch+air*s*.058+step*.024,gearYaw+s*brake*(1-skid)*.135+
          s*air*.074-s*push*.064,roll,'YXZ');
        plank.position.set(s*(.141+.035*pressure+.029*skid+.034*air+.025*push),
          .002+Math.abs(Math.sin(roll))*.047+boardLift+contactLift+insideLoad*.007+Math.max(0,step)*.020,
          -.094*insideLoad+.066*outside+air*s*.075-step*.126);
        limb.flex(clamp(noseLoad*(.85+outside*.34),0,1),tailLoad);
      }

      ankle.set(0,.196,.030).applyQuaternion(foot.quaternion).add(foot.position);
      ankle.applyQuaternion(plank.quaternion).add(plank.position);
      hip.set(s*hipWidth,-.007,.006).applyQuaternion(pelvis.quaternion).add(pelvis.position);
      if (!board) hip.y += outside*.036-insideLoad*.028;
      const legYaw = board ? foot.rotation.y+gearYaw : gearYaw+slip*.10+s*brake*(1-skid)*.12;
      bend.set(s*.11,-.03,-1).applyAxisAngle(axisY,legYaw);
      bend.x+=edge*(board ? .19:.36); bend.z-=trim*.085;
      solveJoint(hip,ankle,bend,leg1,leg2,knee);
      aimBone(limb.thigh,hip,knee,leg1,legYaw);aimBone(limb.shin,knee,ankle,leg2,legYaw);

      shoulder.set(s*width,.396,.009).applyQuaternion(torso.quaternion).add(torso.position);
      const poleTap = s===posed.turnSign ? transferPlant : 0;
      if (board) {
        wrist.set(s*(.381+.085*pressure+.075*air+.068*land)-s*charge*.046,
          .054+.12*air+.055*charge+s*edge*.14+recovered*push*.087,
          -.166-.025*fast+s*.044-s*turn*.115+s*trim*.045);
      } else {
        wrist.set(s*(.259+.066*pressure+.045*skid-.037*tuck+.036*poleTap),
          .018+.095*fast+.060*tuck+.075*air-.064*land-.045*charge+
            poling*.093-s*edge*.092+recovered*push*.050-.045*poleTap,
          -.226-.117*fast-.047*tuck-.039*trim+.18*poling-.088*poleTap-s*edge*.044);
      }
      wrist.applyAxisAngle(axisY,chestYaw).add(torso.position);
      tmp.subVectors(wrist,shoulder).clampLength(.12,arm1+arm2-.002);
      wrist.copy(shoulder).add(tmp);

      // A planted pole tip briefly stays in the snow as the skier moves past it.
      const worldPose = Number.isFinite(state.x) && Number.isFinite(state.z);
      if (limb.pole) {
        if (!drive || inFlight || !worldPose || rewound) limb.plant=null;
        const startPlant = (push>.25 && phase<.18 && (limb.lastStroke>=.18 || !limb.wasPushing)) ||
          (poleTap>.8 && limb.lastStroke<.79 && push<.35);
        if (!limb.plant && startPlant && drive && !inFlight && worldPose) {
          contact.set(wrist.x+s*(.24+.065*pressure),.013,wrist.z-.34);
          group.localToWorld(contact);
          if (state.data?.height) contact.y=state.data.height(contact.x,contact.z)+.016;
          limb.plant={point:contact.clone(),age:0,max:Math.min(.42,.98/Math.max(2.7,speed))};
        }
        limb.lastStroke = push>.25 ? phase : poleTap;limb.wasPushing=push>.25;
        if (limb.plant) {
          limb.plant.age+=dt;
          contact.copy(limb.plant.point);group.worldToLocal(contact);
          grip.copy(wrist);grip.y-=.062;
          const d=grip.distanceTo(contact);
          if (limb.plant.age>limb.plant.max || d>1.27 || d<.60) limb.plant=null;
          else {
            grip.sub(contact).setLength(1.135).add(contact);grip.y+=.062;
            tmp.subVectors(grip,shoulder);
            if(tmp.length()>arm1+arm2+.065)limb.plant=null;
            else wrist.copy(shoulder).add(tmp.clampLength(.14,arm1+arm2-.001));
          }
        }
      }

      bend.set(s*(board ? .83:.78),-.18,.84).applyAxisAngle(axisY,chestYaw);
      solveJoint(shoulder,wrist,bend,arm1,arm2,elbow);
      aimBone(limb.arm,shoulder,elbow,arm1,chestYaw);aimBone(limb.forearm,elbow,wrist,arm2,chestYaw);
      limb.hand.position.copy(wrist);
      limb.hand.rotation.set(board?-.20-fast*.10:.20+fast*.25+poling*.23,
        chestYaw-s*.14,s*.145+lean*.09,'YXZ');
      if (limb.pole) {
        const hold=tmp.set(-s*.008,-.065,-.013).applyQuaternion(limb.hand.quaternion).add(wrist);
        limb.pole.position.copy(hold);
        if (limb.plant) {
          const length=limb.poleDirection.subVectors(contact,hold).length();
          limb.poleDirection.multiplyScalar(1/Math.max(.001,length));
          limb.pole.scale.y=clamp(length/1.135,.97,1.03);
        } else {
          const drop=clamp(hold.y-.11-.20*air-.16*recovered*push-.035*swap,.28,1.035);
          const spread=s*(.165+.12*pressure+.084*poleTap);
          const trail=Math.sqrt(Math.max(.01,1.135**2-drop**2-spread**2));
          // Recover the shaft forward just before the next low-speed pole plant.
          const reach = push*THREE.MathUtils.smoothstep(phase,.69,.90) +
            (1-push)*poleTap*.65;
          limb.poleDirection.set(spread+s*reach*.35,-drop,trail*(1-reach*1.45)).normalize();
          limb.pole.scale.y=1;
        }
        limb.pole.quaternion.setFromUnitVectors(axisDown,limb.poleDirection);
      }
    }
  }


  function dispose() {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
    const skeletons = new Set();
    group.traverse(node => {
      if (node.isMesh) node.geometry.dispose();
      if (node.isSkinnedMesh) skeletons.add(node.skeleton);
    });
    for (const skeleton of skeletons) skeleton.dispose();
    for (const value of Object.values(m)) if (value?.isMaterial) value.dispose();
    for (const tex of m.textures) tex.dispose();
  }

  update();
  return { group, update, dispose };
}
