import * as THREE from 'three';
import {clamp,mixAngle,randomGenerator} from './mountain.js';
import {getSkiSigns} from './navigation.js';
import {createWayfinding} from './wayfinding.js';

function localInstances(scene,geometry,material,items) {
  const mesh=new THREE.InstancedMesh(geometry,material,items.length),object=new THREE.Object3D();
  const matrices=new Float32Array(items.length*16);
  for(let i=0;i<items.length;i++){
    const [x,y,z,sx,sy,sz,ry=0]=items[i];object.position.set(x,y,z);object.scale.set(sx,sy,sz);object.rotation.y=ry;object.updateMatrix();object.matrix.toArray(matrices,i*16);
  }
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.count=0;mesh.frustumCulled=false;scene.add(mesh);
  return (x,z)=>{
    let count=0;const target=mesh.instanceMatrix.array;
    for(let i=0;i<items.length;i++){
      const m=i*16,dx=matrices[m+12]-x,dz=matrices[m+14]-z;
      if(dx*dx+dz*dz>520*520)continue;
      target.set(matrices.subarray(m,m+16),count*16);count++;
    }
    mesh.count=count;mesh.visible=count>0;mesh.instanceMatrix.needsUpdate=true;
  };
}
function distAlong(points,s) {
  for(let i=1;i<points.length;i++){
    const [x,z]=points[i-1],[bx,bz]=points[i],dx=bx-x,dz=bz-z,d=Math.hypot(dx,dz);
    if(d>s){const t=s/d;return {x:x+t*dx,z:z+t*dz,rx:-dz/d,rz:dx/d};}s-=d;
  }
}
export function courseDetails(scene,data,navigation,modeledBuildings=new Set()) {
  const directions=createWayfinding(scene,data,navigation?.signs||getSkiSigns(data));
  const poles=[],caps=[],netPos=[],rand=randomGenerator(18359);
  for(const trail of data.trails){
    for(let s=22;s<8000;s+=63){
      const p=distAlong(trail.points,s);if(!p)break;
      for(const side of [-1,1]){
        const w=(trail.width||34)*.48*side;
        const x=p.x+p.rx*w,z=p.z+p.rz*w,y=data.height(x,z);
        poles.push([x,y+.86,z,.066,1.74,.066]);caps.push([x,y+1.51,z,.076,.30,.076]);
      }
    }
  }
  const plank=new THREE.CylinderGeometry(.5,.55,1,6);
  const batches=[localInstances(scene,plank,new THREE.MeshLambertMaterial({color:0xc45a3b}),poles),
    localInstances(scene,plank,new THREE.MeshLambertMaterial({color:0xf3cf77}),caps)];
  const netCanvas=document.createElement('canvas');netCanvas.width=netCanvas.height=64;
  const nc=netCanvas.getContext('2d');nc.strokeStyle='rgba(206,68,36,.80)';nc.lineWidth=3.4;
  for(let i=0;i<=64;i+=16){nc.beginPath();nc.moveTo(i,0);nc.lineTo(i,64);nc.moveTo(0,i);nc.lineTo(64,i);nc.stroke();}
  nc.fillStyle='rgba(227,82,42,.96)';nc.fillRect(0,0,64,4);nc.fillRect(0,62,64,2);
  const nt=new THREE.CanvasTexture(netCanvas);nt.wrapS=THREE.RepeatWrapping;nt.colorSpace=THREE.SRGBColorSpace;nt.anisotropy=4;
  const uv=[],netPoles=[];
  for(const r of data.routes.filter(r=>r.id.endsWith('classic'))){
    for(const offset of [26,r.length*.48,r.length-90]){
      const side=rand()<.5?-1:1, vs=[];
      for(let s=0;s<60;s+=4.4){
        const p=r.frame(offset+s),x=p.x-p.dz*16.2*side,z=p.z+p.dx*16.2*side,y=data.height(x,z);
        netPoles.push([x,y+.84,z,.085,1.75,.085]);
        vs.push([x,y+.16,z,x,y+1.42,z]);
        const a=vs.at(-2),b=vs.at(-1);if(!a)continue;
        netPos.push(...a.slice(0,3),...b.slice(0,3),...a.slice(3),...a.slice(3),...b.slice(0,3),...b.slice(3));
        uv.push(0,0,3,0,0,1,0,1,3,0,3,1);
      }
    }
  }
  batches.push(localInstances(scene,plank,new THREE.MeshLambertMaterial({color:0xc94b31}),netPoles));
  const ng=new THREE.BufferGeometry();ng.setAttribute('position',new THREE.Float32BufferAttribute(netPos,3));ng.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  scene.add(new THREE.Mesh(ng,new THREE.MeshBasicMaterial({map:nt,side:THREE.DoubleSide,alphaTest:.43,transparent:false})));
  const gateCloth=new THREE.BufferGeometry();
  gateCloth.setAttribute('position',new THREE.Float32BufferAttribute([
    0,1.8,0, .74,1.67,-.10, 0,1.03,0, .74,1.67,-.10, .78,1.0,-.08, 0,1.03,0,
    .74,1.67,-.10, 1.32,1.71,.04, .78,1.0,-.08, 1.32,1.71,.04, 1.29,1.06,.02, .78,1.0,-.08
  ],3));gateCloth.computeVertexNormals();
  const gateCount=Math.max(40,...(data.allRoutes||data.routes).map(r=>Math.ceil(r.length/190)+2));
  const flags=new THREE.InstancedMesh(gateCloth,new THREE.MeshLambertMaterial({side:THREE.DoubleSide}),gateCount);
  const staffs=new THREE.InstancedMesh(plank,new THREE.MeshLambertMaterial({color:0x334856}),gateCount);
  const gatePose=new THREE.Object3D(),flagColor=new THREE.Color();
  for(const mesh of [flags,staffs]){mesh.count=0;mesh.frustumCulled=false;scene.add(mesh);}
  let activeRoute=null;
  function setRoute(route){
    if(route===activeRoute)return;
    activeRoute=route;let i=0;
    if(route)for(let at=32;at<route.length-16&&i<gateCount;at+=190){
      const f=route.frame(at),side=i%2?1:-1;
      const x=f.x-f.dz*6.5*side,z=f.z+f.dx*6.5*side,y=data.height(x,z);
      gatePose.position.set(x,y,z);gatePose.scale.set(1,1,1);gatePose.rotation.y=-f.angle;
      gatePose.updateMatrix();flags.setMatrixAt(i,gatePose.matrix);flags.setColorAt(i,flagColor.set(i%2?0x286a85:0xb64543));
      gatePose.position.y+=.92;gatePose.scale.set(.074,1.84,.074);gatePose.updateMatrix();staffs.setMatrixAt(i,gatePose.matrix);i++;
    }
    for(const mesh of [flags,staffs]){mesh.count=i;mesh.visible=i>0;mesh.instanceMatrix.needsUpdate=true;}
    if(flags.instanceColor)flags.instanceColor.needsUpdate=true;
  }
  function nextFlag(along){
    if(!activeRoute)return null;
    const next=32+190*Math.max(0,Math.ceil((along-32)/190));
    return next<activeRoute.length-16?Math.max(0,next-along):null;
  }
  // The other mapped resort buildings retain their surveyed footprint and roof line.
  const taken=new Set(data.landmarks.map(l=>l.buildingId).filter(Boolean));
  const walls=[],roofs=[],wallUv=[];
  for(const b of data.buildings){
    if(taken.has(b.id)||modeledBuildings.has(b.id)||b.footprint.length<3)continue;
    const pts=b.footprint.slice();if(pts.length>1&&pts[0][0]===pts.at(-1)[0]&&pts[0][1]===pts.at(-1)[1])pts.pop();
    const h=clamp((b.levels||1)*3.2+1.5,4.1,38),y=pts.reduce((a,p)=>a+data.height(...p),0)/pts.length;
    const vectors=pts.map(p=>new THREE.Vector2(...p));
    const triangles=THREE.ShapeUtils.triangulateShape(vectors,[]);
    for(const f of triangles){for(const i of [f[0],f[2],f[1]])roofs.push(pts[i][0],y+h,pts[i][1]);}
    for(let i=0;i<pts.length;i++){
      const a=pts[i],t=pts[(i+1)%pts.length],pa=[a[0],Math.min(data.height(...a),y)-1,a[1]],pb=[t[0],Math.min(data.height(...t),y)-1,t[1]],pc=[a[0],y+h,a[1]],pd=[t[0],y+h,t[1]];
      walls.push(...pa,...pb,...pc,...pc,...pb,...pd);
      const width=Math.hypot(t[0]-a[0],t[1]-a[1])/8.4,levels=Math.max(1,Math.round(h/3.65));
      wallUv.push(0,0,width,0,0,levels,0,levels,width,0,width,levels);
    }
  }
  const facade=document.createElement('canvas');facade.width=256;facade.height=100;
  const fc=facade.getContext('2d');fc.fillStyle='#b4a99b';fc.fillRect(0,0,256,100);
  fc.fillStyle='#8d8378';fc.fillRect(0,3,256,3);fc.fillStyle='#e2e1d6';fc.fillRect(0,0,256,3);
  for(const x of [17,95,177]){
    fc.fillStyle='#6c6b65';fc.fillRect(x,28,55,41);fc.fillStyle='#718993';fc.fillRect(x+3,31,49,35);
    fc.fillStyle='#536773';fc.fillRect(x+4,50,48,15);fc.fillStyle='#bfc2b7';fc.fillRect(x+26,30,2,36);fc.fillRect(x-2,68,59,3);
  }
  const facadeTex=new THREE.CanvasTexture(facade);facadeTex.colorSpace=THREE.SRGBColorSpace;facadeTex.wrapS=facadeTex.wrapT=THREE.RepeatWrapping;facadeTex.anisotropy=4;
  for(const [vertices,col] of [[walls,0xf4eeeb],[roofs,0xd7dbdb]]){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));if(vertices===walls)g.setAttribute('uv',new THREE.Float32BufferAttribute(wallUv,2));g.computeVertexNormals();scene.add(new THREE.Mesh(g,new THREE.MeshLambertMaterial({color:col,map:vertices===walls?facadeTex:null,side:THREE.DoubleSide})));
  }
  return {setRoute,nextFlag,locate(x,z){directions.locate(x,z);for(const update of batches)update(x,z);}};
}

// Shared, tileable snow grain. The low fan is a torn sheet of displaced snow;
// this texture breaks its surface into granules without a circular sprite edge.
function powderGrain() {
  const size=96,bytes=new Uint8Array(size*size*4),random=randomGenerator(28419),grid=new Float32Array(32*32);
  for(let i=0;i<grid.length;i++)grid[i]=random();
  function noise(x,y,period,ox=0,oy=0){
    const i=Math.floor(x),j=Math.floor(y),fx=x-i,fy=y-j,a=fx*fx*(3-2*fx),b=fy*fy*(3-2*fy),mask=period-1;
    const at=(p,q)=>grid[(((p&mask)+ox)&31)+(((q&mask)+oy)&31)*32];
    return ((1-a)*at(i,j)+a*at(i+1,j))*(1-b)+((1-a)*at(i,j+1)+a*at(i+1,j+1))*b;
  }
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(x+y*size)*4,u=x/size,v=y/size;
    bytes[i]=255*(.58*noise(u*8,v*8,8)+.42*noise(u*32,v*32,32));bytes[i+1]=255*random();bytes[i+2]=255*noise(u*16,v*16,16,9,2);bytes[i+3]=255;
  }
  const texture=new THREE.DataTexture(bytes,size,size);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;
}
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const lerp=(a,b,t)=>a+(b-a)*t;
const dynamic=(values,count)=>new THREE.BufferAttribute(values,count).setUsage(THREE.DynamicDrawUsage);

function snowContact(p,dimensions){
  const skis=p.gear!=='board',length=dimensions?.deckLength||(skis?1.753:1.585),waist=dimensions?.waistWidth||(skis ? .079 : .250);
  const heading=p.heading,travel=p.travelHeading??heading,edge=clamp(p.edge??p.steer??0,-1,1),load=clamp(p.pressure??Math.abs(edge),0,1.35);
  const skid=clamp(p.skid??p.brake??0,0,1),signedSlip=Math.sin(p.slipAngle??(heading-travel)),slip=Math.abs(signedSlip);
  const soft=clamp(p.snowSoftness??(p.onTrail===false ? .86 : .10),0,1),speed=Math.max(0,p.speed),v=smooth(.6,18,speed);
  const press=clamp((p.press||0)-(skis?0:p.moves?.balance||0),-1,1),side=-Math.sign(Math.abs(signedSlip)>.085?signedSlip:Math.abs(edge)>.085?edge:p.cutSide||1);
  const drive=Math.max(slip*(.19+.81*skid),Math.abs(edge)*(.10+.50*load),skid*(.17+.40*load));
  const edgeBite=(p.moves?.carve||0)*smooth(.10,.55,load);
  const force=clamp(drive*(.34+.90*v+.48*edgeBite)+soft*.105*v,0,1.4);
  return {x:p.x,z:p.z,heading,travel,edge,load,skid,slip,soft,speed,press,side,force,skis,length,waist,
    scale:dimensions?.scale||1,stance:(dimensions?.stanceWidth||(skis ? .282 : .55))*(1+.248*load+.206*skid+.206*(p.push||0)),
    sink:Math.max(0,p.snowSink||0)};
}

function snowTracks(scene,data,uniforms){
  const capacity=1950,cols=6,stride=cols*2,positions=new Float32Array(capacity*stride*3),cut=new Float32Array(capacity*stride*3);
  const indices=new Uint16Array(capacity*(cols-1)*6),geometry=new THREE.BufferGeometry();
  for(let i=0,k=0;i<capacity;i++)for(let j=0;j<cols-1;j++){
    const v=i*stride+j;indices.set([v,v+cols,v+1,v+1,v+cols,v+cols+1],k);k+=6;
  }
  geometry.setAttribute('position',dynamic(positions,3));geometry.setAttribute('cut',dynamic(cut,3));geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.setDrawRange(0,0);
  const material=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true,
    polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2,
    vertexShader:`attribute vec3 cut;varying vec3 v;varying vec3 wp;varying float dist;
      void main(){v=cut;wp=position;vec4 eye=modelViewMatrix*vec4(position,1.);dist=-eye.z;gl_Position=projectionMatrix*eye;}`,
    fragmentShader:`uniform sampler2D snowGrain;uniform float night;uniform float haze;uniform vec3 keyDir;varying vec3 v;varying vec3 wp;varying float dist;
      void main(){float u=v.x;float bed=smoothstep(.055,.26,u)*(1.-smoothstep(.74,.945,u));
        float outside=smoothstep(0.,.085,u)*(1.-smoothstep(.915,1.,u));float ridge=v.z;
        vec2 grain=texture2D(snowGrain,wp.xz*vec2(2.1,1.7)).rg;
        float etch=exp(-abs(u-.235)*26.)+exp(-abs(u-.765)*26.);
        vec3 n=normalize(cross(dFdx(wp),dFdy(wp)));if(n.y<0.)n=-n;
        float sun=clamp(dot(n,keyDir)*.63+.38,0.,1.);
        vec3 compressed=mix(vec3(.105,.18,.275),vec3(.40,.52,.64),.29+grain.x*.29-etch*.24);
        vec3 shoulder=mix(vec3(.32,.44,.58),vec3(.92,.94,.94),sun*.73+grain.x*.20);
        float edgeLip=ridge*max(exp(-abs(u-.16)*19.),exp(-abs(u-.84)*19.));
        vec3 color=mix(compressed,shoulder,edgeLip);
        float alpha=(bed*(.32+.13*etch)*v.y+edgeLip*.54)*outside;
        alpha*=.83+.25*grain.x;alpha*=1.-smoothstep(95.,210.,dist);alpha*=exp(-haze*haze*dist*dist);
        gl_FragColor=vec4(color*mix(vec3(1.),vec3(.18,.26,.39),night),alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
  const mesh=new THREE.Mesh(geometry,material);mesh.name='Continuous edge tracks';mesh.frustumCulled=false;mesh.visible=false;mesh.renderOrder=1;scene.add(mesh);
  let cursor=0,occupied=0,latest=null,older=null;
  function section(p){
    const sx=Math.cos(p.heading),sz=Math.sin(p.heading),fx=sz,fz=-sx,rx=Math.cos(p.travel),rz=Math.sin(p.travel);
    const rolled=Math.abs(p.edge),swipe=p.length*.68*p.slip*(.38+.62*p.skid);
    const base=p.waist*(.99-.63*rolled*(1-p.skid)),merged=p.skis&&swipe>p.stance*.78;
    const half=(base+swipe+(merged?p.stance*Math.abs(Math.cos(p.heading-p.travel)):0))*.5;
    const lanes=p.skis&&!merged?[-1,1]:[0],row=[],edging=smooth(.04,.33,Math.max(rolled,p.slip));
    for(const lane of lanes){
      const outside=!lane||lane===p.side?1:lerp(1,.57,edging),contact=lane*p.stance*.5+p.edge*p.waist*.39*(1-.5*p.skid);
      const advance=p.length*(.325-.38*Math.max(0,p.press)+.095*Math.max(0,-p.press))+(lane?-lane*p.edge*p.length*.037:0);
      const x=p.x-fx*advance+sx*contact,z=p.z-fz*advance+sz*contact;
      const load=.57+.39*p.soft+.34*p.load+.22*p.skid;
      const lip=(.0015+.005*p.soft+outside*p.force*(.024+.066*p.soft))*p.scale+p.sink*.13;
      const widths=[-1,1].map(side=>(.010+(.026+.107*p.soft)*p.force*(side===p.side?1:lerp(1,.17,edging))+.012*p.soft)*p.scale);
      const heights=[-1,1].map(side=>lip*(side===p.side?1:lerp(1,.12,edging)));
      const across=[-half-widths[0],-half-widths[0]*.42,-half*.69,half*.69,half+widths[1]*.42,half+widths[1]];
      const levels=[0,heights[0],0,0,heights[1],0],profile=[0,.16,.32,.68,.84,1],vertices=new Float32Array(cols*6);
      for(let j=0;j<cols;j++){
        const tx=x+rx*across[j],tz=z+rz*across[j],h=levels[j],k=j*6;
        const compacted=load*outside*(merged ? .52 : 1);
        vertices.set([tx,data.height(tx,tz)+.005+h,tz,profile[j],compacted,Math.min(.92,h/(.010*p.scale))],k);
      }
      row.push(vertices);
    }
    return row;
  }
  function write(a,b){
    const offset=cursor*stride;let i=offset*3,j=offset*3;
    for(const row of [a,b])for(let q=0;q<cols;q++){
      const k=q*6;positions[i++]=row[k];positions[i++]=row[k+1];positions[i++]=row[k+2];
      cut[j++]=row[k+3];cut[j++]=row[k+4];cut[j++]=row[k+5];
    }
    geometry.attributes.position.addUpdateRange(offset*3,stride*3);geometry.attributes.cut.addUpdateRange(offset*3,stride*3);
    cursor=(cursor+1)%capacity;occupied=Math.min(capacity,occupied+1);
  }
  function draw(point){
    const moved=latest?Math.hypot(point.x-latest.x,point.z-latest.z):Infinity;
    if(moved>10||point.skis!==latest?.skis||point.length!==latest?.length){latest=point;older=section(point);return;}
    const spacing=(.39+.24*(1-Math.min(1,point.force)))*(.74+.26*point.scale);
    if(moved<spacing*.78)return;
    const steps=Math.min(22,Math.max(1,Math.round(moved/spacing)));
    for(let i=1;i<=steps;i++){
      const t=i/steps,s={...point,x:lerp(latest.x,point.x,t),z:lerp(latest.z,point.z,t),heading:mixAngle(latest.heading,point.heading,t),travel:mixAngle(latest.travel,point.travel,t)};
      for(const field of ['edge','load','skid','slip','force','soft','press','stance'])s[field]=lerp(latest[field],point[field],t);
      const row=section(s);if(row.length===older.length)for(let j=0;j<row.length;j++)write(older[j],row[j]);older=row;
    }
    latest=point;geometry.setDrawRange(0,occupied*(cols-1)*6);mesh.visible=occupied>0;
    geometry.attributes.position.needsUpdate=geometry.attributes.cut.needsUpdate=true;
  }
  return {draw,lift(){latest=older=null;},clear(){latest=older=null;cursor=occupied=0;geometry.setDrawRange(0,0);mesh.visible=false;}};
}

// Successive cuts stay where the runner left them. Each cross-section curls
// outward, loses coherent snow from its lip, and falls back onto the slope.
function snowFan(scene,data,uniforms){
  const max=60,pairsMax=max+4,cols=5,positions=new Float32Array(pairsMax*cols*2*3),ink=new Float32Array(pairsMax*cols*2*4);
  const idx=new Uint16Array(pairsMax*(cols-1)*6),geo=new THREE.BufferGeometry();
  for(let i=0,k=0;i<pairsMax;i++)for(let j=0;j<cols-1;j++){
    const v=(i*2)*cols+j;idx.set([v,v+cols,v+1,v+1,v+cols,v+cols+1],k);k+=6;
  }
  geo.setAttribute('position',dynamic(positions,3));geo.setAttribute('parcel',dynamic(ink,4));geo.setIndex(new THREE.BufferAttribute(idx,1));geo.setDrawRange(0,0);
  const material=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true,
    vertexShader:`attribute vec4 parcel;varying vec4 v;varying vec3 wp;void main(){v=parcel;wp=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform sampler2D snowGrain;uniform float night,solar;uniform vec3 keyDir,sunColor;varying vec4 v;varying vec3 wp;
      void main(){vec3 grains=texture2D(snowGrain,vec2(v.y*.78,v.x*.98+v.y*.034)).rgb;
        float top=smoothstep(.36,1.,v.x);float pore=.185+.31*top+.41*v.z+top*.16*v.z;
        float mass=smoothstep(pore-.065,pore+.08,grains.r*.63+grains.b*.25+grains.g*.12);
        float ageFade=1.-smoothstep(.17,.69,v.z);
        float opacity=mass*v.w*(.66-.35*top)*(.27+.73*ageFade)*
          smoothstep(0.,.14,v.x)*(1.-smoothstep(.70,.98,v.x));
        if(opacity<.025)discard;vec3 n=normalize(cross(dFdx(wp),dFdy(wp)));if(n.y<0.)n=-n;
        float lit=.29+.51*max(0.,dot(n,keyDir))+.18*grains.r;
        vec3 c=mix(vec3(.34,.47,.60),vec3(.89,.94,.97),lit);
        float scatter=pow(max(0.,dot(normalize(wp-cameraPosition),keyDir)),4.);
        c+=sunColor*solar*(.17+1.49*scatter)*lit;
        gl_FragColor=vec4(c*mix(vec3(1.),vec3(.20,.29,.46),night),opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
  const mesh=new THREE.Mesh(geo,material);mesh.name='Curling edge snow';mesh.frustumCulled=false;mesh.visible=false;mesh.renderOrder=2;scene.add(mesh);
  const rows=Array.from({length:max},()=>({verts:new Float32Array(cols*3)}));
  const widthAt=[0,.35,.70,.88,1],rise=[.04,.40,.93,1,.55];
  const bow=[0,.22,.36,.465].map(()=>({verts:new Float32Array(cols*3)}));
  let cursor=0,used=0,stamp=0,previous=null,chain=0,measure=0,clock=0;
  function update(c,dt){
    clock+=dt;
    if(c&&c.force>(c.soft>.55 ? .13 : .20)&&c.speed>1.3){
      const fx=Math.sin(c.heading),fz=-Math.cos(c.heading),rx=-fz*c.side,rz=fx*c.side;
      const offset=(c.skis?c.stance*.5:0)+c.waist*.46,fore=c.length*(.11+.14*Math.abs(c.edge)+.085*c.slip+.070*c.press);
      const x=c.x+rx*offset+fx*fore,z=c.z+rz*offset+fz*fore;
      const d=previous?Math.hypot(x-previous.x,z-previous.z):0;
      const join=previous&&c.side===previous.side&&c.length===previous.length&&d<3.3&&clock-stamp<.18;
      if(!join||d>.19*c.scale||clock-stamp>.085){
        const slices=join?Math.max(1,Math.min(9,Math.ceil(d/.36))):1;if(!join)chain++;
        for(let i=1;i<=slices;i++){
          const t=i/slices,row=rows[cursor];measure+=(join?d/slices:.30);
          Object.assign(row,{x:join?lerp(previous.x,x,t):x,z:join?lerp(previous.z,z,t):z,rx,rz,fx,fz,scale:c.scale,
            time:join?lerp(stamp,clock,t):clock,chain,measure,soft:c.soft,force:Math.min(1.35,c.force),speed:c.speed,
            seed:.55*Math.sin(measure*8.8)+.45*Math.sin(measure*19.75+.27)});
          cursor=(cursor+1)%max;used=Math.min(max,used+1);
        }
        previous={x,z,side:c.side,length:c.length};stamp=clock;
      }
    }else previous=null;
    let last=null,pairs=0;
    function joinRows(a,b){
      let v=pairs*cols*2*3,k=pairs*cols*2*4;
      for(const row of [a,b]){positions.set(row.verts,v);v+=cols*3;
        for(let j=0;j<cols;j++){ink[k++]=widthAt[j];ink[k++]=row.measure;ink[k++]=row.age;ink[k++]=row.alpha;}}
      pairs++;
    }
    for(let i=0;i<used;i++){
      const r=rows[(cursor-used+i+max)%max],age=clock-r.time,life=.27+.115*r.force+.12*r.soft,u=age/life;
      if(u>=1){last=null;continue;}
      const f=r.force,s=r.scale,soft=r.soft,crest=(.028+f*(.085+.070*soft)+Math.max(0,age*((1.08+1.92*f)*(.78+.18*soft))-4.36*age*age))*s;
      const reach=(.045+.125*f+age*(.65+f*(2.8+.9*soft)))*(1+.21*r.seed)*s;
      for(let j=0;j<cols;j++){
        const w=widthAt[j],drift=reach*w,pull=age*Math.min(1.5,r.speed*.065)*w;
        const x=r.x+r.rx*drift+r.fx*pull,z=r.z+r.rz*drift+r.fz*pull,h=crest*rise[j]*(1+r.seed*.32*w);
        r.verts[j*3]=x;r.verts[j*3+1]=data.height(x,z)+.013+h;r.verts[j*3+2]=z;
      }
      r.age=u;r.alpha=smooth(.09,.64,f)*(1-smooth(.52,1,u));
      if(last&&last.chain===r.chain)joinRows(last,r);
      last=r;
    }
    // Snow packs against the working shovel before it peels into the wake.
    // This close ridge is visible beside the tip in an eye-level camera.
    if(c&&c.force>.20&&c.speed>1.3){
      const fx=Math.sin(c.heading),fz=-Math.cos(c.heading),rx=-fz*c.side,rz=fx*c.side;
      const offset=(c.skis?c.stance*.5:0)+c.waist*.49,along=[.025,.20,.345,.465],lift=[.08,.78,1,.10];
      const crest=c.scale*(.035+c.force*(.14+.11*c.soft)),span=c.scale*(.045+c.force*(.15+.11*c.soft));
      for(let i=0;i<bow.length;i++){
        const row=bow[i],r=lift[i];row.measure=measure+along[i]*c.length*.76;row.age=.035;row.alpha=smooth(.13,.55,c.force)*.96;
        for(let j=0;j<cols;j++){
          const across=offset+widthAt[j]*span*(.30+.70*r),fore=c.length*along[i]+widthAt[j]*span*.19;
          const x=c.x+rx*across+fx*fore,z=c.z+rz*across+fz*fore,k=3*j;
          row.verts[k]=x;row.verts[k+1]=data.height(x,z)+.012+crest*r*rise[j];row.verts[k+2]=z;
        }
        if(i)joinRows(bow[i-1],row);
      }
    }
    mesh.visible=pairs>0;geo.setDrawRange(0,pairs*(cols-1)*6);
    if(pairs){geo.attributes.position.addUpdateRange(0,pairs*cols*2*3);geo.attributes.parcel.addUpdateRange(0,pairs*cols*2*4);geo.attributes.position.needsUpdate=geo.attributes.parcel.needsUpdate=true;}
  }
  return {update,clear(){used=cursor=0;previous=null;mesh.visible=false;geo.setDrawRange(0,0);}};
}
function snowParticles(scene,data,random,uniforms,updateScreen){
  const maxClods=165,maxGrains=170,clods=[],grains=[];
  const shape=new THREE.IcosahedronGeometry(1,1),verts=shape.attributes.position,colors=[];
  for(let i=0;i<verts.count;i++){
    const x=verts.getX(i),y=verts.getY(i),z=verts.getZ(i),q=.94+.15*Math.sin(x*22.1+y*6.7+z*11.3);
    verts.setXYZ(i,x*q,y*q*(y>0?1:.81),z*q);const tone=.92+.07*(.5+.5*Math.sin(Math.floor(i/3)*26.67));colors.push(tone,tone+.012,Math.min(1,tone+.018));
  }
  shape.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));shape.computeVertexNormals();
  const normals=shape.attributes.normal,round=new THREE.Vector3(),face=new THREE.Vector3();
  for(let i=0;i<verts.count;i++){
    round.fromBufferAttribute(verts,i).normalize();face.fromBufferAttribute(normals,i).lerp(round,.74).normalize();normals.setXYZ(i,face.x,face.y,face.z);
  }
  const material=new THREE.MeshLambertMaterial({color:0xf3f5f3,vertexColors:true,emissive:0xffffff});
  const lumps=new THREE.InstancedMesh(shape,material,maxClods),obj=new THREE.Object3D();
  lumps.name='Displaced snow clods';lumps.frustumCulled=false;lumps.count=0;lumps.visible=false;lumps.receiveShadow=true;lumps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(lumps);
  const pos=new Float32Array(maxGrains*3),style=new Float32Array(maxGrains*4),geo=new THREE.BufferGeometry();
  geo.setAttribute('position',dynamic(pos,3));geo.setAttribute('grain',dynamic(style,4));geo.setDrawRange(0,0);
  const grainMat=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,
    vertexShader:`attribute vec4 grain;uniform float screen;uniform vec3 keyDir;varying vec4 v;varying float scatter;
      void main(){vec4 eye=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*eye;
      scatter=pow(max(0.,dot(normalize(position-cameraPosition),keyDir)),5.);
      float px=grain.x*screen*.5*projectionMatrix[1][1]/max(.12,-eye.z);gl_PointSize=clamp(px,.65,15.);v=grain;v.y*=smoothstep(.15,1.05,px)*smoothstep(.24,.67,-eye.z);}`,
    fragmentShader:`uniform float night,solar;uniform vec3 sunColor;varying vec4 v;varying float scatter;
      void main(){vec2 q=gl_PointCoord-.5;float s=sin(v.z),c=cos(v.z);q=mat2(c,-s,s,c)*q;
      float d=max(abs(q.x*.86+q.y*.24),abs(q.y)*1.58+.40*abs(q.x));float a=(1.-smoothstep(.30,.47,d))*v.y;
      if(a<.024)discard;
      vec3 ice=mix(vec3(.61,.72,.87),vec3(.28,.38,.55),night)*(.71+.29*v.w);
      gl_FragColor=vec4(ice+sunColor*solar*(.37+2.2*scatter)*(.55+.45*v.w),a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`});
  const specks=new THREE.Points(geo,grainMat);specks.name='Edge powder and ice crystals';specks.frustumCulled=false;specks.renderOrder=3;specks.visible=false;specks.onBeforeRender=updateScreen;scene.add(specks);
  let chunkBank=0,grainBank=0,previous=null;
  function emit(c,fine,strength,landing,f){
    const live=fine?grains:clods;if(live.length>=(fine?maxGrains:maxClods))return;
    const skid=c.skid,neutral=Math.abs(c.edge)<.09&&c.slip<.07;
    const both=landing ? .48 : neutral ? .49 : .028+.08*(1-skid),bank=random()<both?-c.side:c.side;
    const forward=Math.sin(c.heading),north=-Math.cos(c.heading),rx=-north,rz=forward;
    const lane=c.skis?bank*c.stance*.5*(random()<.88?1:-1):0;
    const across=lane+bank*c.waist*(.41+.10*random());
    const fore=random()<.30&&c.force>.24?(.26+.145*random()):((random()-.53)*.60+.15*c.press+.12*c.slip),along=c.length*clamp(fore,-.37,.43);
    const x=lerp(previous?.x??c.x,c.x,f)+rx*across+forward*along,z=lerp(previous?.z??c.z,c.z,f)+rz*across+north*along;
    const size=c.scale,soft=c.soft,pw=Math.min(1.4,strength),root=Math.sqrt(size);
    const out=bank*(.32+pw*(1.25+random()*(fine?3.85:3.12)))*(1+.12*soft)*root;
    const carry=c.speed*(.035+random()*.11+pw*.095)-random()*.30;
    const upward=(.18+random()*(fine ? .95 : .53)+pw*(fine?1.60+random()*2.24:1.03+random()*1.85))*root;
    const vx=rx*out+Math.sin(c.travel)*carry,vz=rz*out-Math.cos(c.travel)*carry;
    const radius=(fine ? .008+random()*.024 : (.008+random()**1.4*.024+.005*soft)*(.84+.38*pw))*size;
    live.push({x,y:data.height(x,z)+.018+radius*1.1,z,vx,vy:upward,vz,age:0,life:.44+random()*(fine ? .47 : .34)+.20*pw,
      r:radius,q:random(),turn:random()*Math.PI*2,spin:(random()-.5)*9,flat:.61+.42*random(),rest:false});
  }
  function drift(live,dt,fine){
    let n=0;
    for(let i=0;i<live.length;i++){
      const a=live[i];a.age+=dt;if(a.age>=a.life)continue;
      if(!a.rest){
        a.x+=a.vx*dt;a.z+=a.vz*dt;a.y+=a.vy*dt-4.82*dt*dt;a.vy-=9.64*dt;
        const drag=1/(1+dt*(fine?1.59:.84));a.vx*=drag;a.vz*=drag;
        if(a.vy<1){const h=data.height(a.x,a.z)+(fine ? .008 : a.r*.30);
          if(a.y<=h){if(fine)continue;a.y=h;a.rest=true;a.life=Math.min(a.life,a.age+.10+.05*a.q);}}
      }
      live[n]=a;const tail=Math.min(1,(a.life-a.age)/(fine ? .19 : .14));
      if(fine){const k=n*3,j=n*4;pos[k]=a.x;pos[k+1]=a.y;pos[k+2]=a.z;
        style[j]=a.r;style[j+1]=tail*(.52+.42*a.q);style[j+2]=a.turn+a.age*a.spin;style[j+3]=a.q;
      }else{const r=a.r*(.42+.58*tail);obj.position.set(a.x,a.y,a.z);obj.rotation.set(a.q*3.12+a.age*a.spin,a.turn+a.age*a.spin*.71,a.q*8.5);
        obj.scale.set(r*(1.07+.33*a.q),r*a.flat,r*(.82+.32*a.q));obj.updateMatrix();lumps.setMatrixAt(n,obj.matrix);}
      n++;
    }
    live.length=n;
    if(fine){specks.visible=n>0;geo.setDrawRange(0,n);if(n){geo.attributes.position.addUpdateRange(0,n*3);geo.attributes.grain.addUpdateRange(0,n*4);geo.attributes.position.needsUpdate=geo.attributes.grain.needsUpdate=true;}}
    else{lumps.visible=n>0;lumps.count=n;if(n){lumps.instanceMatrix.addUpdateRange(0,n*16);lumps.instanceMatrix.needsUpdate=true;}}
  }
  function update(c,dt,impact){
    if(c){
      if(previous&&(Math.hypot(previous.x-c.x,previous.z-c.z)>6||c.length!==previous.length))previous=null;
      if(impact>.12){
        const power=Math.min(1.4,impact)*(.75+.25*c.soft);
        for(let n=Math.round((6+power*17)*(.72+.28*c.scale));n>0;n--)emit(c,false,power,true,1);
        for(let n=Math.round((2+power*9)*(.72+.28*c.scale));n>0;n--)emit(c,true,power,true,1);
      }
      const engaged=Math.max(0,c.force-.04),v=smooth(.55,12,c.speed);
      chunkBank+=dt*engaged*(38+39*c.soft+15*c.skid)*v;
      grainBank+=dt*Math.max(0,c.force-.15)*(25+18*c.skid)*v;
      const chunks=Math.floor(chunkBank),bits=Math.floor(grainBank);chunkBank-=chunks;grainBank-=bits;
      for(let i=0;i<chunks;i++)emit(c,false,c.force,false,(i+random())/chunks);
      for(let i=0;i<bits;i++)emit(c,true,c.force,false,(i+random())/bits);
      previous=c;
    }else{chunkBank=grainBank=0;previous=null;}
    if(clods.length){const sun=1-uniforms.night.value;material.emissive.setRGB(.009+sun*.18,.012+sun*.20,.019+sun*.22);}
    drift(clods,dt,false);drift(grains,dt,true);
  }
  return {update,clear(){previous=null;clods.length=grains.length=0;chunkBank=grainBank=lumps.count=0;lumps.visible=specks.visible=false;geo.setDrawRange(0,0);}};
}

function powderWake(scene,data,random,uniforms,updateScreen){
  const capacity=92,live=[];
  const positions=new Float32Array(capacity*3),shapes=new Float32Array(capacity*4);
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',dynamic(positions,3));
  geo.setAttribute('puff',dynamic(shapes,4));
  const mat=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,
    vertexShader:`attribute vec4 puff;uniform float screen;uniform vec3 keyDir;varying vec4 shape;varying float lit;
      void main(){
        vec4 eye=modelViewMatrix*vec4(position,1.);
        gl_Position=projectionMatrix*eye;
        float depth=-eye.z;
        float pixels=puff.x*screen*.5*projectionMatrix[1][1]/max(.1,depth);
        gl_PointSize=clamp(pixels,1.,104.);
        float fade=smoothstep(1.8,4.7,depth)*(1.-smoothstep(90.,154.,pixels));
        shape=vec4(puff.x,puff.y*fade,puff.z,puff.w);
        lit=.54+.46*pow(max(0.,dot(normalize(position-cameraPosition),keyDir)),3.);
      }`,
    fragmentShader:`uniform sampler2D snowGrain;uniform float night,solar;uniform vec3 sunColor;varying vec4 shape;varying float lit;
      void main(){
        vec2 uv=gl_PointCoord-.5;
        float radial=length(uv*vec2(1.02,1.38)+vec2(0.,.10));
        vec3 fine=texture2D(snowGrain,uv*.94+vec2(shape.z,shape.z*.643+shape.w*.12)).rgb;
        float density=(.55*fine.r+.29*fine.g+.16*fine.b);
        float opacity=(1.-smoothstep(.16,.49,radial+(density-.54)*.22))*shape.y;
        opacity*=smoothstep(.19,.65,density);
        if(opacity<.013)discard;
        float top=clamp((.47-uv.y)*.97+lit*.42+density*.28,0.,1.);
        vec3 color=mix(vec3(.33,.44,.65),vec3(.85,.90,1.03),top)+sunColor*solar*(.15+1.48*pow(lit,2.8))*top;
        gl_FragColor=vec4(color*mix(vec3(1.),vec3(.22,.32,.49),night),opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const cloud=new THREE.Points(geo,mat);
  cloud.name='Windblown carve wake';cloud.frustumCulled=false;cloud.visible=false;
  cloud.renderOrder=3;cloud.onBeforeRender=updateScreen;scene.add(cloud);
  let bank=0,previous=null;
  function update(c,dt,impact,wind=.18){
    if(c){
      const hard=clamp((c.force-(.23-.15*c.soft))*1.3,0,1.10)*smooth(3.8,15,c.speed);
      bank+=dt*hard*(35+31*c.soft+19*c.skid);
      const count=Math.floor(bank);bank-=count;
      const landing=Math.round(impact*(3+4*c.soft));
      const vx=Math.sin(c.travel),vz=-Math.cos(c.travel);
      const sideX=Math.cos(c.heading)*c.side,sideZ=Math.sin(c.heading)*c.side;
      const edge=(c.skis?c.stance*.5:0)+c.waist*.45;
      for(let i=0;i<count+landing&&live.length<capacity;i++){
        const power=i<count?hard:Math.min(1,impact);
        const f=(i+random())/Math.max(1,count+landing),start=previous||c;
        const across=edge+.06+random()*.23,trail=c.length*(.24+random()*.18);
        const x=lerp(start.x,c.x,f)-vx*trail+sideX*across,z=lerp(start.z,c.z,f)-vz*trail+sideZ*across;
        const drift=(.68+random()*1.45+power*1.7)*c.scale;
        live.push({x,z,y:data.height(x,z)+(.13+.16*random())*c.scale,age:0,
          vx:sideX*drift+vx*c.speed*.09+wind*.46,vz:sideZ*drift+vz*c.speed*.09+wind*.18,
          life:.56+.56*random()+.26*c.soft,lift:(.48+power*.96)*c.scale,scale:c.scale,
          force:power,seed:random()});
      }
      previous=c;
    }else{previous=null;bank=0;}
    let count=0;
    for(const puff of live){
      puff.age+=dt;
      if(puff.age>=puff.life)continue;
      const age=puff.age/puff.life,drift=1/(1+dt*1.55);
      puff.x+=puff.vx*dt;puff.z+=puff.vz*dt;puff.vx*=drift;puff.vz*=drift;
      puff.y=Math.max(data.height(puff.x,puff.z)+.10,puff.y+dt*puff.lift*(1-1.23*age));
      const at=count*3,style=count*4;
      positions[at]=puff.x;positions[at+1]=puff.y;positions[at+2]=puff.z;
      shapes[style]=puff.scale*(.38+age*(.72+puff.force*.64));
      shapes[style+1]=puff.force*.66*smooth(0,.10,age)*(1-smooth(.24,1,age));
      shapes[style+2]=puff.seed;shapes[style+3]=age;
      live[count++]=puff;
    }
    live.length=count;cloud.visible=count>0;geo.setDrawRange(0,count);
    if(count){geo.attributes.position.needsUpdate=true;geo.attributes.puff.needsUpdate=true;}
  }
  return {update,clear(){live.length=0;previous=null;bank=0;cloud.visible=false;geo.setDrawRange(0,0);}};
}

export function makeSnowFX(scene,data,snowAir){
  const random=randomGenerator(6127),screen={value:720},night={value:0},viewport=new THREE.Vector2();
  const uniforms={screen,night,squall:{value:0},solar:{value:0},snowSky:{value:0},sunColor:{value:new THREE.Color()},haze:{value:0},keyDir:{value:new THREE.Vector3(.36,.75,.55).normalize()},snowGrain:{value:powderGrain()}};
  const updateScreen=renderer=>{screen.value=renderer.getDrawingBufferSize(viewport).y;};
  const tracks=snowTracks(scene,data,uniforms),fan=snowFan(scene,data,uniforms),particles=snowParticles(scene,data,random,uniforms,updateScreen);
  const wake=powderWake(scene,data,randomGenerator(6419),uniforms,updateScreen);
  const flakeCount=1100,flakes=new Float32Array(flakeCount*3),specks=new Float32Array(flakeCount*3);
  for(let i=0;i<flakeCount;i++){
    flakes[i*3]=(random()-.5)*39;flakes[i*3+1]=random()*24-9;flakes[i*3+2]=(random()-.5)*39;
    specks[i*3]=.014+random()*.050;specks[i*3+1]=random()*6.28;specks[i*3+2]=.58+random()*.38;
  }
  const fg=new THREE.BufferGeometry();fg.setAttribute('position',new THREE.BufferAttribute(flakes,3).setUsage(THREE.DynamicDrawUsage));
  fg.setAttribute('speck',new THREE.BufferAttribute(specks,3));fg.setDrawRange(0,0);
  const fallMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms,
    vertexShader:`attribute vec3 speck;uniform float screen,squall;varying vec2 flakeAxis;varying float opacity,scatter;uniform vec3 keyDir;
      void main(){vec4 eye=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*eye;
      scatter=pow(max(0.,dot(normalize(position),keyDir)),4.);
      vec2 motion=(mat3(viewMatrix)*vec3(.90,-.58,.28)).xy;
      flakeAxis=normalize(vec2(motion.x,-motion.y)+vec2(.0001));
      gl_PointSize=clamp(speck.x*screen*.45*projectionMatrix[1][1]/max(.1,-eye.z),.65,8.)*(1.+2.3*squall);
      opacity=speck.z*smoothstep(.65,2.3,-eye.z)*(1.-smoothstep(17.,25.,-eye.z));}`,
    fragmentShader:`uniform float night,snowSky,squall;uniform vec3 sunColor;varying vec2 flakeAxis;varying float opacity,scatter;void main(){vec2 p=gl_PointCoord-.5;
      p=mix(p,vec2(dot(p,flakeAxis),dot(p,vec2(-flakeAxis.y,flakeAxis.x))*3.5),squall);
      float a=(1.-smoothstep(.2,.5,length(p*vec2(1.05,.88))))*opacity;
      gl_FragColor=vec4(mix(vec3(.87,.92,1.),vec3(.48,.59,.77),night)+sunColor*snowSky*(.10+.55*scatter),a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`});
  const falling=new THREE.Points(fg,fallMat);falling.name='Falling snow';falling.visible=false;falling.frustumCulled=false;falling.renderOrder=4;
  falling.onBeforeRender=updateScreen;scene.add(falling);
  const oldView=new THREE.Vector3();let hadSnow=false,windTime=0,wasAirborne=false,movingSnow=false;
  const wrap=(v,span,min)=>v-min-Math.floor((v-min)/span)*span+min;
  function snowfall(dt,weather,view) {
    const type=weather?.resolvedWeather??weather;
    const amount=clamp(weather?.snowAmount??(type==='heavy'?1:type==='light'||type==='snow' ? .34:0),0,1);
    uniforms.squall.value=weather?.sceneId==='squall'?amount*(weather.sceneStrength??1):0;
    const n=type!=='clear'&&amount>.002?Math.max(3,Math.floor(flakeCount*amount**1.19)):0;
    falling.visible=!!n;fg.setDrawRange(0,n);
    if(!n||!view){hadSnow=false;return;}
    const wind=clamp(weather?.wind??(.18+.62*amount),0,1);
    const dx=hadSnow?oldView.x-view.x:0,dy=hadSnow?oldView.y-view.y:0,dz=hadSnow?oldView.z-view.z:0;
    falling.position.copy(view);oldView.copy(view);hadSnow=true;windTime+=dt;
    for(let i=0;i<n;i++){
      const k=i*3,w=specks[k+1],gust=Math.sin(windTime*1.7+w)*.29;
      flakes[k]=wrap(flakes[k]+dx+dt*(.20+3.3*wind+gust+uniforms.squall.value*4.1),39,-19.5);
      flakes[k+1]=wrap(flakes[k+1]+dy-dt*(.82+specks[k]*15+wind*.63),24,-9);
      flakes[k+2]=wrap(flakes[k+2]+dz+dt*(wind*.78+Math.cos(w+windTime)*.18),39,-19.5);
    }
    fg.attributes.position.needsUpdate=true;
  }
  return {
    snowfall,
    reset(){tracks.clear();fan.clear();particles.clear();wake.clear();hadSnow=wasAirborne=movingSnow=false;},
    update(p,dt,weather,view,dimensions){
      night.value=weather?.nightAmount??0;uniforms.haze.value=scene.fog?.density??0;
      if(weather?.dir)uniforms.keyDir.value.fromArray(weather.dir);
      const sunlight=weather?.sunAmount??0;
      uniforms.solar.value=sunlight*(sunlight>.08 ? snowAir.sunAt(p.x,p.y+.7,p.z,weather) : 0);
      uniforms.snowSky.value=sunlight*(sunlight>.08&&view ? snowAir.sunAt(view.x,view.y+1.1,view.z,weather) : 0);
      if(weather?.sun)uniforms.sunColor.value.setHex(weather.sun);
      snowfall(dt,weather,view);
      if(p.mode!=='run'){
        if(movingSnow){tracks.lift();fan.clear();particles.clear();wake.clear();movingSnow=false;}wasAirborne=false;return;
      }
      movingSnow=true;
      const inAir=!!p.airborne||(p.airHeight||0)>.04,impact=!inAir&&wasAirborne?(p.impact??p.landing??.45):0;
      const contact=!inAir&&(p.speed>.35||impact>.12)?snowContact(p,dimensions):null;
      if(contact&&p.speed>.35)tracks.draw(contact);else tracks.lift();
      fan.update(contact,dt);particles.update(contact,dt,impact);wake.update(contact,dt,impact,weather?.wind);wasAirborne=inAir;
    }
  };
}
