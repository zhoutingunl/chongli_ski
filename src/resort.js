import * as THREE from 'three';
import {crowdColours,daylightTraffic,passengerManifest} from './piste-traffic.js';

// Local axes for a landmark: the front elevation looks along +Z, one unit is one metre.
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const up = V(0, 1, 0);
const materialCache = new Map();
const palette = new Map();
let resortNight = 0;
export function setResortNight(amount=0) {
  resortNight = THREE.MathUtils.clamp(amount,0,1);
  for(const key of ['occupiedRoom','glazing','panorama']) {
    const m=materialCache.get(key);
    if(m) m.emissiveIntensity=key==='occupiedRoom'?.18+1.74*resortNight:.13*resortNight;
  }
}
const tileMeters = { timber: 2.7, stone: 3.0, plaster: 4.8, glazing: 1, panorama: 1 };

function color(value) {
  if (!palette.has(value)) palette.set(value, new THREE.Color(value));
  return palette.get(value);
}

function loadTexture(name, data = false) {
  if (typeof document === 'undefined') return null;
  const uri = new URL(`assets/resort/${name}.webp`, document.baseURI).href;
  const tex = new THREE.TextureLoader().load(uri);
  tex.wrapS = tex.wrapT = name === 'lettering' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  if (!data) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function getMaterial(key) {
  if (materialCache.has(key)) return materialCache.get(key);
  const options = { vertexColors: true, roughness: 0.79, metalness: 0.03 };
  if (['timber', 'stone', 'plaster'].includes(key)) {
    options.map = loadTexture(key);
    options.normalMap = loadTexture(`${key}-n`, true);
    options.normalScale = new THREE.Vector2(0.48, 0.48);
  } else if (key === 'occupiedRoom') {
    const room = loadTexture('room');
    options.map = options.emissiveMap = room;
    options.emissive = new THREE.Color('#ebb67c');
    options.emissiveIntensity = .18+1.74*resortNight;
    options.roughness = 0.30;
  } else if (['glazing', 'panorama', 'cabinGlass'].includes(key)) {
    options.map = loadTexture('glazing');
    if(key!=='cabinGlass') Object.assign(options,{emissiveMap:options.map,emissive:new THREE.Color('#fad9ab'),emissiveIntensity:.13*resortNight});
    options.metalness = 0.13;
    options.roughness = 0.22;
    if (key !== 'glazing') Object.assign(options, { transparent: true, opacity: key === 'panorama' ? 0.74 : 0.60, depthWrite: false });
    if (key === 'cabinGlass') options.side = THREE.DoubleSide;
  } else if (key === 'metal') {
    options.roughness = 0.50;
    options.metalness = 0.31;
  } else if (key === 'lettering') {
    options.map = loadTexture(key);
    options.alphaTest = 0.3;
    options.roughness = 0.75;
    options.side = THREE.DoubleSide;
  }
  const m = key === 'distant' ? new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}) : new THREE.MeshStandardMaterial(options);
  if (key === 'cabinGlass') {
    m.forceSinglePass = true;
    m.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <alphamap_fragment>',
        '#include <alphamap_fragment>\n if (!gl_FrontFacing) diffuseColor.a *= 0.22;');
    };
  }
  m.userData.surface=key;
  materialCache.set(key, m);
  return m;
}

// Bake repeated members into a single geometry per surface, including all the balusters,
// facets and window frames. This also keeps the identical lift carriers instancable.
class Builder {
  constructor() {
    this.data = new Map();
    this.transform = new THREE.Matrix4();
  }
  pose(x, y, z, yaw, build) {
    const old = this.transform;
    const local = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
    this.transform = old.clone().multiply(local);
    build();
    this.transform = old;
  }
  face(key, tint, xyz, uv) {
    if (!this.data.has(key)) this.data.set(key, {pos: [], norm: [], col: [], uv: [], ix: []});
    const d = this.data.get(key);
    const pts = xyz.map(p => V(...p).applyMatrix4(this.transform));
    const n = pts[1].clone().sub(pts[0]).cross(pts[2].clone().sub(pts[0])).normalize();
    const base = d.pos.length / 3;
    const shade = Array.isArray(tint) ? null : color(tint);
    const span = tileMeters[key] || 1;
    const w = pts[0].distanceTo(pts[1]) / span;
    const h = pts[0].distanceTo(pts[pts.length-1]) / span;
    const st = uv || (pts.length === 4 ? [[0,0],[w,0],[w,h],[0,h]] : [[0,0],[w,0],[w/2,h]]);
    for (let i=0; i<pts.length; i++) {
      const p = pts[i], rgb = shade || color(tint[i]);
      d.pos.push(p.x,p.y,p.z); d.norm.push(n.x,n.y,n.z); d.col.push(rgb.r,rgb.g,rgb.b); d.uv.push(...st[i]);
    }
    d.ix.push(base,base+1,base+2);
    if (pts.length===4) d.ix.push(base,base+2,base+3);
  }
  box(x,y,z,w,h,d, tint, key='solid') {
    const l=x-w/2,r=x+w/2,b=y-h/2,t=y+h/2,f=z+d/2,k=z-d/2;
    this.face(key,tint,[[l,b,f],[r,b,f],[r,t,f],[l,t,f]]);
    this.face(key,tint,[[r,b,f],[r,b,k],[r,t,k],[r,t,f]]);
    this.face(key,tint,[[r,b,k],[l,b,k],[l,t,k],[r,t,k]]);
    this.face(key,tint,[[l,b,k],[l,b,f],[l,t,f],[l,t,k]]);
    this.face(key,tint,[[l,t,f],[r,t,f],[r,t,k],[l,t,k]]);
    this.face(key,tint,[[l,b,k],[r,b,k],[r,b,f],[l,b,f]]);
  }
  rod(a,b,rad,tint, key='metal', sides=6, topRad=rad) {
    const lo=V(...a), hi=V(...b), axis=hi.clone().sub(lo).normalize();
    const u=(Math.abs(axis.y)>.97? V(1,0,0) : up.clone().cross(axis)).normalize();
    const v=axis.clone().cross(u);
    const lower=[], upper=[];
    for(let i=0;i<sides;i++) {
      const angle=i*Math.PI*2/sides;
      const radial=u.clone().multiplyScalar(Math.cos(angle)).addScaledVector(v,Math.sin(angle));
      lower.push(lo.clone().addScaledVector(radial,rad).toArray()); upper.push(hi.clone().addScaledVector(radial,topRad).toArray());
    }
    for(let i=0;i<sides;i++) {
      const j=(i+1)%sides;
      this.face(key,tint,[lower[i],lower[j],upper[j],upper[i]]);
      if (topRad>0) this.face(key,tint,[b,upper[i],upper[j]]);
      this.face(key,tint,[a,lower[j],lower[i]]);
    }
  }
  group() {
    const g=new THREE.Group();
    for (const [key,buf] of this.data) {
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(buf.pos,3));
      geo.setAttribute('normal',new THREE.Float32BufferAttribute(buf.norm,3));
      geo.setAttribute('color',new THREE.Float32BufferAttribute(buf.col,3));
      geo.setAttribute('uv',new THREE.Float32BufferAttribute(buf.uv,2));
      geo.setIndex(buf.ix); geo.computeBoundingSphere();
      const mesh=new THREE.Mesh(geo,getMaterial(key));
      mesh.castShadow=key!=='distant' && key!=='lettering' && key!=='cabinGlass' && key!=='panorama';
      mesh.receiveShadow=key!=='lettering';
      mesh.name=key; g.add(mesh);
    }
    return g;
  }
}

const unitUv=[[0,0],[1,0],[1,1],[0,1]];
const ice='#f1f5f7', frame='#364451', pewter='#808c92', bronze='#5a4940', darkWood='#6a432c';

function pane(b,x,y,z,w,h,tint='#b4c6cf', key='glazing', offset=0) {
  const l=x-w/2, r=x+w/2, t=y+h/2, d=y-h/2;
  b.face(key,tint,[[l,d,z],[r,d,z],[r,t,z],[l,t,z]],[[offset,0],[offset+.28,0],[offset+.28,1],[offset,1]]);
}

function sign(b,i,x,y,z,w,h,tint='#fef4dd',back=null) {
  if (back) b.box(x,y,z-.09,w+.3,h+.24,.16,back);
  const u=(i%2)/2, v=1-(Math.floor(i/2)+1)/8;
  const l=x-w/2, r=x+w/2, t=y+h/2, k=y-h/2;
  b.face('lettering',tint,[[l,k,z+.008],[r,k,z+.008],[r,t,z+.008],[l,t,z+.008]],[[u+.001,v+.001],[u+.499,v+.001],[u+.499,v+.124],[u+.001,v+.124]]);
}

function windowBay(b,x,y,z,w,h,seed, divided=true) {
  b.box(x,y,z,w+.14,h+.14,.10,'#485055','metal');
  const variants=['#b2c3c7','#c7c4ad','#a7bbc2','#b7c5c5','#c5c8c3','#96a9b2'];
  if (seed%8===0) {
    const l=x-(w-.09)/2, r=x+(w-.09)/2, bot=y-(h-.09)/2, top=y+(h-.09)/2;
    b.face('occupiedRoom','#dbd5c1',[[l,bot,z+.10],[r,bot,z+.10],[r,top,z+.10],[l,top,z+.10]],unitUv);
  } else {
    pane(b,x,y,z+.10,w-.09,h-.09,variants[seed%variants.length],'glazing', (seed*.173)%1);
  }
  if (divided) {
    b.box(x-w*.12,y,z+.14,.072,h,.05,'#59646a','metal');
    b.box(x,y+h*.21,z+.14,w,.066,.05,'#59646a','metal');
  }
}

function stairs(b,x,z,width,rise,count) {
  for(let i=0;i<count;i++) {
    const h=(i+1)*rise, at=z-i*.43;
    b.box(x,h/2-.03,at,width,h,.48,'#b9b3a7','plaster');
    b.box(x,h,at+.10,width+.03,.045,.25,ice);
  }
}

function rail(b,x,z,length,y=0,metal=false) {
  const n=Math.max(1,Math.ceil(length/1.7)), tint=metal?'#b0b9b9':darkWood, m=metal?'metal':'solid';
  for(let i=0;i<=n;i++) b.box(x+(i/n-.5)*length,y+.56,z,metal?.065:.17,1.12,metal?.065:.17,tint,m);
  for(const top of [.42,.94]) b.box(x,y+top,z,length+.12,metal?.055:.13,metal?.055:.12,tint,m);
  b.box(x,y+1.06,z,length+.18,.095,.16,metal?'#d3dde1':'#b0997d',m);
}

function skiRack(b,x,z,count=5) {
  const len=count*.45+.35;
  for (const dx of [-len/2,len/2]) {
    b.rod([x+dx,0,z-.48],[x+dx,1.12,z],.048,frame);
    b.rod([x+dx,0,z+.48],[x+dx,1.12,z],.048,frame);
  }
  b.rod([x-len/2,1.05,z],[x+len/2,1.05,z],.06,'#727f88');
  const colors=['#b63329','#e49a27','#e5e8db','#386281','#c94c31'];
  for(let i=0;i<count;i++) for(const offset of [-.075,.075]) {
    const dx=x+(i-(count-1)/2)*.46+offset;
    const top=1.55+(i%3)*.12, lean=(i%2?.14:-.13);
    b.face('solid',colors[i%colors.length],[[dx-.053,.025,z-.21],[dx+.053,.025,z-.21],[dx+lean+.055,top,z+.11],[dx+lean-.055,top,z+.11]]);
    b.box(dx+lean*.38,.70,z-.046,.082,.21,.095,'#2d3337');
  }
}

function gableRoof(b,x,z,w,d,eave,ridge,timber='#9c6948') {
  const left=x-w/2,right=x+w/2,front=z+d/2,back=z-d/2;
  // The lower face of the snowy roof has a visible timber soffit when seen from below.
  for (const side of [-1,1]) {
    const a=side<0? left:x, c=side<0?x:right, ya=side<0?eave:ridge, yc=side<0?ridge:eave;
    const top=[[a,ya+.19,front],[c,yc+.19,front],[c,yc+.19,back],[a,ya+.19,back]];
    b.face('solid',ice,top);
    b.face('timber',timber,[[a,ya-.13,back],[c,yc-.13,back],[c,yc-.13,front],[a,ya-.13,front]]);
    b.face('solid','#806955',[[a,ya-.13,front],[c,yc-.13,front],[c,yc+.19,front],[a,ya+.19,front]]);
    b.face('solid','#766355',[[c,yc-.13,back],[a,ya-.13,back],[a,ya+.19,back],[c,yc+.19,back]]);
  }
  for(const xx of [left,right]) b.box(xx,eave+.015,z,.18,.34,d,'#9a8c7b');
  const inset=Math.min(.54,d*.13);
  b.face('timber',timber,[[left+.39,eave-.09,front-inset],[right-.39,eave-.09,front-inset],[x,ridge-.17,front-inset]]);
  b.face('timber',timber,[[right-.39,eave-.09,back+inset],[left+.39,eave-.09,back+inset],[x,ridge-.17,back+inset]]);
}

function deckTable(b,x,z) {
  b.rod([x,.04,z],[x,.81,z],.09,'#394750');
  b.rod([x,.78,z],[x,.86,z],.59,'#b59268','solid',12);
  for(const k of [-1,1]) {
    b.box(x,.5,z+k*.87,1.15,.13,.33,'#a88660');
    for(const dx of [-.38,.38]) b.box(x+dx,.23,z+k*.87,.065,.45,.21,frame,'metal');
  }
}

function wanlongSummit(b) {
  // The OSM outline is a long, narrow building; the lower wood section and the glazed
  // lookout share a continuous stone foundation and mountain-facing deck.
  b.box(0,-2.31,0,52,5.85,12.6,'#c0b5a2','stone');
  b.box(0,.37,6.5,53,.67,3.7,'#b08b68','timber');
  for(const x of [-25,-16,-5,5.5,15.5,25]) b.box(x,-1.95,7.67,.25,4.21,.28,darkWood);
  b.box(-11,2.57,-.45,28,4.12,10.65,'#b87648','timber');
  b.box(14.5,2.4,-.7,23,3.8,10.15,'#b79a78','timber');
  // Interlocked projecting log ends continue along each corner.
  for(let i=0;i<14;i++) for(const x of [-24.8,2.8]) for(const z of [-5.7,4.77]) {
    const yy=.72+i*.275;
    if (i%2) b.rod([x-.4,yy,z],[x+.4,yy,z],.148,'#ac7950','solid',7);
    else b.rod([x,yy,z-.38],[x,yy,z+.38],.15,'#a5724b','solid',7);
  }
  // Two overlapping pitched wings and a glazed western lookout.
  b.pose(-11,0,0,Math.PI/2,()=>{ gableRoof(b,0,0,12.65,30,4.46,7.35); });
  b.face('timber','#b07f55',[[-17.5,4.16,5.05],[-4.5,4.16,5.05],[-11,7.38,5.05]]);
  gableRoof(b,-11,3.55,14.4,5.8,4.03,7.64);
  for(const dx of [-6.2,6.2]) { b.box(-11+dx,2.24,6.07,.32,3.44,.32,darkWood); b.rod([-11+dx,3.15,6.07],[-11+dx*.74,4.64,6.07],.13,'#784e34','solid'); }
  b.box(-11,2.25,5.03,2.4,3.02,.19,bronze);
  pane(b,-11,2.32,5.15,1.92,2.73,'#bba583'); b.box(-11,2.35,5.18,.09,2.82,.05,darkWood);
  sign(b,0,-11,5.12,6.07,5.6,1.32,'#f5d29b','#62472d');
  for(const dx of [-21.3,-17.46,-4.72,-.74]) windowBay(b,dx,2.69,4.94,2.55,1.85,Math.round(dx+23));
  b.pose(-25.02,0,-.5,-Math.PI/2,()=>{ for(const dx of [-2.5,1.8]) windowBay(b,dx,2.68,0,2.8,1.74,3); });
  b.box(-19.6,6.45,-2.65,1.02,4.4,1.14,'#b6a58f','stone'); b.box(-19.6,8.69,-2.65,1.32,.17,1.42,ice);
  for(let i=0;i<8;i++) windowBay(b,4.85+i*2.8,2.77,4.44,2.61,2.88,i);
  for(let i=0;i<4;i++) b.pose(26.1,0,-.6,Math.PI/2,()=>windowBay(b,-3.55+i*2.30,2.67,0,2.12,2.55,i));
  b.box(14.5,4.59,-.64,25.15,.37,12.5,'#795942'); b.box(14.5,4.84,-.64,25.24,.17,12.62,ice);
  sign(b,1,14.5,4.03,4.63,6.6,.82,'#e4d7b6','#544d3d');
  rail(b,-19.4,8.08,11.6,.70); rail(b,8.8,8.08,32.3,.70); stairs(b,-11,10,3.17,.18,4);
  skiRack(b,-18.4,10.3); skiRack(b,4.1,10.4,4);
  for(const dx of [9,16,22]) deckTable(b,dx,6.76);
}

function gentingSummit(b) {
  const slices=12;
  const footprint=[], eaves=[], upper=[];
  for(let i=0;i<slices;i++) {
    const a=i*2*Math.PI/slices + Math.PI/12;
    const rib=i%2===0;
    // Projecting folded timber leaves, visible above the glass perimeter of 金花阁.
    footprint.push([16.9*Math.cos(a),.46,-10.9*Math.sin(a)]);
    upper.push([18.0*Math.cos(a),rib?7.25:5.95,-11.65*Math.sin(a)]);
    eaves.push([(rib?21.0:18.8)*Math.cos(a),rib?8.35:6.16,-(rib?14.3:12.9)*Math.sin(a)]);
  }
  for(let i=0;i<slices;i++) {
    const j=(i+1)%slices,lo=footprint[i],next=footprint[j],hi=upper[i],hiNext=upper[j],ei=eaves[i],ej=eaves[j];
    b.face('stone','#c5bfb2',[[lo[0],-1.85,lo[2]],[next[0],-1.85,next[2]],next,lo]);
    b.face('panorama',i%3===1?'#91b9cc':'#a1bfd0',[lo,next,hiNext,hi],[[i*.09,0],[(i+1)*.09,0],[(i+1)*.09,1],[i*.09,1]]);
    for (let k=0;k<4;k++) {
      const t=k/4, bot=V(...lo).lerp(V(...next),t), top=V(...hi).lerp(V(...hiNext),t);
      b.rod(bot.toArray(),top.toArray(), k===0?.091:.048,frame);
    }
    const a=V(...lo).lerp(V(...hi),.59), end=V(...next).lerp(V(...hiNext),.59);
    b.rod(a.toArray(),end.toArray(),.046,'#59666c');
    b.rod(hi,hiNext,.11,'#34434a');
    b.face('timber','#b98d65',[[0,7.2,0],[ej[0],ej[1]-.16,ej[2]],[ei[0],ei[1]-.16,ei[2]]]);
    b.face('solid','#e5eaeb',[[0,7.58,0],[ei[0],ei[1]+.08,ei[2]],[ej[0],ej[1]+.08,ej[2]]]);
    b.face('timber','#ac7d51',[[ei[0],ei[1]-.19,ei[2]],[ej[0],ej[1]-.19,ej[2]],[ej[0],ej[1]+.09,ej[2]],[ei[0],ei[1]+.09,ei[2]]]);
    for(let k=0;k<3;k++) {
      const t=(k+.5)/3, edge=V(...ei).lerp(V(...ej),t);
      b.rod([edge.x*.69,5.45,edge.z*.69],[edge.x,edge.y-.18,edge.z],.09,'#9a7252','solid');
    }
  }
  b.box(0,.21,0,30,.47,17,'#c0b5a4','stone');
  b.box(0,2.53,-1.9,13.1,4.25,3.5,'#d6b28b','timber');
  for(const x of [-10,-6,6,10]) { deckTable(b,x,3); deckTable(b,x,-3); }
  for(const x of [-9,-3,3,9]) { b.rod([x,4.65,-.35],[x,6.25,-.35],.035,frame); b.rod([x,4.45,-.35],[x,4.7,-.35],.26,'#e4c990','solid',8,.12); }
  b.box(0,1.88,10.89,3.52,3.04,.19,'#38454a'); pane(b,0,1.87,11.01,3.30,2.91,'#abc6c7'); b.box(0,1.86,11.04,.085,2.95,.06,frame);
  sign(b,5,0,3.85,11.22,4.6,1.13,'#eee5cf','#3c4344');
  b.box(7.4,.16,12.4,8.25,.27,.72,ice); sign(b,11,7.4,1.23,12.42,8.0,2.14,'#d83538');
  for (const x of [4.1,6.2,8.4,10.6]) b.box(x,.78,12.32,.075,1.2,.12,bronze);
  skiRack(b,-9.4,12.75); skiRack(b,-11.3,11.15,3);
}

function flatBlock(b,x,z,w,d,h,wall='#dbd6c8', coping='#797e7c') {
  b.box(x,(h-.5)/2-.25,z,w,h,d,wall,'plaster');
  b.box(x,-5.29,z,w+.16,13,d+.16,'#c8beb2','stone');
  b.box(x,h-.39,z,w+.46,.51,d+.46,coping);
  b.box(x,h-.035,z,w+.58,.20,d+.58,ice);
}

function glassFront(b,x,z,width,height,y0,cols,rows,tint='#b5c8cf') {
  const w=width/cols, h=height/rows;
  b.box(x,y0+height/2,z-.114,width+.17,height+.17,.14,frame,'metal');
  for(let x0=0;x0<cols;x0++) for(let y=0;y<rows;y++) {
    const left=x-width/2+x0*w, low=y0+y*h;
    b.face('glazing',tint,[[left+.052,low+.045,z+.008],[left+w-.052,low+.045,z+.008],[left+w-.052,low+h-.045,z+.008],[left+.052,low+h-.045,z+.008]],[[x0/cols,y/rows],[(x0+1)/cols,y/rows],[(x0+1)/cols,(y+1)/rows],[x0/cols,(y+1)/rows]]);
  }
}

function clockFace(b,x,y,z) {
  b.rod([x,y,z-.10],[x,y,z+.09],1.31,'#7c6944','metal',22);
  b.rod([x,y,z+.09],[x,y,z+.135],1.14,'#f3dfae','solid',24);
  for(let i=0;i<12;i++) {
    const a=i*Math.PI/6, xx=Math.sin(a), yy=Math.cos(a);
    b.rod([x+xx*.9,y+yy*.9,z+.145],[x+xx*1.065,y+yy*1.065,z+.145],.035,'#393c3d','solid',4);
  }
  b.rod([x,y,z+.16],[x-.51,y+.41,z+.16],.065,'#383532','solid',5);
  b.rod([x,y,z+.16],[x+.78,y+.16,z+.16],.04,'#383532','solid',5);
}

function entrance(b,x,z,span,base=0) {
  const count=Math.floor(span/2.9);
  for(let j=0;j<count;j++) {
    const xx=x+(j-(count-1)/2)*2.86;
    b.box(xx,base+1.9,z,2.72,3.75,.20,frame,'metal');
    pane(b,xx,base+1.92,z+.116,2.54,3.53,'#9babb0');
    b.box(xx,base+1.9,z+.15,.082,3.57,.08,'#9aabae','metal');
    for(const dx of [-.12,.12]) b.rod([xx+dx,base+1.25,z+.24],[xx+dx,base+1.77,z+.24],.026,'#d0d5d2');
  }
}

function plaza(b,extent,z) {
  for(const dx of [-.43,-.31,.34,.46]) skiRack(b,extent*dx,z,4);
  for(const dx of [-.48,.49]) {
    const x=extent*dx;
    b.rod([x,0,z-.6],[x,5.2,z-.6],.12,'#555d60','metal',8,.07);
    b.rod([x,.04,z-.6],[x,.75,z-.6],.19,'#767c7a','metal',7);
    b.rod([x,5.08,z-.65],[x,5.22,z+.23],.082,'#717c7e');
    b.box(x,5.18,z+.37,.36,.13,.77,'#c5c8ba','metal');
  }
}

function forecourtFlag(b,x,z,resort,angle) {
  b.pose(x,0,z,angle,()=>{
    b.rod([0,-.24,0],[0,4.2,0],.044,'#a4aca9','metal',6,.031);
    b.rod([0,.05,0],[0,.38,0],.135,'#6e7979','metal',7);
    const tint=resort==='genting'?'#ad3541':'#9c5233';
    const edge=[[0,1.79,0],[.58,1.67,.07],[1.08,1.91,.02],[.98,3.64,-.029],[.64,4.02,.022],[0,4.12,0]];
    b.face('solid',tint,[edge[0],edge[1],edge[4],edge[5]]);
    b.face('solid',tint,[edge[1],edge[2],edge[3],edge[4]]);
    b.face('solid',tint,[edge[5],edge[4],edge[1],edge[0]]);
    b.face('solid',tint,[edge[4],edge[3],edge[2],edge[1]]);
    sign(b,resort==='genting'?15:14,.50,3.34,.078,.83,.52,'#f1e3bd');
  });
}

function wanlongBase(b) {
  // The east tower is Dragon Palace. The ski hall occupies the lower, western podium.
  flatBlock(b,3,-1.5,56,33,11.3,'#dacbb5','#847160');
  b.box(3,3.0,15.36,55.7,5.4,.5,'#bca88b','stone');
  glassFront(b,3,15.68,51.8,3.37,6.2,19,2,'#c0c9c2');
  b.box(3,5.62,16.42,54.7,.53,3.1,'#796451'); b.box(3,5.94,16.45,55,.15,3.14,ice);
  for(const x of [-21,-12,13,23]) b.box(x,2.67,17,.53,5.31,.57,'#bba692','stone');
  entrance(b,1,16.06,20.4);
  glassFront(b,-17.6,15.79,9.32,2.65,1.10,5,2,'#bcc2b4');
  glassFront(b,19.7,15.79,12.29,2.66,1.1,6,2,'#c1c4b6');
  sign(b,2,3,10.18,15.59,12.3,1.83,'#a53c26','#dfd4bc');
  sign(b,12,-15.7,4.41,15.86,6.2,1.20,'#eee3c5','#695443');
  b.pose(-25.13,0,-1.48,-Math.PI/2,()=>glassFront(b,0,.02,27.8,4.2,5.52,10,2));
  // A fully framed, enclosed passage is visible between the podium and hotel wing.
  flatBlock(b,39,-5.3,17.8,9.65,7.48,'#bbab95');
  glassFront(b,39,-.36,16.2,3.17,3.67,9,2,'#c3c5b6');
  for(const x of [30.54,36.15,41.86,47.37]) b.box(x,4.35,-.24,.19,5.25,.28,bronze,'metal');
  const center=75,hotelWidth=54.5;
  flatBlock(b,center,-8.3,hotelWidth,30,29.5,'#e8dfce','#797268');
  flatBlock(b,center,5.58,hotelWidth+2.5,9.7,8.4,'#e3d5c2','#756c64');
  glassFront(b,center,10.63,hotelWidth-2.1,3.64,4.17,18,2,'#b1c2c7');
  const w=hotelWidth/13;
  for(let f=0;f<7;f++) {
    const y=9.51+2.71*f;
    for(let j=0;j<13;j++) windowBay(b,center+(j-6)*w,y,6.79,2.31,1.72,j*2+f,false);
    if (f===2 || f===5) b.box(center,y-1.32,6.87,hotelWidth+.18,.18,.64,'#aba294');
  }
  for(const s of [-1,1]) {
    const xx=center+s*hotelWidth/2;
    b.pose(xx+s*.13,0,-8.27,s*Math.PI/2,()=>{
      for(let f=0;f<7;f++) for(let col=0;col<6;col++) windowBay(b,(col-2.5)*4.12,9.5+f*2.71,0,2.19,1.70,f+col,false);
    });
  }
  // Tall stone pilasters, timber lanterns and hipped crowns of the hotel towers.
  for(const [x,top] of [[50.3,32.1],[75,33.8],[99.2,31.3]]) {
    b.box(x,top/2-.38,6.62,6.68,top,7.95,'#b7ada1','stone');
    glassFront(b,x,10.69,4.25,top-7.0,4.31,3,10,'#b2bfc1');
    b.box(x,top-1.25,6.7,7.55,.45,8.82,'#7a6453');
    b.box(x,top+.05,6.7,6.9,2.23,8.25,'#956b4b','timber');
    for(let j=0;j<3;j++) windowBay(b,x+(j-1)*1.77,top+.16,10.91,1.32,1.10,j,false);
    gableRoof(b,x,6.69,9.1,10.42,top+1.16,top+3.23,'#8f6c53');
  }
  sign(b,4,75,28.72,10.99,6.2,1.35,'#ecdbab','#625545');
  b.box(-19,9.78,5.66,5.35,8.74,5.0,'#c2b6a6','stone');
  gableRoof(b,-19,5.65,6.9,6.15,14.1,15.76,'#927455'); clockFace(b,-19,12.19,8.18);
  plaza(b,55,19.25);
  for(const [x,a] of [[-24,.15],[-21.82,-.18],[18,.42]]) forecourtFlag(b,x,21.0,'wanlong',a);
}

function balconyFront(b,center,width,z,base,levels,cols,warm=false) {
  const pitch=width/cols, floorH=3.17;
  for(let f=0;f<levels;f++) {
    const y=base+f*floorH;
    for(let k=0;k<cols;k++) windowBay(b,center+(k-(cols-1)/2)*pitch,y+1.38,z,pitch-.52,2.58,k*3+f, true);
    b.box(center,y-.03,z+.65,width+.3,.34,1.61,'#9d968c'); b.box(center,y+.16,z+.7,width+.33,.08,1.62,ice);
    // Slender metal rails with individual tinted wind screens are set off the wall.
    b.box(center,y+1.16,z+1.39,width,.055,.075,warm?'#63554b':pewter,'metal');
    for(let k=0;k<=cols;k++) {
      const x=center+(k-cols/2)*pitch;
      b.box(x,y+.65,z+1.4,.077,1.03,.07,pewter,'metal');
      if(k<cols) pane(b,x+pitch/2,y+.68,z+1.38,pitch-.12,.76,'#9faeb1','panorama',(f+k)*.115);
    }
  }
}

function gentingBase(b) {
  // The long ski-facing, balconied facade sits on the ski centre and its stepped terrace.
  flatBlock(b,25,-9.5,118,30,11.15,'#ddd4c5','#6e6e69');
  flatBlock(b,25,-13.8,114,24,32.35,'#ded7c9','#737574');
  b.box(25,4.63,5.73,117.5,8.43,.81,'#a49988','stone');
  balconyFront(b,25,107,-1.61,11.06,6,24);
  for(const x of [-27,-5.4,17.4,39.25,61.7,78.7]) {
    b.box(x,20.91,-.79,1.03,20.5,2.52,'#c1bbae','plaster');
  }
  for(const x of [-14.2,41.8]) b.box(x,32.93,-15,9.02,3.17,8.46,'#b2aea2','plaster');
  // Exposed upper floor signage matches the mountain-side hotel approach.
  b.box(24.8,31.58,-1.42,111.1,2.67,.51,'#d4cdc0');
  sign(b,7,3.7,31.68,-1.10,18.7,3.01,'#a82e29'); sign(b,8,47.7,31.63,-1.08,24.2,2.2,'#a42a28');
  glassFront(b,25,6.20,111.8,3.21,6.89,41,2,'#a4bdc7');
  for(const x of [-30,-12,7.24,26.4,45.55,64.26,80.73]) b.box(x,4.17,6.42,.82,8.34,1.00,'#a69c8c','plaster');
  b.box(-1.1,5.08,7.11,40,.54,4.02,'#6f7170'); b.box(-1.1,5.43,7.12,40.22,.19,4.13,ice);
  entrance(b,-1.1,6.31,28.5); sign(b,6,-1.1,6.24,6.46,11.6,1.48,'#ebe6d9','#525d5e');
  for(const [x,w] of [[-22.6,11.55],[27.4,18.5],[54.3,22.1],[75.1,10.5]]) {
    glassFront(b,x,6.23,w,3.43,.63,Math.round(w/2.35),2,'#bcc1bf');
  }
  sign(b,13,52.8,4.95,6.33,9.0,1.2,'#f0e7da','#455d6c');
  sign(b,3,-22.5,4.88,6.33,7.0,1.14,'#e6ddc7','#5b554a');
  b.box(53.3,-4.37,9.08,26.0,9.12,6.6,'#b9b3a6','stone');
  b.box(53.3,.24,9.08,26.18,.14,6.72,ice);
  for(const x of [44.2,49.7,55.2,60.7]) deckTable(b,x,9.14);
  rail(b,53.3,12.21,24.6,.3,true);
  // The hotel bends around its courtyard behind the piste frontage; these wings connect
  // the uphill lobby to the mapped hotel point near the centre of the complex.
  for(const [x,depth] of [[-22.2,46],[69.1,53]]) {
    flatBlock(b,x,-(30+depth/2),16.4,depth,23.8,'#d3cec2','#777875');
    for(const side of [-1,1]) b.pose(x+side*8.28,0,-(30+depth/2),side*Math.PI/2,()=>{
      const cols=side>0?10:9;
      for(let f=0;f<6;f++) for(let k=0;k<cols;k++) windowBay(b,(k-(cols-1)/2)*depth/(cols+.5),4.18+f*3.16,0,2.35,1.95,k+f,false);
    });
  }
  flatBlock(b,22.8,-69.2,77.6,14.5,15.05,'#cbc6b9','#7a7c77');
  glassFront(b,23,-61.88,70.1,9.54,3.45,26,4,'#bcc8c9');
  for(const x of [-34,84]) b.pose(x,0,-9.4,(x<0?-1:1)*Math.PI/2,()=>glassFront(b,0,.03,25.2,5.1,4.35,8,3));
  plaza(b,60,11.85);
  for(const [x,a] of [[-20.5,.22],[-17.85,-.42],[23.8,-.18]]) forecourtFlag(b,x,14.15,'genting',a);
}

export function createLandmark(kind,resort) {
  const b=new Builder();
  if (kind==='summit' || kind==='lodge') {
    (resort==='genting' ? gentingSummit : wanlongSummit)(b);
  } else {
    (resort==='genting' ? gentingBase : wanlongBase)(b);
  }
  const model=b.group();
  model.name=`${resort}-${kind}`;
  return model;
}

function roundedPlan(w,d,r,div=3) {
  const ring=[];
  for(let corner=0;corner<4;corner++) {
    const cx=(corner===0||corner===3 ? 1:-1)*(w/2-r);
    const cz=(corner<2?-1:1)*(d/2-r);
    for(let k=0;k<=div;k++) {
      const a=Math.PI/2*(corner+k/div);
      ring.push([cx+r*Math.cos(a),cz-r*Math.sin(a)]);
    }
  }
  return ring;
}

function shell(b,levels,key='metal',cap=true) {
  const rings=levels.map(q=>roundedPlan(q.w,q.d,q.r,q.div||3).map(([x,z])=>[x,q.y,z]));
  for(let l=0;l<rings.length-1;l++) {
    const first=rings[l], last=rings[l+1];
    for(let i=0;i<first.length;i++) {
      const j=(i+1)%first.length;
      b.face(key,levels[l].tint,[first[i],first[j],last[j],last[i]],[[i/first.length,0],[(i+1)/first.length,0],[(i+1)/first.length,1],[i/first.length,1]]);
    }
  }
  if(cap) for(const [idx,side] of [[0,-1],[rings.length-1,1]]) {
    const points=rings[idx], center=[0,levels[idx].y,0];
    for(let i=0;i<points.length;i++) {
      const j=(i+1)%points.length;
      b.face(key,levels[idx].tint,side===1?[center,points[i],points[j]]:[center,points[j],points[i]]);
    }
  }
}

function station(b,p,yaw,resort,isLow) {
  b.pose(p.x,p.y,p.z,yaw,()=>{
    const paint=resort==='genting'?'#ac3538':'#cf672e';
    b.box(0,-.28,0,8.65,1.18,16.8,'#d3c8b9','plaster');
    b.box(0,.22,0,8.7,.23,16.9,'#e6eaeb');
    for(const x of [-4.68,4.68]) {
      b.box(x,.77,0,1.62,1.60,14.12,'#bdbbb2','plaster');
      b.box(x,1.61,0,1.64,.115,14.2,'#e1e3df');
      b.box(x-Math.sign(x)*.70,1.68,0,.12,.046,14.08,'#d4b062');
      stairs(b,x,10.37,1.63,.205,8);
    }
    for(const z of [-4.75,4.0]) {
      b.box(0,2.57,z,1.35,4.55,1.25,'#90988d','metal');
      b.box(0,1.0,z,1.56,1.4,1.47,isLow?'#bc6452':'#e29953','solid');
      b.box(0,4.52,z,6.35,.46,1.33,'#657276','metal');
    }
    shell(b,[{y:4.62,w:8.0,d:19.7,r:3,tint:'#babfc0'},{y:5.00,w:8.61,d:20.2,r:3.8,tint:paint},{y:5.57,w:8.70,d:20.37,r:3.9,tint:paint}]);
    shell(b,[{y:5.56,w:8.72,d:20.4,r:3.9,tint:'#879fac'},{y:6.84,w:8.23,d:20.08,r:3.86,tint:'#85949b'}],'glazing');
    shell(b,[{y:6.80,w:8.27,d:20.14,r:3.9,tint:'#858c8c'},{y:7.04,w:7.67,d:19.74,r:3.6,tint:ice},{y:7.10,w:7.48,d:19.5,r:3.52,tint:ice}]);
    for(const side of [-1,1]) for(let k=-2;k<=2;k++) b.rod([side*4.33,5.61,k*2.25],[side*4.11,6.79,k*2.25+.17],.045,'#717c7d');
    // Side cabin, glazed operator bay, queue rail and boarding gates.
    b.box(-5.15,1.53,-1.36,2.65,2.92,4.60,'#c2b4a4','plaster');
    b.box(-5.15,3.05,-1.36,3.02,.17,4.96,ice);
    pane(b,-5.15,1.96,.97,2.15,1.32,'#99adb4');
    b.pose(-3.78,0,-1.36,Math.PI/2,()=>pane(b,0,2,0,3.85,1.31,'#a4b4b6'));
    for(let k=0;k<3;k++) {
      const x=3.75+k*1.15; b.rod([x,.18,-6.15],[x,1.14,-6.15],.079,'#939d9d');
      b.rod([x-.22,.75,-6.15],[x+.31,.83,-5.84],.043,'#b4bfc0');
    }
    sign(b,resort==='genting'?10:9,0,5.25,10.23,3.92,.76,'#f1e8d3');
  });
}

function tower(b,p,yaw,height) {
  b.pose(p.x,p.y,p.z,yaw,()=>{
    b.box(0,-.36,0,2.02,1.65,2.1,'#c4beb0','plaster');
    b.box(0,.53,0,1.53,.20,1.50,'#818a88','metal');
    b.rod([0,.50,0],[0,height-.87,0],.58,'#83918e','metal',10,.392);
    for(const xx of [-.38,.38]) for(const zz of [-.43,.42]) b.rod([xx,.61,zz],[xx,.75,zz],.073,'#665e52','metal',5);
    for(const x of [-.22,.22]) b.rod([x,1.15,.53],[x,height-.42,.49],.035,'#9da8a4','metal',5);
    for(let y=1.26;y<height-.43;y+=.44) b.rod([-.23,y,.52],[.23,y,.52],.026,'#8c9997','metal',4);
    b.box(0,height-.73,0,6.62,.36,.58,'#708080','metal');
    b.box(0,height-.5,0,6.90,.12,.88,'#b8c0bc','metal');
    for(const side of [-1,1]) {
      b.rod([0,height-2.35,0],[side*2.46,height-.68,0],.117,'#82908c');
      const x=side*2.71;
      for(const along of [-.87,.87]) b.box(x,height-.26,along,.38,.19,1.67,'#71817c','metal');
      for(const along of [-1.47,-.51,.51,1.47]) {
        b.rod([x-.18,height-.235,along],[x+.18,height-.235,along],.235,'#455457','metal',9);
        b.rod([x-.24,height-.235,along],[x-.185,height-.235,along],.157,'#b4bdbb','metal',7);
      }
      for(const z of [-1.74,1.74]) {
        b.rod([x+side*.44,height-.42,z],[x+side*.44,height+.48,z],.04,'#a3b0a9','metal',4);
      }
      b.rod([x+side*.44,height+.48,-1.74],[x+side*.44,height+.48,1.74],.044,'#9facaa','metal',4);
    }
  });
}

function hanger(b) {
  b.rod([0,.03,-.33],[0,.03,.39],.083,'#444d51','metal',7);
  const parts=[[0,.02,.18],[.49,-.14,.13],[.53,-.58,.08],[.27,-1.14,0],[0,-1.36,0]];
  for(let k=0;k<parts.length-1;k++) b.rod(parts[k],parts[k+1],.067,'#9aa6a7','metal',7);
  b.rod([-.125,-1.28,0],[.14,-1.28,0],.114,'#4d5759','metal',8);
}

function cabin(b,paint,resort) {
  hanger(b); const div=3;
  const level=(y,w,d,r,tint)=>({y,w,d,r,tint,div});
  shell(b,[level(-3.64,1.83,1.50,.27,'#39444a'),level(-3.51,2.12,1.80,.32,paint),level(-2.90,2.30,1.97,.40,paint),level(-2.84,2.30,1.97,.40,'#3b474a')]);
  shell(b,[level(-2.85,2.30,1.97,.40,'#b8c7c9'),level(-2.52,2.34,2.0,.41,'#b3c3c7'),level(-1.65,2.15,1.81,.36,'#bac8cb')],'cabinGlass',false);
  shell(b,[level(-1.66,2.17,1.84,.37,'#303b40'),level(-1.58,2.18,1.84,.37,paint),level(-1.43,1.93,1.62,.33,paint),level(-1.40,1.89,1.59,.32,'#9b9f99')]);
  const posts=[[-.76,.94],[.76,.94],[-.76,-.94],[.76,-.94]];
  for(const [x,z] of posts) b.rod([x,-2.88,z],[x*.93,-1.62,z*.94],.037,'#384246','metal',6);
  for(const side of [-1,1]) {
    b.box(0,-3.19,side*.63,1.73,.13,.39,'#3e4951','metal');
    b.box(0,-2.96,side*.78,1.73,.42,.105,'#505c63','metal');
    for(const dx of [-.41,.03,.45]) b.box(dx,-3.12,side*.59,.029,.026,.32,'#8b9598','metal');
    b.rod([side*1.145,-3.40,.01],[side*1.145,-2.55,.01],.025,'#435054');
    b.rod([side*1.145,-2.55,.01],[side*1.068,-1.59,.01],.025,'#435054');
    b.rod([side*1.153,-2.65,-.10],[side*1.15,-2.49,-.10],.018,'#d9dedc','metal',5);
  }
  for(const z of [-.49,-.21,.10,.39,.65]) {
    b.rod([-1.09,-3.42,z],[-1.32,-3.42,z],.021,'#535e61','metal',4);
    b.rod([-1.32,-3.42,z],[-1.32,-3.23,z],.021,'#535e61','metal',4);
  }
  b.rod([-1.32,-3.24,-.55],[-1.32,-3.24,.68],.023,'#596466','metal',5);
  b.box(0,-3.40, .944,1.65,.039,.027,'#e5d5b1','metal');
  sign(b,resort==='genting'?15:14,0,-3.14,1.00,1.16,.36,'#f6eedc');
}

function chair(b,resort,bubble) {
  hanger(b);
  const wide=2.94, sideX=wide/2, seatColor=resort==='genting'?'#a33337':'#c76a32';
  b.rod([0,-1.34,0],[0,-1.56,-.06],.078,'#858e8b');
  b.rod([-sideX,-1.57,-.05],[sideX,-1.57,-.05],.071,'#8d9997');
  for(const sign of [-1,1]) {
    const x=sideX*sign;
    b.rod([x,-1.56,-.05],[x,-2.85,-.65],.068,'#9aa4a1');
    b.rod([x,-2.85,-.65],[x,-3.13,-.44],.068,'#9aa4a1');
    b.rod([x,-3.13,-.44],[x,-3.13,.48],.061,'#8a9595');
    b.rod([x,-2.65,-.44],[x,-2.66,.49],.054,'#a9b3af');
  }
  b.box(0,-3.07,-.02,wide,.18,1.00,seatColor,'metal'); b.box(0,-2.74,-.48,wide,.72,.17,seatColor,'metal');
  b.rod([-sideX,-2.68,.5],[sideX,-2.68,.5],.055,'#a7b2ae');
  for(let j=0;j<4;j++) {const x=(j-1.5)*.7; b.box(x,-2.966,-.03,.65,.077,.86,'#525d64','metal'); b.box(x,-2.70,-.374,.645,.54,.058,'#546069','metal'); }
    for(const x of [-.74,.74]) {
      b.rod([x,-2.68,.50],[x,-3.80,.68],.041,'#7f8d8c');
      b.rod([x-.34,-3.8,.68],[x+.34,-3.8,.68],.042,'#647476');
    }
  if(bubble) {
    const curve=[[-.66,-2.68],[-.79,-2.12],[-.70,-1.82],[-.42,-1.57],[.02,-1.50],[.49,-1.66],[.75,-1.98]];
    for(let i=0;i<curve.length-1;i++) {
      const [z0,y0]=curve[i], [z1,y1]=curve[i+1];
      b.face('cabinGlass','#b4bec2',[[-sideX,y0,z0],[-sideX,y1,z1],[sideX,y1,z1],[sideX,y0,z0]],unitUv);
      for(const x of [-sideX,sideX]) b.rod([x,y0,z0],[x,y1,z1],.035,'#7e8888','metal',4);
    }
  }
}

const clamp01=t=>Math.max(0,Math.min(1,t));
const trackHalfWidth=2.71;

function prepareLine(points,heightAt,validatedSupports) {
  const ground=[];
  for(const source of points) {
    const p=source.isVector3 ? source.clone() : Array.isArray(source) ? (source.length>2 ? V(...source) : V(source[0],heightAt?.(source[0],source[1])||0,source[1])) : V(source.x,source.y,source.z);
    const prev=ground.at(-1);
    if(prev && prev.distanceToSquared(p)<1) continue;
    if(prev) {
      // Insert missing supports on unusually long unsurveyed stretches (some OSM lines
      // contain just their terminal coordinates), following the same DEM as the skier.
      const horizontal=Math.hypot(p.x-prev.x,p.z-prev.z);
      const sections=!validatedSupports&&horizontal>230 ? Math.ceil(horizontal/160) : 1;
      for(let i=1;i<sections;i++) {
        const q=prev.clone().lerp(p,i/sections);
        if(heightAt) q.y=heightAt(q.x,q.z);
        ground.push(q);
      }
    }
    ground.push(p);
  }
  if(ground.length<2) throw new Error('An aerial lift needs two distinct stations.');
  const n=ground.length;
  const tops=ground.map((p,i)=>p.clone().addScaledVector(up,i===0||i===n-1?5.24:12.8+1.9*Math.abs(Math.sin(i*1.77))));
  const sag=[];
  for(let i=0;i<n-1;i++) {
    const d=Math.hypot(ground[i+1].x-ground[i].x,ground[i+1].z-ground[i].z);
    sag[i]=Math.min(4.8,Math.max(.13,d*.019));
    if(heightAt) {
      // Test clearance inside each span, as the public trail points and the DEM can
      // have different sampling resolutions. Terminal heights are fixed by the platform.
      for(let step=1;step<9;step++) {
        const t=step/9, x=THREE.MathUtils.lerp(tops[i].x,tops[i+1].x,t), z=THREE.MathUtils.lerp(tops[i].z,tops[i+1].z,t);
        const cableHeight=THREE.MathUtils.lerp(tops[i].y,tops[i+1].y,t)-4*sag[i]*t*(1-t);
        const diff=heightAt(x,z)+5.15-cableHeight;
        if(diff>0) {
          if(i===0 && i+1<n-1) tops[i+1].y+=diff/t;
          else if(i+1===n-1 && i>0) tops[i].y+=diff/(1-t);
          else if(i>0 && i+1<n-1) { tops[i].y+=diff; tops[i+1].y+=diff; }
        }
      }
    }
  }
  const lengths=[0], headings=[], normals=[];
  for(let i=0;i<n;i++) {
    if(i) lengths.push(lengths[i-1]+tops[i].distanceTo(tops[i-1]));
    const d=tops[Math.min(n-1,i+1)].clone().sub(tops[Math.max(0,i-1)]);
    d.y=0; d.normalize();
    headings.push(d); normals.push(V(d.z,0,-d.x));
  }
  const length=lengths.at(-1), arc=Math.PI*trackHalfWidth, loopLength=2*(length+arc);
  const normal=V(0,0,0);
  function lane(s,side,position,dir) {
    s=Math.max(0,Math.min(length,s));
    let lo=0,hi=n-1;
    while(lo+1<hi) { const mid=(lo+hi)>>1;if(s<lengths[mid]) hi=mid; else lo=mid; }
    const t=(s-lengths[lo])/(lengths[lo+1]-lengths[lo]);
    normal.lerpVectors(normals[lo],normals[lo+1],t).normalize();
    position.lerpVectors(tops[lo],tops[lo+1],t).addScaledVector(normal,side*trackHalfWidth);
    position.y-=4*sag[lo]*t*(1-t);
    dir.subVectors(tops[lo+1],tops[lo]); dir.y-=4*sag[lo]*(1-2*t); dir.normalize();
    return position;
  }
  function turn(which,s,side,position,dir) {
    const a=s/trackHalfWidth;
    position.copy(tops[which]).addScaledVector(normals[which],side*trackHalfWidth*Math.cos(a)).addScaledVector(headings[which],side*trackHalfWidth*Math.sin(a));
    dir.copy(headings[which]).multiplyScalar(side*Math.cos(a)).addScaledVector(normals[which],-side*Math.sin(a));
  }
  function sample(meters,pos,dir) {
    const s=((meters%loopLength)+loopLength)%loopLength;
    if(s<length) lane(s,1,pos,dir);
    else if(s<length+arc) turn(n-1,s-length,1,pos,dir);
    else if(s<2*length+arc) { lane(2*length+arc-s,-1,pos,dir); dir.negate(); }
    else turn(0,s-2*length-arc,-1,pos,dir);
  }
  return {ground,tops,headings,lengths,length,loopLength,arc,lane,sample};
}

const wireMaterial = new THREE.LineBasicMaterial({color:'#35414a', transparent:true, opacity:.78});
function wire(line) {
  const positions=[],a=V(0,0,0),d=V(0,0,0);
  const count=Math.ceil(line.loopLength/6);
  let prev=null;
  for(let i=0;i<=count;i++) {
    line.sample(i/count*line.loopLength,a,d);
    if(prev) positions.push(...prev,a.x,a.y,a.z);
    prev=[a.x,a.y,a.z];
  }
  const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  const mesh=new THREE.LineSegments(geo,wireMaterial); mesh.name='haul rope'; return mesh;
}

// Distant carriers are a single opaque mesh. Four corner cuts preserve the silhouette,
// vertex colours describe the sky reflected in the glass, and the metal bow remains visible.
const farSurface='distant';
function ribbon(b,a,e,w,tint) {
  const start=V(...a),end=V(...e),axis=end.clone().sub(start).normalize();
  const side=(Math.abs(axis.y)>.93 ? V(1,0,0) : up.clone().cross(axis)).setLength(w*.5);
  const cross=axis.clone().cross(side).setLength(w*.5);
  const local=off=>[start.clone().sub(off).toArray(),end.clone().sub(off).toArray(),end.clone().add(off).toArray(),start.clone().add(off).toArray()];
  b.face(farSurface,tint,local(side)); b.face(farSurface,tint,local(cross));
}
function lowRing(b,profile) {
  const rings=profile.map(p=>roundedPlan(p[1],p[2],p[3],1).map(([x,z])=>[x,p[0],z]));
  for(let r=0;r<rings.length-1;r++)for(let i=0;i<8;i++) {
    const next=(i+1)%8;
    b.face(farSurface,profile[r][4],[rings[r][i],rings[r][next],rings[r+1][next],rings[r+1][i]],unitUv);
  }
  const lo=rings[0],hi=rings.at(-1);
  for(let i=1;i<7;i++) {
    b.face(farSurface,profile[0][4],[lo[0],lo[i+1],lo[i]]);
    b.face(farSurface,profile.at(-1)[4],[hi[0],hi[i],hi[i+1]]);
  }
}
function distantVehicle(b,style,resort) {
  const paint=resort==='genting'?'#bc363d':'#d26c33';
  const steel='#889394';
  ribbon(b,[0,0,0],[.40,-.23,.06],.115,steel);
  ribbon(b,[.40,-.23,.06],[0,-1.43,0],.13,steel);
  if(style==='cabin' || style==='gold') {
    const ink=style==='gold'?'#d99747':paint;
    lowRing(b,[[-3.61,1.91,1.56,.26,ink],[-2.85,2.33,2.01,.41,['#314752','#314752','#83a4af','#83a4af']],[-1.64,2.18,1.83,.36,ink],[-1.42,1.94,1.59,.32,'#899495']]);
    // A near-black central glazing bar carries across the broad viewing angles.
    b.face(farSurface,'#35454c',[[-.031,-2.85,1.012],[.031,-2.85,1.012],[.031,-1.64,.925],[-.031,-1.64,.925]]);
    return;
  }
  b.box(0,-3.06,-.02,2.95,.19,1.04,paint,farSurface);
  b.box(0,-2.75,-.47,2.94,.63,.14,'#4d5c65',farSurface);
  ribbon(b,[-1.46,-1.54,-.04],[1.46,-1.54,-.04],.113,steel);
  for(const x of [-1.46,1.46]) ribbon(b,[x,-1.54,-.04],[x,-3.02,-.51],.12,steel);
  ribbon(b,[-1.45,-2.65,.5],[1.45,-2.65,.5],.092,'#99a2a1');
  for(const x of [-.72,.72]) {
    ribbon(b,[x,-2.65,.50],[x,-3.65,.68],.074,steel);
    b.face(farSurface,'#516166',[[x-.34,-3.69,.72],[x+.34,-3.69,.72],[x+.34,-3.63,.72],[x-.34,-3.63,.72]]);
  }
  if(style==='bubble') {
    const cap=[[-.71,-2.57],[-.78,-2.05],[-.43,-1.58],[.18,-1.51],[.69,-1.92]];
    for(let i=0;i<cap.length-1;i++) {
      const [z0,y0]=cap[i], [z1,y1]=cap[i+1];
      b.face(farSurface,i<2?'#6d8289':'#9aa9aa',[[-1.49,y0,z0],[-1.49,y1,z1],[1.49,y1,z1],[1.49,y0,z0]]);
    }
  }
}

function distantTower(b,ground,yaw,h) {
  b.pose(ground.x,ground.y,ground.z,yaw,()=>{
    const shaft=[[-.49,0,.51],[.49,0,.51],[.49,0,-.51],[-.49,0,-.51]];
    const top=shaft.map(([x,,z])=>[x*.68,h-.74,z*.68]);
    for(let i=0;i<4;i++) {const j=(i+1)%4;b.face(farSurface,'#89938e',[shaft[i],shaft[j],top[j],top[i]]);}
    b.box(0,.26,0,1.61,.55,1.61,'#aca99f',farSurface);
    b.box(0,h-.60,0,6.75,.44,.68,'#838d88',farSurface);
    for(const s of [-1,1]) {
      ribbon(b,[0,h-2.20,0],[s*2.47,h-.63,0],.19,'#8f9894');
      b.box(s*trackHalfWidth,h-.24,0,.38,.32,3.45,'#63716e',farSurface);
    }
  });
}
function distantStation(b,ground,yaw,resort) {
  b.pose(ground.x,ground.y,ground.z,yaw,()=>{
    const ink=resort==='genting'?'#bb4043':'#bf653e';
    lowRing(b,[[4.63,8.2,19.6,3.1,ink],[5.58,8.7,20.4,3.85,['#495860','#495860','#80939c','#80939c']],[6.81,8.28,20.1,3.8,'#bdc4c5'],[7.1,7.56,19.6,3.52,ice]]);
    for(const z of [-4.75,4]) b.box(0,2.55,z,1.4,4.64,1.25,'#9ca49e',farSurface);
    b.box(-5.15,1.47,-1.36,2.65,2.92,4.6,'#a5a99d',farSurface);
    b.box(0,.03,0,9.3,.65,16.8,'#c4c6be',farSurface);
  });
}

// Each line has one low-detail structure mesh. Its index is rebuilt only when supports
// enter or leave the near band. The detailed local structures keep their surveyed heights.
function lineStructures(line,resort,group) {
  const far=new Builder(), parts=[];
  for(let i=0;i<line.ground.length;i++) {
    const ground=line.ground[i],d=line.headings[i],yaw=Math.atan2(d.x,d.z),h=line.tops[i].y-ground.y;
    const end=i===0||i===line.ground.length-1;
    const high=new Builder(),offset=far.data.get(farSurface)?.ix.length||0;
    if(end) {
      const angle=yaw+(i===0?Math.PI:0);
      station(high,ground,angle,resort,i===0); distantStation(far,ground,angle,resort);
    } else {
      tower(high,ground,yaw,h); distantTower(far,ground,yaw,h);
    }
    const mesh=high.group(); mesh.name=end?'near terminal':'near support';mesh.visible=false;group.add(mesh);
    const bound=new THREE.Sphere(ground.clone().addScaledVector(up,h*.52),end?14:Math.max(6,h*.66));
    parts.push({ground,end,mesh,offset,limit:far.data.get(farSurface).ix.length,bound,state:-1});
  }
  const low=far.group().children[0];low.removeFromParent();low.name='distant lift structures';low.castShadow=low.receiveShadow=false;group.add(low);
  const geo=low.geometry, index=geo.getIndex(),orig=index.array.slice();index.setUsage(THREE.DynamicDrawUsage);
  const last=V(Infinity,Infinity,Infinity),lastFacing=V(0,0,0),facing=V(0,0,0);
  let fieldOfView=0;
  return function locate(observer,camera,volume) {
    if(!observer) return;
    if(camera?.isCamera) facing.setFromMatrixColumn(camera.matrixWorld,2);
    const moved=observer.distanceToSquared(last)>=64;
    const turned=volume && (lastFacing.dot(facing)<.992 || fieldOfView!==camera.fov);
    if(!moved && !turned)return;
    last.copy(observer); lastFacing.copy(facing); fieldOfView=camera?.fov || 0;
    let dirty=false;
    for(const p of parts) {
      const dist=observer.distanceToSquared(p.ground);
      const hidden=volume && dist>48*48 && !volume.intersectsSphere(p.bound);
      const state=dist>3300*3300 || hidden ? 0 : dist<(p.end?95*95:65*65)?2:1;
      if(state!==p.state) {p.state=state;p.mesh.visible=state===2;dirty=true;}
    }
    if(!dirty)return;
    let count=0;
    for(const p of parts)if(p.state===1) {
      index.array.set(orig.subarray(p.offset,p.limit),count);count+=p.limit-p.offset;
    }
    low.visible=count>0;geo.setDrawRange(0,count);index.needsUpdate=true;
  };
}

const vehicleTemplates=new Map();
// Many routes overlap in the skyline. All lifts sharing a camera reuse its expanded
// frustum; the small allowance covers camera easing between the update and draw.
const cameraCull=new WeakMap();
const clipMatrix=new THREE.Matrix4();
function carrierFrustum(camera) {
  if(!camera?.isCamera) return null;
  let state=cameraCull.get(camera);
  if(!state){state={matrix:new THREE.Matrix4(),frustum:new THREE.Frustum()};cameraCull.set(camera,state);}
  clipMatrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
  if(!state.matrix.equals(clipMatrix)) {
    state.matrix.copy(clipMatrix);state.frustum.setFromProjectionMatrix(clipMatrix,camera.coordinateSystem,camera.reversedDepth);
    for(const plane of state.frustum.planes) plane.constant+=14;
  }
  return state.frustum;
}
function vehicleTemplate(style,resort,far) {
  const key=`${style}-${resort}-${far}`;
  if(!vehicleTemplates.has(key)) {
    const b=new Builder();
    if(far) distantVehicle(b,style,resort);
    else if(style==='chair' || style==='bubble') chair(b,resort,style==='bubble');
    else cabin(b,style==='gold'?'#d08a39':resort==='genting'?'#be3338':'#d06433',resort);
    vehicleTemplates.set(key,b.group());
  }
  return vehicleTemplates.get(key);
}

// Shared seated passengers sit on the actual bench, with a clear middle aisle in cabins.
const passengerModels=new Map();
function passengerModel(colour,openChair){
  const key=colour+'-'+Number(openChair);
  if(passengerModels.has(key))return passengerModels.get(key);
  const b=new Builder(),coat=crowdColours[colour],pants='#263746',helmet='#374754';
  const link=(a,z,r,t,top=r)=>b.rod(a,z,r,t,'solid',8,top);
  link([0,.00,-.04],[0,.31,-.05],.155,coat,.209);
  link([0,.31,-.05],[0,.49,-.014],.209,coat,.122);
  link([0,.485,.004],[0,.64,.022],.094,'#bc9079',.113);
  link([0,.60,.012],[0,.70,.004],.119,helmet,.139);
  link([0,.70,.004],[0,.764,-.003],.139,helmet,.092);
  b.box(0,.641,.119,.209,.052,.042,'#447387');
  b.box(0,.29,.133,.21,.035,.036,'#dedfcb');
  for(const s of [-1,1]){
    link([s*.158,.372,-.002],[s*.218,.131,.077],.078,coat,.064);
    link([s*.218,.131,.077],[s*.14,.097,.231],.062,coat,.052);
    b.box(s*.143,.094,.218,.090,.077,.102,helmet);
    link([s*.088,.023,-.032],[s*.119,-.041,.29],.104,pants,.082);
    link([s*.119,-.041,.29],[s*.132,-.394,.295],.081,pants,.059);
    b.box(s*.132,-.423,.34,.129,.135,.245,helmet);
    if(openChair)b.box(s*.132,-.501,.311,.069,.023,1.33,'#546b73');
  }
  const model=b.group().children[0];passengerModels.set(key,model);return model;
}

// points follow the order of travel, normally from the lower station to the upper station.
// position returned by seatAt and getRide is the passenger's eye position on the rising rope.
export function createLift({points,resort='wanlong',type,kind,id='',name='',bubble=false,mixed=false,heightAt,validatedSupports=false,random=Math.random}) {
  const line=prepareLine(points,heightAt,validatedSupports),group=new THREE.Group();group.name=name||`${resort}-lift`;
  const locateStructures=lineStructures(line,resort,group);
  group.add(wire(line));
  const mode=type||kind||'gondola';
  mixed=mixed || mode==='mixed' || id==='w469393391' || (resort==='genting' && /^(1|一)索$/.test(name));
  const hood=bubble || (id==='w469393393');
  const count=Math.max(6,Math.min(70,Math.round(line.loopLength/(mode==='chair'?46:64))));
  const carriers=[], styles=new Map();
  const bounds=new THREE.Box3().setFromPoints(line.tops).expandByScalar(8).getBoundingSphere(new THREE.Sphere());
  function fleet(style,far) {
    // At this distance amber and orange shells share one fleet and one draw call.
    if(far && style==='gold') style='cabin';
    const key=style+(far?' low':' high');
    if(!styles.has(key)) {
      const model=vehicleTemplate(style,resort,far), meshes=[];
      for(const part of model.children) {
        const mesh=new THREE.InstancedMesh(part.geometry,part.material,count);
        mesh.name=`${key} ${part.name}`; mesh.count=0; mesh.boundingSphere=bounds;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow=!far && part.castShadow;mesh.receiveShadow=!far;
        meshes.push(mesh); group.add(mesh);
      }
      styles.set(key,{meshes,used:0});
    }
    return styles.get(key);
  }
  for(let i=0;i<count;i++) {
    let style=mode==='chair'?(hood?'bubble':'chair'):'cabin';
    if(mixed && i%3!==0) style=hood?'bubble':'chair';
    if(style==='cabin' && resort==='wanlong' && i%4===1) style='gold';
    const chairSeat=style==='chair'||style==='bubble';
    carriers.push({offset:i/count*line.loopLength,hi:fleet(style,false),lo:fleet(style,true),
      chairSeat,passengers:[],trip:null,seatChance:0});
  }
  const pos=V(0,0,0),dir=V(0,0,0), carrier=new THREE.Object3D();
  const speed=resort==='genting'?5.0:5.65;
  let phaseOffset=0;
  const seat=new THREE.Object3D(),worldSeat=new THREE.Matrix4(),riders=new Map();
  function fillSeats(car,index,trip,probability,occupied){
    if(car.trip!==trip){
      car.trip=trip;car.seatChance=probability;car.passengers=passengerManifest(random,4);
    }
    for(let j=0;j<car.passengers.length;j++){
      const p=car.passengers[j];
      if(p.ticket>=car.seatChance||(occupied&&car.chairSeat&&j===1))continue;
      const cabin=!car.chairSeat;
      if(cabin)seat.position.set(j%2?.48:-.48,-3.115,j<2?-.63:.63);
      else seat.position.set((j-1.5)*.68,-2.90,-.07);
      seat.rotation.y=cabin&&j>=2?Math.PI:.035*Math.sin(index+j);
      seat.scale.setScalar(p.scale);seat.updateMatrix();worldSeat.multiplyMatrices(carrier.matrix,seat.matrix);
      const template=passengerModel(p.coat,car.chairSeat);
      let mesh=riders.get(template);
      if(!mesh){
        mesh=new THREE.InstancedMesh(template.geometry,template.material,count*4);
        mesh.name='Seated lift guests';mesh.count=0;mesh.boundingSphere=bounds;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);riders.set(template,mesh);group.add(mesh);
      }
      mesh.setMatrixAt(mesh.count++,worldSeat);
    }
  }
  function update(time,observer,occupiedT=null,travelDirection=1,night=null) {
    if(!group.visible) return;
    const view=observer?.isCamera?observer.position:observer;
    const visibleVolume=carrierFrustum(observer);
    locateStructures(view,observer,visibleVolume);
    // Align a cabin with the seated camera from boarding until disembarkation.
    // Retaining the phase offset lets the other vehicles keep moving at departure.
    if (Number.isFinite(occupiedT)) {
      const along=clamp01(occupiedT)*line.length;
      phaseOffset=(travelDirection<0 ? 2*line.length+line.arc-along : along)-time*speed;
    }
    const {seatChance}=daylightTraffic(night);
    for(const mesh of riders.values())mesh.count=0;
    for(const batch of styles.values()) batch.used=0;
    for(let i=0;i<carriers.length;i++) {
      const car=carriers[i],distance=car.offset+time*speed+phaseOffset;
      line.sample(distance,pos,dir);
      const d2=view?pos.distanceToSquared(view):150*150;
      if(d2>2850*2850 || (d2>24*24 && visibleVolume && !visibleVolume.containsPoint(pos))) continue;
      const batch=d2<65*65?car.hi:car.lo;
      carrier.position.copy(pos);
      carrier.rotation.y=Math.atan2(dir.x,dir.z);
      carrier.rotation.z=Math.sin(time*.68+i*1.23)*.011;
      carrier.updateMatrix();
      if(d2<75*75&&night!=null){
        const trip=Math.floor(distance/(line.loopLength*.5));
        fillSeats(car,i,trip,seatChance,i===0&&Number.isFinite(occupiedT));
      }
      for(const mesh of batch.meshes) mesh.setMatrixAt(batch.used,carrier.matrix);
      batch.used++;
    }
    for(const mesh of riders.values()){mesh.visible=mesh.count>0;if(mesh.count)mesh.instanceMatrix.needsUpdate=true;}
    for(const batch of styles.values()) for(const mesh of batch.meshes) {
      mesh.count=batch.used;mesh.visible=batch.used>0;
      if(batch.used) mesh.instanceMatrix.needsUpdate=true;
    }
  }
  function getRide(t,travelDirection=1) {
    const position=V(0,0,0), direction=V(0,0,0);
    line.lane(clamp01(t)*line.length,travelDirection,position,direction);
    if(travelDirection<0) direction.negate();
    position.y-=2.48;
    return {position,direction};
  }
  // This also makes the source standalone in a static scene before the first RAF tick.
  update(0,line.ground[0]);
  return {group,update,getRide,seatAt:(t,d)=>getRide(t,d).position,length:line.length,speed};
}
