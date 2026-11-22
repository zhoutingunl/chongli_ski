import * as THREE from 'three';

// Integrate the local solar shadow map only as far as the visible surface.
// The ray pass runs at one-sixteenth of the full pixel count; the final pass
// weights adjacent rays by their original depth to keep edges sharp.
export function createSnowLightShafts(renderer) {
  const supported=renderer.extensions.has('EXT_color_buffer_float');
  if(!supported)return null;
  const world=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:2,
    depthTexture:new THREE.DepthTexture(1,1,THREE.UnsignedIntType)});
  world.depthTexture.minFilter=world.depthTexture.magFilter=THREE.NearestFilter;
  const volume=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  const scene=new THREE.Scene(),screen=new THREE.Camera(),size=new THREE.Vector2();
  const tri=new THREE.BufferGeometry();
  tri.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
  const vertexShader=`
    varying vec2 imageUV;
    void main(){imageUV=position.xy*.5+.5;gl_Position=vec4(position,1.);}
  `;
  const cameraUniforms={
    surfaceDepth:{value:world.depthTexture}, projection:{value:new THREE.Matrix4()},
    eyeToWorld:{value:new THREE.Matrix4()}
  };
  const surfaceDepth=`
    varying vec2 imageUV;
    uniform sampler2D surfaceDepth;
    uniform mat4 projection;
    vec3 eyePoint(){
      float d=texture2D(surfaceDepth,imageUV).r;
      vec4 p=projection*vec4(imageUV*2.-1.,d*2.-1.,1.);
      return p.xyz/max(.000001,p.w);
    }
  `;
  const integrate=new THREE.ShaderMaterial({vertexShader,depthTest:false,depthWrite:false,toneMapped:false,
    uniforms:{...cameraUniforms,sunMatrix:{value:new THREE.Matrix4()},
      shadow:{value:null},source:{value:new THREE.Vector3()},air:{value:0}},
    fragmentShader:`
      ${surfaceDepth}
      uniform highp sampler2DShadow shadow;
      uniform mat4 sunMatrix,eyeToWorld;
      uniform vec3 source;
      uniform float air;
      float lightAt(vec3 p){
        vec3 q=(sunMatrix*vec4(p,1.)).xyz;
        float edge=min(min(q.x,1.-q.x),min(q.y,1.-q.y));
        if(edge<.001||q.z>=1.||q.z<=0.)return 0.;
        return texture(shadow,vec3(q.xy,q.z-.0007))*smoothstep(.0,.14,edge);
      }
      void main(){
        vec3 eye=eyePoint();
        float distanceToSurface=length(eye);
        vec3 direction=normalize(mat3(eyeToWorld)*eye);
        vec3 origin=eyeToWorld[3].xyz;
        float finish=min(distanceToSurface,58.);
        float stride=max(0.,finish-1.4)/16.;
        float scatter=0.;
        float shadowed=0.;
        for(int i=0;i<16;i++){
          float t=1.4+(float(i)+.5)*stride;
          float lift=exp(-t*.026);
          float sunlit=lightAt(origin+direction*t);
          scatter+=sunlit*lift;
          shadowed+=(1.-sunlit)*lift;
        }
        float facing=.20+.80*pow(max(0.,dot(direction,source)),3.);
        float contrast=smoothstep(.62,4.5,shadowed);
        float light=min(.63,scatter*stride*air*facing*(.20+.80*contrast));
        gl_FragColor=vec4(light,min(1.,distanceToSurface/96.),0.,1.);
      }`});
  const composite=new THREE.ShaderMaterial({vertexShader,depthTest:false,depthWrite:false,
    uniforms:{...cameraUniforms,image:{value:world.texture},fogLight:{value:volume.texture},
      extent:{value:new THREE.Vector2()}, tint:{value:new THREE.Color()}},
    fragmentShader:`
      ${surfaceDepth}
      uniform sampler2D image,fogLight;
      uniform vec2 extent;
      uniform vec3 tint;
      void main(){
        float depth=min(1.,length(eyePoint())/96.);
        vec2 p=imageUV*extent-.5, base=floor(p), f=fract(p);
        float light=0., weight=0.;
        for(int j=0;j<2;j++)for(int i=0;i<2;i++){
          vec2 corner=vec2(float(i),float(j));
          vec2 bilinear=mix(1.-f,f,corner);
          vec2 v=texture2D(fogLight,(base+corner+.5)/extent).rg;
          float w=bilinear.x*bilinear.y*exp(-140.*abs(v.y-depth));
          light+=w*v.x;
          weight+=w;
        }
        vec3 color=texture2D(image,imageUV).rgb;
        gl_FragColor=vec4(color+tint*light/max(.015,weight),1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
  const quad=new THREE.Mesh(tri,integrate);quad.frustumCulled=false;scene.add(quad);

  return function render(sceneWorld,camera,sun,weather) {
    const strength=weather.sunAmount*(.012+.023*weather.snowAmount+.018*(1-Math.min(1,weather.sunDir[1])));
    if(strength<.006||!sun.castShadow) {renderer.render(sceneWorld,camera);return;}
    renderer.getDrawingBufferSize(size);
    if(size.x!==world.width||size.y!==world.height){
      world.setSize(size.x,size.y);volume.setSize(Math.ceil(size.x/4),Math.ceil(size.y/4));
      composite.uniforms.extent.value.set(volume.width,volume.height);
    }
    renderer.setRenderTarget(world);renderer.render(sceneWorld,camera);
    cameraUniforms.projection.value.copy(camera.projectionMatrixInverse);
    cameraUniforms.eyeToWorld.value.copy(camera.matrixWorld);
    integrate.uniforms.shadow.value=sun.shadow.map.depthTexture;
    integrate.uniforms.sunMatrix.value.copy(sun.shadow.matrix);
    integrate.uniforms.source.value.fromArray(weather.sunDir);
    integrate.uniforms.air.value=strength;
    composite.uniforms.tint.value.setHex(weather.sun);
    quad.material=integrate;renderer.setRenderTarget(volume);renderer.render(scene,screen);
    quad.material=composite;renderer.setRenderTarget(null);renderer.render(scene,screen);
  };
}
