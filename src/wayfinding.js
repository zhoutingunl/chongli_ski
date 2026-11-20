import * as THREE from 'three';

// Trail signs are fixed to the ground. The front and reverse have separate lettering and
// arrows, so someone approaching from the other side never sees a mirrored instruction.
const gradeStyles = {
  easy:         {body:'#225840', edge:'#347552', badge:'#23834d', zh:'初级'},
  intermediate: {body:'#173f5c', edge:'#285c7a', badge:'#1761a1', zh:'中级'},
  advanced:     {body:'#273237', edge:'#425057', badge:'#182329', zh:'高级'},
  expert:       {body:'#232c30', edge:'#41494d', badge:'#182329', zh:'专家'},
  service:      {body:'#394e50', edge:'#506767', badge:'#566c6d', zh:''},
};
const localNames = {
  '长龙道':'Long Dragon', '玉龙道':'Jade Dragon', '卧龙道':'Sleeping Dragon',
  '金龙道':'Golden Dragon', '银龙道':'Silver Dragon', '大奔头':'Silver Dragon · Lower',
  '芍药花':'Peony', '雪绒花':'Edelweiss', '锦带花':'Weigela',
  '曼陀罗':'Datura', '剪秋萝':'Campion', '翠菊花':'China Aster', '山丹丹':'Mountain Lily',
};
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const bearing=(a,b)=>Math.atan2(b[0]-a[0],-(b[1]-a[1]));
const simpleName=name=>(name||'').split(/[（(·]/)[0].trim();
const font='"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",system-ui,sans-serif';
const latin='"Arial Narrow","Helvetica Neue",Arial,sans-serif';

function alongShoulder(point,heading,offset,forward=0) {
  return [point[0]+Math.sin(heading)*forward+Math.cos(heading)*offset,
          point[1]-Math.cos(heading)*forward+Math.sin(heading)*offset];
}
function legAt(route,index,trails) {
  const leg=route.legs?.find(l=>index>=l.startIndex && index<l.endIndex) || route.legs?.at(-1);
  return trails.get(leg?.trailId);
}
function signSites(data,plans) {
  const sites=[];
  for(const p of plans) {
    if(!p.options?.length)continue;
    const src=[p.x,p.z],side=p.resort,approach=p.approach;
    const rows=p.options.map(o=>({...o,name:o.name||o.zh,en:o.en||localNames[simpleName(o.name)]||'',difficulty:o.difficulty||'intermediate'}));
    if(p.type==='summit') {
      const start=data.summitPlaces[side],h=start.heading;
      // The Wanlong unloading apron is directly under the return lane of lift 7.
      // Its board stands on the right shoulder, clear of the passing cabins.
      const pos=side==='wanlong'?alongShoulder(start.position,h,6.75,9.85):alongShoulder(start.position,h,-3.05,8.65);
      const heading=bearing(start.position,pos);
      sites.push({id:p.id,signId:p.id,type:'summit',pos,side,heading,approach:h,rows,header:side==='wanlong'?'红花梁 · 雪道入口':'云顶 · 雪道入口',en:'TRAILHEAD'});
    } else if(p.type==='junction') {
      const fork=p.junctionPosition||src;
      const nearest=data.index.near(...fork),width=nearest.trail?.width||34;
      // The facing normal follows the incoming piste, whereas every arrow follows the
      // outgoing geometry. A warning board upstream consequently depicts the fork ahead.
      const route=data.routes.find(r=>r.id===p.sourceRouteId);
      const lane=p.junctionPosition&&route ? route.frame(p.along-12) : null;
      const railSide=lane ? Math.sign((p.x-lane.x)*Math.cos(lane.angle)+(p.z-lane.z)*Math.sin(lane.angle))||1 : side==='genting'?-1:1;
      const ahead=p.upstreamPosition || alongShoulder(fork,approach,0,-46);
      const approach0=route?route.frame(p.along-48).angle:approach;
      const aheadWidth=data.index.near(...ahead).trail?.width||width;
      const aheadPos=alongShoulder(ahead,approach0,railSide*clamp(aheadWidth*.43,7.5,15.5));
      const pos=p.junctionPosition?src:alongShoulder(fork,approach,railSide*clamp(width*.42,7.2,15));
      const rounded=Math.round(Math.hypot(fork[0]-ahead[0],fork[1]-ahead[1])/5)*5;
      sites.push({id:p.id+'-advance',signId:p.id,type:'advance',side,pos:aheadPos,heading:approach0+railSide*.16,approach:approach0,rows,
        header:`前方 ${rounded} 米分岔`,en:'JUNCTION AHEAD'});
      sites.push({id:p.id,signId:p.id,type:'junction',side,pos,heading:approach+railSide*.16,approach,rows,header:'雪道分岔',en:'TRAIL JUNCTION'});
    } else if(p.type==='confirmation') {
      sites.push({id:p.id,type:'repeater',side,pos:src,heading:approach,approach,rows});
    }
  }
  const trails=new Map(data.trails.map(t=>[t.id,t]));
  // Shared initial and lower pistes get one confirmation marker, regardless of how many
  // itineraries use them. The name on the plate is the current OSM leg under the skis.
  for(const route of data.routes) {
    for(let s=160;s<route.length-180;s+=590) {
      const f=route.frame(s),trail=legAt(route,f.index,trails);
      if(!trail?.name)continue;
      const name=simpleName(trail.name),en=localNames[name];
      if(!en)continue;
      const side=trail.resort==='genting'?-1:1,pos=alongShoulder([f.x,f.z],f.angle,side*clamp(trail.width*.47,7.5,20));
      if(sites.some(o=>Math.hypot(pos[0]-o.pos[0],pos[1]-o.pos[1])<Math.min(170,o.type==='repeater'?170:125)))continue;
      const lower=trail.name.includes('大奔头');
      sites.push({id:'follow-'+trail.id+'-'+Math.round(s),type:'repeater',side:trail.resort,pos,heading:f.angle+side*.16,approach:f.angle,
        rows:[{name:lower?'银龙道 · 大奔头':name,en:lower?'Silver Dragon · Lower':en,difficulty:trail.difficulty,heading:f.angle,routeId:route.id}]});
    }
  }
  for(const side of ['wanlong','genting']) {
    const route=data.routes.find(r=>r.id===side+'-classic');
    const hall=data.landmarks.find(l=>l.id===side+'-hall');
    const lift=data.lifts.find(l=>l.id===(side==='wanlong'?'w1368988315':'w469393391'));
    if(!route||!hall||!lift)continue;
    const f=route.frame(route.length-44),pos=alongShoulder([f.x,f.z],f.angle,side==='wanlong'?9.2:-9.2);
    sites.push({id:side+'-base-services',type:'base',side,pos,heading:f.angle,approach:f.angle,header:'山脚服务区',en:'BASE AREA',rows:[
      {name:'雪具大厅',en:'Ski Center',difficulty:'service',heading:bearing(pos,[hall.x,hall.z])},
      {name:'索道下站',en:'Gondola Station',difficulty:'service',heading:bearing(pos,lift.points[0])}
    ]});
  }
  return sites;
}

function keyFor(row) {return `${row.labelType||'route'}|${row.difficulty||''}|${row.name}|${row.en}`;}
function textFit(c,t,x,y,w,size,min,weight,family) {
  c.font=`${weight} ${size}px ${family}`;
  while(size>min && c.measureText(t).width>w)c.font=`${weight} ${--size}px ${family}`;
  c.fillText(t,x,y,w);
}
function badge(c,grade) {
  const q=gradeStyles[grade]||gradeStyles.service,x=76,y=63;
  c.fillStyle='#f0f1e8';c.fillRect(x-34,y-32,68,64);c.fillStyle=q.badge;
  c.beginPath();
  if(grade==='easy'){c.arc(x,y,21,0,Math.PI*2);c.fill();}
  else if(grade==='intermediate'){c.fillRect(x-19,y-19,38,38);}
  else if(grade==='advanced'||grade==='expert') {
    const list=grade==='expert'?[-13,13]:[0],r=grade==='expert'?13:21;
    for(const n of list){c.beginPath();c.moveTo(x+n,y-r);c.lineTo(x+n+r,y);c.lineTo(x+n,y+r);c.lineTo(x+n-r,y);c.closePath();c.fill();}
  }else{c.font=`bold 44px ${latin}`;c.textAlign='center';c.fillText('i',x,y+2);}
  if(q.zh){c.fillStyle='#ecf1e9';c.font=`600 24px ${font}`;c.textAlign='center';c.fillText(q.zh,x,116);}
  c.textAlign='left';
}
function drawCell(c,r,x,y,w,h) {
  c.save();c.translate(x,y);c.scale(w/768,h/151);c.textAlign='left';c.textBaseline='middle';
  if(r.labelType==='white') {c.fillStyle='#faf9ee';c.fillRect(0,0,768,151);c.restore();return;}
  const header=r.labelType==='header',style=gradeStyles[r.difficulty]||gradeStyles.service;
  const g=c.createLinearGradient(0,0,0,151);
  g.addColorStop(0,header?'#a97643':style.edge);g.addColorStop(.15,header?'#80592f':style.body);g.addColorStop(1,header?'#5d442c':style.body);
  c.fillStyle=g;c.fillRect(0,0,768,151);
  // A thin retroreflective rule, edge wear and small fasteners belong to the enamel plate.
  c.strokeStyle=header?'#d5b892':'#c4d2cd';c.lineWidth=2.0;c.strokeRect(10,9,748,133);
  c.globalAlpha=.17;c.fillStyle='#f2f3ed';for(let i=0;i<38;i++){const px=(i*103+31)%748,py=(i*57+11)%128;c.fillRect(10+px,10+py,(i%4)+1,.7);}c.globalAlpha=1;
  for(const bx of [20,748])for(const by of [19,132]){c.fillStyle='#233e40';c.beginPath();c.arc(bx,by,3.1,0,Math.PI*2);c.fill();c.fillStyle='#aeb7ac';c.fillRect(bx-1.0,by-1.25,2,1.2);}
  if(header){
    c.fillStyle='#fff7db';textFit(c,r.name,34,72,467,73,43,700,font);
    c.textAlign='right';c.fillStyle='#eee1bd';textFit(c,r.en.toUpperCase(),734,78,237,34,21,650,latin);
  }else{
    badge(c,r.difficulty);
    c.fillStyle='#fcfcf4';textFit(c,r.name,125,56,494,77,45,720,font);
    c.fillStyle='#dbe8e6';textFit(c,r.en.toUpperCase(),128,112,486,31,19,650,latin);
    c.strokeStyle='rgba(229,239,236,.39)';c.lineWidth=1.6;c.beginPath();c.moveTo(623,28);c.lineTo(623,122);c.stroke();
  }
  c.restore();
}
function labelAtlas(sites) {
  const unique=new Map(),white={labelType:'white',name:'',en:''};unique.set(keyFor(white),white);
  for(const s of sites) {
    if(s.header){s.top={name:s.header,en:s.en,labelType:'header'};unique.set(keyFor(s.top),s.top);}
    for(const row of s.rows)unique.set(keyFor(row),row);
  }
  const tiles=[...unique.entries()],cols=tiles.length>24?4:3,cellWidth=cols===4?512:640,cellHeight=128,rows=Math.ceil(tiles.length/cols);
  const c=document.createElement('canvas');c.width=cols*cellWidth;c.height=rows*cellHeight;
  const ct=c.getContext('2d'),uv=new Map();
  tiles.forEach(([key,r],i)=>{const x=i%cols*cellWidth,y=Math.floor(i/cols)*cellHeight;drawCell(ct,r,x,y,cellWidth,cellHeight);
    uv.set(key,[(x+1.5)/c.width,1-(y+cellHeight-1.5)/c.height,(x+cellWidth-1.5)/c.width,1-(y+1.5)/c.height]);});
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;
  const enamel=new THREE.MeshLambertMaterial({map:tex,emissive:0xffffff,emissiveMap:tex,emissiveIntensity:.20});
  const shell=new THREE.MeshLambertMaterial({vertexColors:true});
  return {uv,white:uv.get(keyFor(white)),enamel,shell};
}

// All plates within one sector use the same atlas; hardware and readable faces each
// need one draw. Individual rows still participate independently in a ray selection.
class GeometryBatch {
  constructor(){this.vertices=[];this.normal=[];this.colors=[];this.st=[];this.ix=[];}
  polygon(points,tint,uv) {
    const offset=this.vertices.length/3;
    const first=points[0],n=points[1].clone().sub(first).cross(points[2].clone().sub(first)).normalize();
    const color=tint?new THREE.Color(tint):null;
    for(let i=0;i<points.length;i++){
      const p=points[i];this.vertices.push(p.x,p.y,p.z);this.normal.push(n.x,n.y,n.z);
      if(color)this.colors.push(color.r,color.g,color.b);if(uv)this.st.push(...uv[i]);
    }
    for(let i=1;i<points.length-1;i++)this.ix.push(offset,offset+i,offset+i+1);
  }
  finish(material) {
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(this.vertices,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(this.normal,3));
    if(this.st.length)g.setAttribute('uv',new THREE.Float32BufferAttribute(this.st,2));
    if(this.colors.length)g.setAttribute('color',new THREE.Float32BufferAttribute(this.colors,3));
    g.setIndex(this.ix);g.computeBoundingSphere();return new THREE.Mesh(g,material);
  }
}
function box(batch,at,x,y,z,w,h,d,color) {
  const a=x-w/2,b=x+w/2,k=y-h/2,t=y+h/2,f=z+d/2,r=z-d/2;
  const q=(v)=>batch.polygon(v.map(p=>at(...p)),color);
  q([[a,k,f],[b,k,f],[b,t,f],[a,t,f]]);q([[b,k,f],[b,k,r],[b,t,r],[b,t,f]]);
  q([[b,k,r],[a,k,r],[a,t,r],[b,t,r]]);q([[a,k,r],[a,k,f],[a,t,f],[a,t,r]]);
  q([[a,t,f],[b,t,f],[b,t,r],[a,t,r]]);q([[a,k,r],[b,k,r],[b,k,f],[a,k,f]]);
}
function graphicArrow(face,at,rect,angle,size,x,y,z,reverse) {
  const th=wrap(angle),sn=Math.sin(th),cs=Math.cos(th),sign=reverse?-1:1;
  const a=(u,v)=>at(sign*(x+(u*cs+v*sn)*size),y+(-u*sn+v*cs)*size,z);
  const swatch=[(rect[0]+rect[2])*.5,(rect[1]+rect[3])*.5];
  const shape=points=>{const vs=points.map(([u,v])=>a(u,v));face.polygon(vs,null,vs.map(()=>swatch));};
  shape([[-.105,-.41],[.105,-.41],[.105,.10],[-.105,.10]]);
  shape([[-.42,.06],[.42,.06],[0,.48]]);
}
function signModel(data,site,batches,atlas) {
  const {rows,type,pos,heading}=site,big=type==='summit',repeater=type==='repeater';
  const width=big?5.03:repeater?3.02:4.26,rowH=big?1.06:repeater?.80:.93,gap=big?.072:.065;
  const base=big?.60:repeater?1.18:.65;
  const topOfRows=base+rows.length*(rowH+gap)-gap;
  const headerH=big?.48:.39,high=topOfRows+(site.top?gap+headerH:0);
  const r=V(Math.cos(heading),0,Math.sin(heading)),n=V(-Math.sin(heading),0,Math.cos(heading));
  const g=data.height(...pos),at=(x,y,z)=>V(pos[0]+r.x*x+n.x*z,g+y,pos[1]+r.z*x+n.z*z);
  const shell=batches.hardware,fac=batches.lettering,deep=.14;
  const posts=repeater?[0]:[-width*.363,width*.363];
  for(const x of posts){
    const foot=at(x,0,-.115),ground=data.height(foot.x,foot.z)-g;
    const postH=high-ground+.18;
    box(shell,at,x,ground+postH*.5,-.15,repeater?.15:.20,postH,.22,'#635344');
    box(shell,at,x,ground+.070,-.15,.37,.21,.39,'#9d9b8e');
    box(shell,at,x,ground+.235,-.15,.24,.15,.27,'#586260');
    box(shell,at,x,high+.08,-.15,.25,.13,.27,'#e9edf0');
  }
  if(!repeater)for(const y of [base+.18,topOfRows-.15])box(shell,at,0,y,-.29,width*.90,.13,.15,'#747c79');
  function slat(row,cy,h,header=false) {
    const hw=width/2,hh=h/2,cut=header?.045:.095;
    const xy=[[-hw+cut,-hh],[hw-cut,-hh],[hw,-hh+cut],[hw,hh-cut],[hw-cut,hh],[-hw+cut,hh],[-hw,hh-cut],[-hw,-hh+cut]];
    for(let i=0;i<xy.length;i++){
      const p=xy[i],q=xy[(i+1)%xy.length];shell.polygon([at(p[0],cy+p[1],-deep),at(q[0],cy+q[1],-deep),at(q[0],cy+q[1],deep),at(p[0],cy+p[1],deep)],(p[1]+q[1])*.5>hh-.12?'#c7cecb':'#515b59');
    }
    const rect=atlas.uv.get(keyFor(row));
    for(const reverse of [false,true]){
      const sign=reverse?-1:1,z=sign*(deep+.005);
      const vs=xy.map(([x,y])=>at(x,cy+y,z)),uv=xy.map(([x,y])=>[rect[0]+(x*sign/width+.5)*(rect[2]-rect[0]),rect[1]+(y/h+.5)*(rect[3]-rect[1])]);
      if(reverse){vs.reverse();uv.reverse();}fac.polygon(vs,null,uv);
      if(!header){const delta=wrap(row.heading-heading-(reverse?Math.PI:0));graphicArrow(fac,at,atlas.white,delta,Math.min(h*.94,width*.15),hw*.79,cy,sign*(deep+.031),reverse);}
    }
    if(header||repeater||rows.length===1)box(shell,at,0,cy+hh+.010,0,width-cut*2,.041,.34,'#ecf0ee');
  }
  rows.forEach((row,i)=>slat(row,topOfRows-rowH*.5-i*(rowH+gap),rowH));
  if(site.top)slat(site.top,topOfRows+gap+headerH*.5,headerH,true);
  if(big){
    // At a side-on angle the pointed metal vanes indicate the actual trail bearings
    // even when the wide bilingual boards are edge-on.
    const x=pos[0]+r.x*width*.363-n.x*.15,z=pos[1]+r.z*width*.363-n.z*.15;
    box(shell,at,width*.363,high+.31,-.15,.089,.63,.089,'#65716f');
    rows.slice(0,3).forEach((row,i)=>{
      const h=row.heading,dx=Math.sin(h),dz=-Math.cos(h),rx=Math.cos(h),rz=Math.sin(h),y=g+high+.51-i*.16;
      const tip=(l,w,dy)=>V(x+dx*l+rx*w,y+dy,z+dz*l+rz*w);
      const verts=[[.02,-.052,-.049],[.96,-.052,-.049],[.96,-.12,-.049],[1.24,0,-.049],[.96,.12,-.049],[.96,.052,-.049],[.02,.052,-.049]];
      const plate=[tip(.025,-.052,.040),tip(.96,-.052,.040),tip(.96,.052,.040),tip(.025,.052,.040)];
      shell.polygon(plate.reverse(),'#d8c7a3');shell.polygon([tip(.90,.13,.04),tip(1.24,0,.04),tip(.90,-.13,.04)],'#d8c7a3');
      for(let k=0;k<verts.length;k++){const a=verts[k],b=verts[(k+1)%verts.length];shell.polygon([tip(a[0],a[1],-.049),tip(b[0],b[1],-.049),tip(b[0],b[1],.04),tip(a[0],a[1],.04)],'#887457');}
    });
  }
}

export function createWayfinding(scene,data,plans) {
  const sites=signSites(data,plans),atlas=labelAtlas(sites),sectors=new Map();
  for(const s of sites){
    const sx=Math.floor(s.pos[0]/245),sz=Math.floor(s.pos[1]/245),key=sx+','+sz;
    if(!sectors.has(key))sectors.set(key,{hardware:new GeometryBatch(),lettering:new GeometryBatch(),spots:[],x:(sx+.5)*245,z:(sz+.5)*245});
    const cell=sectors.get(key);cell.spots.push(s.pos);signModel(data,s,cell,atlas);
  }
  const groups=[];
  for(const cell of sectors.values()){
    const group=new THREE.Group();group.name='Ski trail directions';
    group.add(cell.hardware.finish(atlas.shell),cell.lettering.finish(atlas.enamel));
    scene.add(group);groups.push({group,x:cell.x,z:cell.z,spots:cell.spots});
  }
  function locate(x,z){
    for(const cell of groups){
      cell.group.visible=(cell.x-x)**2+(cell.z-z)**2<625*625;
      const near=cell.group.visible&&cell.spots.some(([sx,sz])=>(sx-x)**2+(sz-z)**2<28*28);
      for(const mesh of cell.group.children)mesh.castShadow=near;
    }
  }
  return {locate};
}
