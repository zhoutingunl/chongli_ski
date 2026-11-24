import * as THREE from 'three';

// Refine the mapped courses permanently and load nearby powder relief in
// DEM-aligned cells as the rider moves. The outer collar joins the coarse DEM.
export function createTerrainDetail(scene,field,snow,material,coverCell) {
  const {bounds,cols,rows,dx,dz}=field;
  const fixed=new Set(), active=new Map(), cache=new Map(), drawn=new Map();
  let revision=0;
  const key=(c,r)=>r*(cols-1)+c;
  for(const f of snow.features){
    const xmin=Math.floor((f.bounds.minX-bounds.minX)/dx)-1;
    const xmax=Math.floor((f.bounds.maxX-bounds.minX)/dx)+1;
    const zmin=Math.floor((f.bounds.minZ-bounds.minZ)/dz)-1;
    const zmax=Math.floor((f.bounds.maxZ-bounds.minZ)/dz)+1;
    for(let r=Math.max(0,zmin);r<=Math.min(rows-2,zmax);r++)for(let c=Math.max(0,xmin);c<=Math.min(cols-2,xmax);c++){
      const x=bounds.minX+(c+.5)*dx-f.x,z=bounds.minZ+(r+.5)*dz-f.z;
      const along=x*f.dx+z*f.dz, side=Math.abs(z*f.dx-x*f.dz);
      const margin=Math.hypot(dx,dz)*.66+5;
      if(along>=f.start-margin&&along<=f.end+margin&&side<=f.width+margin)fixed.add(key(c,r));
    }
  }
  function edges(c,r,adjacent) {
    return Number(!adjacent(c-1,r))|Number(!adjacent(c+1,r))*2|
      Number(!adjacent(c,r-1))*4|Number(!adjacent(c,r+1))*8;
  }
  function mesh(c,r,border,steps) {
    const stride=steps+1,count=stride*stride,originX=bounds.minX+c*dx,originZ=bounds.minZ+r*dz;
    const sides=[1,2,4,8].filter(side=>border&side),size=(count+sides.length*stride)*3;
    const points=new Float32Array(size), surface=new Float32Array(size), normals=new Float32Array(size);
    const halo=steps+3, relief=new Float32Array(halo*halo),triangles=[];
    // One extra sample on each side gives neighbouring tiles the same relief
    // derivative at their shared edge, including on the walls of the halfpipe.
    for(let j=-1;j<=steps+1;j++)for(let i=-1;i<=steps+1;i++){
      const u=i/steps,v=j/steps,x=originX+u*dx,z=originZ+v*dz;
      let collar=1;
      if(border&1)collar=Math.min(collar,u*8);
      if(border&2)collar=Math.min(collar,(1-u)*8);
      if(border&4)collar=Math.min(collar,v*8);
      if(border&8)collar=Math.min(collar,(1-v)*8);
      collar=THREE.MathUtils.smoothstep(collar,0,1);
      const sample=snow.sample(x,z), rise=sample.relief*collar;
      relief[(j+1)*halo+i+1]=rise;
      if(i<0||j<0||i>steps||j>steps)continue;
      const k=j*stride+i;
      points.set([x,field.height(x,z)+rise,z],k*3);
      const powder=sample.kind==='powder'?sample.strength*collar:0;
      const weathered=sample.kind==='moguls'?sample.strength*.96*collar:powder;
      surface.set([powder,sample.rim*collar,weathered],k*3);
      if(i<steps&&j<steps)triangles.push(k,k+stride,k+1,k+1,k+stride,k+stride+1);
    }
    // Subdivision preserves the DEM triangles for collision. Lighting instead
    // interpolates their original vertex normals, then adds only the derivative
    // of the *extra* snow. Differentiating the DEM again exposes its flat faces.
    const base=field.vertexNormals, nw=3*(r*cols+c),ne=nw+3,sw=nw+3*cols,se=sw+3;
    for(let j=0;j<=steps;j++)for(let i=0;i<=steps;i++){
      const u=i/steps,v=j/steps,t=1-u-v, even=t>=0;
      const a=even?nw:se, weightB=even?u:1-v,weightC=even?v:1-u;
      const mix=k=>Math.abs(t)*base[a+k]+weightB*base[ne+k]+weightC*base[sw+k];
      const at=(j+1)*halo+i+1,ny=mix(1);
      const nx=mix(0)-ny*(relief[at+1]-relief[at-1])*steps/(2*dx);
      const nz=mix(2)-ny*(relief[at+halo]-relief[at-halo])*steps/(2*dz);
      const length=Math.hypot(nx,ny,nz);
      normals.set([nx/length,ny/length,nz/length],(j*stride+i)*3);
    }
    // A coarse edge meets many fine vertices. Cover subpixel rounding cracks
    // from either viewing direction with a short lip underneath the snow.
    sides.forEach((side,n)=>{
      const first=count+n*stride;
      let previous;
      for(let i=0;i<=steps;i++){
        const top=side===1?i*stride:side===2?i*stride+steps:side===4?i:steps*stride+i;
        const low=first+i;
        for(const array of [points,surface,normals])array.copyWithin(low*3,top*3,top*3+3);
        points[low*3]+=(side===2?1:side===1?-1:0)*.08;
        points[low*3+2]+=(side===8?1:side===4?-1:0)*.08;
        points[low*3+1]-=.55;
        if(i)triangles.push(previous,top,low,previous,low,low-1,low,top,previous,low-1,low,previous);
        previous=top;
      }
    });
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(points,3));
    geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));
    geometry.setAttribute('snowRelief',new THREE.BufferAttribute(surface,3));
    geometry.setIndex(triangles);geometry.computeBoundingSphere();
    const tile=new THREE.Mesh(geometry,material);
    tile.receiveShadow=true;tile.userData.steps=steps;
    return tile;
  }
  const isFixed=(c,r)=>c>=0&&c<cols-1&&r>=0&&r<rows-1&&fixed.has(key(c,r));
  for(const id of fixed){
    const c=id%(cols-1),r=Math.floor(id/(cols-1));
    const tile=mesh(c,r,edges(c,r,isFixed),48);scene.add(tile);drawn.set(id,tile);
    coverCell?.(c,r,true);
  }
  let centerX,centerZ,radius;
  function locate(x,z,quality){
    const c0=Math.floor((x-bounds.minX)/dx),r0=Math.floor((z-bounds.minZ)/dz);
    const reach=quality==='lite'?1:2;
    if(c0===centerX&&r0===centerZ&&reach===radius)return;
    centerX=c0;centerZ=r0;radius=reach;revision++;
    const left=Math.max(0,c0-reach),right=Math.min(cols-1,c0+reach+1);
    const top=Math.max(0,r0-reach),bottom=Math.min(rows-1,r0+reach+1);
    const adjacent=(c,r)=>c>=left&&c<right&&r>=top&&r<bottom&&!isFixed(c,r);
    const keep=new Set();
    for(let r=top;r<bottom;r++)for(let c=left;c<right;c++){
      if(!adjacent(c,r))continue;
      const border=edges(c,r,adjacent), name=key(c,r)*32+border+(reach===1?16:0);
      keep.add(name);
      if(active.has(name))continue;
      const tile=cache.get(name)||mesh(c,r,border,reach===1?16:24);
      cache.delete(name);
      const id=key(c,r);
      if(!drawn.has(id))coverCell?.(c,r,true);
      scene.add(tile);active.set(name,tile);drawn.set(id,tile);
    }
    for(const [name,tile] of active){
      if(keep.has(name))continue;
      scene.remove(tile);active.delete(name);cache.set(name,tile);
      const id=Math.floor(name/32);
      if(drawn.get(id)===tile){
        drawn.delete(id);coverCell?.(id%(cols-1),Math.floor(id/(cols-1)),false);
      }
    }
    for(const [name,tile] of cache){
      if(cache.size<=45)break;
      tile.geometry.dispose();cache.delete(name);
    }
  }
  // Decals use exactly the triangles currently drawn, including their LOD
  // collars. The continuous simulation surface can cross a letter on rough snow.
  function heightAt(x,z){
    const gx=(x-bounds.minX)/dx,gz=(z-bounds.minZ)/dz,c=Math.floor(gx),r=Math.floor(gz);
    const tile=drawn.get(key(c,r));if(!tile)return field.height(x,z);
    const steps=tile.userData.steps,u=(gx-c)*steps,v=(gz-r)*steps;
    const i=Math.min(steps-1,Math.floor(u)),j=Math.min(steps-1,Math.floor(v));
    const fx=u-i,fz=v-j,stride=steps+1,start=i+j*stride;
    const y=tile.geometry.attributes.position.array;
    const h=n=>y[3*(start+n)+1];
    return fx+fz<=1?h(0)*(1-fx-fz)+h(1)*fx+h(stride)*fz:
      h(stride+1)*(fx+fz-1)+h(1)*(1-fz)+h(stride)*(1-fx);
  }
  return {isFixed,locate,heightAt,stepsAt:(c,r)=>drawn.get(key(c,r))?.userData.steps||1,get revision(){return revision;}};
}
