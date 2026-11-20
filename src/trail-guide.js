import * as THREE from 'three';
import {SkiRoute} from './mountain.js';

const grades={
  easy: ['初级','Easy','#216647'], intermediate:['中级','Intermediate','#175a81'],
  advanced:['高级','Advanced','#1b2f3a'], expert:['专家','Expert','#202b37'],
};
const snowRim='#f3f1dd',ink='#183642';
const typeface='"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",Arial,sans-serif';
const latin='"Arial Narrow","Helvetica Neue",Arial,sans-serif';
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const bearing=(a,b)=>Math.atan2(b[0]-a[0],a[1]-b[1]);
const move=(p,h,forward,right=0)=>[
  p[0]+Math.sin(h)*forward+Math.cos(h)*right,
  p[1]-Math.cos(h)*forward+Math.sin(h)*right,
];
const xy=f=>[f.x,f.z];
const gradeOf=o=>grades[o.difficulty]?o.difficulty:'intermediate';

function makeGrain() {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
  const c=canvas.getContext('2d'),image=c.createImageData(64,64);
  let state=17203;
  for(let i=3;i<image.data.length;i+=4){
    state=(Math.imul(state,1664525)+1013904223)>>>0;
    const n=state/4294967296;
    image.data[i]=n>.95?68:n>.68?29:9;
  }
  c.putImageData(image,0,0);return canvas;
}
function polygon(c,points){
  c.beginPath();c.moveTo(...points[0]);for(const p of points.slice(1))c.lineTo(...p);c.closePath();
}
function paint(c,color,rim=5){
  c.strokeStyle=snowRim;c.lineWidth=rim;c.lineJoin='round';c.stroke();c.fillStyle=color;c.fill();
}
function gradeSymbol(c,grade,x,y){
  const color=grades[grade][2];c.beginPath();
  if(grade==='easy')c.arc(x,y,15,0,2*Math.PI);
  else if(grade==='intermediate')c.rect(x-13,y-13,26,26);
  else{
    const both=grade==='expert',r=both?9:18;
    for(const d of both?[-11,11]:[0]){c.moveTo(x+d,y-r);c.lineTo(x+d+r,y);c.lineTo(x+d,y+r);c.lineTo(x+d-r,y);c.closePath();}
  }
  paint(c,color,5);
}
function fittedText(c,text,x,y,maxW,size,weight,face,color,outline){
  c.font=weight+' '+size+'px '+face;
  const w=c.measureText(text).width,scale=Math.min(1,maxW/Math.max(1,w));
  c.save();c.translate(x,y);c.scale(scale,1);c.lineJoin='round';
  c.strokeStyle=snowRim;c.lineWidth=outline;c.strokeText(text,0,0);
  c.strokeStyle=color;c.lineWidth=1.25;c.strokeText(text,0,0);c.fillStyle=color;c.fillText(text,0,0);c.restore();
}
function drawTile(c,def,lang){
  const grade=gradeOf(def),color=grades[grade][2],en=lang==='en';
  if(def.kind==='name'){
    const parts=(en?def.en||def.name:def.name).split(/\s*·\s*/),title=parts.shift()||'';
    const aux=[grades[grade][en?1:0],def.incoming?(en?'Merge':'汇入'):'',parts.join(' · ')].filter(Boolean).join(' · ');
    gradeSymbol(c,grade,27,55);
    c.textBaseline='middle';c.textAlign='left';
    fittedText(c,title,50,54,321,en?79:83,850,en?latin:typeface,ink,5.8);
    fittedText(c,aux,52,113,318,39,760,en?latin:typeface,color,5);
    return;
  }
  // Road symbols have their own real world bearing; the printed type may face
  // the reader even when the source piste joins from the opposite shoulder.
  c.translate(192,76);c.scale(2.72,1);c.lineJoin='round';c.lineCap='round';
  if(def.kind==='merge'){
    c.scale(def.side,1);
    const strokes=()=>{c.beginPath();c.moveTo(12,60);c.lineTo(12,-55);c.moveTo(-40,48);c.bezierCurveTo(-40,21,-17,19,12,-9);};
    strokes();c.strokeStyle=snowRim;c.lineWidth=22;c.stroke();strokes();c.strokeStyle=color;c.lineWidth=14;c.stroke();
    polygon(c,[[-15,-28],[12,-66],[39,-28]]);paint(c,color,3);
    return;
  }
  polygon(c,[[-49,-3],[0,-66],[49,-3],[29,-6],[13,-23],[13,59],[-13,59],[-13,-23],[-29,-6]]);
  paint(c,color,5);
}

// UVs use units of atlas cells. Adding the few extra named arms reachable
// from an optional itinerary changes a texture transform, not existing meshes.
function makeAtlas(renderer){
  const canvas=document.createElement('canvas'),grain=makeGrain(),slots=new Map(),defs=[];
  const limit=Math.min(renderer?.capabilities?.maxTextureSize||2048,2048);
  const columns=5,cellW=Math.min(384,Math.floor(limit/columns));
  const material=new THREE.MeshLambertMaterial({transparent:true,opacity:.96,depthTest:true,depthWrite:false,alphaTest:.035,
    polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2,emissive:0xffffff,emissiveIntensity:.10});
  let texture=null,language='',count=-1;
  function slot(def){
    const key=def.kind+'|'+gradeOf(def)+'|'+(def.side||0)+'|'+(def.incoming?1:0)+'|'+(def.name||'')+'|'+(def.en||'');
    if(!slots.has(key)){slots.set(key,defs.length);defs.push(def);}
    return slots.get(key);
  }
  function apply(lang){
    if(language===lang&&count===defs.length)return;
    const rows=Math.max(1,Math.ceil(defs.length/columns)),cellH=Math.min(152,Math.floor(limit/rows));
    if(!texture||canvas.height!==rows*cellH){
      texture?.dispose();canvas.width=columns*cellW;canvas.height=rows*cellH;
      texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      texture.anisotropy=Math.min(12,renderer?.capabilities?.getMaxAnisotropy?.()||4);
      material.map=material.emissiveMap=texture;material.needsUpdate=true;
    }
    const c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);
    defs.forEach((def,i)=>{
      const x=(i%columns)*cellW,y=(rows-1-Math.floor(i/columns))*cellH;
      c.save();c.translate(x,y);c.scale(cellW/384,cellH/152);drawTile(c,def,lang);c.restore();
    });
    c.save();c.globalCompositeOperation='destination-out';c.fillStyle=c.createPattern(grain,'repeat');c.fillRect(0,0,canvas.width,canvas.height);c.restore();
    texture.repeat.set(1/columns,1/rows);texture.needsUpdate=true;language=lang;count=defs.length;
  }
  return {slot,apply,material,columns,dispose(){texture?.dispose();material.dispose();}};
}

function clip(points,side){
  const out=[];if(!points.length)return out;
  let a=points.at(-1),da=side(a);
  for(const b of points){
    const db=side(b),ia=da>=0,ib=db>=0;
    if(ia!==ib){const t=da/(da-db);out.push(a.map((v,i)=>v+t*(b[i]-v)));}
    if(ib)out.push(b);a=b;da=db;
  }
  return out;
}

class SnowPrints{
  constructor(data,atlas){this.data=data;this.atlas=atlas;this.pos=[];this.norm=[];this.uv=[];this.indices=[];}
  patch(poly,slot){
    const ii=this.pos.length/3,col=slot%this.atlas.columns,row=Math.floor(slot/this.atlas.columns),height=this.data.height;
    for(const [x,z,u,v] of poly){
      const y=height(x,z),nx=height(x-.35,z)-height(x+.35,z),nz=height(x,z-.35)-height(x,z+.35),len=Math.hypot(nx,.7,nz);
      this.pos.push(x,y+.006,z);this.norm.push(nx/len,.7/len,nz/len);
      this.uv.push(col+.008+.984*u,row+.015+.970*v);
    }
    for(let i=1;i<poly.length-1;i++)this.indices.push(ii,ii+i,ii+i+1);
  }
  quad(p,heading,w,len,def,reader=null){
    const vertex=(u,v)=>{
      const forward=(v-.5)*len,across=(u-.5)*w;
      // Cross strokes stay parallel to the piste. Uprights on the outer lanes
      // fan out along the sightline, like elongated lettering on a real road.
      const slant=reader?forward*(reader.lateral+across*.64)/reader.distance:0;
      return [...move(p,heading,forward,across+slant),u,v];
    };
    const slot=this.atlas.slot(def),bands=reader?3:1,columns=reader?2:1;
    for(let j=0;j<bands;j++)for(let i=0;i<columns;i++){
      const u=i/columns,v=j/bands,s=(i+1)/columns,t=(j+1)/bands;
      this.conform([vertex(u,v),vertex(s,v),vertex(s,t),vertex(u,t)],slot);
    }
  }
  conform(source,slot){
    const field=this.data.field,b=field.bounds,dx=field.dx,dz=field.dz;
    const gx=source.map(q=>Math.floor((q[0]-b.minX)/dx)),gz=source.map(q=>Math.floor((q[1]-b.minZ)/dz));
    for(let ir=Math.min(...gz);ir<=Math.max(...gz);ir++)for(let ic=Math.min(...gx);ic<=Math.max(...gx);ic++){
      const x=b.minX+ic*dx,z=b.minZ+ir*dz;
      let poly=clip(source,q=>q[0]-x);poly=clip(poly,q=>x+dx-q[0]);poly=clip(poly,q=>q[1]-z);poly=clip(poly,q=>z+dz-q[1]);
      if(poly.length<3)continue;
      // Match the two DEM triangles exactly, including their shared diagonal.
      const diagonal=q=>1-(q[0]-x)/dx-(q[1]-z)/dz;
      for(const sign of [1,-1]){
        const part=clip(poly,q=>sign*diagonal(q));if(part.length>=3)this.patch(part,slot);
      }
    }
  }
  mesh(label){
    if(!this.indices.length)return null;
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(this.pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(this.norm,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(this.uv,2));g.setIndex(this.indices);g.computeBoundingSphere();
    const mesh=new THREE.Mesh(g,this.atlas.material);mesh.name=label;mesh.renderOrder=1;mesh.receiveShadow=true;return mesh;
  }
}

const label=(o,incoming=false)=>({kind:'name',difficulty:o.difficulty,name:o.name,en:o.en,incoming});
const arrow=(o,side=0)=>({kind:side?'merge':'arrow',difficulty:o.difficulty,side});
function paintRow(batch,center,heading,site,width,summit=false){
  const options=[...site.options].sort((a,b)=>wrap(a.heading-heading)-wrap(b.heading-heading));
  const spacing=Math.min(summit?3.23:options.length===2?6.0:5.0,width/Math.max(options.length,1));
  for(let i=0;i<options.length;i++){
    const o=options[i],middle=options.length%2===1&&i===(options.length-1)/2;
    const stagger=middle&&options.length>1?(summit?4.2:5.1):0;
    const lateral=(i-(options.length-1)/2)*spacing+(middle?(summit?1.70:2.65):0);
    const w=middle?Math.min(4.15,width*.60):Math.min(summit?3.62:4.2,spacing*1.12);
    const l=summit?(stagger?6.45:4.9):(stagger?6.4:5.3);
    const p=move(center,heading,stagger,lateral),inkPos=move(p,heading,l*.49+1.12);
    const incoming=o.role==='incoming',flow=site.current?.heading??site.approach;
    const side=incoming?(Math.sin(o.heading-flow)>0?-1:1):0;
    batch.quad(p,heading,w,l,label(o,incoming),{distance:(summit?7.35:7.7)+stagger,lateral});
    batch.quad(inkPos,incoming?flow:o.heading,stagger?2.4:summit?1.92:2.13,stagger?3.55:summit?2.65:3.0,arrow(o,side));
  }
}

export function createTrailGuide(scene,data,renderer){
  const root=new THREE.Group();root.name='Snow trail markings';scene.add(root);
  const atlas=makeAtlas(renderer),sites=new Map(),arms=new Map(),paths=new Map();
  const nearLight=scene.children.find(o=>o.isHemisphereLight);
  let known=null,previous=null,route=null,frameX=Infinity,frameZ=Infinity,current=null,lang='';
  function addMesh(mesh){if(mesh){mesh.visible=false;root.add(mesh);}return mesh;}
  function armFrom(opt,site){
    const t=paths.get(opt.trailId);if(!t)return null;
    const near=t.closest(...site.position);if(near.distance>1.4)return null;
    const dir=opt.role==='incoming'?-1:1,room=dir>0?t.length-near.along:near.along;
    if(room<5)return null;
    return {room,frame(d){return t.frame(near.along+dir*d);}};
  }
  function addArm(site,opt,frameAt,limit,summit){
    const d=Math.min(summit?18.5:15.5,limit*.65),f=frameAt(d),p=xy(f);
    if(data.obstacles?.contact(...p))return;
    // Shared outgoing legs only carry one marking even if two routes enter the junction.
    const key=opt.trailId+'|'+Math.round(p[0]/2)+'|'+Math.round(p[1]/2)+'|'+opt.role?.startsWith('incoming');
    if(arms.has(key))return;
    const batch=new SnowPrints(data,atlas);
    const excess=1.45,print=move(p,f.angle,0,excess);
    batch.quad(print,f.angle,summit?3.6:4.0,summit?4.8:5.25,label(opt),{lateral:excess,distance:8.6});
    batch.quad(move(print,f.angle,3.75),f.angle,1.85,2.8,arrow(opt));
    if(limit>d+17){const next=frameAt(d+15);batch.quad(xy(next),next.angle,1.25,2.5,arrow(opt));}
    const mesh=addMesh(batch.mesh('Piste arm · '+opt.name));
    arms.set(key,{p,mesh});
  }
  function addSite(site,path,nav){
    if(!site?.options?.length||sites.has(site.id))return;
    const summit=site.type==='summit',batch=new SnowPrints(data,atlas);
    const p=site.position,approach=site.approach;
    if(summit){
      paintRow(batch,move(p,approach,6.42),approach,site,12.4,true);
      for(const o of site.options){
        const exit=nav.departure(site.resort,...p,o.heading,o.routeId);
        if(exit)addArm(site,o,d=>exit.frame(d),Math.min(45,exit.length),true);
      }
    }else{
      if(!path)return;
      const closest=path.closest(...p);if(closest.distance>1.5)return;
      const s=closest.along,enter=paths.get(site.fromTrailId),width=(enter?.width||31)*.70;
      const leads=site.type==='fork'?[79,43,12]:[47,12];
      for(const lead of leads){
        if(s<lead+1.2)continue;
        const f=path.frame(s-lead);paintRow(batch,xy(f),f.angle,site,width);
      }
      for(const o of site.options){const arm=armFrom(o,site);if(arm)addArm(site,o,arm.frame,arm.room,false);}
    }
    sites.set(site.id,{id:site.id,geo:site.siteId,p,summit,approach,mesh:addMesh(batch.mesh('Piste approach · '+site.id))});
  }
  function prepare(nav){
    for(const t of data.trails)paths.set(t.id,new SkiRoute(t,data));
    for(const side of Object.keys(data.summitPlaces)){
      const route=data.routes.find(r=>r.resort===side);
      if(route)addSite(nav.guidance({mode:'summit',route}),route,nav);
    }
    for(const r of data.routes)for(const site of nav.guidanceOn(r))addSite(site,r,nav);
    known=nav;
  }
  function update(sim,navigation,language='zh'){
    if(!navigation||!sim?.route){root.visible=false;return;}
    if(!known)prepare(navigation);
    root.visible=true;
    const local=language==='en'?'en':'zh';
    if(nearLight)atlas.material.emissiveIntensity=.085+Math.max(0,1.35-nearLight.intensity)*.38;
    // World footprints are stationary. Only the relevant approach sequence and the
    // nearby real branch markings need drawing; looking around never rotates the paint.
    const moved=Math.hypot(sim.x-frameX,sim.z-frameZ);
    if(route===sim.route && current===sim.mode && lang===local && moved<1.4)return;
    const context=navigation.guidance(sim);
    if(context&&!sites.has(context.id)){
      const r=sim.route.closest(...context.position).distance<1.5?sim.route:paths.get(context.fromTrailId);
      addSite(context,r,navigation);
    }
    if(context)previous=context.id;
    const p=[sim.x,sim.z];
    for(const s of sites.values()){
      if(!s.mesh)continue;
      const d=distance(p,s.p);
      s.mesh.visible=s.summit?d<58:context?.id===s.id&&d<175||!context&&s.id===previous&&d<34;
    }
    for(const a of arms.values())if(a.mesh)a.mesh.visible=distance(p,a.p)<108;
    atlas.apply(local);frameX=sim.x;frameZ=sim.z;route=sim.route;current=sim.mode;lang=local;
  }
  function dispose(){root.traverse(o=>o.geometry?.dispose());atlas.dispose();root.removeFromParent();}
  return {update,dispose};
}
