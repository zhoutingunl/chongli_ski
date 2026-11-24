import * as THREE from 'three';
import {clamp, randomGenerator} from './mountain.js';

const windX=.943, windZ=.333;

export function ridgeExposure(height,x,z) {
  const center=height(x,z);
  const windward=(center-height(x-18*windX,z-18*windZ))/18;
  const leeward=(center-height(x+14*windX,z+14*windZ))/14;
  return clamp((Math.min(windward,leeward+.018)-.020)*14,0,1);
}

export function sunThroughTerrain(height,canopy,x,y,z,dir) {
  let light=1;
  for(const distance of [3,7,15,25,42,70,120,220]) {
    const sx=x+distance*dir[0],sz=z+distance*dir[2];
    const above=y+distance*dir[1]-height(sx,sz);
    if(above<-.32)return 0;
    if(distance<=42&&above<17&&canopy?.(sx,above,sz))light*=.36;
  }
  return light;
}

export function createSnowAir(scene,data) {
  const random=randomGenerator(701327);
  const height=data.height, canopy=data.obstacles?.snowCanopy?.bind(data.obstacles);
  const capacity=124, positions=[], centers=new Float32Array(capacity*4), shape=new Float32Array(capacity*4), contours=new Float32Array(capacity*4),breeze=new Float32Array(capacity*2);
  const shade=new Map(), ridge=[];
  let x0=Infinity,z0=Infinity,lookingForRidge=0,shadeTime=0,clock=0;
  const geometry=new THREE.InstancedBufferGeometry();
  const strip=[],indices=[];
  for(let column=0;column<5;column++){
    const longitudinal=.5*column-1;
    strip.push(longitudinal,-1,0,longitudinal,1,0);
    if(column<4){const j=2*column;indices.push(j,j+2,j+1,j+2,j+3,j+1);}
  }
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(strip,3));
  geometry.setIndex(indices);
  geometry.setAttribute('plume',new THREE.InstancedBufferAttribute(centers,4).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('shape',new THREE.InstancedBufferAttribute(shape,4).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('contour',new THREE.InstancedBufferAttribute(contours,4).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('breeze',new THREE.InstancedBufferAttribute(breeze,2).setUsage(THREE.DynamicDrawUsage));
  const uniforms={
    time:{value:0},
    sun:{value:new THREE.Color()}, blue:{value:new THREE.Color()}, ray:{value:new THREE.Vector3()},
    solar:{value:0}, night:{value:0}, haze:{value:0}, strength:{value:0}
  };
  const material=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true,
    vertexShader:`
      attribute vec4 plume;
      attribute vec4 shape,contour;
      attribute vec2 breeze;
      varying vec2 uvP;
      varying vec3 vWorld;
      varying vec4 ink;
      varying float sunlight;
      void main(){
        uvP=position.xy;
        vec3 rayToEye=normalize(cameraPosition-plume.xyz);
        vec3 axis=normalize(vec3(breeze.x,shape.z,breeze.y));
        vec3 wide=cross(rayToEye,axis);
        if(length(wide)<.08)wide=vec3(-breeze.y,.2,breeze.x);
        wide=normalize(wide);
        float column=position.x;
        float rel=column<-.75?contour.x:column<-.25?contour.y:column<.25?0.:column<.75?contour.z:contour.w;
        vec3 wp=plume.xyz+vec3(breeze.x*column*shape.x,rel,breeze.y*column*shape.x)+wide*position.y*shape.y;
        ink=vec4(plume.w,fract(shape.w)*29.,distance(cameraPosition,wp),pow(abs(dot(rayToEye,normalize(cross(axis,wide)))),.65));
        sunlight=floor(shape.w)/31.;
        vWorld=wp;
        gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.);
      }`,
    fragmentShader:`
      uniform float time,solar,night,haze,strength;
      uniform vec3 sun,blue,ray;
      varying vec2 uvP;
      varying vec3 vWorld;
      varying vec4 ink;
      varying float sunlight;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float grain(vec2 p){
        vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);
      }
      void main(){
        float curl=(grain(vec2(uvP.x*2.2+ink.y,time*.33))-.5)*.44;
        float band=uvP.y+curl;
        vec2 p=vec2(uvP.x*2.45-time*.53+ink.y,band*2.6+ink.y);
        float noise=grain(p)*.70+grain(p*2.7)*.30;
        float edge=(1.-smoothstep(.03,1.,abs(uvP.x)))*(1.-smoothstep(.04,.98,abs(band)));
        float opacity=min(.18,edge*edge*smoothstep(.21,.85,noise)*ink.x*strength);
        opacity*=smoothstep(2.5,8.,ink.z)*(1.-smoothstep(31.,83.,ink.z))*exp(-ink.z*haze*.8)*ink.w;
        float sunFacing=pow(max(0.,dot(normalize(vWorld-cameraPosition),ray)),5.);
        vec3 c=mix(vec3(.56,.69,.86),blue,.38)*mix(.94,.41,night);
        c+=sun*solar*sunlight*(.12+1.12*sunFacing);
        gl_FragColor=vec4(c,opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name='Groomed snow wind and ridge spindrift';
  mesh.frustumCulled=false;mesh.visible=false;mesh.renderOrder=2;scene.add(mesh);
  // The low-frequency solar sample is shared when several wisps pass the
  // same stretch of slope. Keep the cache local even during long descents.
  function lightAt(x,y,z,weather) {
    if(weather.sunAmount<.08)return 0;
    const key=Math.floor(x/4)+','+Math.floor(z/4)+','+Math.floor((y-height(x,z))/2);
    if(!shade.has(key))shade.set(key,sunThroughTerrain(height,canopy,x,y,z,weather.sunDir));
    return shade.get(key);
  }
  function findRidges(x,z) {
    ridge.length=0;
    for(let dz=-90;dz<=90;dz+=18)for(let dx=-90;dx<=90;dx+=18) {
      const sx=Math.round(x/18)*18+dx,sz=Math.round(z/18)*18+dz;
      const strength=ridgeExposure(height,sx,sz);
      if(strength>.13)ridge.push({x:sx,z:sz,strength});
    }
  }
  function spawn(i,camera,wind,scatter) {
    const range=i<18?32:i<64?64:115;
    const crest=i%4===0&&ridge.length?ridge[Math.floor(random()*ridge.length)]:null;
    const yaw=random()*Math.PI*2, distance=range*Math.sqrt(random());
    const x=crest?crest.x+(random()-.5)*11:camera.x+Math.cos(yaw)*distance;
    const z=crest?crest.z+(random()-.5)*11:camera.z+Math.sin(yaw)*distance;
    const life=1.7+random()*4.1;
    return {x,z,crest,life,age:scatter?random()*life:0,phase:random()*19,
      heading:(random()-.5)*(crest?.57:.84),gust:.41+random()*.88,
      length:1.25+random()**1.8*(crest?5.3:3.6),thickness:.135+random()*(crest?.30:.18),
      rate:(1.7+random()*3.5)*(.68+wind*1.6),light:0,targetLight:0};
  }
  return {
    sunAt(x,y,z,weather){return lightAt(x,y,z,weather);},
    reset(){positions.length=0;ridge.length=0;shade.clear();x0=Infinity;mesh.visible=false;},
    update(dt,weather,camera,skier,quality,mini) {
      const snow=weather.snowAmount;
      const maximum=mini?26:quality==='lite'?38:quality==='high'?capacity:82;
      const count=Math.round(maximum*(.67+.22*snow+.10*weather.wind));
      clock+=dt;lookingForRidge+=dt;shadeTime+=dt;
      if(shadeTime>.64){shadeTime=0;shade.clear();}
      if(Math.hypot(x0-camera.x,z0-camera.z)>31 || lookingForRidge>5) {
        if(Math.hypot(x0-camera.x,z0-camera.z)>150)positions.length=0;
        x0=camera.x;z0=camera.z;lookingForRidge=0;findRidges(x0,z0);
      }
      const w=weather.wind;
      uniforms.time.value=clock;
      uniforms.ray.value.fromArray(weather.sunDir);
      uniforms.sun.value.setHex(weather.sun);uniforms.blue.value.setHex(weather.hemi);
      uniforms.solar.value=weather.sunAmount;uniforms.night.value=weather.nightAmount;
      uniforms.haze.value=weather.density;
      uniforms.strength.value=(.29+.23*w+.077*snow)*(weather.sceneId==='spindrift'?1+.65*(weather.sceneStrength??1):1);
      for(let i=0;i<count;i++) {
        let particle=positions[i];
        if(!particle||particle.age>=particle.life||Math.hypot(particle.x-camera.x,particle.z-camera.z)>144)
          positions[i]=particle=spawn(i,camera,w,!particle);
        const p=particle; p.age+=dt;
        const t=clamp(p.age/p.life,0,1);
        const curl=p.heading+.16*Math.sin(clock*p.gust+p.phase)+.08*Math.sin((p.x+p.z)*.016-clock*.64);
        const sine=Math.sin(curl),cosine=Math.cos(curl);
        const dx=windX*cosine-windZ*sine,dz=windZ*cosine+windX*sine;
        const step=dt*p.rate*(.64+.40*Math.sin(Math.PI*t)+w*.24)*(.90+.23*Math.sin(clock*p.gust*.64+p.phase));
        p.x+=step*dx;p.z+=step*dz;
        const rise=(p.crest?.21+p.crest.strength*.61:.11)*Math.sin(Math.PI*t);
        const ground=height(p.x,p.z),y=ground+.065+rise+p.thickness*.95;
        const length=p.length*(.74+.38*t),wx=dx*length,wz=dz*length;
        const near=height(p.x-wx,p.z-wz)-ground,far=height(p.x+wx,p.z+wz)-ground;
        const slope=clamp((far-near)/Math.max(1,2*length),-.87,.87);
        if((i+Math.floor(clock*22))%7===0)p.targetLight=lightAt(p.x,y,p.z,weather);
        p.light+=(p.targetLight-p.light)*-Math.expm1(-dt*8);
        const room=skier.mode==='run'?THREE.MathUtils.smoothstep(Math.hypot(skier.x-p.x,skier.z-p.z),2.5,8):1;
        const alpha=Math.sin(Math.PI*t)**1.29*(p.crest?1.10:.86)*(.18+.82*room);
        const k=i*4;
        centers[k]=p.x;centers[k+1]=y;centers[k+2]=p.z;centers[k+3]=alpha;
        shape[k]=length;shape[k+1]=p.thickness;shape[k+2]=slope;shape[k+3]=Math.round(p.light*31)+p.phase/19;
        contours[k]=near;contours[k+1]=height(p.x-wx*.5,p.z-wz*.5)-ground;
        contours[k+2]=height(p.x+wx*.5,p.z+wz*.5)-ground;contours[k+3]=far;
        breeze[i*2]=dx;breeze[i*2+1]=dz;
      }
      geometry.instanceCount=count;
      geometry.attributes.plume.needsUpdate=geometry.attributes.shape.needsUpdate=true;
      geometry.attributes.contour.needsUpdate=geometry.attributes.breeze.needsUpdate=true;
      mesh.visible=true;
    }
  };
}
