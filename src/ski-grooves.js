// Footprints are fixed in terrain coordinates after the tail passes. A sliding
// running edge sweeps an area between successive poses, including underfoot.
import {BufferAttribute,BufferGeometry,Mesh,DynamicDrawUsage} from 'three';
import {cutResponse} from './edge-contact.js';

const cross=[-1.34,-1,-.65,0,.65,1,1.34];
const N=cross.length;
function geometry(capacity,name,material,scene){
  const geometry=new BufferGeometry(),count=capacity*2*N;
  const positions=new BufferAttribute(new Float32Array(count*3),3);
  const normals=new BufferAttribute(new Float32Array(count*3),3);
  const cuts=new BufferAttribute(new Float32Array(count*4),4);
  for(const [key,attribute] of [['position',positions],['normal',normals],['edgeCut',cuts]])
    geometry.setAttribute(key,attribute.setUsage(DynamicDrawUsage));
  const indices=new Uint16Array(capacity*(N-1)*6);
  for(let i=0,k=0;i<capacity;i++)for(let j=0;j<N-1;j++){
    const v=2*N*i+j;
    indices.set([v,v+1,v+N,v+N,v+1,v+N+1],k);k+=6;
  }
  geometry.setIndex(new BufferAttribute(indices,1));geometry.setDrawRange(0,0);
  const mesh=new Mesh(geometry,material);mesh.name=name;mesh.frustumCulled=false;mesh.receiveShadow=true;
  mesh.renderOrder=1;scene.add(mesh);
  let cursor=0,used=0;
  function write(a,b,height){
    const start=cursor*2*N,rows=[a,b];
    const reverse=a.rz*(b.x-a.x)-a.rx*(b.z-a.z)<0;
    for(let j=0;j<rows.length;j++){
      const p=rows[j];
      for(let i=0;i<N;i++){
        const u=cross[reverse?N-1-i:i],ix=start+j*N+i;
        const x=p.x+p.rx*u*p.half,z=p.z+p.rz*u*p.half;
        const wall=!p.scuff&&Math.abs(u)===1&&Math.sign(u)===p.side;
        const lip=wall?p.load*.0045:0,tilt=wall?-p.side*(.13+.30*p.load):0;
        positions.setXYZ(ix,x,height(x,z)+(p.scuff ? .0013 : .0021)+lip,z);
        normals.setXYZ(ix,p.nx+tilt*p.rx,p.ny,p.nz+tilt*p.rz);
        cuts.setXYZW(ix,u,p.load,p.side,p.scuff);
      }
    }
    for(const attr of [positions,normals,cuts]){
      attr.addUpdateRange(start*attr.itemSize,2*N*attr.itemSize);attr.needsUpdate=true;
    }
    cursor=(cursor+1)%capacity;used=Math.min(used+1,capacity);
    geometry.setDrawRange(0,used*(N-1)*6);
  }
  function clear(){cursor=used=0;geometry.setDrawRange(0,0);}
  return {write,clear};
}
function sample(mark,point,width,side){
  return {x:point.x,z:point.z,rx:mark.across.x,rz:mark.across.z,
    nx:mark.normal.x,ny:mark.normal.y,nz:mark.normal.z,half:width*.5,load:mark.weight,side,scuff:0};
}
function scuffRow(foot,slip){
  const dx=foot.fore.x-foot.rear.x,dz=foot.fore.z-foot.rear.z;
  // At ±1.34 the row ends exactly on the released tail and running shovel.
  return {x:(foot.fore.x+foot.rear.x)*.5,z:(foot.fore.z+foot.rear.z)*.5,
    rx:dx/2.68,rz:dz/2.68,half:1,nx:foot.normal.x,ny:foot.normal.y,nz:foot.normal.z,
    load:foot.weight,side:0,scuff:Math.min(1,slip*3.4)};
}
function between(a,b,t){
  const row={};for(const key in a)row[key]=a[key]+(b[key]-a[key])*t;
  return row;
}

export function skiGrooves(scene,data,material){
  const history=geometry(2048,'Packed ski grooves',material,scene);
  const live=geometry(4,'Working ski edges',material,scene);
  const previous=[null,null],response=[null,null];
  function lift(){previous.fill(null);response.fill(null);live.clear();}
  return {response,lift,reset(){lift();history.clear();},update(feet,p,dimensions,dt){
    live.clear();
    for(let i=0;i<2;i++){
      const foot=feet[i];let old=previous[i];
      if(!foot?.active||p.airborne){previous[i]=response[i]=null;continue;}
      if(old&&old.boot.distanceTo(foot.boot)>Math.max(1.1,p.speed*dt*2.6))old=null;
      const feel=cutResponse(foot,old||foot,dt,p.speed,dimensions.waistWidth);
      response[i]=feel;
      const side=Math.abs(feel.sideSpeed)>1?Math.sign(feel.sideSpeed):-Math.sign(foot.edgeAngle)||1;
      const back=sample(foot,foot.rear,feel.edgeWidth,side),waist=sample(foot,foot.boot,feel.edgeWidth,side);
      const front=sample(foot,foot.fore,feel.edgeWidth,side),scrape=scuffRow(foot,feel.slip);
      if(old){
        if(feel.slip>.04)history.write(old.scrape,scrape,data.height);
        const d=old.rear.distanceTo(foot.rear),steps=Math.max(1,Math.ceil(d/.22));
        let last=old.row;
        for(let n=1;n<=steps;n++){
          const next=n===steps?back:between(old.row,back,n/steps);
          history.write(last,next,data.height);last=next;
        }
      }
      live.write(back,waist,data.height);live.write(waist,front,data.height);
      previous[i]={rear:foot.rear.clone(),boot:foot.boot.clone(),row:back,scrape};
    }
  }};
}
