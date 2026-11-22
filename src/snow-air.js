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
  const capacity=124, positions=[], centers=new Float32Array(capacity*4), shape=new Float32Array(capacity*4);
  const shade=new Map(), ridge=[];
  let x0=Infinity,z0=Infinity,lookingForRidge=0,shadeTime=0,clock=0;
  const geometry=new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0, 1,-1,0, -1,1,0, 1,1,0],3));
  geometry.setIndex([0,1,2,1,3,2]);
  geometry.setAttribute('plume',new THREE.InstancedBufferAttribute(centers,4).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('shape',new THREE.InstancedBufferAttribute(shape,4).setUsage(THREE.DynamicDrawUsage));
  const uniforms={
    time:{value:0}, wind:{value:new THREE.Vector2(windX,windZ)},
    sun:{value:new THREE.Color()}, blue:{value:new THREE.Color()}, ray:{value:new THREE.Vector3()},
    solar:{value:0}, night:{value:0}, haze:{value:0}, strength:{value:0}
  };
  const material=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true,
    vertexShader:`
      attribute vec4 plume;
      attribute vec4 shape;
      uniform vec2 wind;
      varying vec2 uvP;
      varying vec3 vWorld;
      varying vec4 ink;
      varying float sunlight;
      void main(){
        uvP=position.xy;
        vec3 rayToEye=normalize(cameraPosition-plume.xyz);
        vec3 axis=normalize(vec3(wind.x,shape.z,wind.y));
        vec3 wide=cross(rayToEye,axis);
        if(length(wide)<.08)wide=vec3(-wind.y,.2,wind.x);
        wide=normalize(wide);
        vec3 wp=plume.xyz+axis*position.x*shape.x+wide*position.y*shape.y;
        ink=vec4(plume.w,fract(shape.w)*29.,distance(cameraPosition,wp),wp.y-plume.y);
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
        float band=uvP.y+sin(uvP.x*4.7+time*.85+ink.y)*.17;
        vec2 p=vec2(uvP.x*3.8-time*.63+ink.y,band*9.+ink.y);
        float noise=grain(p)*.56+grain(p*2.3)*.31+grain(p*5.2)*.13;
        float edge=(1.-smoothstep(.31,1.,abs(uvP.x)))*(1.-smoothstep(.09,.93,abs(band)));
        float opacity=edge*smoothstep(.22,.78,noise)*ink.x*strength;
        opacity*=smoothstep(1.2,5.,ink.z)*(1.-smoothstep(66.,158.,ink.z))*exp(-ink.z*haze*.8);
        if(opacity<.003)discard;
        float sunFacing=pow(max(0.,dot(normalize(vWorld-cameraPosition),ray)),5.);
        float littleIce=smoothstep(.76,.96,grain(p*12.));
        float scatter=ink.w>.1?.93:1.;
        vec3 c=mix(vec3(.61,.74,.90),blue,.38)*mix(.94,.41,night);
        c+=sun*solar*sunlight*scatter*(.14+1.15*sunFacing+.36*littleIce);
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
    const life=1.9+random()*4.9;
    return {x,z,crest,life,age:scatter?random()*life:0,phase:random()*19,
      length:1.6+random()**1.4*(crest?8.2:5.9),thickness:.095+random()*(crest?.34:.18),
      rate:(2.4+random()*2.7)*(.64+wind*1.6),light:0};
  }
  return {
    sunAt(x,y,z,weather){return lightAt(x,y,z,weather);},
    reset(){positions.length=0;ridge.length=0;shade.clear();x0=Infinity;mesh.visible=false;},
    update(dt,weather,camera,quality,mini) {
      const count=mini?26:quality==='lite'?38:quality==='high'?capacity:80;
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
      uniforms.strength.value=clamp(.22+.34*w+.28*weather.snowAmount,0,.80);
      for(let i=0;i<count;i++) {
        let particle=positions[i];
        if(!particle||particle.age>=particle.life||Math.hypot(particle.x-camera.x,particle.z-camera.z)>144)
          positions[i]=particle=spawn(i,camera,w,!particle);
        const p=particle; p.age+=dt;
        const t=clamp(p.age/p.life,0,1);
        const step=dt*p.rate*(.63+.64*Math.sin(Math.PI*t)+w*.21), curl=.18*Math.sin(clock*1.6+p.phase);
        p.x+=step*(windX-windZ*curl); p.z+=step*(windZ+windX*curl);
        const rise=(p.crest?.21+p.crest.strength*.61:.11)*Math.sin(Math.PI*t);
        const y=height(p.x,p.z)+.12+rise+p.thickness*.63;
        const slope=clamp((height(p.x+windX*2,p.z+windZ*2)-height(p.x-windX*2,p.z-windZ*2))*.25,-.75,.75);
        if((i+Math.floor(clock*22))%7===0)p.light=lightAt(p.x,y,p.z,weather);
        const alpha=Math.sin(Math.PI*t)**1.21*(p.crest?1.17:.85);
        const k=i*4;
        centers[k]=p.x;centers[k+1]=y;centers[k+2]=p.z;centers[k+3]=alpha;
        shape[k]=p.length*(.8+.49*t);shape[k+1]=p.thickness;shape[k+2]=slope;shape[k+3]=Math.round(p.light*31)+p.phase/19;
      }
      geometry.instanceCount=count;geometry.attributes.plume.needsUpdate=geometry.attributes.shape.needsUpdate=true;
      mesh.visible=true;
    }
  };
}
