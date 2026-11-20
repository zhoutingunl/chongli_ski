import * as THREE from 'three';
import {HeightField,clamp,randomGenerator} from './mountain.js';

const asset = name => import.meta.env.BASE_URL+'assets/'+name;
const glNoise = `
float hash21(vec2 p) { vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z); }
float noise21(vec2 p) {vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),mix(hash21(i+vec2(0.,1.)),hash21(i+1.),f.x),f.y);}
`;

function dataTexture(r,g,b) {
  const t=new THREE.DataTexture(new Uint8Array([r,g,b,255]),1,1);t.needsUpdate=true;return t;
}
function loadTexture(url,space=THREE.NoColorSpace) {
  return new Promise((resolve,reject)=>new THREE.TextureLoader().load(url,t=>{
    t.colorSpace=space;t.flipY=false;t.anisotropy=4;resolve(t);
  },undefined,reject));
}
function prepareTrailMask(data) {
  const size=2048,el=document.createElement('canvas');el.width=el.height=size;
  const c=el.getContext('2d');c.fillStyle='#000';c.fillRect(0,0,size,size);
  const b=data.bounds, sx=size/(b.maxX-b.minX),sz=size/(b.maxZ-b.minZ);
  const toPix=([x,z])=>[(x-b.minX)*sx,(z-b.minZ)*sz];
  c.lineCap='round';c.lineJoin='round';
  for(const trail of data.trails){
    const points=trail.points;
    for(let i=1;i<points.length;i++){
      const a=toPix(points[i-1]),d=toPix(points[i]),dx=d[0]-a[0],dz=d[1]-a[1],l=Math.hypot(dx,dz)||1;
      c.strokeStyle='rgb(255,'+Math.round(127.5+dx/l*127.5)+','+Math.round(127.5+dz/l*127.5)+')';
      c.lineWidth=(trail.width||36)*sx;c.beginPath();c.moveTo(...a);c.lineTo(...d);c.stroke();
    }
  }
  const t=new THREE.CanvasTexture(el);t.flipY=false;t.colorSpace=THREE.NoColorSpace;t.anisotropy=4;return t;
}
function addTerrainTiles(scene,field,material,innerBounds=null) {
  const {cols,rows,dx,dz,bounds:b,heights:h}=field, tile=52;
  for(let r=0;r<rows-1;r+=tile)for(let c=0;c<cols-1;c+=tile){
    const endR=Math.min(rows-1,r+tile),endC=Math.min(cols-1,c+tile),stride=endC-c+1;
    const positions=[],normals=[],indices=[];
    for(let j=r;j<=endR;j++)for(let i=c;i<=endC;i++){
      const x=b.minX+i*dx,z=b.minZ+j*dz,gi=j*cols+i;
      let y=h[gi];
      if(innerBounds&&x>=innerBounds.minX-dx&&x<=innerBounds.maxX+dx&&z>=innerBounds.minZ-dz&&z<=innerBounds.maxZ+dz)y-=34;
      positions.push(x,y,z);
      const i0=Math.max(0,i-1),i1=Math.min(cols-1,i+1),j0=Math.max(0,j-1),j1=Math.min(rows-1,j+1);
      const nx=(h[j*cols+i0]-h[j*cols+i1])/((i1-i0)*dx),nz=(h[j0*cols+i]-h[j1*cols+i])/((j1-j0)*dz),length=Math.hypot(nx,1,nz);
      normals.push(nx/length,1/length,nz/length);
      if(j===endR||i===endC)continue;
      if(innerBounds&&x>innerBounds.minX+dx&&x<innerBounds.maxX-2*dx&&z>innerBounds.minZ+dz&&z<innerBounds.maxZ-2*dz)continue;
      const a=(j-r)*stride+i-c;indices.push(a,a+stride,a+1,a+1,a+stride,a+stride+1);
    }
    if(!indices.length)continue;
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geo.setIndex(indices);geo.computeBoundingSphere();
    const patch=new THREE.Mesh(geo,material);patch.receiveShadow=!innerBounds;scene.add(patch);
  }
}
function snowMaterial(uniforms,far) {
  const mat=new THREE.MeshLambertMaterial({color:0xffffff});
  mat.customProgramCacheKey=()=>far?'distant-snow-v2':'near-snow-v2';
  mat.onBeforeCompile=s=>{
    Object.assign(s.uniforms,uniforms);
    s.vertexShader='varying vec3 vGround;\n'+s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvGround=position;');
    s.fragmentShader=`varying vec3 vGround;
      uniform sampler2D trailMask,ortho,crystals,lampMap; uniform float pisteLights; uniform vec3 lowSun; uniform float hasOrtho; uniform vec4 terrainBounds;
      `+glNoise+s.fragmentShader.replace('#include <color_fragment>',far?`
      vec2 p=vGround.xz;
      float n=noise21(p*.00081)*.56+noise21(p*.0034)*.27+noise21(p*.009)*.17;
      float snow=smoothstep(.21,.80,n+(vGround.y-1800.)*.00082);
      vec3 distant=texture2D(ortho,(p-terrainBounds.xy)/terrainBounds.zw).rgb;
      vec3 bank=mix(vec3(.13,.17,.19),vec3(.64,.70,.75),snow);
      diffuseColor.rgb=mix(bank,distant*.84+vec3(.043,.055,.066),hasOrtho*.82);
    `:`
      vec2 p=vGround.xz;
      vec2 uv=(p-terrainBounds.xy)/terrainBounds.zw;
      vec4 m=texture2D(trailMask,uv); vec2 groove=normalize(m.gb*2.-1.+vec2(.0001));
      float dist=length(cameraPosition-vGround);
      float slow=noise21(p*.009)*.58+noise21(p*.033)*.29+noise21(p*.14)*.13;
      float course=smoothstep(.13,.91,m.r+(slow-.5)*.20);
      vec3 nativeColor=texture2D(ortho,uv).rgb;
      float luma=dot(nativeColor,vec3(.24,.58,.18));
      vec3 snowy=mix(vec3(.64,.72,.83),vec3(.86,.90,.93),slow);
      vec3 timber=mix(vec3(.42,.49,.55),vec3(.76,.81,.84),smoothstep(.29,.75,slow));
      vec3 local=mix(timber,snowy,course);
      vec3 actual=mix(vec3(.095,.13,.15),vec3(.84,.89,.94),smoothstep(.024,.78,luma));
      actual=mix(actual,nativeColor*.92+vec3(.018,.024,.029),.33);
      float distanceBlend=smoothstep(110.,1050.,dist);
      float imageWeight=mix(mix(.22,.87,distanceBlend),mix(.065,.47,distanceBlend),course);
      local=mix(local,actual,hasOrtho*imageWeight);
      float across=dot(p,vec2(-groove.y,groove.x));
      float phase=across*87.; float aa=1.-smoothstep(.45,2.65,fwidth(phase));
      float ridges=sin(phase+(slow-.5)*1.6)*aa;
      float runner=cos(across*1.57+slow*.55); float seam=smoothstep(.975,1.,runner);
      float grain=(noise21(p*7.6)-.5)*(1.-smoothstep(8.,30.,dist));
      vec2 relief=texture2D(crystals,p*.47).rg*2.-1.;
      vec2 broad=texture2D(crystals,p*.081+vec2(.12,.34)).rg*2.-1.;
      float facets=dot(relief*.64+broad*.36,normalize(lowSun.xz));
      local*=1.+facets*mix(.43,.19,course)*(1.-smoothstep(24.,130.,dist));
      float winds=noise21(vec2(dot(p,groove)*.23,across*.63));
      local+=course*(winds-.5)*vec3(.047,.040,.030)*(1.-smoothstep(12.,110.,dist));
      local+=vec3(course*(ridges*.071-seam*.025)*(1.-smoothstep(12.,76.,dist))+grain*.043);
      diffuseColor.rgb=max(vec3(.04),local);
    `);
    if(!far) s.fragmentShader=s.fragmentShader.replace('#include <opaque_fragment>',`
      if(pisteLights>.005){
        float pool=texture2D(lampMap,(vGround.xz-terrainBounds.xy)/terrainBounds.zw).r;
        outgoingLight+=diffuseColor.rgb*vec3(.91,.76,.53)*pool*pisteLights*.91;
      }
      #include <opaque_fragment>
    `);
  };
  return mat;
}

export function createSky(scene) {
  const col=()=>({value:new THREE.Color()}),real=()=>({value:0}),dir=()=>({value:new THREE.Vector3()});
  const uniforms={zenith:col(),horizonColor:col(),sunDir:dir(),moonDir:dir(),sunColor:col(),cloudColor:col(),cloudiness:real(),snow:real(),solar:real(),moonlight:real(),stars:real(),aurora:real(),phase:real()};
  const mat=new THREE.ShaderMaterial({uniforms,side:THREE.BackSide,depthWrite:false,depthTest:false,
    vertexShader:'varying vec3 vDir; void main(){vDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:`varying vec3 vDir;uniform vec3 zenith,horizonColor,sunDir,sunColor,moonDir,cloudColor;
      uniform float cloudiness,snow,solar,moonlight,stars,aurora,phase;
      `+glNoise+`
      float starField(vec2 coord,float frequency,float seed) {
        vec2 q=coord*vec2(frequency,frequency*.52),cell=floor(q);
        float chance=hash21(cell+vec2(seed,17.3));
        vec2 center=.20+.60*vec2(hash21(cell+vec2(22.4,seed)),hash21(cell+vec2(seed+4.2,2.8)));
        vec2 off=fract(q)-center;
        float size=mix(.028,.105,pow(chance,17.)), width=clamp(length(fwidth(q))*.47,.016,.32);
        float kernel=1.-smoothstep(max(0.,size-width),size+width,length(off));
        return kernel*step(.887,chance)*(.22+.78*pow(chance,13.))*(.79+.21*sin(phase*.51+chance*112.));
      }
      vec3 curtain(float az,float altitude,float warp,float lift,float strength) {
        float drift=phase*.077;
        float path=lift+.050*sin(az*3.+drift*.23+warp)+.043*sin(az*5.1-drift*.17+warp*.74)+.018*sin(az*11.+warp);
        float rays=noise21(vec2(az*68.+sin(az*6.+drift*.27)*1.6+warp,drift*.075));
        rays=(.32+.68*rays*rays)*(.55+.45*noise21(vec2(az*3.7+warp,drift*.079)));
        float y=altitude-path;
        float main=smoothstep(-.024,.010,y)*exp(-max(0.,y)*(13.-3.3*rays));
        float rim=exp(-abs(y)*95.);
        float upper=smoothstep(.033,.155,y);
        vec3 shade=mix(vec3(.045,.66,.39),vec3(.34,.12,.48),upper);
        return strength*rays*(main*shade+rim*vec3(.035,.21,.16));
      }
      void main(){
        vec3 d=normalize(vDir); float h=max(d.y,0.);
        vec3 sky=mix(horizonColor,zenith,1.-exp(-3.8*h));
        float sunAngle=max(dot(d,sunDir),0.);
        float glint=pow(sunAngle,32.);
        sky+=sunColor*solar*(.13*pow(sunAngle,7.)+.40*glint+.48*pow(sunAngle,550.)+2.65*smoothstep(.99986,.999965,sunAngle));
        vec2 p=d.xz/max(h+.09,.05)*vec2(1.85,4.25);
        vec2 drift=vec2(phase*(.00095+snow*.0017),phase*.00053);
        vec2 q=p+drift;
        float vapor=noise21(q)*.55+noise21(q*2.11+3.6)*.27+noise21(q*4.4)*.13+noise21(q*9.2)*.05;
        float clouds=smoothstep(.67-cloudiness*.29,.88-cloudiness*.23,vapor)*smoothstep(-.04,.12,d.y);
        float stratus=smoothstep(.47,.98,snow);
        vec3 ceiling=mix(horizonColor,zenith,smoothstep(-.01,.57,d.y))*(.89+.19*noise21(q*.44));
        sky=mix(sky,ceiling,stratus*.91);
        float az=atan(d.x,-d.z);
        if(stars>.002 && h>.008){
          vec2 sphere=vec2(az*.15915494+.50,asin(clamp(d.y,-1.,1.))*.3183099+.5);
          float lights=starField(sphere,294.,1.8)+.33*starField(sphere,473.,8.3);
          sky+=vec3(.76,.86,1.02)*lights*stars*smoothstep(.015,.18,h)*(1.-clouds*.91);
        }
        if(moonlight>.005){
          vec3 east=normalize(cross(vec3(0.,1.,0.),moonDir)),north=cross(moonDir,east);
          vec2 disk=vec2(dot(d,east),dot(d,north))/.010;
          float facing=max(dot(d,moonDir),0.), r2=dot(disk,disk);
          float shape=(1.-smoothstep(.80,1.10,r2))*step(.995,facing);
          float phaseLight=.21+.79*clamp(disk.x*.56+sqrt(max(0.,1.-r2))*.63+.24,0.,1.);
          sky+=vec3(.62,.76,1.)*moonlight*(.095*pow(facing,95.)+.14*pow(facing,1200.)+shape*phaseLight*1.98);
        }
        if(aurora>.002 && h>.002){
          // Broad arcs with moving, vertically striated folds, brightest above geographic north.
          float north=.65+.35*cos(az);
          vec3 band=curtain(az,d.y,1.25,.19,1.14)+curtain(az,d.y,4.1,.34,.58);
          sky+=band*aurora*north*smoothstep(.0,.075,d.y)*(1.-clouds*.64);
        }
        vec3 cloud=mix(cloudColor,horizonColor,.20+.26*snow);
        cloud=mix(cloud,sunColor,min(.40,glint*.56)*solar);
        sky=mix(sky,cloud,clouds*(.27+cloudiness*.52)*(1.-stratus*.79));
        gl_FragColor=vec4(max(sky,vec3(.0003)),1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(41000,36,19),mat);mesh.renderOrder=-99;mesh.frustumCulled=false;scene.add(mesh);
  return {mesh,apply(env){
    uniforms.zenith.value.set(env.sky);uniforms.horizonColor.value.set(env.horizon);
    uniforms.sunColor.value.set(env.sun);uniforms.cloudColor.value.set(env.cloudColor??env.horizon);
    uniforms.sunDir.value.fromArray(env.sunDir||env.dir).normalize();uniforms.moonDir.value.fromArray(env.moonDir||[.4,.39,-.83]).normalize();
    uniforms.cloudiness.value=env.cloud;uniforms.snow.value=env.snowAmount||0;uniforms.solar.value=env.sunAmount??1;
    uniforms.stars.value=env.starAmount||0;uniforms.moonlight.value=env.moonAmount||0;
    uniforms.aurora.value=env.auroraAmount||0;uniforms.phase.value=env.elapsed||0;
  }};
}
function makePisteLighting(scene,data) {
  // One baked illuminance map puts light on the actual slope, including the connecting
  // runs. Fixtures reuse two small geometries and distant lamps share one point sprite draw.
  const b=data.bounds,size=1024,map=document.createElement('canvas');map.width=map.height=size;
  const c=map.getContext('2d'); c.fillStyle='#000';c.fillRect(0,0,size,size);c.globalCompositeOperation='lighter';
  const sx=size/(b.maxX-b.minX),sz=size/(b.maxZ-b.minZ);
  const lights=[];
  for(const route of data.routes) for(let s=45;s<route.length-15;s+=78) {
    const p=route.frame(s),near=data.index.near(p.x,p.z),shoulder=clamp((near.trail?.width||35)*.53,13,31);
    const side=route.resort==='genting'?-1:1,rx=-p.dz*side,rz=p.dx*side;
    const x=p.x+rx*(shoulder+1.1),z=p.z+rz*(shoulder+1.1);
    if(lights.some(o=>Math.abs(x-o.x)<48 && Math.abs(z-o.z)<48 && (x-o.x)**2+(z-o.z)**2<46*46)) continue;
    const y=data.height(x,z),mast=8.1;
    lights.push({x,y,z,rx,rz,mast});
    const cx=p.x+rx*(shoulder*.27)+p.dx*7,cz=p.z+rz*(shoulder*.27)+p.dz*7;
    c.save();c.translate((cx-b.minX)*sx,(cz-b.minZ)*sz);c.rotate(Math.atan2(p.dz*sz,p.dx*sx));c.scale((31+shoulder*.15)*sx,(20+shoulder*.18)*sz);
    const pool=c.createRadialGradient(0,0,0,0,0,1);pool.addColorStop(0,'#e8e8e8');pool.addColorStop(.22,'#cecece');pool.addColorStop(.57,'#737373');pool.addColorStop(.83,'#262626');pool.addColorStop(1,'#000');c.fillStyle=pool;c.fillRect(-1,-1,2,2);c.restore();
  }
  const texture=new THREE.CanvasTexture(map);texture.flipY=false;texture.colorSpace=THREE.NoColorSpace;
  const group=new THREE.Group();group.name='Night skiing lights';scene.add(group);
  const poleMat=new THREE.MeshLambertMaterial({color:0x788088});
  const masts=new THREE.InstancedMesh(new THREE.CylinderGeometry(.073,.107,1,5),poleMat,lights.length);
  const fixtures=new THREE.InstancedMesh(new THREE.BoxGeometry(.90,.21,1.12),new THREE.MeshLambertMaterial({color:0xa5a8a7}),lights.length);
  const dummy=new THREE.Object3D(),points=[];
  for(let i=0;i<lights.length;i++) {
    const l=lights[i],h=l.mast,fx=l.x-l.rx*.27,fz=l.z-l.rz*.27;
    dummy.position.set(l.x,l.y+h*.50,l.z);dummy.rotation.set(0,0,0);dummy.scale.set(1,h,1);dummy.updateMatrix();masts.setMatrixAt(i,dummy.matrix);
    dummy.position.set(fx,l.y+h,fz);dummy.rotation.set(-.36,Math.atan2(-l.rx,-l.rz),0,'YXZ');dummy.scale.set(1,1,1);dummy.updateMatrix();fixtures.setMatrixAt(i,dummy.matrix);
    points.push(fx-l.rx*.22,l.y+h-.09,fz-l.rz*.22);
  }
  group.add(masts,fixtures);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
  const glowUniform={amount:{value:0},scale:{value:480},fogDensity:{value:.00015}};
  const glow=new THREE.Points(g,new THREE.ShaderMaterial({uniforms:glowUniform,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    vertexShader:`uniform float scale; varying float distanceToLight;void main(){vec4 eye=modelViewMatrix*vec4(position,1.);distanceToLight=length(eye.xyz);gl_PointSize=clamp(1.3+scale*3.1/max(2.,-eye.z),1.6,42.);gl_Position=projectionMatrix*eye;}`,
    fragmentShader:`uniform float amount,fogDensity;varying float distanceToLight;void main(){vec2 uv=2.*gl_PointCoord-1.;float r=length(uv);if(r>=1.) discard;float core=exp(-r*r*24.);float halo=exp(-r*r*4.4);float visibility=exp(-pow(distanceToLight*fogDensity,2.));gl_FragColor=vec4(mix(vec3(1.,.66,.30),vec3(1.,.91,.74),core),amount*visibility*(.28*halo+.92*core));}`
  }));
  const screen=new THREE.Vector2();
  glow.onBeforeRender=(renderer,scene,camera)=>{glowUniform.scale.value=renderer.getDrawingBufferSize(screen).y*camera.projectionMatrix.elements[5]*.5;};
  glow.renderOrder=2;group.add(glow);
  return {texture,setLight(e){const amount=e.lampAmount||0;glowUniform.amount.value=amount;glowUniform.fogDensity.value=e.density;glow.visible=amount>.025;}};
}

export async function buildSurface(scene,data) {
  const b=data.bounds,fixtures=makePisteLighting(scene,data);
  const uniforms={lampMap:{value:fixtures.texture},pisteLights:{value:0},crystals:{value:dataTexture(128,128,255)},lowSun:{value:new THREE.Vector3(-.5,.47,-.66)},trailMask:{value:prepareTrailMask(data)},terrainBounds:{value:new THREE.Vector4(b.minX,b.minZ,b.maxX-b.minX,b.maxZ-b.minZ)},ortho:{value:dataTexture(160,160,160)},hasOrtho:{value:0}};
  addTerrainTiles(scene,data.field,snowMaterial(uniforms,false));
  await Promise.all([
    loadTexture(asset('art/snow-normal.webp')).then(t=>{t.wrapS=t.wrapT=THREE.RepeatWrapping;uniforms.crystals.value=t;}),
    loadTexture(asset('geo/winter.jpg'),THREE.SRGBColorSpace).then(t=>{uniforms.ortho.value=t;uniforms.hasOrtho.value=1;}).catch(()=>{}),
    fetch(asset('geo/horizon.json')).then(r=>r.json()).then(h=>{
      const hb=h.bounds;
      const far={...uniforms,terrainBounds:{value:new THREE.Vector4(hb.minX,hb.minZ,hb.maxX-hb.minX,hb.maxZ-hb.minZ)},ortho:{value:dataTexture(140,140,140)},hasOrtho:{value:0}};
      addTerrainTiles(scene,new HeightField(h),snowMaterial(far,true),b);
      return loadTexture(asset('geo/horizon.jpg'),THREE.SRGBColorSpace).then(t=>{far.ortho.value=t;far.hasOrtho.value=1;}).catch(()=>{});
    })
  ]);
  return {setLight(env){uniforms.lowSun.value.fromArray(env.dir);uniforms.pisteLights.value=env.lampAmount||0;fixtures.setLight(env);}};
}

async function readForest() {
  try{
    const response=await fetch(asset('geo/forest.png'));if(!response.ok)return null;
    const img=await createImageBitmap(await response.blob());
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
    const ct=c.getContext('2d',{willReadFrequently:true});ct.drawImage(img,0,0);const out=ct.getImageData(0,0,c.width,c.height);img.close();return out;
  }catch{return null;}
}
export async function plantForest(scene,data) {
  const [atlas,cover]=await Promise.all([loadTexture(asset('art/treeline.webp'),THREE.SRGBColorSpace),readForest()]);
  const uniforms={...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),atlas:{value:atlas},tint:{value:new THREE.Color(1,1,1)}};
  const sm=new THREE.ShaderMaterial({uniforms,fog:true,side:THREE.DoubleSide,
    vertexShader:`#include <common>
      #include <fog_pars_vertex>
      attribute vec3 location;attribute vec4 form;varying vec2 vUv;varying float vTint;varying float vSpecies;
      void main(){
        vUv=vec2((uv.x+floor(form.z))/3.,1.-uv.y);
        vTint=form.w; vSpecies=form.z;
        vec2 face=normalize(cameraPosition.xz-location.xz+vec2(.001));
        vec3 world=location+vec3(face.y*position.x*form.x,(position.y+.5)*form.y,-face.x*position.x*form.x);
        vec4 mvPosition=viewMatrix*vec4(world,1.);
        gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader:`uniform sampler2D atlas;uniform vec3 tint;varying vec2 vUv;varying float vTint;varying float vSpecies;
      #include <fog_pars_fragment>
      void main(){
        vec4 c=texture2D(atlas,vUv);
        float lum=dot(c.rgb,vec3(.22,.68,.10));
        float bare=step(.45,abs(vSpecies-1.));
        float alpha=c.a*(1.-bare*smoothstep(.24,.74,lum));
        if(alpha<.34)discard;
        vec3 needles=mix(c.rgb,c.rgb*vec3(.68,.69,.72),bare);
        gl_FragColor=vec4(needles*tint*vTint*(.85+.15*(1.-vUv.y)),1.);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const rand=randomGenerator(4238),b=data.bounds, range=b.maxX-b.minX;
  const density=(x,z)=>cover?cover.data[(Math.min(cover.height-1,Math.floor((z-b.minZ)/range*cover.height))*cover.width+Math.min(cover.width-1,Math.floor((x-b.minX)/range*cover.width)))*4]/255:.82;
  const special=data.buildings.map(o=>({x:o.x,z:o.z,r:Math.max(...o.footprint.map(p=>Math.hypot(p[0]-o.x,p[1]-o.z)),7)+2}));
  const liftPaths=data.lifts.map(l=>[l.points[0],l.points.at(-1)]);
  const nearCable=(x,z)=>liftPaths.some(([a,b])=>{
    const dx=b[0]-a[0],dz=b[1]-a[1],w=((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz);
    return w>=0&&w<=1&&(a[0]+w*dx-x)**2+(a[1]+w*dz-z)**2<22;
  });
  const plane=new THREE.PlaneGeometry(1,1);
  const chunks=[],cell=360,step=11.2;
  for(let iz=-8;iz<=8;iz++) for(let ix=-9;ix<=10;ix++){
    const x0=ix*cell,z0=iz*cell,loc=[],forms=[];
    for(let zz=step/2;zz<cell;zz+=step)for(let xx=step/2;xx<cell;xx+=step){
      const x=x0+xx+(rand()-.5)*step*.94,z=z0+zz+(rand()-.5)*step*.94;
      const coverValue=density(x,z);
      if(rand()>Math.max(0,coverValue-.055)*.94)continue;
      const near=data.index.near(x,z);
      if(near.distance<(near.trail?.width||32)*.5+1.3 || nearCable(x,z))continue;
      if(special.some(o=>Math.abs(o.x-x)<o.r&&Math.abs(o.z-z)<o.r&&Math.hypot(x-o.x,z-o.z)<o.r))continue;
      const h=5+rand()**.83*10.5;
      const species=rand(),id=species<.53?0:species<.72?1:2;
      data.obstacles?.tree(x,z,.39+h*.019);
      loc.push(x,data.height(x,z)-.25,z);forms.push(h*(id===2?.90:id===1?.91:.90)*(rand()>.5?1:-1),h,id,.83+rand()*.30);
    }
    if(!loc.length)continue;
    const g=new THREE.InstancedBufferGeometry();
    g.index=plane.index;g.setAttribute('position',plane.getAttribute('position'));g.setAttribute('uv',plane.getAttribute('uv'));
    g.setAttribute('location',new THREE.InstancedBufferAttribute(new Float32Array(loc),3));
    g.setAttribute('form',new THREE.InstancedBufferAttribute(new Float32Array(forms),4));g.instanceCount=loc.length/3;
    const center=new THREE.Vector3(x0+cell/2,data.height(x0+cell/2,z0+cell/2)+8,z0+cell/2);
    g.boundingSphere=new THREE.Sphere(center,340);const m=new THREE.Mesh(g,sm);scene.add(m);chunks.push(m);
  }
  return {setLight(env){uniforms.tint.value.set(env.treeTint??0xffffff);if(env.nightAmount)uniforms.tint.value.multiplyScalar(1-.33*env.nightAmount);},locate(x,z,quality){const d=quality==='lite'?1270:quality==='high'?2640:1920;for(const m of chunks){const c=m.geometry.boundingSphere.center;m.visible=(c.x-x)**2+(c.z-z)**2<d*d;}}};
}
