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
      uniform sampler2D trailMask,ortho,crystals; uniform vec3 lowSun; uniform float hasOrtho; uniform vec4 terrainBounds;
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
  };
  return mat;
}

export const environments={
  morning:{name:'清晨晴空',time:'09:18',sky:0x366d9d,horizon:0xd1dfe1,fog:0xb8cbd5,sun:0xffe7c3,light:1.63,ambient:1.48,dir:[-.50,.47,-.66],density:.000093,cloud:.30},
  noon:{name:'午后薄云',time:'13:26',sky:0x5994c6,horizon:0xe0e8e7,fog:0xc9d7dc,sun:0xfff4e4,light:1.66,ambient:1.42,dir:[-.33,.83,.42],density:.000073,cloud:.52},
  snow:{name:'林间小雪',time:'10:42',sky:0x82939f,horizon:0xe1e5e3,fog:0xd0d9dc,sun:0xf4f3e9,light:.79,ambient:1.74,dir:[-.34,.63,.56],density:.00045,cloud:.85},
  dusk:{name:'山脊日落',time:'16:32',sky:0x596987,horizon:0xf4cbae,fog:0xd6c2b8,sun:0xffbb82,light:1.33,ambient:1.18,dir:[-.82,.22,.38],density:.00014,cloud:.42}
};
export function createSky(scene) {
  const uniforms={zenith:{value:new THREE.Color()},horizonColor:{value:new THREE.Color()},sunDir:{value:new THREE.Vector3()},sunColor:{value:new THREE.Color()},cloudiness:{value:.3}};
  const mat=new THREE.ShaderMaterial({uniforms,side:THREE.BackSide,depthWrite:false,depthTest:false,
    vertexShader:'varying vec3 vDir; void main(){vDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:`varying vec3 vDir;uniform vec3 zenith,horizonColor,sunDir,sunColor;uniform float cloudiness;
    `+glNoise+`
    void main(){
      vec3 d=normalize(vDir); float h=max(d.y,0.);
      vec3 sky=mix(horizonColor,zenith,1.-exp(-3.6*h));
      vec2 p=d.xz/max(h+.105,.045)*vec2(1.85,5.2);
      float clouds=noise21(p)*.55+noise21(p*2.13)*.27+noise21(p*4.47)*.13+noise21(p*9.)*.05;
      float veil=smoothstep(.64-cloudiness*.19,.86-cloudiness*.15,clouds)*smoothstep(-.025,.16,h);
      sky=mix(sky,mix(horizonColor,vec3(1.),.36),veil*(.28+cloudiness*.50));
      float cosine=max(dot(d,normalize(sunDir)),0.);
      sky+=sunColor*(pow(cosine,9.)*.12+pow(cosine,140.)*.43+smoothstep(.99977,.999965,cosine)*2.8);
      gl_FragColor=vec4(sky,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
  });
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(41000,36,19),mat);mesh.renderOrder=-99;mesh.frustumCulled=false;scene.add(mesh);
  return {mesh,apply(env){uniforms.zenith.value.set(env.sky);uniforms.horizonColor.value.set(env.horizon);uniforms.sunColor.value.set(env.sun);uniforms.sunDir.value.fromArray(env.dir).normalize();uniforms.cloudiness.value=env.cloud;}};
}
export async function buildSurface(scene,data) {
  const b=data.bounds;
  const uniforms={crystals:{value:dataTexture(128,128,255)},lowSun:{value:new THREE.Vector3(-.5,.47,-.66)},trailMask:{value:prepareTrailMask(data)},terrainBounds:{value:new THREE.Vector4(b.minX,b.minZ,b.maxX-b.minX,b.maxZ-b.minZ)},ortho:{value:dataTexture(160,160,160)},hasOrtho:{value:0}};
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
  return {setLight(env){uniforms.lowSun.value.fromArray(env.dir);}};
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
  return {setLight(env){uniforms.tint.value.set(env.sun).lerp(new THREE.Color(1,1,1),.71);},locate(x,z,quality){const d=quality==='lite'?1270:quality==='high'?2640:1920;for(const m of chunks){const c=m.geometry.boundingSphere.center;m.visible=(c.x-x)**2+(c.z-z)**2<d*d;}}};
}
