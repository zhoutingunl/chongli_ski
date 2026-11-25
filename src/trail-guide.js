import * as THREE from 'three';
import {SkiRoute} from './mountain.js';

const colors={easy:'#216647',intermediate:'#175a81',advanced:'#1b2f3a',expert:'#202b37'};
const ink='#173540',rim='#f5f2de';
const chinese='"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif';
const latin='"Arial Narrow","Helvetica Neue",Arial,sans-serif';
const tileWidth=512,tileHeight=216;
const signedAngle=a=>Math.atan2(Math.sin(a),Math.cos(a));
const nameOf=s=>(s||'').split(/\s*·\s*/)[0].trim();
const move=(p,h,forward,right=0)=>[
  p[0]+Math.sin(h)*forward+Math.cos(h)*right,
  p[1]-Math.cos(h)*forward+Math.sin(h)*right,
];

function arrow(c,x,y,stencil,grade){
  // Read the directional symbol in the same approach-facing stencil as its
  // name. Its bend depicts the measured turn from the incoming to the exit.
  const angle=stencil.turn,dx=Math.sin(angle),dy=-Math.cos(angle),color=colors[grade];
  const tipX=.88*dx,tipY=.88*dy-.055,baseX=-.34*dx;
  const shape=new Path2D();shape.moveTo(baseX,.84);shape.lineTo(baseX,.32);
  shape.quadraticCurveTo(baseX,-.02,tipX-.45*dx,tipY-.45*dy);shape.lineTo(tipX,tipY);
  shape.moveTo(tipX-.54*dx-.39*dy,tipY-.54*dy+.39*dx);
  shape.lineTo(tipX,tipY);shape.lineTo(tipX-.54*dx+.39*dy,tipY-.54*dy-.39*dx);
  c.save();c.translate(x,y);c.scale(52,73);c.lineJoin='round';c.lineCap='round';
  c.lineWidth=.46;c.strokeStyle=rim;c.stroke(shape);c.lineWidth=.34;c.strokeStyle=color;c.stroke(shape);
  // The difficulty symbol is punched into the shaft rather than beside the name.
  c.translate(baseX,.63);c.fillStyle=rim;c.beginPath();
  if(grade==='easy')c.arc(0,0,.103,0,2*Math.PI);
  else if(grade==='intermediate')c.rect(-.09,-.09,.18,.18);
  else {
    const radius=grade==='expert'?.065:.118;
    for(const cx of grade==='expert'?[-.069,.069]:[0]){
      c.moveTo(cx,-radius);c.lineTo(cx+radius,0);c.lineTo(cx,radius);c.lineTo(cx-radius,0);c.closePath();
    }
  }
  c.fill();c.restore();
}
function title(c,text,x,y,natural,width,color,outline){
  c.save();c.translate(x,y);c.scale(width/natural,1);c.lineJoin='round';
  c.strokeStyle=rim;c.lineWidth=outline;c.strokeText(text,0,0);
  c.strokeStyle=color;c.lineWidth=1.3;c.strokeText(text,0,0);c.fillStyle=color;c.fillText(text,0,0);c.restore();
}
function drawStencil(c,stencil,language){
  const opt=stencil.option,grade=colors[opt.difficulty]?opt.difficulty:'intermediate',en=language==='en';
  const text=en?opt.en||opt.name:opt.name,full=nameOf(text),badge=stencil.status;
  const name=badge?full.replace(/[（(].*?[）)]/g,'').trim():full,face=en?latin:chinese;
  const destination=text.split(/\s*·\s*/).slice(1).find(s=>/^(至|通往|往|to\s|toward)/i.test(s))||'';
  c.font='850 '+(en?86:91)+'px '+face;c.textBaseline='middle';c.textAlign='left';
  const natural=Math.max(1,c.measureText(name).width),textWidth=Math.min(342,natural);
  const gutter=14,arrowWidth=104,left=(tileWidth-arrowWidth-gutter-textWidth)/2,mid=tileHeight/2;
  const arrowAfter=stencil.lateral<-1,textX=arrowAfter?left:left+arrowWidth+gutter;
  // An arrow rests at the inside edge of each side lane, close to the name.
  arrow(c,(arrowAfter?left+textWidth+gutter:left)+arrowWidth/2,mid,stencil,grade);
  const qualifier=full.match(/[（(](.+?)[）)]/)?.[1];
  const fresh=badge==='new',status=fresh?(en?'NEW':'未滑过'):(en?'✓ VISITED':'✓ 已滑过');
  const via=opt.destination?(en?'to Peony':'至'+opt.destination):'';
  const sub=badge?[status,qualifier||via].filter(Boolean).join(' · '):destination;
  title(c,name,textX,sub?mid-22:mid,natural,textWidth,fresh?'#9d3710':ink,6);
  if(sub){
    const note=en?sub.replace(/^to\b/i,'To'):sub;
    c.font='760 53px '+face;const w=Math.max(1,c.measureText(note).width);
    title(c,note,textX,mid+50,w,Math.min(w,Math.max(textWidth,228)),fresh?'#9d3710':colors[grade],6);
  }
}

function makeGrain(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
  const c=canvas.getContext('2d'),image=c.createImageData(64,64);let seed=17203;
  for(let i=3;i<image.data.length;i+=4){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const n=seed/4294967296;image.data[i]=n>.95?66:n>.68?27:8;
  }
  c.putImageData(image,0,0);return canvas;
}
function makeInk(renderer){
  const canvas=document.createElement('canvas'),grain=makeGrain();
  const limit=renderer?.capabilities?.maxTextureSize||2048;
  const material=new THREE.MeshLambertMaterial({transparent:true,opacity:.96,depthTest:true,depthWrite:false,alphaTest:.035,
    polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2,emissive:0xffffff,emissiveIntensity:.1});
  let texture=null;
  function paintChoices(stencils,language){
    const columns=stencils.length,cell=Math.min(tileWidth,Math.floor(limit/columns));
    if(!texture||canvas.width!==columns*cell){
      texture?.dispose();canvas.width=columns*cell;canvas.height=tileHeight;
      texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      texture.anisotropy=Math.min(12,renderer?.capabilities?.getMaxAnisotropy?.()||4);
      material.map=material.emissiveMap=texture;material.needsUpdate=true;
    }
    const c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);
    stencils.forEach((stencil,i)=>{
      c.save();c.translate(i*cell,0);c.scale(cell/tileWidth,1);drawStencil(c,stencil,language);c.restore();
    });
    c.save();c.globalCompositeOperation='destination-out';c.fillStyle=c.createPattern(grain,'repeat');c.fillRect(0,0,canvas.width,canvas.height);c.restore();
    texture.repeat.set(1/columns,1);texture.needsUpdate=true;
  }
  return {material,paintChoices,dispose(){texture?.dispose();material.dispose();}};
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
function atUV(stencil,u,v){
  const p=stencil.projector,side=(stencil.lateral+(u-.5)*stencil.width)/p.distance;
  const dx=p.sine+side*p.cosine,dz=-p.cosine+side*p.sine,dy=p.grade+(v-.5)*p.aperture;
  // Cast from a fixed point on the approach. Each glyph's horizontal strokes
  // stay level even where the piste falls away across the skier's line of sight.
  // The ray is only used while baking the mesh. The paint stays in world space.
  const point=t=>[p.x+t*dx,p.z+t*dz];
  if(stencil.radial)return point(p.distance/(1-(v-.5)*1.32));
  const clearance=t=>p.eye+t*dy-p.height(p.x+t*dx,p.z+t*dz);
  const far=p.distance*2.45,step=far/14;
  let near=0;
  for(let i=1;i<=14;i++){
    let end=i*step;
    if(clearance(end)<=0){
      for(let j=0;j<9;j++){
        const mid=(near+end)*.5;if(clearance(mid)>0)near=mid;else end=mid;
      }
      return point((near+end)*.5);
    }
    near=end;
  }
  return point(far);
}
function prepareProjection(stencil,data){
  const {center,heading,lateral,readingDistance}=stencil;
  // Repeated junction marks are read on approach even when the decision area
  // itself extends farther back than the part of the slope used for printing.
  const d=Math.min(13,readingDistance),[x,z]=move(center,heading,-d,-lateral);
  const eye=data.height(x,z)+1.48;
  stencil.projector={x,z,eye,height:data.height,distance:d,sine:Math.sin(heading),cosine:Math.cos(heading),
    grade:(data.height(...center)-eye)/d,aperture:stencil.aperture};
}
function makeGeometry(data,stencils,detail){
  const positions=[],normals=[],uv=[],indices=[],field=data.field,b=field.bounds,height=detail?.heightAt||data.height,ranges=[];
  function patch(poly,slot){
    const start=positions.length/3;
    for(const [x,z,u,v] of poly){
      const nx=height(x-.35,z)-height(x+.35,z),nz=height(x,z-.35)-height(x,z+.35),len=Math.hypot(nx,.7,nz);
      positions.push(x,height(x,z)+.006,z);normals.push(nx/len,.7/len,nz/len);uv.push(slot+u,v);
    }
    for(let i=1;i<poly.length-1;i++)indices.push(start,start+i,start+i+1);
  }
  function conform(poly,slot,left=b.minX,top=b.minZ,dx=field.dx,dz=field.dz,coarse=true){
    const gx=poly.map(q=>Math.floor((q[0]-left)/dx)),gz=poly.map(q=>Math.floor((q[1]-top)/dz));
    for(let r=Math.min(...gz);r<=Math.max(...gz);r++)for(let c=Math.min(...gx);c<=Math.max(...gx);c++){
      const x=left+c*dx,z=top+r*dz;
      let p=clip(poly,q=>q[0]-x);p=clip(p,q=>x+dx-q[0]);p=clip(p,q=>q[1]-z);p=clip(p,q=>z+dz-q[1]);
      if(p.length<3)continue;
      const steps=coarse&&detail?.stepsAt(c,r);
      if(steps>1){conform(p,slot,x,z,dx/steps,dz/steps,false);continue;}
      const diagonal=q=>1-(q[0]-x)/dx-(q[1]-z)/dz;
      for(const sign of [1,-1]){const part=clip(p,q=>sign*diagonal(q));if(part.length>=3)patch(part,slot);}
    }
  }
  stencils.forEach((stencil,slot)=>{
    const start=indices.length;
    const nx=4,ny=8,grid=[];
    for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
      const u=i/nx,v=j/ny;grid.push([...atUV(stencil,u,v),u,v]);
    }
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const a=i+j*(nx+1);conform([grid[a],grid[a+1],grid[a+nx+2],grid[a+nx+1]],slot);
    }
    ranges.push([start,indices.length]);
  });
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  const source=new Uint16Array(indices);geometry.setIndex(new THREE.BufferAttribute(source.slice(),1).setUsage(THREE.DynamicDrawUsage));
  geometry.computeBoundingSphere();return {geometry,source,ranges};
}

const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const bearing=(a,b)=>Math.atan2(b[0]-a[0],a[1]-b[1]);
const finitePoint=p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1]);

function uniqueExits(site){
  const ids=new Set(),names=new Set(),exits=[];
  for(const o of site.options||[]){
    const name=nameOf(o.name),id=o.choiceId||o.routeId;
    if(!o.selectable||o.role==='incoming'||!name||!id||!Number.isFinite(o.heading)||ids.has(id)||names.has(name))continue;
    ids.add(id);names.add(name);exits.push(o);
  }
  return exits;
}
function radialStencil(site,option){
  const hub=site.position,target=finitePoint(option.position)?option.position:move(hub,option.heading,15);
  const center=finitePoint(option.paintPosition)?option.paintPosition:move(hub,bearing(hub,target),Math.min(16,Math.max(8,distance(hub,target))));
  const readingDistance=Math.max(4,distance(hub,center)),heading=bearing(hub,center);
  // Every mouth has a fixed reading direction from the apron. Looking left or
  // right reveals the print on that patch of snow without rotating the print.
  return {option,center,heading,radial:true,turn:signedAngle(option.heading-heading),lateral:0,readingDistance,
    width:Math.min(6.8,Math.max(3.8,readingDistance*.47)),aperture:.167};
}
function approachFrame(site,track){
  const p=site.position,h=site.approach;
  if(!track)return {center:move(p,h,-25),heading:h};
  const nearest=track.closest(...p);
  if(nearest.distance>3)return {center:move(p,h,-25),heading:h};
  const s=nearest.along,back=track.at(Math.max(0,s-25)),front=track.at(Math.min(track.length,s+25));
  const chooseBack=s>1&&(track.length-s<1||Math.abs(signedAngle(bearing([back.x,back.z],p)-h))<=Math.abs(signedAngle(bearing([front.x,front.z],p)-h)));
  const sign=chooseBack?1:-1,room=chooseBack?s:track.length-s;
  const range=Math.min(32,Math.max(0,room)*.52),f=track.frame(s-sign*range);
  return {center:[f.x,f.z],heading:sign>0?f.angle:signedAngle(f.angle+Math.PI)};
}
function layOutChoices(tracks,site,exits){
  if(!exits.length)return [];
  if(site.type==='summit')return exits.map(o=>radialStencil(site,o));
  const track=tracks.get(site.fromTrailId),{center,heading}=approachFrame(site,track);
  const count=exits.length,snowWidth=track?.width||30,spacing=Math.min(count>2?5.6:6.15,snowWidth*.76/count),width=Math.min(6.8,spacing*1.04);
  return exits.slice().sort((a,b)=>signedAngle(a.heading-heading)-signedAngle(b.heading-heading)).map((option,i)=>{
    if(finitePoint(option.paintPosition))return radialStencil(site,option);
    const middle=count>1&&count%2===1&&i===(count-1)/2,lateral=(i-(count-1)/2)*spacing+(middle?1.62:0);
    return {option,heading,center:move(center,heading,middle?2.3:0,lateral),turn:signedAngle(option.heading-heading),
      width,aperture:.126,lateral,readingDistance:9.5+(middle?2.3:0)};
  });
}
function groundPoint(data,p){return new THREE.Vector3(p[0],data.height(...p)+.006,p[1]);}

export function createTrailGuide(scene,data,renderer,progress,detail){
  const root=new THREE.Group();root.name='Snow trail markings';root.visible=false;scene.add(root);
  const ink=makeInk(renderer),light=scene.children.find(o=>o.isHemisphereLight);
  const tracks=new Map(),matrix=new THREE.Matrix4(),clipPoint=new THREE.Vector4(),forward=new THREE.Vector3(),eye=new THREE.Vector3();
  let mesh=null,batch=null,key='',marks=[],language='',lastMask='',terrainRevision;
  function load(site,exits){
    if(mesh){mesh.removeFromParent();mesh.geometry.dispose();mesh=null;}
    const id=site.fromTrailId;
    if(id&&!tracks.has(id)){const raw=data.trails.find(t=>t.id===id);tracks.set(id,raw?new SkiRoute(raw,data):null);}
    marks=layOutChoices(tracks,site,exits);lastMask='';language='';
    if(!marks.length){batch=null;return;}
    for(const m of marks){
      prepareProjection(m,data);
      m.center3=groundPoint(data,m.center);
      // Test both ends of the name/arrow unit. A label touching a side of
      // the viewport disappears as a unit instead of leaving a lone arrow.
      m.left=groundPoint(data,atUV(m,.105,.50));m.right=groundPoint(data,atUV(m,.895,.50));
      m.mouth=finitePoint(m.option.position)?groundPoint(data,m.option.position):null;
    }
    batch=makeGeometry(data,marks,detail);mesh=new THREE.Mesh(batch.geometry,ink.material);
    mesh.name=(site.type==='summit'?'Piste summit · ':'Piste fork · ')+site.id;mesh.renderOrder=1;mesh.receiveShadow=true;root.add(mesh);
  }
  function inView(point,sideLimit,verticalLimit){
    clipPoint.set(point.x,point.y,point.z,1).applyMatrix4(matrix);
    const w=clipPoint.w;
    return w>.1&&clipPoint.z>=-w&&clipPoint.z<=w&&Math.abs(clipPoint.x)<sideLimit*w&&Math.abs(clipPoint.y)<verticalLimit*w;
  }
  function update(sim,navigation,locale='zh',camera){
    const site=navigation?.nearbyChoices?.(sim);
    if(!site||!finitePoint(site.position)){root.visible=false;if(mesh)mesh.visible=false;return;}
    const exits=uniqueExits(site);
    // The observed incoming piste can change at one junction during free skiing.
    // Its surveyed geometry owns the paint independently of the selected itinerary.
    const nextKey=[site.type,site.siteId||site.id,site.fromTrailId||'',Math.round(site.approach*90),...exits.map(o=>[o.choiceId||o.routeId,o.name,o.en,o.difficulty,Math.round(o.heading*90),o.paintPosition||o.position].join('/'))].join('|');
    if(key!==nextKey){key=nextKey;load(site,exits);}
    else if(mesh&&terrainRevision!==detail?.revision){
      mesh.geometry.dispose();batch=makeGeometry(data,marks,detail);mesh.geometry=batch.geometry;lastMask='';
    }
    terrainRevision=detail?.revision;
    if(!mesh){root.visible=false;return;}
    const next=locale==='en'?'en':'zh';
    for(const mark of marks)mark.status=site.type==='summit'?progress?.status(site.resort,mark.option):null;
    const variant=next+'|'+marks.map(m=>m.status||'').join(',');
    if(language!==variant){ink.paintChoices(marks,next);language=variant;}
    if(light)ink.material.emissiveIntensity=.085+Math.max(0,1.35-light.intensity)*.38;
    let halfView=0,flat=0;
    if(camera){
      camera.updateWorldMatrix(true,false);matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
      eye.setFromMatrixPosition(camera.matrixWorld);forward.setFromMatrixColumn(camera.matrixWorld,2).negate();
      flat=Math.hypot(forward.x,forward.z);halfView=1/Math.hypot(1,1.26/camera.projectionMatrix.elements[0]);
    }
    const visible=marks.map(m=>{
      if(!camera)return true;
      if(!inView(m.center3,.99,1.035)||!inView(m.left,1.025,1.13)||!inView(m.right,1.025,1.13))return false;
      if(site.type==='summit'||!m.mouth||flat<.25)return true;
      const dx=m.mouth.x-eye.x,dz=m.mouth.z-eye.z;
      return Math.hypot(dx,dz)<3||dx*forward.x+dz*forward.z>=halfView*Math.hypot(dx,dz)*flat;
    });
    const mask=visible.map(x=>x?'1':'0').join('');
    if(mask!==lastMask){
      const index=batch.geometry.index;let count=0;
      visible.forEach((on,i)=>{if(on){const [start,end]=batch.ranges[i];index.array.set(batch.source.subarray(start,end),count);count+=end-start;}});
      if(count){index.addUpdateRange(0,count);index.needsUpdate=true;}batch.geometry.setDrawRange(0,count);lastMask=mask;
    }
    root.visible=mesh.visible=batch.geometry.drawRange.count>0;
  }
  function dispose(){mesh?.geometry.dispose();ink.dispose();root.removeFromParent();}
  return {update,dispose,hide(){root.visible=false;}};
}
