import * as THREE from 'three';
import {randomGenerator} from './mountain.js';

// A repeatable field of airborne ice, independent of precipitation and ski spray.
// A particle wraps only at the far edge, where its opacity is already zero.
export function createIceDust(scene){
  const count=1440,random=randomGenerator(13595),positions=new Float32Array(count*3);
  for(let i=0;i<positions.length;i++)positions[i]=random()*32;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const uniforms={phase:{value:0},strength:{value:1},pixel:{value:720},solar:{value:new THREE.Vector3()}};
  const material=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    vertexShader:`uniform float phase,pixel,strength; uniform vec3 solar; varying float glimmer,core;
      void main(){
        float seed=position.x+position.y*.7;
        vec3 drift=vec3(phase*.26+.27*sin(seed+phase*.24),-.16*phase,.12*phase);
        vec3 local=mod(position+drift-cameraPosition+16.,32.)-16.;
        vec4 eye=viewMatrix*vec4(cameraPosition+local,1.);
        float edge=1.-smoothstep(10.5,15.9,max(max(abs(local.x),abs(local.y)),abs(local.z)));
        float wink=.5+.5*sin(seed*9.17+phase*(1.1+.6*sin(seed)));
        float toward=max(0.,dot(normalize(local),solar));
        glimmer=strength*edge*(.23+1.19*pow(wink,3.))*(.57+.43*toward);
        core=fract(seed*2.61);gl_PointSize=clamp(1.65+pixel*(.039+.044*core)/max(1.,-eye.z),1.65,7.1);
        gl_Position=projectionMatrix*eye;
      }`,
    fragmentShader:`varying float glimmer,core;void main(){
      vec2 p=abs(gl_PointCoord*2.-1.);float r=dot(p,p);
      float shard=exp(-r*4.)+.32*exp(-min(p.x,p.y)*9.)*max(0.,1.-r);
      gl_FragColor=vec4(mix(vec3(.74,.86,1.),vec3(1.,.92,.72),core)*1.65,glimmer*shard);
    }`});
  const points=new THREE.Points(geometry,material),size=new THREE.Vector2();
  points.name='Airborne ice crystals';points.frustumCulled=false;points.renderOrder=3;points.visible=false;
  points.onBeforeRender=r=>{uniforms.pixel.value=r.getDrawingBufferSize(size).y;};
  scene.add(points);
  return (env,lite)=>{
    points.visible=env.sceneId==='dust'&&env.sunAmount>.1;
    if(!points.visible)return;
    uniforms.phase.value=env.elapsed;uniforms.solar.value.fromArray(env.sunDir);
    uniforms.strength.value=env.sunAmount*(env.sceneStrength??1);geometry.setDrawRange(0,lite?660:count);
  };
}
