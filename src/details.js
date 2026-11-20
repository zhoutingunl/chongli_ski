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
export function courseDetails(scene,data,navigation) {
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
  const gateCount=Math.max(...data.routes.map(r=>Math.ceil(r.length/190)+1));
  const flags=new THREE.InstancedMesh(gateCloth,new THREE.MeshLambertMaterial({side:THREE.DoubleSide}),gateCount);
  const staffs=new THREE.InstancedMesh(plank,new THREE.MeshLambertMaterial({color:0x334856}),gateCount);
  const gatePose=new THREE.Object3D(),flagColor=new THREE.Color();
  for(const mesh of [flags,staffs]){mesh.count=0;mesh.frustumCulled=false;scene.add(mesh);}
  let activeRoute=null;
  function setRoute(route){
    if(route===activeRoute)return;
    activeRoute=route;let i=0;
    if(route)for(let at=32;at<route.length-16;at+=190){
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
    if(taken.has(b.id)||b.footprint.length<4)continue;
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

function powderStamp() {
  const size=64, data=new Uint8Array(size*size*4), random=randomGenerator(28419);
  const noise=new Float32Array(32*32);
  for(let i=0;i<noise.length;i++)noise[i]=random();
  function grain(x,y){
    const i=Math.floor(x),j=Math.floor(y),f=x-i,g=y-j;
    const a=f*f*(3-2*f),b=g*g*(3-2*g);
    const at=(ix,iy)=>noise[(ix&31)+(iy&31)*32];
    return ((1-a)*at(i,j)+a*at(i+1,j))*(1-b)+((1-a)*at(i,j+1)+a*at(i+1,j+1))*b;
  }
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/(size-1),v=y/(size-1),dx=2*u-1,dy=2*v-1;
    const n=.55*grain(u*4+2,v*4+7)+.28*grain(u*9+8,v*9+1)+.17*grain(u*23,v*23);
    const r=Math.hypot(dx,dy)*(1.04+.37*(n-.5)),i=4*(y*size+x);
    const body=clamp((1-r)*2.5,0,1);
    data[i]=186+Math.round(62*n);data[i+1]=data[i+2]=255;
    data[i+3]=Math.round(255*body*body*(.19+.81*n));
  }
  const stamp=new THREE.DataTexture(data,size,size);stamp.magFilter=THREE.LinearFilter;
  stamp.minFilter=THREE.LinearMipmapLinearFilter;stamp.generateMipmaps=true;stamp.needsUpdate=true;return stamp;
}

function snowTracks(scene,data) {
  const limit=7900, geometry=new THREE.BufferGeometry(), positions=new Float32Array(limit*18);
  const profile=new Float32Array(limit*12),attribute=(array,n)=>new THREE.BufferAttribute(array,n).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position',attribute(positions,3));geometry.setAttribute('cut',attribute(profile,2));
  geometry.setDrawRange(0,0);
  const material=new THREE.ShaderMaterial({
    uniforms:{night:{value:0},haze:{value:0}},
    transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,
    vertexShader:`attribute vec2 cut;
      varying vec2 vCut;varying float depth;
      void main(){vCut=cut;vec4 eye=modelViewMatrix*vec4(position,1.0);depth=-eye.z;gl_Position=projectionMatrix*eye;}`,
    fragmentShader:`uniform float night;uniform float haze;varying vec2 vCut;varying float depth;
      void main(){
        float u=vCut.x;
        float rim=smoothstep(.63,.85,u)*(1.-smoothstep(.89,1.,u));
        float furrow=smoothstep(.02,.32,u)*(1.-smoothstep(.55,.90,u));
        float opacity=(furrow*.31+rim*.50)*vCut.y*exp(-haze*haze*depth*depth);
        vec3 ink=mix(vec3(.18,.28,.38),vec3(.88,.94,.99),rim);
        gl_FragColor=vec4(ink*mix(vec3(1.),vec3(.22,.29,.41),night),opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const mesh=new THREE.Mesh(geometry,material);mesh.name='Continuous edge tracks';mesh.frustumCulled=false;mesh.renderOrder=1;scene.add(mesh);
  let cursor=0,visible=0,latest=null,rows=null;
  const mix=(a,b,t)=>a+(b-a)*t;
  function section(a) {
    const noseX=Math.sin(a.heading),noseZ=-Math.cos(a.heading),sideX=-noseZ,sideZ=noseX;
    const widthX=Math.cos(a.travel),widthZ=Math.sin(a.travel);
    const slip=Math.abs(Math.sin(a.heading-a.travel));
    const skied=a.gear==='ski',tail=skied ? .51:.39;
    const footprint=(skied ? .048:.122)+slip*(skied ? .54:.60)*(.47+.53*a.skid);
    const edgeSide=Math.abs(a.edge)>.075?Math.sign(a.edge):a.side;
    const lanes=skied?[-1,1]:[0];
    return lanes.map(lane=>{
      const offset=lane*(.141+.034*a.load+.029*a.skid)+edgeSide*(skied ? .027:.104)*Math.min(1,Math.abs(a.edge)*1.6);
      const tailShift=tail-Math.max(0,a.press)*(skied ? .63 : .79)+Math.max(0,-a.press)*.20+(skied?lane*a.edge*.058:0),x=a.x-noseX*tailShift+sideX*offset,z=a.z-noseZ*tailShift+sideZ*offset;
      const half=Math.max(skied ? .025:.041,footprint*(1-.38*Math.abs(a.edge)*(1-a.skid)));
      const stroke=[];
      for(const s of [-1,1]){
        const tx=x+widthX*half*s,tz=z+widthZ*half*s;
        stroke.push([tx,data.height(tx,tz)+.026,tz]);
      }
      return stroke;
    });
  }
  function stampSegment(a,b,power,flip) {
    const v=cursor*18,k=cursor*12,order=[a[0],b[0],a[1],a[1],b[0],b[1]],sides=[0,0,1,1,0,1];
    for(let j=0;j<6;j++){
      positions[v+j*3]=order[j][0];positions[v+j*3+1]=order[j][1];positions[v+j*3+2]=order[j][2];
      profile[k+2*j]=flip?1-sides[j]:sides[j];profile[k+2*j+1]=power;
    }
    geometry.attributes.position.addUpdateRange(v,18);geometry.attributes.cut.addUpdateRange(k,12);
    cursor=(cursor+1)%limit;visible=Math.min(limit,visible+1);
  }
  return {
    lighting(night,density){material.uniforms.night.value=night;material.uniforms.haze.value=density;},
    clear(){latest=rows=null;cursor=visible=0;geometry.setDrawRange(0,0);},
    lift(){latest=rows=null;},
    draw(p){
      const point={x:p.x,z:p.z,heading:p.heading,travel:p.travelHeading??p.heading,edge:p.edge??p.steer,
        skid:p.skid??p.brake,press:p.press||0,load:p.pressure??Math.abs(p.steer),gear:p.gear,side:p.cutSide||1};
      const moved=latest?Math.hypot(point.x-latest.x,point.z-latest.z):Infinity;
      if(!latest||point.gear!==latest.gear||moved>12){latest=point;rows=section(point);return;}
      if(moved<.24)return;
      const sections=Math.min(30,Math.max(1,Math.ceil(moved/.38)));
      for(let i=1;i<=sections;i++){
        const f=i/sections;
        const sample={...point,x:mix(latest.x,point.x,f),z:mix(latest.z,point.z,f),
          travel:mixAngle(latest.travel,point.travel,f),heading:mixAngle(latest.heading,point.heading,f),
          edge:mix(latest.edge,point.edge,f),press:mix(latest.press,point.press,f),load:mix(latest.load,point.load,f),skid:mix(latest.skid,point.skid,f)};
        const next=section(sample),power=.46+.30*sample.load+.42*sample.skid;
        const dir=Math.abs(sample.edge)>.1?Math.sign(sample.edge):sample.side;
        for(let k=0;k<next.length;k++){
          const outside=next.length===2&&((k===0&&dir>0)||(k===1&&dir<0));
          stampSegment(rows[k],next[k],power*(outside?1.12:.89),dir>0);
        }
        rows=next;
      }
      latest=point;geometry.setDrawRange(0,visible*6);
      geometry.attributes.position.needsUpdate=true;geometry.attributes.cut.needsUpdate=true;
    }
  };
}

export function makeSnowFX(scene,data) {
  const stamp=powderStamp(),random=randomGenerator(6127),count=700;
  const positions=new Float32Array(count*3),velocity=new Float32Array(count*3),info=new Float32Array(count*4);
  const age=new Float32Array(count),lifetime=new Float32Array(count),power=new Float32Array(count),seed=new Float32Array(count);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('grain',new THREE.BufferAttribute(info,4).setUsage(THREE.DynamicDrawUsage));
  const screen={value:720},night={value:0},viewport=new THREE.Vector2();
  const material=new THREE.ShaderMaterial({
    uniforms:{stamp:{value:stamp},screen,night},transparent:true,depthWrite:false,
    vertexShader:`attribute vec4 grain;
      uniform float screen;varying vec4 vGrain;
      void main(){
        vec4 eye=modelViewMatrix*vec4(position,1.);
        gl_Position=projectionMatrix*eye;
        gl_PointSize=clamp(grain.x*screen*.5*projectionMatrix[1][1]/max(.10,-eye.z),.01,228.);
        vGrain=grain;
        vGrain.y*=smoothstep(.12,.48,-eye.z);
      }`,
    fragmentShader:`uniform sampler2D stamp;uniform float night;varying vec4 vGrain;
      void main(){
        if(vGrain.y<.004)discard;
        float a=vGrain.z; vec2 p=gl_PointCoord-.5;
        vec2 uv=mat2(cos(a),-sin(a),sin(a),cos(a))*p+.5;
        vec4 tex=texture2D(stamp,clamp(uv,0.,1.));
        float fine=step(.5,vGrain.w);
        float mask=mix(tex.a,(1.-smoothstep(.13,.48,length(p))),fine)*vGrain.y;
        float light=clamp(.25+(tex.r-.70)*1.73+(1.-gl_PointCoord.y)*.36,0.,1.);
        vec3 shade=mix(vec3(.36,.48,.63),vec3(.99,.985,.96),mix(light,1.,fine));
        gl_FragColor=vec4(shade*mix(vec3(1.),vec3(.29,.37,.56),night),mask);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const spray=new THREE.Points(geometry,material);spray.name='Edge powder and ice crystals';spray.frustumCulled=false;spray.renderOrder=3;
  spray.onBeforeRender=renderer=>{screen.value=renderer.getDrawingBufferSize(viewport).y;};scene.add(spray);
  const tracks=snowTracks(scene,data);
  const flakeCount=1100,flakes=new Float32Array(flakeCount*3),specks=new Float32Array(flakeCount*3);
  for(let i=0;i<flakeCount;i++){
    flakes[i*3]=(random()-.5)*39;flakes[i*3+1]=random()*24-9;flakes[i*3+2]=(random()-.5)*39;
    specks[i*3]=.014+random()*.050;specks[i*3+1]=random()*6.28;specks[i*3+2]=.58+random()*.38;
  }
  const fg=new THREE.BufferGeometry();fg.setAttribute('position',new THREE.BufferAttribute(flakes,3).setUsage(THREE.DynamicDrawUsage));
  fg.setAttribute('speck',new THREE.BufferAttribute(specks,3));fg.setDrawRange(0,0);
  const fallMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{screen,night},
    vertexShader:`attribute vec3 speck;uniform float screen;varying float opacity;
      void main(){vec4 eye=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*eye;
      gl_PointSize=clamp(speck.x*screen*.5*projectionMatrix[1][1]/max(.1,-eye.z),.7,12.);
      opacity=speck.z*smoothstep(.2,1.3,-eye.z)*(1.-smoothstep(17.,25.,-eye.z));}`,
    fragmentShader:`uniform float night;varying float opacity;void main(){vec2 p=gl_PointCoord-.5;
      float a=(1.-smoothstep(.2,.5,length(p*vec2(1.05,.88))))*opacity;
      gl_FragColor=vec4(mix(vec3(.93,.96,1.),vec3(.48,.59,.77),night),a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`});
  const falling=new THREE.Points(fg,fallMat);falling.name='Falling snow';falling.visible=false;falling.frustumCulled=false;falling.renderOrder=4;
  falling.onBeforeRender=spray.onBeforeRender;scene.add(falling);
  const oldView=new THREE.Vector3();let hadSnow=false,windTime=0,cursor=0,dustBank=0,grainBank=0;
  const wrap=(v,span,min)=>v-min-Math.floor((v-min)/span)*span+min;
  function snowfall(dt,weather,view) {
    const type=weather?.resolvedWeather??weather;
    const amount=clamp(weather?.snowAmount??(type==='heavy'?1:type==='light'||type==='snow' ? .34:0),0,1);
    const n=type!=='clear'&&amount>.002?Math.max(3,Math.floor(flakeCount*amount**1.19)):0;
    falling.visible=!!n;fg.setDrawRange(0,n);
    if(!n||!view){hadSnow=false;return;}
    const wind=clamp(weather?.wind??(.18+.62*amount),0,1);
    const dx=hadSnow?oldView.x-view.x:0,dy=hadSnow?oldView.y-view.y:0,dz=hadSnow?oldView.z-view.z:0;
    falling.position.copy(view);oldView.copy(view);hadSnow=true;windTime+=dt;
    for(let i=0;i<n;i++){
      const k=i*3,w=specks[k+1],gust=Math.sin(windTime*1.7+w)*.29;
      flakes[k]=wrap(flakes[k]+dx+dt*(.20+3.3*wind+gust),39,-19.5);
      flakes[k+1]=wrap(flakes[k+1]+dy-dt*(.82+specks[k]*15+wind*.63),24,-9);
      flakes[k+2]=wrap(flakes[k+2]+dz+dt*(wind*.78+Math.cos(w+windTime)*.18),39,-19.5);
    }
    fg.attributes.position.needsUpdate=true;
  }
  function puff(p,strength,fine) {
    const k=cursor++%count,i=k*3;
    const fx=Math.sin(p.heading),fz=-Math.cos(p.heading),rx=-fz,rz=fx;
    const slip=p.slipAngle??0,edge=p.edge??p.steer,side=-Math.sign(Math.abs(slip)>.095?slip:(edge||0));
    const bank=(side&&random()<.68+.28*Math.min(1,strength))?side:(random()<.5?-1:1);
    const grip=p.gear==='ski' ? .167:.11;
    const s=grip*bank+(random()-.5)*(.07+.12*strength),tail=.20+random()*(p.gear==='ski' ? .54:.46)
      -Math.max(0,p.press||0)*(p.gear==='ski' ? .59:.76)+Math.max(0,-(p.press||0))*.20;
    const x=p.x-fx*tail+rx*s,z=p.z-fz*tail+rz*s;
    positions[i]=x;positions[i+1]=data.height(x,z)+.061+random()*.075;positions[i+2]=z;
    const fan=bank*(.18+strength*(.88+random()*3)+(fine?random()*1.35:0));
    const carry=p.speed*(.09+.16*random()+.17*Math.min(1,strength))-random()*.56;
    const flow=p.travelHeading??p.heading;
    velocity[i]=rx*fan+Math.sin(flow)*carry;
    velocity[i+1]=(.18+random()*(fine?2.85:1.35))+strength*(fine?3.27:2.15);
    velocity[i+2]=rz*fan-Math.cos(flow)*carry;
    age[k]=0;lifetime[k]=fine ? .29+random()*.46:.48+random()*.43+strength*.79;
    power[k]=strength;seed[k]=random();info[k*4+2]=random()*6.28;info[k*4+3]=+fine;
  }
  return {
    reset(){
      tracks.clear();cursor=0;dustBank=grainBank=0;lifetime.fill(0);info.fill(0);
      geometry.attributes.grain.needsUpdate=true;hadSnow=false;
    },
    update(p,dt,weather,view){
      night.value=weather?.nightAmount??0;tracks.lighting(night.value,scene.fog?.density??0);
      snowfall(dt,weather,view);
      const ground=p.mode==='run' && !p.airborne && p.airHeight<.05 && p.speed>.40;
      if(ground){
        tracks.draw(p);
        const cut=p.spray??(.065+.5*Math.abs(p.steer)+.72*p.brake);
        const strength=clamp(cut*(p.onTrail===false?1.14:1),0,1.48);
        const speed=clamp(p.speed/6,.09,1);
        dustBank+=dt*(2+strength*105)*speed;
        grainBank+=dt*(6+strength*184)*speed;
        while(dustBank>=1){dustBank--;puff(p,strength,false);}
        while(grainBank>=1){grainBank--;puff(p,strength,true);}
      }else{tracks.lift();dustBank=grainBank=0;}
      let visible=false;
      for(let k=0;k<count;k++){
        const i=k*3,j=k*4;
        if(lifetime[k]<=0){info[j]=info[j+1]=0;continue;}
        age[k]+=dt;const u=age[k]/lifetime[k];
        if(u>=1){lifetime[k]=0;info[j]=info[j+1]=0;continue;}
        const fine=info[j+3]>.5,pw=power[k],drag=Math.exp(-dt*(fine ? .79:1.68));visible=true;
        positions[i]+=velocity[i]*dt;positions[i+1]+=velocity[i+1]*dt;positions[i+2]+=velocity[i+2]*dt;
        velocity[i]*=drag;velocity[i+2]*=drag;velocity[i+1]-=(fine?8.35:2.15)*dt;
        if(velocity[i+1]<0&&positions[i+1]<data.height(positions[i],positions[i+2])+.035){
          if(fine){lifetime[k]=0;info[j]=info[j+1]=0;continue;}
          positions[i+1]=data.height(positions[i],positions[i+2])+.035;velocity[i+1]=.06;
        }
        const fade=Math.min(1,age[k]/.073)*(1-u)**(fine ? .70:1.34);
        info[j]=fine?(.008+.034*seed[k])*(.7+.56*pw):(.12+.26*seed[k]+.31*pw)+age[k]*(.66+pw*1.88);
        info[j+1]=fade*(fine ? .46+.41*seed[k]:.23+.64*pw);
        if(!fine)info[j+2]+=dt*(seed[k]-.5)*1.3;
      }
      spray.visible=visible;geometry.attributes.position.needsUpdate=geometry.attributes.grain.needsUpdate=true;
    }
  };
}
