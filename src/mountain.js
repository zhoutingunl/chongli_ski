export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const lerp = (a, b, t) => a + (b - a) * t;
export const mixAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
export const resortName = id => id === 'genting' ? '云顶' : '万龙';
export const formatTime = seconds => Math.floor(seconds / 60) + '′ ' + String(Math.floor(seconds % 60)).padStart(2, '0') + '″';
export const difficultyName = {easy:'初级', intermediate:'中级', advanced:'高级', expert:'专家'};
export const difficultyColor = {easy:'#8fc79d', intermediate:'#84b9e2', advanced:'#e49c85', expert:'#c49eb8'};
import {loadData} from './platform.js';

export class HeightField {
  constructor({bounds, dem}) {
    Object.assign(this, {bounds, ...dem});
    this.dx = (bounds.maxX - bounds.minX) / (this.cols - 1);
    this.dz = (bounds.maxZ - bounds.minZ) / (this.rows - 1);
  }
  height(x, z) {
    const u = clamp((x - this.bounds.minX) / this.dx, 0, this.cols - 1.000001);
    const v = clamp((z - this.bounds.minZ) / this.dz, 0, this.rows - 1.000001);
    const col = Math.floor(u), row = Math.floor(v), fx = u - col, fz = v - row;
    const i = row * this.cols + col, h = this.heights, w = this.cols;
    // The ski edge and the rendered surface use the same two triangles in each cell.
    return fx + fz < 1 ? h[i] + (h[i + 1] - h[i]) * fx + (h[i + w] - h[i]) * fz :
      h[i + w + 1] + (h[i + w] - h[i + w + 1]) * (1 - fx) + (h[i + 1] - h[i + w + 1]) * (1 - fz);
  }
}

class TrailIndex {
  constructor(trails) {
    this.cells = new Map();
    this.size = 90;
    for (const trail of trails) {
      for (let i = 1; i < trail.points.length; i++) {
        const [x,z] = trail.points[i - 1], [x2,z2] = trail.points[i];
        const dx = x2-x, dz = z2-z, l2 = dx*dx+dz*dz;
        if (!l2) continue;
        const seg = {x,z,dx,dz,l2,trail};
        const margin = Math.max(60, (trail.width || 38) * 0.75);
        for (let j=Math.floor((Math.min(z,z2)-margin)/this.size); j<=Math.floor((Math.max(z,z2)+margin)/this.size); j++) {
          for (let k=Math.floor((Math.min(x,x2)-margin)/this.size); k<=Math.floor((Math.max(x,x2)+margin)/this.size); k++) {
            const key=k+','+j;
            if (!this.cells.has(key)) this.cells.set(key,[]);
            this.cells.get(key).push(seg);
          }
        }
      }
    }
  }
  near(x,z) {
    const segments=this.cells.get(Math.floor(x/this.size)+','+Math.floor(z/this.size));
    let distance2=Infinity, best=null;
    for (const s of segments || []) {
      const t=clamp(((x-s.x)*s.dx+(z-s.z)*s.dz)/s.l2,0,1);
      const ax=x-s.x-s.dx*t, az=z-s.z-s.dz*t, d=ax*ax+az*az;
      if (d<distance2) { distance2=d; best=s; }
    }
    return {trail:best?.trail,distance:Math.sqrt(distance2)};
  }
}

// Collision checks are local to the rider. Mapped buildings use their footprints.
export class ObstacleIndex {
  constructor(buildings) {
    this.cells=new Map();this.size=32;
    for(const building of buildings){
      const pts=building.footprint;
      if(!pts?.length)continue;
      const xs=pts.map(p=>p[0]),zs=pts.map(p=>p[1]);
      this.insert(Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs),{pts});
    }
  }
  insert(x0,z0,x1,z1,item) {
    for(let j=Math.floor(z0/this.size);j<=Math.floor(z1/this.size);j++)
      for(let i=Math.floor(x0/this.size);i<=Math.floor(x1/this.size);i++){
        const key=i+','+j;
        if(!this.cells.has(key))this.cells.set(key,[]);
        this.cells.get(key).push(item);
      }
  }
  tree(x,z,r){this.insert(x-r,z-r,x+r,z+r,{x,z,r});}
  contact(x,z){
    const items=this.cells.get(Math.floor(x/this.size)+','+Math.floor(z/this.size));
    if(!items)return null;
    for(const item of items){
      if(!item.pts){
        const dx=x-item.x,dz=z-item.z,len=Math.hypot(dx,dz);
        if(len<item.r){const nx=dx/(len||1),nz=dz/(len||1);return {x:item.x+nx*(item.r+.15),z:item.z+nz*(item.r+.15),nx,nz};}
        continue;
      }
      const pts=item.pts;let inside=false,best=Infinity,px=x,pz=z;
      for(let i=0,j=pts.length-1;i<pts.length;j=i++){
        const a=pts[j],b=pts[i],dx=b[0]-a[0],dz=b[1]-a[1];
        if((a[1]>z)!==(b[1]>z) && x<dx*(z-a[1])/dz+a[0])inside=!inside;
        const t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1),0,1),ax=a[0]+t*dx,az=a[1]+t*dz,dd=(x-ax)**2+(z-az)**2;
        if(dd<best){best=dd;px=ax;pz=az;}
      }
      if(inside){const len=Math.sqrt(best)||1,nx=(px-x)/len,nz=(pz-z)/len;return {x:px+nx*.41,z:pz+nz*.41,nx,nz};}
    }
    return null;
  }
}

export class SkiRoute {
  constructor(raw, mountain) {
    Object.assign(this, raw);
    const p=this.points;
    this.distances=[0];
    for(let i=1;i<p.length;i++) this.distances.push(this.distances[i-1]+Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]));
    this.length=this.distances.at(-1);
    this.startHeight=mountain.height(...p[0]);
    this.endHeight=mountain.height(...p.at(-1));
  }
  at(distance) {
    distance=clamp(distance,0,this.length);
    let lo=0, hi=this.points.length-1;
    while(lo+1<hi) { const mid=(lo+hi)>>1; if(this.distances[mid]>distance) hi=mid; else lo=mid; }
    const a=this.points[lo],b=this.points[hi];
    const t=clamp((distance-this.distances[lo])/Math.max(0.01,this.distances[hi]-this.distances[lo]),0,1);
    return {x:lerp(a[0],b[0],t),z:lerp(a[1],b[1],t),index:lo};
  }
  frame(s) {
    const p=this.at(s), a=this.at(s-9), b=this.at(s+13);
    const dx=b.x-a.x, dz=b.z-a.z, d=Math.hypot(dx,dz)||1;
    return {...p,dx:dx/d,dz:dz/d,angle:Math.atan2(dx,-dz)};
  }
  closest(x,z) {
    let best=Infinity, along=0;
    for(let i=1;i<this.points.length;i++){
      const a=this.points[i-1], b=this.points[i],dx=b[0]-a[0],dz=b[1]-a[1];
      const t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1),0,1);
      const d=(a[0]+t*dx-x)**2+(a[1]+t*dz-z)**2;
      if(d<best){best=d;along=lerp(this.distances[i-1],this.distances[i],t);}
    }
    return {distance:Math.sqrt(best),along};
  }
}

let pending;
export function loadMountain() {
  if (!pending) pending = loadData('mountain').then(raw=>{
    const field=new HeightField(raw);
    const data={...raw, field, height:field.height.bind(field), index:new TrailIndex(raw.trails),obstacles:new ObstacleIndex(raw.buildings)};
    data.routes=raw.routes.map(r=>new SkiRoute(r,data));
    return data;
  }).catch(e=>{pending=null;throw e;});
  return pending;
}

export function randomGenerator(seed=7719) {
  return () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
}
