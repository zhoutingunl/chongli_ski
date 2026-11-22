import * as THREE from 'three';

const triangleVertex=`
  varying vec2 imageUV;
  void main(){imageUV=position.xy*.5+.5;gl_Position=vec4(position,1.);}
`;

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

export function createSnowLighting(renderer) {
  if(!renderer.extensions.has('EXT_color_buffer_float'))return null;
  const world=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,
    depthTexture:new THREE.DepthTexture(1,1,THREE.UnsignedIntType)});
  world.depthTexture.minFilter=world.depthTexture.magFilter=THREE.NearestFilter;
  const volume=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  const bloom=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:false});
  const daylight=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false});
  const scene=new THREE.Scene(),screen=new THREE.Camera(),size=new THREE.Vector2();
  const triangle=new THREE.BufferGeometry();
  triangle.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
  const pass=(uniforms,fragmentShader,toneMapped=false)=>new THREE.ShaderMaterial({
    vertexShader:triangleVertex,fragmentShader,uniforms,depthTest:false,depthWrite:false,toneMapped
  });
  const quad=new THREE.Mesh(triangle);quad.frustumCulled=false;scene.add(quad);
  function draw(pass,target) {
    quad.material=pass;renderer.setRenderTarget(target);renderer.render(scene,screen);
  }
  const depth={value:world.depthTexture},image={value:world.texture};
  const cameraUniforms={surfaceDepth:depth,projection:{value:new THREE.Matrix4()}};
  const direction={value:new THREE.Vector3()}, eyeToWorld={value:new THREE.Matrix4()};
  const sunScreen={value:new THREE.Vector4()};
  const integrate=pass({...cameraUniforms,eyeToWorld,source:direction,
    sunMatrix:{value:new THREE.Matrix4()},shadow:{value:null},air:{value:0},phase:{value:0}},`
      ${surfaceDepth}
      uniform highp sampler2DShadow shadow;
      uniform mat4 sunMatrix,eyeToWorld;
      uniform vec3 source;
      uniform float air,phase;
      float hash(vec2 p){
        vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);
        return fract((q.x+q.y)*q.z);
      }
      float pockets(vec2 p){
        vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);
      }
      float lightAt(vec3 p){
        vec3 q=(sunMatrix*vec4(p,1.)).xyz;
        float edge=min(min(q.x,1.-q.x),min(q.y,1.-q.y));
        if(edge<.001||q.z>=1.||q.z<=0.)return 0.;
        return texture(shadow,vec3(q.xy,q.z-.00135))*smoothstep(.0,.115,edge);
      }
      void main(){
        vec3 eye=eyePoint();
        float depth=length(eye);
        vec3 ray=normalize(mat3(eyeToWorld)*eye),origin=eyeToWorld[3].xyz;
        float stride=max(0.,min(depth,78.)-3.1)/16.;
        float stratify=mix(.22,.78,hash(floor(gl_FragCoord.xy)));
        float lit=0.,blocked=0.;
        for(int i=0;i<16;i++){
          float t=3.1+(float(i)+stratify)*stride;
          vec3 p=origin+ray*t;
          float drift=pockets((p.xz+vec2(p.y*.46,-p.y*.25))*vec2(.074,.092)-vec2(.073,.036)*phase);
          float falloff=exp(-t*.025)*(.53+.47*drift);
          float sunlight=lightAt(p);
          lit+=sunlight*falloff;
          blocked+=(1.-sunlight)*falloff;
        }
        float facing=.20+.80*pow(max(0.,dot(ray,source)),3.7);
        float contrast=smoothstep(.40,5.,blocked);
        float light=min(.46,lit*stride*air*facing*(.19+.81*contrast));
        gl_FragColor=vec4(light,min(1.,depth/112.),0.,1.);
      }`);
  const extract=pass({image,pixel:{value:new THREE.Vector2()},gate:{value:.74}},`
    varying vec2 imageUV;
    uniform sampler2D image;
    uniform vec2 pixel;
    uniform float gate;
    void main(){
      vec3 bright=vec3(0.);
      for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
        vec2 off=vec2(float(x),float(y))*pixel;
        vec3 c=texture2D(image,imageUV+off).rgb;
        float peak=max(c.r,max(c.g,c.b));
        float weight=smoothstep(gate,gate+1.10,peak);
        bright+=min(c,vec3(3.6))*weight*(x==0&&y==0?2.:1.);
      }
      gl_FragColor=vec4(bright*.1,1.);
    }`);
  const seeSun=pass({sunScreen,image,surfaceDepth:depth},`
    uniform sampler2D surfaceDepth,image;
    uniform vec4 sunScreen;
    void main(){
      float visibility=0.;
      for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
        vec2 delta=vec2(float(x)/sunScreen.w,float(y))*.009;
        vec2 uv=sunScreen.xy+delta;
        float open=step(.999998,texture2D(surfaceDepth,uv).r);
        vec3 color=texture2D(image,uv).rgb;
        float peak=max(color.r,max(color.g,color.b));
        visibility+=open*smoothstep(.52,1.40,peak);
      }
      gl_FragColor=vec4(vec3(visibility/9.*sunScreen.z),1.);
    }`);
  const blend=pass({...cameraUniforms,image,sunScreen,visibleSun:{value:daylight.texture},bright:{value:bloom.texture},
    fogLight:{value:volume.texture},extent:{value:new THREE.Vector2()},bloomStep:{value:new THREE.Vector2()},pixelSize:{value:new THREE.Vector2()},
    tint:{value:new THREE.Color()},beams:{value:0},sunset:{value:0},saturation:{value:1},glow:{value:0},aa:{value:0}},`
      ${surfaceDepth}
      uniform sampler2D image,fogLight,visibleSun,bright;
      uniform vec2 extent,bloomStep,pixelSize;
      uniform vec3 tint;
      uniform vec4 sunScreen;
      uniform float beams,sunset,saturation,glow,aa;
      vec3 highlight(){
        vec3 core=texture2D(bright,imageUV).rgb;
        vec3 side=texture2D(bright,imageUV+vec2(bloomStep.x,0.)).rgb
          +texture2D(bright,imageUV-vec2(bloomStep.x,0.)).rgb
          +texture2D(bright,imageUV+vec2(0.,bloomStep.y)).rgb
          +texture2D(bright,imageUV-vec2(0.,bloomStep.y)).rgb;
        return .33*core+.1675*side;
      }
      float scattering(float distance){
        float depth=min(1.,distance/112.);
        vec2 p=imageUV*extent-.5,base=floor(p),f=fract(p);
        float light=0.,weight=0.;
        for(int j=0;j<2;j++)for(int i=0;i<2;i++){
          vec2 corner=vec2(float(i),float(j));
          vec2 bilinear=mix(1.-f,f,corner);
          vec2 v=texture2D(fogLight,(base+corner+.5)/extent).rg;
          float w=bilinear.x*bilinear.y*exp(-132.*abs(v.y-depth));
          light+=w*v.x;
          weight+=w;
        }
        return light/max(.014,weight);
      }
      float value(vec3 c){return dot(c,vec3(.213,.715,.072));}
      vec3 softenContour(vec3 c) {
        vec3 left=texture2D(image,imageUV-vec2(pixelSize.x,0.)).rgb;
        vec3 right=texture2D(image,imageUV+vec2(pixelSize.x,0.)).rgb;
        vec3 up=texture2D(image,imageUV+vec2(0.,pixelSize.y)).rgb;
        vec3 down=texture2D(image,imageUV-vec2(0.,pixelSize.y)).rgb;
        float l=value(left),r=value(right),u=value(up),d=value(down),m=value(c);
        float lo=min(m,min(min(l,r),min(u,d))),hi=max(m,max(max(l,r),max(u,d)));
        if(hi-lo<.09*hi+.028)return c;
        vec3 edge=abs(l-r)>abs(u-d)? .5*(left+right):.5*(up+down);
        return mix(c,edge,.13*clamp((hi-lo)/max(.10,hi),0.,1.));
      }
      void main(){
        vec3 c=texture2D(image,imageUV).rgb;
        if(aa>.5)c=softenContour(c);
        c=mix(vec3(value(c)),c,saturation);
        float visible=texture2D(visibleSun,vec2(.5)).r;
        vec2 ratio=vec2(sunScreen.w,1.);
        vec2 fromSun=(imageUV-sunScreen.xy)*ratio;
        float d=length(fromSun);
        float glowBand=.45*exp(-d*15.)+.16*exp(-d*5.0);
        vec2 axis=(sunScreen.xy-.5)*ratio;
        float ghost=exp(-length((imageUV-.5)*ratio+.53*axis)*35.)*.026;
        float streak=exp(-abs(fromSun.y)*84.-abs(fromSun.x)*8.)*.040;
        vec3 flare=tint*visible*(glowBand+ghost+streak)*(.68+.56*sunset);
        vec3 light=glow*highlight()+flare;
        if(beams>.5){
          float depth=length(eyePoint());
          light+=tint*scattering(depth)*smoothstep(3.5,16.,depth);
        }
        gl_FragColor=vec4(max(vec3(0.),c+light),1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,true);

  const point=new THREE.Vector3(),look=new THREE.Vector3();
  return function render(sceneWorld,camera,sun,weather,quality,limited) {
    const strong=quality==='high';
    renderer.getDrawingBufferSize(size);
    const samples=strong?2:0;
    if(world.samples!==samples){world.dispose();world.samples=samples;}
    if(size.x!==world.width||size.y!==world.height)world.setSize(size.x,size.y);
    const divisor=strong?4:7;
    volume.setSize(Math.ceil(size.x/divisor),Math.ceil(size.y/divisor));
    bloom.setSize(Math.ceil(size.x/8),Math.ceil(size.y/8));
    blend.uniforms.extent.value.set(volume.width,volume.height);
    blend.uniforms.bloomStep.value.set(1.6/bloom.width,1.6/bloom.height);
    blend.uniforms.pixelSize.value.set(1/size.x,1/size.y);
    blend.uniforms.aa.value=strong||limited?0:1;
    extract.uniforms.pixel.value.set(3.4/size.x,3.4/size.y);

    renderer.setRenderTarget(world);renderer.render(sceneWorld,camera);
    cameraUniforms.projection.value.copy(camera.projectionMatrixInverse);
    eyeToWorld.value.copy(camera.matrixWorld);
    direction.value.fromArray(weather.sunDir);
    const solar=weather.sunAmount;
    const warming=(1-THREE.MathUtils.smoothstep(weather.sunDir[1],.07,.44))*solar;
    const inFront=camera.getWorldDirection(look).dot(direction.value)>.12;
    point.copy(camera.position).addScaledVector(direction.value,14000).project(camera);
    const framed=inFront?1-THREE.MathUtils.smoothstep(Math.max(Math.abs(point.x),Math.abs(point.y)),.96,1.18):0;
    sunScreen.value.set(point.x*.5+.5,point.y*.5+.5,solar*framed,camera.aspect);
    extract.uniforms.gate.value=weather.nightAmount>.50?.57:.82;
    draw(extract,bloom);
    draw(seeSun,daylight);
    const strength=solar*(.014+.027*warming+.017*weather.snowAmount);
    const shafts=strength>.012&&sun.castShadow&&sun.shadow.map&&(strong||!limited);
    if(shafts){
      integrate.uniforms.shadow.value=sun.shadow.map.depthTexture;
      integrate.uniforms.sunMatrix.value.copy(sun.shadow.matrix);
      integrate.uniforms.air.value=strength;
      integrate.uniforms.phase.value=weather.elapsed;
      draw(integrate,volume);
    }
    blend.uniforms.beams.value=shafts?1:0;
    blend.uniforms.tint.value.setHex(weather.sun);
    blend.uniforms.sunset.value=warming;
    blend.uniforms.saturation.value=1.02+.10*solar;
    blend.uniforms.glow.value=(.13+.09*solar+.056*warming)*(1-.53*weather.snowAmount);
    draw(blend,null);
  };
}
