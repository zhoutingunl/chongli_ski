import * as THREE from 'three';

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
  const text=en?opt.en||opt.name:opt.name,name=nameOf(text),face=en?latin:chinese;
  const destination=text.split(/\s*·\s*/).slice(1).find(s=>/^(至|通往|往|to\s|toward)/i.test(s))||'';
  c.font='850 '+(en?86:91)+'px '+face;c.textBaseline='middle';c.textAlign='left';
  const natural=Math.max(1,c.measureText(name).width),textWidth=Math.min(342,natural);
  const gutter=14,arrowWidth=104,left=(tileWidth-arrowWidth-gutter-textWidth)/2,mid=tileHeight/2;
  const arrowAfter=stencil.lateral<-1,textX=arrowAfter?left:left+arrowWidth+gutter;
  // An arrow rests at the inside edge of each side lane, close to the name.
  arrow(c,(arrowAfter?left+textWidth+gutter:left)+arrowWidth/2,mid,stencil,grade);
  title(c,name,textX,destination?mid-23:mid,natural,textWidth,ink,6);
  if(destination){
    const note=en?destination.replace(/^to\b/i,'To'):destination;
    c.font='760 53px '+face;const w=Math.max(1,c.measureText(note).width);
    title(c,note,textX,mid+50,w,Math.min(w,Math.max(textWidth,228)),colors[grade],5);
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
function makeGeometry(data,stencils,heading){
  const positions=[],normals=[],uv=[],indices=[],field=data.field,b=field.bounds,height=data.height;
  function patch(poly,slot){
    const start=positions.length/3;
    for(const [x,z,u,v] of poly){
      const nx=height(x-.35,z)-height(x+.35,z),nz=height(x,z-.35)-height(x,z+.35),len=Math.hypot(nx,.7,nz);
      positions.push(x,height(x,z)+.006,z);normals.push(nx/len,.7/len,nz/len);uv.push(slot+u,v);
    }
    for(let i=1;i<poly.length-1;i++)indices.push(start,start+i,start+i+1);
  }
  function conform(quad,slot){
    const dx=field.dx,dz=field.dz;
    const gx=quad.map(q=>Math.floor((q[0]-b.minX)/dx)),gz=quad.map(q=>Math.floor((q[1]-b.minZ)/dz));
    for(let ir=Math.min(...gz);ir<=Math.max(...gz);ir++)for(let ic=Math.min(...gx);ic<=Math.max(...gx);ic++){
      const x=b.minX+ic*dx,z=b.minZ+ir*dz;
      let p=clip(quad,q=>q[0]-x);p=clip(p,q=>x+dx-q[0]);p=clip(p,q=>q[1]-z);p=clip(p,q=>z+dz-q[1]);
      if(p.length<3)continue;
      // Split the stencil at the very same diagonal as the snow mesh.
      const diagonal=q=>1-(q[0]-x)/dx-(q[1]-z)/dz;
      for(const sign of [1,-1]){const part=clip(p,q=>sign*diagonal(q));if(part.length>=3)patch(part,slot);}
    }
  }
  stencils.forEach(({center,width,length,lateral,readingDistance},slot)=>{
    // A road stencil's near edge is physically shorter than its far edge.
    // Inverse-perspective spacing keeps both lines legible from normal ski height.
    const span=2*readingDistance*length/(Math.hypot(readingDistance,length)+readingDistance);
    function vertex(u,v){
      const t=(v-.5)*span,f=t/(1-t/readingDistance),a=(u-.5)*width;
      return [...move(center,heading,f,a+f*(lateral+a)/readingDistance),u,v];
    }
    for(let j=0;j<5;j++)for(let i=0;i<2;i++){
      const u=i/2,v=j/5,s=(i+1)/2,t=(j+1)/5;
      conform([vertex(u,v),vertex(s,v),vertex(s,t),vertex(u,t)],slot);
    }
  });
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeBoundingSphere();return geometry;
}

function layOutChoices(data,navigation,route,site){
  const seenIds=new Set(),seenNames=new Set(),choices=[];
  for(const o of site.options){
    const name=nameOf(o.name),id=o.choiceId||o.routeId;
    if(!o.selectable||o.role==='incoming'||!name||!id||!Number.isFinite(o.heading)||seenIds.has(id)||seenNames.has(name))continue;
    seenIds.add(id);seenNames.add(name);choices.push(o);
  }
  if(choices.length<2)return [];
  // At 70 km/h a group read 10–15 m before the paint leaves about two
  // seconds for the turn. Keep the footprint on this leg at close forks.
  let lastChoice=route.approach?.endDistance||0;
  for(const station of navigation.stationsOn(route)){
    if(station.along>=site.along-.1)break;
    lastChoice=Math.max(lastChoice,station.along);
  }
  const lead=Math.min(32,Math.max(0,site.along-lastChoice)*.52);
  const frame=route.frame(Math.max(0,site.along-lead)),center=[frame.x,frame.z],heading=frame.angle;
  choices.sort((a,b)=>signedAngle(a.heading-heading)-signedAngle(b.heading-heading));
  const snowWidth=data.trails.find(t=>t.id===site.fromTrailId)?.width||30;
  const count=choices.length,spacing=Math.min(count>2?5.6:6.15,snowWidth*.76/count),width=Math.min(6.8,spacing*1.04);
  return choices.map((option,i)=>{
    const middle=count%2===1&&i===(count-1)/2,lateral=(i-(count-1)/2)*spacing+(middle?1.62:0);
    return {option,heading,center:move(center,heading,middle?2.3:0,lateral),turn:signedAngle(option.heading-heading),
      width,length:11.1,lateral,readingDistance:9.5+(middle?2.3:0)};
  });
}

export function createTrailGuide(scene,data,renderer){
  const root=new THREE.Group();root.name='Snow trail markings';root.visible=false;scene.add(root);
  const ink=makeInk(renderer),light=scene.children.find(o=>o.isHemisphereLight);
  let mesh=null,route=null,forkId=null,stencils=[],language='';
  function update(sim,navigation,locale='zh'){
    const site=sim?.mode==='run'?navigation?.upcomingChoice(sim):null;
    if(!site){root.visible=false;if(mesh)mesh.visible=false;return;}
    if(route!==sim.route||forkId!==site.id){
      if(mesh){mesh.removeFromParent();mesh.geometry.dispose();mesh=null;}
      route=sim.route;forkId=site.id;stencils=layOutChoices(data,navigation,route,site);language='';
      if(stencils.length){
        mesh=new THREE.Mesh(makeGeometry(data,stencils,stencils[0].heading),ink.material);
        mesh.name='Piste fork · '+site.id;mesh.renderOrder=1;mesh.receiveShadow=true;root.add(mesh);
      }
    }
    if(!mesh){root.visible=false;return;}
    const next=locale==='en'?'en':'zh';
    if(language!==next){ink.paintChoices(stencils,next);language=next;}
    if(light)ink.material.emissiveIntensity=.085+Math.max(0,1.35-light.intensity)*.38;
    root.visible=mesh.visible=true;
  }
  function dispose(){mesh?.geometry.dispose();ink.dispose();root.removeFromParent();}
  return {update,dispose};
}
