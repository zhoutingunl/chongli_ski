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

// Equipment is measured nose to tail. Stance is the distance between the
// boot centres at rest, across a pair of skis or along a snowboard.
export function getRiderDimensions({gear = 'ski', gender = 'male'} = {}) {
  const board = gear === 'board', isChild = gender === 'boy' || gender === 'girl';
  const scale = gender === 'boy' ? .684 : gender === 'girl' ? .674 : 1;
  const lengthScale = scale * (isChild ? (board ? .885 : .820) : 1);
  const widthScale = scale * (isChild ? (board ? 1.055 : 1.16) : 1);
  const stanceScale = scale * (isChild ? (board ? .900 : .985) : 1);
  return Object.freeze({
    isChild, scale, lengthScale, widthScale, stanceScale,
    deckLength: (board ? 1.585 : 1.753) * lengthScale,
    deckWidth: (board ? .288 : .127) * widthScale,
    waistWidth: (board ? .250 : .079) * widthScale,
    stanceWidth: (board ? .550 : .282) * stanceScale,
    poleLength: board ? 0 : (isChild ? 1.085 : 1.135) * scale
  });
}

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

function jacket(batch, m, palette, female, junior) {
  const shoulder = junior ? .91 : female ? .916 : 1, waist = junior ? .97 : female ? .91 : 1;
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
    const gathered = 1-THREE.MathUtils.smoothstep(row[0],-.058,.103);
    row[1]=mix(row[1],.172,gathered*.36);row[2]=mix(row[2],.130,gathered*.37);
    row[1] *= mix(waist, shoulder, clamp((row[0] + .03) / .35, 0, 1));
    row[1] += .010 + .015 * flare;
    row[2] += .007 + .018 * flare;
    row[3] += .009 * flare;
    if (junior) {
      const insulation=.010*Math.sin(Math.PI*clamp((row[0]+.08)/.55,0,1));
      row[1]+=insulation;row[2]+=insulation;
    }
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
    p.y += hem * (.019 - back * .032);
    const acrossYoke = .346 + .041 * side - .025 * back;
    p.color = p.y > acrossYoke ? palette.yoke : side > .933 && p.y > .09 && p.y < .345 ? palette.underarm : palette.coat;
    p.light = .97 + .035 * ripple * gathering + .017 * Math.cos(3 * p.a) + crease * 8.0;
    if (junior && p.y>.015 && p.y<.336) {
      const chamber=.5+.5*Math.cos((p.y+.013*back+.018*side)*75);
      p.x+=.006*chamber*Math.cos(p.a);p.z+=.006*chamber*back;
      p.light*=.94+.08*chamber;
    }
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
    if (junior) {
      seam([[w*.204,.388],[w*.182,.369],[w*.156,.353]],true,'#c5d9cd',.0045);
    }
  }
  seam([[0, .016], [.002, .086], [.001, .190], [0, .297], [.001, .398], [0, .453]],
    false, palette.dark, .0039);
  seam([[-.067, .340], [-.079, .285], [-.091, .233]], false, palette.underarm, .0032);
  block(batch, m.alloy, '#929088', onShell(-.069, .33, false, .0055), [.007, .014, .004], [0, 0, -.2]);
  cord(batch, m.hard, palette.dark, [[0, .445, -.079], [0, .480, -.084], [0, .515, -.076]], .0032);
  block(batch, m.alloy, '#928b78', [.003, .494, -.085], [.008, .013, .004]);
  if (junior) {
    cord(batch,m.cloth,palette.yoke,[[.003,.490,-.087],[.011,.475,-.091],
      [.003,.464,-.093],[-.005,.477,-.091],[.003,.490,-.087]],.0037);
    const reflector=female?'#f4ddb5':'#b2d9d2';
    for(const s of [-1,1]){
      seam([[s*.165,.304],[s*.124,.291],[s*.081,.280]],true,reflector,.007);
      if(female)seam([[s*.149,.268],[s*.111,.254],[s*.083,.250]],true,reflector,.003);
    }
  } else if (female) {
    for(const s of [-1,1])seam([[s*.175,.321],[s*.111,.291],[s*.037,.277]],true,palette.stitch,.004);
    batch.add(loft([[.022,.055,.020,.132],[.037,.088,.034,.144],[.085,.094,.034,.142],[.102,.061,.018,.137]],22),m.cloth,'#51636a');
    cord(batch,m.hard,'#96a5a5',[[-.069,.082,.164],[-.027,.083,.177],[.039,.083,.175],[.073,.079,.160]],.0024);
  } else {
    const pack='#45575b',webbing='#394245';
    batch.add(loft([[.040,.039,.021,.134],[.055,.082,.049,.151],[.094,.103,.059,.157],
      [.177,.112,.066,.151],[.251,.107,.063,.148],[.310,.095,.052,.145],[.352,.069,.035,.134],[.369,.042,.021,.132]],24),m.cloth,pack);
    for(const s of [-1,1]){
      seam([[s*.140,.429],[s*.148,.376],[s*.134,.299],[s*.120,.235],[s*.132,.161]],false,webbing,.010);
      cord(batch,m.cloth,webbing,[onShell(s*.140,.429,false,.005),[s*.142,.449,-.064],
        [s*.145,.459,.007],[s*.142,.445,.061],[s*.115,.406,.111],[s*.069,.350,.151]],.0098);
      cord(batch,m.cloth,webbing,[onShell(s*.132,.161,false,.004),[s*.175,.128,-.063],
        [s*.187,.100,.008],[s*.165,.078,.086],[s*.079,.063,.151]],.0067);
      cord(batch,m.cloth,'#91a3a0',[[s*.060,.307,.183],[s*.088,.248,.189],[s*.086,.147,.198],[s*.059,.092,.206]],.0028);
    }
    cord(batch,m.cloth,'#839691',[[-.052,.119,.209],[.041,.155,.211],[-.047,.185,.210],[.052,.221,.203]],.0023);
  }
}

function pelvisShape(batch, m, p, female) {
  const w = female ? .154 : .150;
  batch.add(loft([
    [-.128, w*.52, .068, .021], [-.109, w*.75, .094, .028],
    [-.083, w*.92, .114, .030], [-.055, w*1.02, .126, .023],
    [-.025, w*1.05, .126, .018], [.017, w, .113, .012], [.055, w*.87, .099, .006]
  ], 24, pt => {
    pt.color = Math.sin(pt.a) > .24 ? p.seat : p.pants;
    const gusset = (1-THREE.MathUtils.smoothstep(pt.y,-.116,-.052));
    pt.y += .018*gusset*Math.abs(Math.cos(pt.a)) - Math.max(0,Math.sin(pt.a))*.012;
  }), m.cloth);
}

// All material layers of the garment use the same bind-space weights, so its
// zippers, stitching and collar move with the fabric underneath them.
function garmentSkeleton(part, names, rest, paint) {
  const meshes = part.children.filter(node => node.isMesh);
  const joints = names.map((name, i) => {
    const joint = new THREE.Bone(); joint.name=name; joint.position.copy(rest[i]); return joint;
  });
  part.add(...joints);part.updateMatrixWorld(true);
  const rig = new THREE.Skeleton(joints);
  for (const mesh of meshes) {
    const geo = mesh.geometry, coords = geo.attributes.position;
    const indices = new Uint16Array(4*coords.count), weights = new Float32Array(4*coords.count);
    for (let i=0;i<coords.count;i++) paint(coords.getX(i),coords.getY(i),coords.getZ(i),4*i,indices,weights);
    geo.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));
    geo.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
    const skin = new THREE.SkinnedMesh(geo,mesh.material);
    skin.bind(rig,new THREE.Matrix4());skin.frustumCulled=false;
    skin.castShadow=mesh.castShadow;skin.receiveShadow=mesh.receiveShadow;
    mesh.removeFromParent();part.add(skin);
  }
  return joints;
}

function fitJacket(part) {
  const rest = [v3(),v3(0,.116,.020),v3(0,.239,.012),v3(0,.353,.006),
    v3(-.058,.372,.006),v3(.058,.372,.006)];
  const levels = [.039,.150,.266,.366];
  const smooth=THREE.MathUtils.smoothstep;
  const joints=garmentSkeleton(part,['Pelvic girdle','Lumbar spine','Rib cage','Thoracic inlet','Left clavicle','Right clavicle'],rest,
    (x,y,z,i,index,weight) => {
      const a=y<levels[1] ? 0 : y<levels[2] ? 1 : 2, t=smooth(y,levels[a],levels[a+1]);
      const shoulder=.91*smooth(Math.abs(x),.062,.185)*smooth(y,.295,.392)*
        (1-smooth(y,.434,.489))*(1-.65*smooth(z,.090,.161));
      index[i]=a;index[i+1]=a+1;index[i+2]=x<0 ? 4 : 5;
      weight[i]=(1-shoulder)*(1-t);weight[i+1]=(1-shoulder)*t;weight[i+2]=shoulder;
    });
  const identity=new THREE.Quaternion(),q=new THREE.Quaternion(),euler=new THREE.Euler(0,0,0,'YXZ');
  const sideAxis=v3(1,0,0);
  const skins=part.children.filter(node=>node.isSkinnedMesh);
  for(const skin of skins){
    const g=skin.geometry,p=g.attributes.position,folds=Array.from({length:3},()=>new Float32Array(3*p.count));
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i),j=3*i;
      const waist=smooth(y,-.041,.025)*(1-smooth(y,.17,.29));
      const ripple=Math.cos(60*y+7*Math.abs(x)+2.3*x+2*z);
      const front=waist*smooth(-z,-.003,.119), flank=waist*smooth(Math.abs(x),.071,.168);
      folds[0][j]=.014*x*front*ripple;folds[0][j+1]=.0027*front*Math.sin(60*y+6*x);folds[0][j+2]=-.009*front*ripple;
      const side=folds[x<0 ? 1 : 2];side[j]=Math.sign(x)*.008*flank*ripple;
      side[j+1]=.003*flank*Math.sin(57*y+5*z);side[j+2]=.015*z*flank*ripple;
    }
    g.morphTargetsRelative=true;g.morphAttributes.position=folds.map(a=>new THREE.BufferAttribute(a,3));skin.updateMorphTargets();
  }
  function pose(hips,load,arc,push,tuck,flex) {
    // Each successive pivot is carried by the one below. A slightly
    // extended lumbar segment and rounded rib cage distribute forward bend.
    joints[0].quaternion.copy(part.quaternion).invert().multiply(hips);
    joints[1].quaternion.copy(joints[0].quaternion).slerp(identity,.42)
      .multiply(q.setFromAxisAngle(sideAxis,.075-.018*tuck));
    joints[2].quaternion.copy(joints[0].quaternion).slerp(identity,.83)
      .multiply(q.setFromAxisAngle(sideAxis,-.055-.051*tuck-.026*load));
    joints[3].quaternion.identity();
    for (let i=1;i<joints.length;i++) {
      const parent=i<4 ? i-1 : 3;
      joints[i].position.subVectors(rest[i],rest[parent]).applyQuaternion(joints[parent].quaternion).add(joints[parent].position);
      if (i<4) continue;
      const sign=i===4 ? -1 : 1, inside=sign*arc;
      euler.set(0,sign*(.048+.15*tuck+.067*load)+push*.087,
        sign*(.025+.042*tuck-.093*inside)+push*.044,'YXZ');
      joints[i].quaternion.setFromEuler(euler);
    }
    for(const skin of skins){
      const w=skin.morphTargetInfluences;w[0]=clamp((flex-.10)/.56,0,1);
      w[1]=Math.max(0,-arc)*load;w[2]=Math.max(0,arc)*load;
    }
  }
  function socket(out,index) {
    return out.sub(rest[index]).applyQuaternion(joints[index].quaternion).add(joints[index].position);
  }
  function restPose() {
    joints.forEach((joint,i)=>{joint.position.copy(rest[i]);joint.quaternion.identity();});
    for(const skin of skins)skin.morphTargetInfluences.fill(0);
  }
  return {pose,socket,restPose};
}

function fitSeat(part,width) {
  const rest=[v3(),v3(-width,-.007,.006),v3(width,-.007,.006)];
  const bones=garmentSkeleton(part,['Trouser waistband','Left seat seam','Right seat seam'],rest,(x,y,z,i,index,weight)=>{
    const smooth=THREE.MathUtils.smoothstep;
    const follow=(1-smooth(y,-.122,-.015))*(.42+.42*smooth(Math.abs(x),.020,.123));
    const right=smooth(x,-.052,.052);
    index[i+1]=1;index[i+2]=2;weight[i]=1-follow;weight[i+1]=follow*(1-right);weight[i+2]=follow*right;
  });
  const inverse=new THREE.Quaternion();
  return limbs=>{
    inverse.copy(part.quaternion).invert();
    for(let i=0;i<limbs.length;i++){
      const bone=bones[i+1],thigh=limbs[i].thigh;
      bone.position.subVectors(thigh.position,part.position).applyQuaternion(inverse);
      bone.quaternion.multiplyQuaternions(inverse,thigh.quaternion);
    }
  };
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

function buildHead(batch, m, p, female, junior) {
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
  const outer = colorOf(junior ? (female ? '#77586b' : '#285974') : (female ? '#697778' : '#383e40'));
  const matte = colorOf(junior ? (female ? '#f2d5b2' : '#5492a4') : (female ? '#bbc7bf' : '#474d4d'));
  const helmetShape = pt => {
    const f = (-Math.sin(pt.a) + 1) / 2;
    pt.y += (1 - pt.t) ** 1.7 * (f * .043 - (1 - f) * .017);
    pt.z -= f * Math.max(0, 1 - pt.t * 3.5) * .012;
    const sidePanel = Math.abs(Math.cos(pt.a)) > .70 && pt.t < .61;
    pt.color = sidePanel ? outer : matte;
    if(junior && !female && Math.abs(pt.x)<.025 && pt.y>.185)pt.color=p.silver;
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
  if (junior) {
    // Rear reflectors on the size-adjustable shell are visible to a following parent.
    for (const s of [-1,1]) {
      cord(batch,m.hard,'#e5ebd2',[[s*.043,.212,.127],[s*.051,.226,.117],
        [s*.057,.235,.109]],.0032);
    }
  }
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
  if (female && junior) {
    for (const s of [-1,1]) {
      for (let i=0;i<5;i++) {
        const d=i*.013;
        ellipsoid(batch,m.cloth,i%2 ? '#655040' : '#523e30',
          [s*(.068+d*.22)+.002*Math.sin(i*2.7),.093-d,.085+d*.33],
          [.0128-i*.0008,.015,.0125-i*.0007],[-.20,s*.13,s*(i%2 ? .39 : -.33)]);
      }
      ellipsoid(batch,m.cloth,p.stitch,[s*.083,.039,.101],[.010,.004,.010]);
    }
  } else if (female) {
    const hair = ['#493c32', '#56463a', '#443a33'];
    for (let i = 0; i < 5; i++) {
      ellipsoid(batch, m.cloth, hair[i % 3],
        [Math.sin(i * 2.4) * .005 + .017, .090 - i * .015, .101 + .003 * i],
        [.0195 - .0018 * i, .019, .0168 - .0015 * i], [.18, -.2, Math.sin(i) * .24]);
    }
    block(batch, m.cloth, p.guard, [.018, .030, .110], [.023, .008, .019]);
  }
}

function buildBoot(batch, m, p, side, snowboard, junior) {
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
    : junior ? [[.108,-.072],[.171,-.024]] : [[.097,-.090],[.121,-.055],[.159,-.022],[.197,-.025]];
  if (junior && !snowboard) band(batch,m.cloth,p.yoke,.219,.061,.068,.034,.023);
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

function makeDeck(batch, m, p, board, side, junior) {
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
  const base = junior ? wash(p.coat,'#38575d',.70) : colorOf(board ? '#384d59' : '#3c535c');
  const paper = junior ? colorOf('#dce8d4') : colorOf(board ? '#d5c7a0' : '#d9cba9');
  const printed = wash(p.coat, '#d3a46e', .34);
  function panel(u, z) {
    const q = u * 2 - 1;
    const sign = board ? 1 : side;
    const cut = z + q * sign * (board ? .115 : .075);
    if (cut < -.67) return printed;
    if (cut < -.60) return paper;
    if (cut < -.49) return base;
    if (cut < -.454 || (cut > .488 && cut < .511)) return printed;
    if (junior && ((cut>-.415 && cut<-.384) || (cut>-.359 && cut<-.344))) return paper;
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
  return profile;
}

// The toe piece and sole stay on the deck. Only the shell above the ankle
// hinge and its buckles follow the shin. Sin/cos weights describe the arc.
function bootCuff(foot) {
  const pivotY = .125, pivotZ = .032;
  const meshes = foot.children.filter(part => part.isMesh);
  for (const mesh of meshes) {
    const geo = mesh.geometry, positions = geo.attributes.position;
    const targets = Array.from({length: 4}, () => new Float32Array(positions.count * 3));
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i), weight = THREE.MathUtils.smoothstep(y, pivotY, .180);
      if (!weight) continue;
      const dx = positions.getX(i) * weight, dy = (y - pivotY) * weight;
      const dz = (positions.getZ(i) - pivotZ) * weight, k = i * 3;
      targets[0][k+1] = dz;  targets[0][k+2] = -dy;
      targets[1][k+1] = -dy; targets[1][k+2] = -dz;
      targets[2][k] = dy;    targets[2][k+1] = -dx;
      targets[3][k] = -dx;   targets[3][k+1] = -dy;
    }
    geo.morphTargetsRelative = true;
    geo.morphAttributes.position = targets.map(values => new THREE.BufferAttribute(values, 3));
    mesh.updateMorphTargets();
  }
  return (pitch, cant, anchor) => {
    const s = Math.sin(pitch), c = 1 - Math.cos(pitch);
    const l = Math.sin(cant), r = 1 - Math.cos(cant);
    for (const mesh of meshes) {
      const w = mesh.morphTargetInfluences;
      w[0] = s; w[1] = c; w[2] = l; w[3] = r;
    }
    const dy = .196 - pivotY, dz = .030 - pivotZ;
    anchor.set(l * dy, .196 + s*dz - (c+r)*dy, .030 - s*dy - c*dz);
  };
}

function springLegs(suspension, goal, frequency, dt, reset) {
  if (reset || !suspension.ready) {
    suspension.height = goal;
    suspension.velocity = 0;
    suspension.ready = true;
  } else {
    const difference = suspension.height - goal;
    const impulse = suspension.velocity + frequency * difference;
    const decay = Math.exp(-frequency * dt);
    suspension.height = goal + (difference + impulse * dt) * decay;
    suspension.velocity = (suspension.velocity - frequency * impulse * dt) * decay;
  }
  return suspension.height;
}

function readPiste(snow, state, speed, active) {
  snow.available = active && state.data?.height && Number.isFinite(state.x) && Number.isFinite(state.z);
  snow.normalLoad = 0;
  if (!snow.available) return;
  snow.map = state.data;
  snow.x = state.x; snow.z = state.z;
  const dir = state.heading ?? 0;
  snow.sin = Math.sin(dir); snow.cos = Math.cos(dir);
  const height = (dx, dz) => snow.map.height(snow.x + dx, snow.z + dz);
  snow.ground = height(0, 0);
  snow.across = (height(2*snow.cos, 2*snow.sin) - height(-2*snow.cos, -2*snow.sin)) * .25;
  snow.back = (height(-2*snow.sin, 2*snow.cos) - height(2*snow.sin, -2*snow.cos)) * .25;
  snow.vertical = 1 / Math.hypot(1, snow.across, snow.back);

  // At a hollow the slope under the skis is flattening and the legs absorb
  // excess load. A convex roll releases the load before the torso pitches over.
  const travel = state.travelHeading ?? dir, sample = clamp(2.8 + speed*.41, 2.8, 12);
  const dx = Math.sin(travel)*sample, dz = -Math.cos(travel)*sample;
  const approach = Math.atan2(height(-dx,-dz)-snow.ground, sample);
  const departure = Math.atan2(snow.ground-height(dx,dz), sample);
  snow.normalLoad = clamp((approach-departure)*speed*speed/(9.81*sample), -.82, 1.28);
}

// Remove the common DEM tangent already applied by world.js. Only residual
// relief under this edge changes its height and pitch relative to the rider.
function snowUnder(snow, x, z) {
  if (!snow.available) return 0;
  x *= snow.scale; z *= snow.scale;
  const y = snow.map.height(snow.x+snow.cos*x-snow.sin*z, snow.z+snow.sin*x+snow.cos*z);
  return clamp((y-snow.ground-snow.across*x-snow.back*z)*snow.vertical/snow.scale, -.08, .08);
}

function flexibleDeck(node, board, widthRatio = 1, stanceRatio = 1, lengthRatio = 1) {
  const skins = node.children.filter(m => m.isMesh);
  const bindingZ = .275 * stanceRatio / lengthRatio;
  for (const skin of skins) {
    const geometry = skin.geometry, a = geometry.attributes.position;
    const nose = new Float32Array(a.count*3), tail = new Float32Array(a.count*3);
    const twist = board ? new Float32Array(a.count*3) : null;
    for (let i = 0; i < a.count; i++) {
      const z = a.getZ(i);
      if (twist) twist[i*3+1] = a.getX(i)*widthRatio * (1 - 2*THREE.MathUtils.smoothstep(z,-bindingZ,bindingZ));
      const before = THREE.MathUtils.smoothstep(-z,.18,board ? .75:.90);
      const after = THREE.MathUtils.smoothstep(z,.18,.73);
      nose[i*3+1] = -.021*before + .008*after;
      tail[i*3+1] = -.016*after + .012*before;
    }
    geometry.morphTargetsRelative = true;
    geometry.morphAttributes.position = [
      new THREE.BufferAttribute(nose,3),new THREE.BufferAttribute(tail,3)
    ];
    if (twist) geometry.morphAttributes.position.push(new THREE.BufferAttribute(twist,3));
    skin.updateMorphTargets();
  }
  return (front,back,twist = 0) => {
    for (const skin of skins) {
      skin.morphTargetInfluences[0] = front;
      skin.morphTargetInfluences[1] = back;
      if (board) skin.morphTargetInfluences[2] = Math.sin(twist);
    }
  };
}

function skiPole(batch, m, p, side, l) {
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
  const board = options.gear === 'board', female = options.gender === 'female', girl=options.gender==='girl';
  const dimensions = getRiderDimensions(options), junior = dimensions.isChild, size = dimensions.scale;
  const deckLength = dimensions.lengthScale/size, deckWidth = dimensions.widthScale/size;
  const stance = dimensions.stanceScale/size, poleLength = dimensions.poleLength/size;
  const m = materials();
  const coat = colorOf(options.color ?? '#bd643c');
  const palette = {
    coat, yoke: wash(coat, '#deb78d', .24), underarm: wash(coat, '#353d3f', .38),
    lining: colorOf('#303a3e'), stitch: wash(coat, '#a49883', .42), dark: colorOf('#232b2d'),
    pants: colorOf('#323f47'), knee: colorOf('#344149'), seat: colorOf('#35424a'), guard: colorOf('#283237'),
    glove: colorOf('#394246'), pantSeam: colorOf('#424e54'), silver: colorOf('#aca995'),
    shaft: colorOf('#838f8c'), pole: wash(coat, '#a09e8d', .32)
  };
  if(junior){
    palette.pants=colorOf(girl?'#44625d':'#304d65');palette.seat=tone(palette.pants,.81);
    palette.knee=wash(palette.pants,girl?'#72877c':'#56768a',.50);
    palette.yoke=wash(coat,girl?'#ecceac':'#afcbc2',.42);
  }
  const group = new THREE.Group();
  group.name = board ? 'Snowboarder' : 'Alpine skier';
  // The public group and camera anchors are in terrain metres. This inner
  // uniform transform keeps joint solves, coupled ski boots and clothing in
  // one bind space, including when the world rotates or repositions a child.
  const rig = junior ? child(group,'Junior rig') : group;
  const pelvis = makePart(rig, 'Snow pants', b => pelvisShape(b, m, palette, female));
  const torso = makePart(rig, 'Shell jacket', b => jacket(b, m, palette, female || girl, junior));
  const spine = fitJacket(torso);
  const head = makePart(torso, 'Helmet and goggles', b => buildHead(b,m,palette,female || options.gender==='girl',junior));
  const neckY = junior ? .461 : .475;
  if (junior) head.scale.set(1.42,1.38,1.37);
  head.position.set(0, neckY, -.003);

  const cutThigh = junior ? .386 : female ? .412 : .432, cutShin = junior ? .351 : female ? .387 : .403;
  let leg1 = junior ? .345 : cutThigh, leg2 = junior ? .301 : cutShin;
  const arm1 = junior ? .251 : female ? .265 : .28, arm2 = junior ? .230 : female ? .244 : .254;
  const width = junior ? .169 : female ? .178 : .192, hipWidth = junior ? .094 : female ? .098 : .104;
  const seatPose = fitSeat(pelvis,hipWidth);
  const baseSections = junior ? new Map() : null;
  function plankModel(name,side) {
    let profile;
    const node=makePart(rig,name,b=>{profile=makeDeck(b,m,palette,board,side,junior);});
    // Only the board layers stretch. The separately sized boots and bindings
    // sit on its footbeds and keep their own shape.
    if (junior) {
      for (const mesh of node.children) mesh.scale.set(deckWidth,1,deckLength);
      const sections=profile.map(([z,width,top])=>{
        const nose=THREE.MathUtils.smoothstep(-z,.18,board ? .75 : .90);
        const tail=THREE.MathUtils.smoothstep(z,.18,.73),bindingZ=.275*stance/deckLength;
        return {z:z*deckLength,half:width*.5*deckWidth,base:top-(board ? .0105 : .013),
          frontFlex:-.021*nose+.008*tail,rearFlex:-.016*tail+.012*nose,
          twist:board ? 1-2*THREE.MathUtils.smoothstep(z,-bindingZ,bindingZ) : 0};
      });
      baseSections.set(node,sections);
    }
    return node;
  }
  const deck = board ? plankModel('Snowboard',0) : null;
  const limbs = [];
  for (const s of [-1, 1]) {
    const prefix = s < 0 ? 'Left ' : 'Right ';
    const plank = deck || plankModel(prefix + 'ski',s);
    let foot, binding;
    if (board) {
      binding = makePart(plank, prefix + 'binding', b => buildBinding(b,m,palette,s,true));
      binding.position.set(0,0,s*.275*stance); binding.rotation.y = s < 0 ? -1.22 : -1.66;
      foot = makePart(plank, prefix + 'boot', b => buildBoot(b,m,palette,s,true,junior));
      foot.position.copy(binding.position); foot.rotation.copy(binding.rotation);
    } else {
      foot = makePart(plank, prefix + 'boot and binding', b => {
        buildBoot(b,m,palette,s,false,junior); buildBinding(b,m,palette,s,false);
      });
    }
    const [thigh, shin] = tailoredLimb(rig, prefix + 'trouser leg', cutThigh, .132,
      b => legGarment(b, m, palette, s, cutThigh, cutShin));
    const [arm, forearm] = tailoredLimb(rig, prefix + 'jacket sleeve', arm1, .102,
      b => armGarment(b, m, palette, s, arm1, arm2));
    const hand = makePart(rig, prefix + 'glove', b => glove(b, m, palette, s));
    const pole = board ? null : makePart(rig, prefix + 'pole', b => skiPole(b, m, palette, s,poleLength));
    limbs.push({
      s, plank, foot, binding, thigh, shin, arm, forearm, hand, pole,
      bendCuff: bootCuff(foot), anklePitch: .17, ankleCant: 0, relief: 0, pitchRelief: 0,
      flex: !board ? flexibleDeck(plank, false) : null, plant: null, lastStroke: 0,
      hip: v3(), ankle: v3(), knee: v3(),
      shoulder: v3(), elbow: v3(), wrist: v3(), poleDirection: v3()
    });
  }
  const bend = v3(), tmp = v3(), contact = v3(), grip = v3(), leanQ = new THREE.Quaternion();
  const deckFlex = board ? flexibleDeck(deck,true,deckWidth,stance,deckLength) : null;
  const bootRotation = new THREE.Quaternion(), bootInverse = new THREE.Quaternion();
  const gaze = new THREE.Quaternion(), zAxis = v3(0,0,1), legInBoot = v3(), sole = v3();
  const aimEuler = new THREE.Euler(0,0,0,'YXZ');
  const suspension = {height: 0, velocity: 0, ready: false};
  const snow = {available: false, normalLoad: 0, scale:size};
  let previousMode, frontEdge = 0, rearEdge = 0, normalLoad = 0, supportedEdge = 0;
  let centreRelief = 0, centrePitch = 0, stridePhase = 0, lastElapsed;

  const posed = {edge:0, chest:0, speed:0, steer:0, grade:0, pressure:0, trim:0,
    skid:0, slip:0, air:0, t:0, turnSign:0, lastSwap:-2, ready:false};
  const leanAxis = v3(0,0,-1);
  const outsidePose = {arc:0, chest:0, entry:0, exit:0, pivot:0, ready:false, spring:{ready:false}};
  const hipOffset = v3(), jointOrigin = v3(), jointEnd = v3(), jointMid = v3(), jointPlane = v3();
  const oldTip = v3(), handOffset = v3(), wristGoal = v3(), support = v3();
  const gravityUp = new THREE.Quaternion(), groundCorrection = new THREE.Quaternion(), headAim=new THREE.Quaternion();
  let disposed = false, redraw = false, lastState;

  // Junior decks have a different sidecut, running length and stance. Seat
  // their flexed bases on the terrain, including when braking across a slope.
  const basePoint=v3();
  let groundMatrix=null, risePerUnit=size, snowSink=0;
  function groundJuniorDeck(plank,front,rear,twist,lift) {
    let closest=Infinity;
    const torsion=Math.sin(twist);
    for(const section of baseSections.get(plank)){
      const y=section.base+front*section.frontFlex+rear*section.rearFlex;
      for(let side=-1;side<=1;side+=2) {
        const x=side*section.half;
        basePoint.set(x,y+x*section.twist*torsion,section.z).applyQuaternion(plank.quaternion).add(plank.position);
        let gap;
        if (groundMatrix) {
          basePoint.applyMatrix4(groundMatrix);
          // The world has already lowered the rider by the compressed snow
          // depth. The contact target uses that same surface in world metres.
          const surface=snow.map.height(basePoint.x,basePoint.z)-snowSink;
          gap=(basePoint.y-surface)/risePerUnit;
        } else gap=basePoint.y-snowUnder(snow,basePoint.x,basePoint.z);
        closest=Math.min(closest,gap);
      }
    }
    plank.position.y+=.0015+lift-closest;
  }

  // Estimate the longitudinal mass centre in the equipment frame. A bent
  // thigh travels toward the shovel while the hips fold back, so neither a
  // helmet nor a pelvis by itself is a reliable balance point.
  const massJoint=v3(),massKnee=v3(),massBend=v3(),footbed=v3(),neckOffset=v3();
  const acrossAxis=v3(1,0,0);
  function balanceOverBoots(pace,force,arc,tuck,trim,push,standing) {
    const headMass=junior ? .113 : .0694, trunkMass=junior ? .445 : .4346;
    const thighMass=junior ? .124 : .1416, shinMass=junior ? .041 : .0433;
    const footMass=junior ? .014 : .0137, armMass=junior ? .0425 : .0494;
    const total=headMass+trunkMass+2*(thighMass+shinMass+footMass+armMass);
    const mid=pelvis.position;
    neckOffset.copy(head.position).applyQuaternion(torso.quaternion);
    massJoint.set(0,.167,0).multiply(head.scale).applyQuaternion(head.quaternion).add(head.position).applyQuaternion(torso.quaternion);
    let moment=headMass*(mid.z+massJoint.z)+trunkMass*(mid.z+.48*neckOffset.z);
    let heightMoment=headMass*(mid.y+massJoint.y)+trunkMass*(mid.y+.48*neckOffset.y);
    let shoeZ=0,footY=0;
    for(const limb of limbs){
      const {s,foot,plank,ankle}=limb;
      footbed.set(0,.045,-.01).applyQuaternion(foot.quaternion).add(foot.position)
        .applyQuaternion(plank.quaternion).add(plank.position);
      const carried=board ? .5-s*(.048*pace+.24*push+.047*trim) : .5-s*.25*Math.tanh(arc*1.5);
      shoeZ+=carried*footbed.z;footY+=carried*footbed.y;
      massJoint.set(s*hipWidth,-.007,.006).applyQuaternion(pelvis.quaternion).add(mid);
      massBend.subVectors(limb.knee,limb.hip);
      solveJoint(massJoint,ankle,massBend,leg1,leg2,massKnee);
      moment+=thighMass*mix(massJoint.z,massKnee.z,.433)+shinMass*mix(massKnee.z,ankle.z,.433)+footMass*footbed.z;
      heightMoment+=thighMass*mix(massJoint.y,massKnee.y,.433)+shinMass*mix(massKnee.y,ankle.y,.433)+footMass*(footbed.y+.045);
      spine.socket(massJoint.set(s*width,.396,.009),s<0 ? 4 : 5).applyQuaternion(torso.quaternion).add(mid);
      const armOffset=.33*(limb.elbow.z-limb.shoulder.z)+.28*(limb.wrist.z-limb.shoulder.z);
      moment+=armMass*(massJoint.z+armOffset);
      heightMoment+=armMass*(massJoint.y+.33*(limb.elbow.y-limb.shoulder.y)+.28*(limb.wrist.y-limb.shoulder.y));
    }
    const reachForward=.009+.050*pace+.010*tuck+.008*force+.009*trim;
    // At rest the skier balances against gravity on a slope. Once gliding,
    // longitudinal pressure is measured against the base of the travelling ski.
    const gravity=standing*(heightMoment/total-footY)*Math.tan(posed.grade);
    const correction=shoeZ-reachForward+gravity-moment/total;
    mid.z+=clamp(correction/.81,-.19,.20);
  }

  // A turn filmed from behind reads through the path of the boots underneath
  // the hips. The lower body establishes an edge before the shoulders follow.
  // Work from the base joints each frame; the goggles camera uses that base pose.
  function outsideMotion(state, dt, reset, drive, moving, steep, push, attack, release, impactSoon, baseLean, baseAngulation) {
    const smooth = THREE.MathUtils.smoothstep;
    const {edge, speed, trim, skid, air, slip} = posed;
    const fast = clamp(speed/21,0,1), flight = !!(state.airborne ?? air>.025);
    const boost = drive ? state.boost || 0 : 0, brake = drive ? state.brake || 0 : 0;
    const charge = drive ? state.charge || 0 : 0, land = drive ? Math.min(1.15,state.landing || 0) : 0;
    const launch = drive ? state.launch || 0 : 0;
    // Lateral acceleration divided by the normal component of gravity gives
    // the balance line through the ski/snow contact. Edge angle alone cannot
    // tell a traversing skier from one making a tight, loaded turn.
    const normalGravity = 9.81*Math.max(.69,Math.cos(posed.grade));
    const measured = state.curve ?? state.turn;
    const sideLoad = Number.isFinite(measured) ? measured*speed/normalGravity :
      edge*speed*speed/((board ? 13 : 17)+speed*.18)/normalGravity;
    const balance = clamp(sideLoad,-1.62,1.62) + .11*edge*(1-skid);
    const arcGoal = Math.atan(balance)*moving*(1-.89*air)*(1-.42*push);
    const snap = reset || !outsidePose.ready;
    const follow = rate => snap ? 1 : 1-Math.exp(-rate*dt);
    outsidePose.arc = mix(outsidePose.arc,arcGoal,follow(9.8));
    outsidePose.chest = mix(outsidePose.chest,outsidePose.arc,follow(7));
    outsidePose.entry = mix(outsidePose.entry,attack,follow(11));
    outsidePose.exit = mix(outsidePose.exit,release,follow(11));
    const pivotGoal=clamp((state.pivotRate || 0)/1.8,-1,1)*(1-smooth(speed,.16,1.6));
    outsidePose.pivot=mix(outsidePose.pivot,pivotGoal,follow(9));outsidePose.ready=true;
    const pivot=outsidePose.pivot;
    const arc = outsidePose.arc, torsoArc = outsidePose.chest, change = arc-torsoArc;
    const entryDelta = outsidePose.entry-attack, exitDelta = outsidePose.exit-release;
    const force = smooth(Math.abs(arc),.055,.93), carve = smooth(Math.abs(arc),.42,1.04)*(1-.58*skid);
    const coast = (1-smooth(force,.07,.70))*(1-.66*steep)*(1-push)*
      (1-clamp(Math.max(skid,brake,charge,boost*fast,land,air),0,1));
    const heel = board ? Math.max(0,-arc) : 0, toe = board ? Math.max(0,arc) : 0;
    const neutral = (board ? .084 : .045)*coast;
    const crossing = (1-Math.min(1,Math.abs(arc)*1.15))*Math.min(1,Math.abs(change)*3.0 + outsidePose.exit*.38)*moving;
    const external=visibility==='body', small=external&&junior, juniorSkier=small&&!board;
    const pace=external ? smooth(speed,3.1,24)*(1-.62*skid)*(1-.82*air) : 0;
    const tuck=Math.max(fast*boost*(1-.63*force),pace*(.83-.34*force)*(1-.50*brake));
    const carry=external ? smooth(speed,6.8,17)*(1-.72*air) : 0;
    const drop = (board ? .042+.043*heel : .042+.055*carve)*force + .030*skid + .043*tuck +
      .054*charge + .053*land + .022*air*(1-impactSoon) + .023*Math.max(0,normalLoad) + .022*Math.abs(pivot);
    const rise = neutral+.060*crossing+.052*launch+.027*impactSoon;
    const heightDelta = springLegs(outsidePose.spring,rise-drop,land>.14 ? 23 : 16,dt,snap);
    const juniorBend=small ? .069+(juniorSkier ? .048 : .036)*force+.025*land+.018*charge-(juniorSkier ? .053 : .029)*crossing : 0;
    pelvis.position.y = Math.max(board ? .423 : .436,pelvis.position.y+heightDelta-juniorBend-pace*(.068-.030*force));
    const slideX = .43+.57*Math.cos(slip), slideZ = -.57*Math.sin(slip);
    // Project a share of the inverted pendulum at the hip. The rest of the
    // body inclines above it. The outside ski also moves the support point.
    const lateral = clamp(Math.tan(arc)*pelvis.position.y*(board ? .54 : juniorSkier ? .71 : .66),
      board ? -.36 : -.46,board ? .36 : .46) * (1-.28*skid);
    const priorX = baseLean*(board ? .310 : .351)+baseAngulation;
    pelvis.position.x += (lateral-priorX)*slideX + pivot*(board ? .023 : .029);
    pelvis.position.z += (lateral-baseLean*.249)*slideZ;
    const anticipation = clamp(change*2.2,-1,1);
    const forward = board ? -.030*Math.abs(anticipation)+.033*heel+.029*skid :
      .042*force+.035*skid+.047*land+.035*charge-.024*crossing;
    pelvis.position.z += forward-trim*.025;
    if (board) pelvis.position.z += -.084*entryDelta+.053*exitDelta;

    // Hips hinge about the femoral heads. The rib cage faces farther down the
    // hill and inclines less. Give the steeper slope part of the forward pitch
    // rather than folding the back twice when the snow normal already tilts.
    const hipYaw=(board ? -1.34 : 0) + slip*(board ? .36 : .28) - arc*((board ? .098 : .057)+(small ? (board ? .057 : .020) : 0)) + pivot*.10;
    const upperYaw=(board ? -1.035-.10*coast : 0) + slip*(board ? .67 : .64) +
      torsoArc*((board ? .089 : .045)+(small ? (board ? .165 : .037) : 0)) + anticipation*(small ? (board ? .255 : .135) : .074) +
      push*Math.sin(stridePhase*TAU)*.082 - pivot*(small ? .32 : .20);
    const chestYaw=hipYaw+clamp(upperYaw-hipYaw,board ? -.60 : -.44,board ? .60 : .44);
    const gradeCredit=Math.max(0,posed.grade)*.090;
    const pelvicFlex=.063+.061*fast+.105*force+.184*tuck+.128*charge+.129*land+.027*trim+.076*pace;
    const chestFlex=.090+.122*fast+.152*force+.439*tuck+.213*charge+.235*land+
      (board ? .051*toe-.047*heel : .058*trim)-gradeCredit+.145*pace+(external ? .044*moving+.02*steep : 0);
    const cross=Math.sin(state.roll || 0)*moving;
    pelvis.rotation.set(-pelvicFlex,hipYaw,board ? (.064*trim+.042*outsidePose.entry-.039*outsidePose.exit) : 0,'YXZ');
    leanQ.setFromAxisAngle(leanAxis,arc*(board ? .48 : juniorSkier ? .64 : .51)+cross*.053);pelvis.quaternion.premultiply(leanQ);
    torso.rotation.set(-chestFlex,chestYaw,board ? -.066*trim : 0,'YXZ');
    leanQ.setFromAxisAngle(leanAxis,torsoArc*(board ? (small ? .51 : .46) : juniorSkier ? .67 : .34)-change*.045+cross*.067);
    torso.quaternion.premultiply(leanQ);
    if(board && external){
      // A snowboarder faces across the deck. Flexing in the anatomical
      // sagittal plane alone would put the chest over the toe edge.
      const towardsNose=.035*moving+.34*pace+.037*tuck;
      torso.quaternion.premultiply(leanQ.setFromAxisAngle(acrossAxis,-towardsNose));
      pelvis.quaternion.premultiply(leanQ.setFromAxisAngle(acrossAxis,-.23*towardsNose));
    }
    headAim.copy(gaze);
    const standing=(1-smooth(speed,.18,1.7))*(1-air);
    if(standing>.001){
      // Boots stand on the tilted snow plane, while the pelvis, shoulders and
      // gaze progressively align with gravity. Crossfall rotates as we pivot.
      support.set(Math.tan(clamp(state.roll||0,-.65,.65)),1,Math.tan(clamp(posed.grade,-.72,.72))).normalize();
      gravityUp.setFromUnitVectors(axisY,support);
      pelvis.quaternion.premultiply(groundCorrection.identity().slerp(gravityUp,.45*standing));
      torso.quaternion.premultiply(groundCorrection.identity().slerp(gravityUp,.83*standing));
      headAim.premultiply(groundCorrection.identity().slerp(gravityUp,.93*standing));
    }
    spine.pose(pelvis.quaternion,force,arc,push*Math.sin(stridePhase*TAU),tuck,chestFlex);
    spine.socket(head.position.set(0,neckY,-.003),3);
    // A cervical counterrotation preserves the view down the line while some
    // upper-chest motion still reaches the helmet at the end of the chain.
    leanQ.copy(torso.quaternion).slerp(headAim,board ? .76 : juniorSkier ? .53-.28*force : .65);
    if(pivot)leanQ.multiply(bootInverse.setFromAxisAngle(axisY,-pivot*.28));
    head.quaternion.copy(torso.quaternion).invert().multiply(leanQ);

    // Pull both decks up during flight with the original sole-to-binding
    // relationship. Release the tuck before touching back down.
    const draw = flight ? Math.min((state.airHeight ?? air)*.44,.088*air)*(1-impactSoon) : 0;
    if (draw>0) for (const plank of decks) plank.position.y += draw;
    const reach = leg1+leg2-.014;
    const tuckedReach=(leg1+leg2)*(external ? (junior ? (board ? .55 : .495) : .435) : .30);
    const targetHeight=pelvis.position.y;
    // At a standstill on a steep pitch the gravity projection and reachable
    // leg height depend on each other. Re-evaluate after the hips settle.
    const passes=external && standing>.25 ? 3 : 1;
    for(let pass=0;pass<passes;pass++) {
      if(external)balanceOverBoots(pace,force,arc,tuck,trim,push,standing);
      let lowest=0,highest=2;
      for(const {s,ankle} of limbs) {
        hipOffset.set(s*hipWidth,-.007,.006).applyQuaternion(pelvis.quaternion);
        hipOffset.y+=board ? s*(.014*trim+.016*Math.abs(anticipation)) :
          (juniorSkier ? .029 : .017)*Math.max(0,-s*arc)-(juniorSkier ? .041 : .021)*Math.max(0,s*arc);
        const dx=pelvis.position.x+hipOffset.x-ankle.x,dz=pelvis.position.z+hipOffset.z-ankle.z;
        const horizontal=dx*dx+dz*dz,ankleY=ankle.y+draw-hipOffset.y;
        highest=Math.min(highest,ankleY+Math.sqrt(Math.max(.024,reach*reach-horizontal)));
        lowest=Math.max(lowest,ankleY+Math.sqrt(Math.max(0,tuckedReach*tuckedReach-horizontal)));
      }
      pelvis.position.y=clamp(targetHeight,lowest,Math.max(lowest,highest));
    }
    torso.position.copy(pelvis.position);

    for (const limb of limbs) {
      const {s,plank,foot,hip,knee,ankle,shoulder,elbow,wrist} = limb;
      const inside = Math.max(0,s*arc), outside = Math.max(0,-s*arc), lead = s<0;
      const yaw = board ? (lead ? -1.22 : -1.66)-edge*.024 + (lead ? 0 : Math.max(0,foot.rotation.y+1.66)) :
        junior ? plank.rotation.y+slip*.10 : -edge*.024+slip*.10+s*brake*(1-skid)*.12;
      jointOrigin.set(s*hipWidth,-.007,.006).applyQuaternion(pelvis.quaternion).add(pelvis.position);
      if (board) jointOrigin.y -= (lead ? 1 : -1)*(.014*trim+.016*Math.abs(anticipation));
      else jointOrigin.y += (juniorSkier ? .029 : .017)*outside-(juniorSkier ? .041 : .021)*inside;
      // Preserve the original anatomical bend plane, then guide each knee
      // independently: the long outside leg supports the body; the inside
      // thigh pulls up. On one board the leading knee opens into the new arc.
      jointPlane.subVectors(knee,hip);
      support.subVectors(ankle,hip).normalize();
      jointPlane.addScaledVector(support,-support.dot(jointPlane)).normalize();
      if (board) {
        jointPlane.x += arc*(lead ? .24 : .115) + .068*(lead ? entryDelta : -exitDelta);
        jointPlane.z += (lead ? -.17 : .14)*force - (lead ? .22 : -.11)*Math.abs(anticipation) +
          (lead ? -.20*entryDelta : .13*exitDelta);
      } else {
        jointPlane.x += arc*(.21+(juniorSkier ? .32 : .24)*inside);
        jointPlane.z -= inside*(juniorSkier ? .34 : .25);
      }
      bootRotation.multiplyQuaternions(plank.quaternion,foot.quaternion);bootInverse.copy(bootRotation).invert();
      jointEnd.copy(ankle);jointEnd.y+=draw;
      solveJoint(jointOrigin,jointEnd,jointPlane,leg1,leg2,jointMid);
      legInBoot.subVectors(jointMid,jointEnd).applyQuaternion(bootInverse);
      const pitch = clamp(limb.anklePitch*.55 + Math.atan2(-legInBoot.z,legInBoot.y)*(board ? .34 : .27),
        board ? -.15 : -.065,board ? .63 : .51);
      const cant = clamp(limb.ankleCant*.50 + Math.atan2(legInBoot.x,legInBoot.y)*.50,
        board ? -.34 : -.118,board ? .34 : .118);
      limb.bendCuff(pitch,cant,jointEnd);
      jointEnd.applyQuaternion(foot.quaternion).add(foot.position).applyQuaternion(plank.quaternion).add(plank.position);
      solveJoint(jointOrigin,jointEnd,jointPlane,leg1,leg2,jointMid);
      aimBone(limb.thigh,jointOrigin,jointMid,cutThigh,yaw);aimBone(limb.shin,jointMid,jointEnd,cutShin,yaw);

      spine.socket(jointOrigin.set(s*width,.396,.009),s<0 ? 4 : 5).applyQuaternion(torso.quaternion).add(torso.position);
      wristGoal.subVectors(wrist,shoulder).add(jointOrigin);
      if (board) {
        handOffset.set(s*(.112*force+.081*crossing-.109*coast),
          -.132*coast+.066*crossing+(lead ? .033 : -.023)*anticipation-s*arc*.078+(lead ? .041 : -.024)*entryDelta,
          .085*coast+(lead ? -.13 : .085)*Math.abs(anticipation)+s*(.096*entryDelta-.055*exitDelta));
      } else {
        handOffset.set(s*(.053*force+.050*crossing+.043*land-.060*tuck-.033*coast),
          -(.045+.176*carve)*inside+.029*outside+.027*crossing+.042*tuck-.056*coast,
          -.074*outside+.034*inside-.046*tuck+.032*coast+.020*land);
      }
      if(small && board){
        const stroke=Math.sin(stridePhase*TAU);
        handOffset.x+=s*(.099*force+.082*crossing+.046*brake+.040*push)+.050*arc;
        handOffset.y+=.056*crossing+.046*land-s*arc*.164+s*push*stroke*.062;
        handOffset.z+=s*(.146*anticipation+.208*arc+.061*push*stroke);
      }
      handOffset.z+=s*pivot*.070;
      handOffset.applyAxisAngle(axisY,chestYaw);wristGoal.add(handOffset);
      if(small && board){
        const brace=Math.max(force,.75*crossing);
        handOffset.set(s*(.075+.18*brace),-.22-s*arc*.30+.065*land,
          -.12+s*.32*arc+(lead ? -.12 : .12)*anticipation).applyAxisAngle(axisY,chestYaw).add(jointOrigin);
        wristGoal.lerp(handOffset,.93*brace);
      }
      const restingHands=(1-smooth(Math.abs(arc),.23,.80))*(1-tuck)*(1-push)*(1-air)*
        (1-clamp(Math.max(brake,land,charge),0,1))*(1-.50*steep);
      const relaxedDrop = junior ? (board ? -.376 : -.405) : (board ? -.436 : -.467);
      const elbowRoom = junior ? (board ? .130 : .092) : (board ? .079 : .044);
      handOffset.set(s*elbowRoom,relaxedDrop,board ? -.068 : -.095)
        .applyAxisAngle(axisY,chestYaw).add(jointOrigin);
      wristGoal.lerp(handOffset,restingHands*.89);
      if(!board && tuck>.001){
        handOffset.set(-s*.062,-.114,-.320).applyAxisAngle(axisY,chestYaw).add(jointOrigin);
        wristGoal.lerp(handOffset,tuck*.95*(small ? 1-.76*force : 1));
      }
      if(juniorSkier){
        // The hands travel with the ribs. The inside mitten lowers toward
        // its hip and the outside elbow stays bent through the loaded phase.
        // Let both return beside the waist as the feet pass under the body.
        handOffset.set(s*(.051+.021*force)+.023*arc,
          -.377+.061*pace-.071*inside+.052*outside+.023*crossing,
          -.064-.108*pace+s*.034*arc-.029*crossing).applyAxisAngle(axisY,chestYaw).add(jointOrigin);
        const steadyGrip=.96*(1-push)*(1-.72*air)*(1-.25*charge);
        wristGoal.lerp(handOffset,steadyGrip);
      }
      if (limb.pole) {
        oldTip.copy(limb.poleDirection).multiplyScalar(poleLength*limb.pole.scale.y).add(limb.pole.position);
        if (limb.plant) {
          contact.copy(limb.plant.point);rig.worldToLocal(contact);
          handOffset.set(-s*.008,-.065,-.013).applyQuaternion(limb.hand.quaternion);
          support.copy(wristGoal).add(handOffset).sub(contact).setLength(poleLength).add(contact).sub(handOffset);
          if (support.distanceTo(jointOrigin)<arm1+arm2+.012) wristGoal.copy(support);
        }
      }
      wristGoal.sub(jointOrigin).clampLength(.14,arm1+arm2-.002).add(jointOrigin);
      jointPlane.subVectors(elbow,shoulder);
      support.subVectors(wrist,shoulder).normalize();
      jointPlane.addScaledVector(support,-support.dot(jointPlane)).normalize();
      if(restingHands>.001){
        support.set(s*.26,-.10,.95).applyAxisAngle(axisY,chestYaw);
        jointPlane.lerp(support,restingHands*.77).normalize();
      }
      if(!board && tuck>.001){
        support.set(s*.36,-.9,.53).applyAxisAngle(axisY,chestYaw);
        jointPlane.lerp(support,tuck*.94).normalize();
      }
      solveJoint(jointOrigin,wristGoal,jointPlane,arm1,arm2,jointMid);
      aimBone(limb.arm,jointOrigin,jointMid,arm1,chestYaw);aimBone(limb.forearm,jointMid,wristGoal,arm2,chestYaw);
      limb.hand.position.copy(wristGoal);
      if (limb.pole) {
        const pole = limb.pole;
        if(juniorSkier && !limb.plant && push<.15)
          limb.hand.rotation.set(.12+.17*pace+.034*outside,chestYaw-s*.11,s*.096-arc*.10,'YXZ');
        pole.position.set(-s*.008,-.065,-.013).applyQuaternion(limb.hand.quaternion).add(wristGoal);
        if (limb.plant) {
          support.subVectors(contact,pole.position);
          pole.scale.y=clamp(support.length()/poleLength,.97,1.03);support.normalize();
        } else {
          const snowY=snowUnder(snow,oldTip.x,oldTip.z);
          const freeTipY=mix(oldTip.y,snowY+.02,inside*(1-air));
          const carryHeight=juniorSkier ? Math.max(.070+.073*pace,.130+.217*pace+.193*outside-.170*inside) :
            .29+.125*pace+.025*steep;
          const targetY=mix(freeTipY,snowY+carryHeight,carry);
          const drop=clamp(pole.position.y-targetY,.15,poleLength-.016);
          const across=juniorSkier ? mix(limb.poleDirection.x,s*(.24+.066*pace+.19*outside)+.028*arc,carry) :
            limb.poleDirection.x+s*(.14*force+.10*crossing);
          support.set(across,0,mix(limb.poleDirection.z,1,carry));
          support.setLength(Math.sqrt(poleLength**2-drop**2));support.y=-drop;support.normalize();pole.scale.y=1;
        }
        pole.quaternion.setFromUnitVectors(axisDown,support);
      }
    }
  }

  function update(state = {}, frameDt, clock) {
    if (disposed) return;
    const dt = clamp(frameDt ?? state.dt ?? 1/60, 0, .1);
    const time = clock ?? state.time ?? (posed.t + dt);
    const rewound = time < posed.t - .05 || state.elapsed < lastElapsed - .05;
    const sameInstant = Math.abs(time - posed.t) < .00001;
    posed.t = time;
    const drive = state.mode ? state.mode === 'run' : true;
    const targetEdge = drive ? (state.edge ?? state.steer ?? 0) : 0;
    const speed = drive ? Math.max(0,state.speed || 0) : 0;
    const modeChanged = previousMode !== state.mode;
    const snapPose = rewound || modeChanged || !posed.ready || (!dt && !sameInstant);
    if (!dt && !snapPose && !redraw) return;
    lastState=state;redraw=false;
    head.position.set(0,neckY,-.003);
    previousMode = state.mode; lastElapsed = state.elapsed; posed.ready = true;
    const ease = rate => snapPose ? 1 : 1-Math.exp(-dt*rate);
    posed.edge = mix(posed.edge,targetEdge,ease(15));
    posed.speed = mix(posed.speed,speed,ease(12));
    const moving = THREE.MathUtils.smoothstep(posed.speed,.20,4);
    const fast = clamp(posed.speed/21,0,1), edge = posed.edge;
    const incomingAir = drive ? clamp(state.air ?? (state.airHeight || 0),0,1) : 0;
    const inFlight = drive && (state.airborne ?? (incomingAir>.025));
    const charge = drive ? (state.charge || 0) : 0, launch = drive ? (state.launch || 0) : 0;
    const land = drive ? clamp(state.landing || 0,0,1.22) : 0;
    const brake = drive ? (state.brake || 0) : 0, boost = drive ? (state.boost || 0) : 0;
    posed.steer = mix(posed.steer,drive ? (state.steer || 0) : 0,ease(15));
    posed.trim = mix(posed.trim,drive ? (state.trim || 0) : 0,ease(16));
    posed.skid = mix(posed.skid,drive ? (state.skid ?? brake*.73) : 0,ease(14));
    posed.slip = mix(posed.slip,drive ? (state.slipAngle || 0) : 0,ease(13));
    posed.air = mix(posed.air,incomingAir,ease(inFlight ? 21 : 30));
    posed.pressure = mix(posed.pressure,drive ? clamp(state.pressure ?? Math.abs(edge)*moving,0,1.25) : 0,ease(14));
    const {steer:turn, trim, skid, slip, air, pressure} = posed;
    const cutSide = state.cutSide || Math.sign(edge || turn) || 1;
    const swap = drive ? state.bankSwap || 0 : 0;
    readPiste(snow,state,speed,(drive || junior) && !inFlight);
    groundMatrix=null;
    if (junior && snow.available) {
      snowSink=state.snowSink || 0;
      rig.updateWorldMatrix(true,false);
      const m=rig.matrixWorld.elements;
      // Also allow standalone pose previews, whose model origin can differ
      // from the location sampled by the simulation.
      if (Math.hypot(m[12]-snow.x,m[14]-snow.z)<.20 && Math.abs(m[13]-(snow.ground-snowSink))<.40) {
        groundMatrix=rig.matrixWorld;
        const gx=snow.across*snow.cos-snow.back*snow.sin, gz=snow.across*snow.sin+snow.back*snow.cos;
        risePerUnit=Math.max(size*.5,m[5]-gx*m[4]-gz*m[6]);
      }
    }
    normalLoad = mix(normalLoad,snow.normalLoad,ease(10.5));
    posed.grade = mix(posed.grade,clamp((state.slope || 0)*Math.PI/180,-.77,1.08),ease(9.7));
    const grade = posed.grade;
    const steep = THREE.MathUtils.smoothstep(grade,.055,.63) * moving;
    const terrain = drive ? state.terrainFlex || 0 : 0;
    const lip = Math.max(0,-normalLoad), hollow = Math.max(0,normalLoad);
    // The front foot establishes the edge first. A phase lag along the
    // snowboard produces torsional flex without rotating either sole off it.
    frontEdge = mix(frontEdge,targetEdge,ease(17));
    rearEdge = mix(rearEdge,targetEdge,ease(5.5));
    const twist = board ? clamp((rearEdge-frontEdge)*.13,-.081,.081)*(1-air) : 0;
    const entry = THREE.MathUtils.smoothstep(Math.abs(state.edgeRate || 0),.18,2.3) * moving;
    const edgeGrowth = Math.sign(edge) * (state.edgeRate || 0);
    const attack = THREE.MathUtils.smoothstep(edgeGrowth,.09,2.35) * moving;
    const release = THREE.MathUtils.smoothstep(-edgeGrowth,.07,2.15) * moving;
    supportedEdge = mix(supportedEdge,edge,ease(7.5));
    const riderPush = drive ? clamp(state.push ?? boost*(1-fast),0,1) : 0;
    // The route guide also supplies a skating push on slow, nearly level
    // traverses. Give that impulse a recover/plant stroke with its own cadence.
    const traverse = drive && state.opts?.assist && !inFlight ?
      .74 * THREE.MathUtils.smoothstep(speed,.32,1.35) * (1-THREE.MathUtils.smoothstep(speed,2.8,3.7)) *
      (1-THREE.MathUtils.smoothstep(grade,.015,.093)) * (1-brake)*(1-skid) : 0;
    const push = Math.max(traverse,riderPush);
    if (snapPose) stridePhase = state.stride ?? 0;
    else if (push>.01) {
      stridePhase += dt*(.71+speed*.047);
      if (riderPush>.10 && Number.isFinite(state.stride)) {
        const delta = (state.stride-stridePhase) * TAU;
        stridePhase += Math.atan2(Math.sin(delta),Math.cos(delta))/TAU * ease(4.8);
      }
      stridePhase -= Math.floor(stridePhase);
    }
    const stride = stridePhase;
    const wave = Math.sin(stride*TAU), kick = THREE.MathUtils.smoothstep(stride,.045,.265) *
      (1-THREE.MathUtils.smoothstep(stride,.76,.987));
    const edgeSign = Math.abs(edge)>.12 ? Math.sign(edge) : 0;
    if (edgeSign && edgeSign!==posed.turnSign) {
      if (posed.turnSign && moving>.6 && time-posed.lastSwap>.30) posed.lastSwap=time;
      posed.turnSign=edgeSign;
    }
    if (!drive || rewound) {posed.lastSwap=-2;posed.turnSign=0;}
    const transferPlant = Math.max(0,1-(time-posed.lastSwap)/.23);
    const depth = .100*fast + .047*steep + .096*steep*fast +
      (.060*pressure+.048*skid)*(1-.72*air);
    const springLoad = hollow*.112 - lip*.055 + terrain*.046;
    const closingSpeed = Math.max(0,(state.verticalAlong || 0) - (state.upSpeed || 0));
    const impactSoon = inFlight && closingSpeed > .5
      ? 1 - THREE.MathUtils.smoothstep((state.airHeight || 0)/closingSpeed,.045,.23) : 0;
    const action = .173*charge + .177*land + .068*air*(1-impactSoon) + .036*boost;
    const extension = .051*release + .034*swap*pressure + .038*impactSoon;
    const compression = clamp(depth + springLoad + action - extension, -.325, .385) * (junior ? .86 : 1);
    const idle = .0038*Math.sin(time*1.75+.48);
    const rhythm = push * (.017 * Math.sin(2*TAU*stride-.8) - .018*Math.max(0,Math.sin(TAU*stride)));
    const restHeight = (junior ? .844 : female ? .898 : .939) - (board ? .055 : 0);
    const targetHeight = restHeight - compression + launch*.093 + rhythm + idle;
    const floorHeight = (board ? .475 : .493) + air * .063;
    const height = springLegs(suspension,clamp(targetHeight,floorHeight,restHeight+.058),
      land>.08 || launch>.26 ? 29 : 18,dt,snapPose);
    const lean = (edge*(.13+.71*moving)*(.60+pressure*.24) + cutSide*skid*.060) * (1-.45*air);
    const intoX = .43+.57*Math.cos(slip), intoZ = -.57*Math.sin(slip);
    const crossSlope = Math.sin(state.roll||0)*moving;
    const angulation = supportedEdge * pressure * (board ? .027 : .046);
    const hipX = (board ? -.015 : 0) + (lean*(board ? .310 : .351)+angulation)*intoX +
      wave*push*(board ? .079 : .061)+crossSlope*.074;
    const fore = trim*(board ? .174:.145);
    const footBalance = board ? -.084*attack + .053*release + .055*skid + wave*push*.051 : -.025*attack;
    const hipZ = (board ? -.020 : .050) + (board ? -.021 : .054)*fast - fore +
      lean*intoZ*.249 + footBalance + .046*charge + .057*land + .029*hollow;
    const gearYaw = -edge*.024;
    const pelvisYaw = (board?-1.33:0)+gearYaw+slip*(board ? .25:.28) - edge*(board ? .213 : .103)+(board ? (frontEdge-rearEdge)*.13 : 0);
    const chestTarget = (board?-.94:0) + slip*(board ? .73:.69) + edge*(board ? .25:.14)
      + (board ? wave*push*.12 : wave*push*.091);
    posed.chest = mix(posed.chest,chestTarget,ease(6.3));
    const chestYaw = posed.chest;
    const tuck = boost*(.28+.72*fast);
    const bodyPitch = -.11-.205*fast-.108*steep-.120*fast*steep-.178*tuck-.125*charge-
      .072*land-.054*pressure+.030*hollow;
    const hipTwist = board ? trim*.106 + attack*.087 - release*.073 : 0;
    leanAxis.set(intoZ,0,-intoX).normalize();
    pelvis.position.set(hipX,height,hipZ);
    pelvis.rotation.set(-.068-.09*fast-.054*steep-.050*trim,pelvisYaw,hipTwist+.020*push*wave,'YXZ');
    leanQ.setFromAxisAngle(leanAxis,lean*(board ? .295:.335)+crossSlope*.062);pelvis.quaternion.premultiply(leanQ);
    torso.position.copy(pelvis.position);
    torso.rotation.set(bodyPitch-(board?0:trim*.145),chestYaw,(board?-trim*.11:0)+.012*Math.sin(time*1.82),'YXZ');
    leanQ.setFromAxisAngle(leanAxis,lean*(board ? .65:.61)+crossSlope*.135);torso.quaternion.premultiply(leanQ);
    // Neck counter-rotation keeps the sight line down the run while the
    // hips and shoulders work underneath it during edge changes.
    aimEuler.set(-.045-.060*fast+.21*grade+.047*air,
      (board ? -.18 : 0)+slip*.81-turn*.13+(board ? .035*trim : 0),
      -.15*lean-.21*crossSlope,'YXZ');
    gaze.setFromEuler(aimEuler);
    head.quaternion.copy(torso.quaternion).invert().multiply(gaze);

    const press = drive ? (state.press ?? Math.sign(trim)*THREE.MathUtils.smoothstep(Math.abs(trim),.57,.98)) : 0;
    const pressPitch = -press*(board ? .150 : .064);
    const contactLift = Math.abs(Math.sin(pressPitch))*(board ? .62 : .65)*deckLength;
    const boardPitch = air*(-.13 + (state.upSpeed<0 ? .19:0)) - trim*.010 + pressPitch + launch*.083;
    const boardLift = inFlight ? air*(.112-.071*impactSoon) : 0;
    const noseLoad=clamp(Math.max(0,trim)*.88+pressure*.24+land*.18,0,1);
    const tailLoad=clamp(Math.max(0,-trim)*.85+charge*.28,0,1);
    if (deck) {
      const roll = -(edge*(.28+.65*moving) + cutSide*skid*.08)*(1-.69*air);
      const foreSnow = snowUnder(snow,0,-.58*deckLength), aftSnow = snowUnder(snow,0,.58*deckLength);
      centreRelief = mix(centreRelief, (foreSnow+aftSnow)*.5,ease(18));
      centrePitch = mix(centrePitch,Math.atan2(foreSnow-aftSnow,1.16*deckLength),ease(18));
      deck.rotation.set(boardPitch+centrePitch,gearYaw,roll,'YXZ');
      deck.position.set(0,.002+Math.abs(Math.sin(roll))*.116*deckWidth+boardLift+contactLift+centreRelief,0);
      deckFlex(noseLoad,tailLoad,twist);
      if (junior && !inFlight) groundJuniorDeck(deck,noseLoad,tailLoad,twist,0);
    }

    for (const limb of limbs) {
      const {s,plank,foot,hip,knee,ankle,shoulder,elbow,wrist}=limb;
      const inside = s*edge, outside = Math.max(0,-inside), insideLoad = Math.max(0,inside);
      const phase = (stride+(s<0 ? .5:0))%1;
      const stroke = Math.sin(phase*TAU), poling = push*stroke;
      const recovered = phase>.53 ? Math.sin((phase-.53)/.47*Math.PI) : 0;
      const timing = board ? (s<0 ? frontEdge : rearEdge) : supportedEdge;
      if (board) {
        const turnInBoot = s<0 ? -1.22 : -1.66;
        const torsionHere = -s*twist;
        limb.binding.rotation.set(0,turnInBoot,0);
        leanQ.setFromAxisAngle(zAxis,torsionHere);
        limb.binding.quaternion.premultiply(leanQ);
        foot.quaternion.copy(limb.binding.quaternion);
        if (s>0) {
          const reach = kick*push;
          const recover = stride>.60 ? Math.sin((stride-.60)/.4*Math.PI) : 0;
          const strideLength=junior && visibility==='body' ? .46 : 1;
          foot.position.set(reach*(.243+.048*Math.sin(stride*Math.PI)),
            reach*recover*.136 + push*kick*(1-kick)*.30,
            .275*stance+reach*strideLength*(-.260+.685*THREE.MathUtils.smoothstep(stride,.14,.72)));
          foot.rotation.set(-reach*.24*recover,turnInBoot+reach*.91,0,'YXZ');
          leanQ.setFromAxisAngle(zAxis,torsionHere*(1-reach));foot.quaternion.premultiply(leanQ);
          if (reach>.01) {
            // Clear the highback on release, then place the loose boot on the
            // snow beside the board, including when the deck is on an edge.
            let clearance = Infinity;
            for (const end of [-.147,.125]) {
              sole.set(0,.044,end).applyQuaternion(foot.quaternion).add(foot.position)
                .applyQuaternion(plank.quaternion).add(plank.position);
              clearance = Math.min(clearance,sole.y-snowUnder(snow,sole.x,sole.z));
            }
            const loose = THREE.MathUtils.smoothstep(reach,.32,.95);
            const correction = (.005 + recover*.136*reach - clearance) * loose;
            const deckUp = sole.set(0,1,0).applyQuaternion(plank.quaternion).y;
            foot.position.y += Math.max(-clearance,correction)/Math.max(.55,deckUp);
          }
        }
      } else {
        const step = state.walking ? s*Math.sin(time*5.05) : push*stroke;
        const roll = -(edge*(.28+moving*(.47+.16*outside)) + cutSide*skid*.085) * (1-.76*air);
        // Children can open a shallow wedge to scrub speed. Keep a gap
        // between the short shovels and blend back to parallel as pace builds.
        const slowWedge = junior && !inFlight ? moving*(1-THREE.MathUtils.smoothstep(speed,5,10))*(1-push) : 0;
        const wedge = brake*(1-skid)*.135 + slowWedge*(.037+.112*brake);
        let halfTrack = (.141+.035*pressure+.029*skid+.034*air+.029*push)*stance;
        if (slowWedge>0) halfTrack = Math.max(halfTrack,.060*deckWidth+.96*deckLength*Math.sin(wedge));
        const lateral = s*halfTrack;
        const advance = -.128*insideLoad+.078*outside+air*s*.080-step*.145;
        const foreSnow = snowUnder(snow,lateral,advance-.62*deckLength), aftSnow = snowUnder(snow,lateral,advance+.55*deckLength);
        limb.relief = mix(limb.relief,(foreSnow+aftSnow)*.5,ease(18));
        limb.pitchRelief = mix(limb.pitchRelief,Math.atan2(foreSnow-aftSnow,1.17*deckLength),ease(18));
        plank.rotation.set(boardPitch+limb.pitchRelief+air*s*.058+step*.024,
          gearYaw+s*wedge+s*air*.074-s*push*.097,roll,'YXZ');
        plank.position.set(lateral,.002+Math.abs(Math.sin(roll))*.047*deckWidth+boardLift+contactLift+
          limb.relief+insideLoad*.006+Math.max(0,step)*.026,advance);
        const frontLoad=clamp(noseLoad*(.85+outside*.34),0,1);
        limb.flex(frontLoad,tailLoad);
        if (junior && !inFlight) groundJuniorDeck(plank,frontLoad,tailLoad,0,Math.max(0,step)*.026);
      }

      bootRotation.multiplyQuaternions(plank.quaternion,foot.quaternion);
      bootInverse.copy(bootRotation).invert();
      ankle.set(0,.196,.030).applyQuaternion(foot.quaternion).add(foot.position);
      ankle.applyQuaternion(plank.quaternion).add(plank.position);
      hip.set(s*hipWidth,-.007,.006).applyQuaternion(pelvis.quaternion).add(pelvis.position);
      if (board) {
        const lead = s<0 ? 1 : -1;
        hip.y -= lead*(trim*.039 + attack*.029 - release*.021);
      } else {
        hip.y += outside*(.037+.023*steep)-insideLoad*(.033+.014*pressure);
      }
      const bootYaw = board ? (s<0 ? -1.22 : -1.66)+gearYaw+(s>0 ? kick*push*.91 : 0) :
        junior ? plank.rotation.y+slip*.10 : gearYaw+slip*.10+s*brake*(1-skid)*.12;
      bend.set(s*.102,-.035,-1).applyAxisAngle(axisY,bootYaw);
      if (board) {
        bend.x += timing*(s<0 ? .31 : .20) + .068*(s<0 ? attack : -release);
        bend.z += s*(.12+.22*pressure)-trim*.16-(s<0 ? .20*attack : -.13*release);
      } else {
        bend.x += edge*(.32+.17*outside)+s*.055*push*stroke;
        bend.z -= trim*.104+insideLoad*.16+.061*steep;
      }
      // Solve once to measure shin demand, tilt the boot cuff about its
      // hinge, and solve to the displaced cuff anchor. The sole never slides.
      solveJoint(hip,ankle,bend,leg1,leg2,knee);
      legInBoot.subVectors(knee,ankle).applyQuaternion(bootInverse);
      const shinFlex = Math.atan2(-legInBoot.z,legInBoot.y);
      const flexion = board ? clamp(.045+.66*shinFlex,-.15,.63) : clamp(.035+.48*shinFlex,-.065,.51);
      const cant = clamp(Math.atan2(legInBoot.x,legInBoot.y),board ? -.34 : -.118,board ? .34 : .118);
      limb.anklePitch = mix(limb.anklePitch,flexion,ease(18));
      limb.ankleCant = mix(limb.ankleCant,cant,ease(18));
      limb.bendCuff(limb.anklePitch,limb.ankleCant,ankle);
      ankle.applyQuaternion(foot.quaternion).add(foot.position).applyQuaternion(plank.quaternion).add(plank.position);
      solveJoint(hip,ankle,bend,leg1,leg2,knee);
      aimBone(limb.thigh,hip,knee,cutThigh,bootYaw);aimBone(limb.shin,knee,ankle,cutShin,bootYaw);

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
      // Hands continue down the fall line through the initial leg compression;
      // in a fast tuck the elbows draw in and the grips move ahead of the knees.
      const steadyHand = clamp(-suspension.velocity*.048,-.055,.073);
      wrist.y += steadyHand;
      if (board) {
        wrist.x += s*(hollow*.034 + entry*.033);
        wrist.y += s*(frontEdge-rearEdge)*.075 + (s<0 ? .041*attack : -.024*attack);
        wrist.z += s*(.096*attack - .055*release) - .025*steep;
      } else {
        wrist.x -= s*steep*fast*.042;
        wrist.y += steep*fast*.137 + tuck*.058 + recovered*push*.026;
        wrist.z -= moving*.028 + steep*fast*.188 + tuck*.062 +
          recovered*push*.090 + outside*.031 + poleTap*.035;
      }
      wrist.applyAxisAngle(axisY,chestYaw).add(torso.position);
      tmp.subVectors(wrist,shoulder).clampLength(.12,arm1+arm2-.002);
      wrist.copy(shoulder).add(tmp);

      // A planted pole tip briefly stays in the snow as the skier moves past it.
      const worldPose = Number.isFinite(state.x) && Number.isFinite(state.z);
      if (limb.pole) {
        const carryPoles=visibility==='body' && speed>10.5;
        if (!drive || inFlight || !worldPose || rewound || carryPoles) limb.plant=null;
        const startPlant = (push>.25 && phase<.18 && (limb.lastStroke>=.18 || !limb.wasPushing)) ||
          (poleTap>.8 && limb.lastStroke<.79 && push<.35);
        if (!limb.plant && startPlant && drive && !inFlight && !carryPoles && worldPose) {
          contact.set(wrist.x+s*(.24+.065*pressure),.013,wrist.z-.34);
          rig.localToWorld(contact);
          if (state.data?.height) contact.y=state.data.height(contact.x,contact.z)+.016*size;
          limb.plant={point:contact.clone(),age:0,max:Math.min(.42,.98/Math.max(2.7,speed))};
        }
        limb.lastStroke = push>.25 ? phase : poleTap;limb.wasPushing=push>.25;
        if (limb.plant) {
          limb.plant.age+=dt;
          contact.copy(limb.plant.point);rig.worldToLocal(contact);
          grip.copy(wrist);grip.y-=.062;
          const d=grip.distanceTo(contact);
          if (limb.plant.age>limb.plant.max || d>poleLength+.135 || d<.60*(poleLength/1.135)) limb.plant=null;
          else {
            grip.sub(contact).setLength(poleLength).add(contact);grip.y+=.062;
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
          limb.pole.scale.y=clamp(length/poleLength,.97,1.03);
        } else {
          const drop=clamp(hold.y-.11-.20*air-.16*recovered*push-.035*swap,.28,poleLength-.100);
          const spread=s*(.165+.12*pressure+.084*poleTap);
          const trail=Math.sqrt(Math.max(.01,poleLength**2-drop**2-spread**2));
          // Recover the shaft forward just before the next low-speed pole plant.
          const reach = push*THREE.MathUtils.smoothstep(phase,.69,.90) +
            (1-push)*poleTap*.65;
          limb.poleDirection.set(spread+s*reach*.35,-drop,trail*(1-reach*1.45)).normalize();
          limb.pole.scale.y=1;
        }
        limb.pole.quaternion.setFromUnitVectors(axisDown,limb.poleDirection);
      }
    }
    if (visibility==='body' || junior) {
      outsideMotion(state,dt,snapPose,drive,moving,steep,push,attack,release,impactSoon,lean,angulation);
      seatPose(limbs);
    }
  }

  const decks = [...new Set(limbs.map(limb => limb.plank))];
  const noseWeights = decks.map(plank => plank.children[0].morphTargetInfluences);
  const nosePoint = v3();
  let visibility = 'body';

  function setVisibility(mode = 'body') {
    const next = mode === 'first' || mode === 'tips' ? mode : 'body';
    if (next === visibility) return;
    visibility = next;
    if(junior){
      leg1=next==='body' ? .345 : cutThigh;leg2=next==='body' ? .301 : cutShin;
      if(next==='body')head.scale.set(1.42,1.38,1.37);else head.scale.set(1.31,1.27,1.29);
    }
    for (const part of rig.children) {
      part.visible = next === 'body' || decks.includes(part) ||
        (next === 'first' && part !== torso && part !== pelvis);
    }
    outsidePose.ready=false;
    if (next!=='body') spine.restPose();
    if (lastState) {redraw=true;update(lastState,0,posed.t);}
  }

  // Optical centre between the lenses, with all neck and torso articulation applied.
  // Both camera anchors are returned in rider-group coordinates (metres).
  function eyePosition(out = v3()) {
    return out.set(0,.153,-.113).multiply(head.scale).applyQuaternion(head.quaternion).add(head.position)
      .applyQuaternion(torso.quaternion).add(torso.position).multiplyScalar(size);
  }

  function shadowPose(out) {
    rig.updateWorldMatrix(true,false);
    const transform=rig.matrixWorld;
    const helmet=out[0].set(0,.165,0).multiply(head.scale).applyQuaternion(head.quaternion).add(head.position);
    helmet.applyQuaternion(torso.quaternion).add(torso.position).applyMatrix4(transform);
    out[1].set(0,.32,0).applyQuaternion(torso.quaternion).add(torso.position).applyMatrix4(transform);
    out[2].copy(pelvis.position).applyMatrix4(transform);
    for(let i=0;i<limbs.length;i++){
      const limb=limbs[i],at=3+i*4;
      out[at].copy(limb.knee).applyMatrix4(transform);
      out[at+1].copy(limb.ankle).applyMatrix4(transform);
      out[at+2].copy(limb.elbow).applyMatrix4(transform);
      out[at+3].copy(limb.wrist).applyMatrix4(transform);
    }
  }

  function tipPosition(out = v3()) {
    out.set(0, 0, 0);
    for (let i = 0; i < decks.length; i++) {
      const plank = decks[i], weights = noseWeights[i];
      const height = (board ? .098 : .119) + .0017 - .021*weights[0] + .012*weights[1];
      nosePoint.set(0,height,(board ? -.80 : -.96)*deckLength);
      nosePoint.applyQuaternion(plank.quaternion).add(plank.position);
      out.add(nosePoint);
    }
    return out.multiplyScalar(size / decks.length);
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

  if (junior) rig.scale.setScalar(size);
  update();
  return { group, dimensions, update, setVisibility, eyePosition, tipPosition, shadowPose, dispose };
}
