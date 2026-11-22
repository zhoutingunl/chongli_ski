import {clamp} from './mountain.js';

export const LIGHT_EDGE_CLEARANCE=4;
const maximumOffset=42;

export function placePisteLights(data) {
  const widest=data.trails.reduce((max,trail)=>Math.max(max,trail.width||38),0);
  const searchRadius=widest*.5+LIGHT_EDGE_CLEARANCE;
  const lights=[];
  for(const route of data.routes)for(let along=45;along<route.length-15;along+=78){
    const p=route.frame(along),near=data.index.near(p.x,p.z);
    const shoulder=clamp((near.trail?.width||35)*.5,13,31);
    const preferred=route.resort==='genting'?-1:1;
    let light=null;
    for(let offset=shoulder+LIGHT_EDGE_CLEARANCE;offset<=maximumOffset&&!light;offset+=3){
      for(const side of [preferred,-preferred]){
        const rx=-p.dz*side,rz=p.dx*side,x=p.x+rx*offset,z=p.z+rz*offset;
        const overlaps=[...data.index.corridors(x,z,searchRadius)].some(hit=>
          hit.distance<(hit.trail.width||38)*.5+LIGHT_EDGE_CLEARANCE);
        if(overlaps||data.obstacles.contact(x,z))continue;
        if(lights.some(other=>Math.hypot(x-other.x,z-other.z)<46))continue;
        light={x,z,rx,rz,p,shoulder};break;
      }
    }
    if(light)lights.push(light);
  }
  return lights;
}
