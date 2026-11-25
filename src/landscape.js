import {sceneHeader,scenicGround,scenicForest,scenicSky,scenicArchitecture} from './scenic-materials.js';
import {artForest} from './art-forest.js';
import {createTerrainDetail} from './terrain-detail.js';
import {placePisteLights} from './piste-lighting.js';
import * as THREE from 'three';
import {HeightField,clamp,randomGenerator} from './mountain.js';
import {loadData,loadForestImage} from './platform.js';

const asset = name => import.meta.env.BASE_URL+'assets/'+name;
const glNoise = `
float hash21(vec2 p) { vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z); }
float noise21(vec2 p) {vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),mix(hash21(i+vec2(0.,1.)),hash21(i+1.),f.x),f.y);}
`;

// Each resolved patch contains a fixed ice facet. Its reflected sunlight follows
// the half vector. Integrating the spot over the pixel keeps it quiet in motion.
const iceFacets=`
  float facetFootprint(vec2 grid) {
    return max(length(dFdx(grid)),length(dFdy(grid)));
  }
  float iceReflection(vec2 grid,float footprint,vec3 surface,vec3 halfVector) {
    if(footprint>.81)return 0.;
    vec2 cell=floor(grid);
    vec4 h=fract(cell.xyxy*vec4(.1031,.1030,.0973,.1099));
    h+=dot(h,h.wzxy+33.33);
    h=fract((h.xxyz+h.yzzw)*h.zywx);
    vec2 delta=fract(grid)-(.19+.62*h.xy);
    float radius=mix(.050,.089,h.x),r2=radius*radius;
    float variance=r2+.26*footprint*footprint;
    float spot=exp(-dot(delta,delta)/variance)*r2/variance;
    float occurrence=smoothstep(.64,.85,fract(23.71*h.x+5.19*h.z));
    vec3 tilt=vec3(h.z*2.-1.,0.,h.w*2.-1.)*1.65;
    vec3 facet=normalize(surface+tilt-surface*dot(surface,tilt));
    float alignment=max(dot(facet,halfVector),0.);
    return spot*occurrence*pow(alignment,85.)*(1.-smoothstep(.34,.81,footprint));
  }
`;
function setSnowSun(vector,env) {
  const dir=env.dir,solar=env.sunAmount??1,snow=env.snowAmount||0;
  const clear=1-THREE.MathUtils.smoothstep(snow,.012,.38);
  vector.set(dir[0],dir[1],dir[2],solar*clear*THREE.MathUtils.smoothstep((env.sunDir||dir)[1],.008,.17));
}

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
  const c=el.getContext('2d');
  const b=data.bounds, sx=size/(b.maxX-b.minX),sz=size/(b.maxZ-b.minZ);
  const toPix=([x,z])=>[(x-b.minX)*sx,(z-b.minZ)*sz];
  c.lineCap='round';c.lineJoin='round';
  for(const trail of [...(data.aprons||[]),...data.trails]){
    const points=trail.points;
    for(let i=1;i<points.length;i++){
      const a=toPix(points[i-1]),d=toPix(points[i]),dx=d[0]-a[0],dz=d[1]-a[1],l=Math.hypot(dx,dz)||1;
      // Alpha is piste coverage. Red measures metres across this surveyed strip;
      // its zero line and the grooming direction follow bends in the centreline.
      const dirX=Math.round(127.5+dx/l*127.5),dirZ=Math.round(127.5+dz/l*127.5);
      const crossX=-dz/l*32*sx,crossZ=dx/l*32*sz;
      const lane=c.createLinearGradient(a[0]-crossX,a[1]-crossZ,a[0]+crossX,a[1]+crossZ);
      lane.addColorStop(0,`rgb(0,${dirX},${dirZ})`);lane.addColorStop(1,`rgb(255,${dirX},${dirZ})`);
      c.strokeStyle=lane;
      c.lineWidth=(trail.width||36)*sx;c.beginPath();c.moveTo(...a);c.lineTo(...d);c.stroke();
    }
  }
  const t=new THREE.CanvasTexture(el);t.flipY=false;t.colorSpace=THREE.NoColorSpace;t.anisotropy=4;return t;
}
export function addTerrainTiles(scene,field,material,innerBounds=null) {
  const {cols,rows,dx,dz,bounds:b,heights:h,vertexNormals}=field, tile=52;
  const tilesAcross=Math.ceil((cols-1)/tile), patches=[];
  for(let r=0;r<rows-1;r+=tile)for(let c=0;c<cols-1;c+=tile){
    const endR=Math.min(rows-1,r+tile),endC=Math.min(cols-1,c+tile),stride=endC-c+1;
    const positions=[],normals=[],indices=[];
    for(let j=r;j<=endR;j++)for(let i=c;i<=endC;i++){
      const x=b.minX+i*dx,z=b.minZ+j*dz,gi=j*cols+i;
      let y=h[gi];
      if(innerBounds&&x>=innerBounds.minX-dx&&x<=innerBounds.maxX+dx&&z>=innerBounds.minZ-dz&&z<=innerBounds.maxZ+dz)y-=34;
      positions.push(x,y,z);
      normals.push(vertexNormals[gi*3],vertexNormals[gi*3+1],vertexNormals[gi*3+2]);
      if(j===endR||i===endC)continue;
      if(innerBounds&&x>innerBounds.minX+dx&&x<innerBounds.maxX-2*dx&&z>innerBounds.minZ+dz&&z<innerBounds.maxZ-2*dz)continue;
      const a=(j-r)*stride+i-c;indices.push(a,a+stride,a+1,a+1,a+stride,a+stride+1);
    }
    if(!indices.length)continue;
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geo.setIndex(indices);geo.computeBoundingSphere();
    const patch=new THREE.Mesh(geo,material);patch.receiveShadow=!innerBounds;scene.add(patch);
    if(!innerBounds){
      geo.index.setUsage(THREE.DynamicDrawUsage);
      patches[(r/tile)*tilesAcross+c/tile]={index:geo.index,stride};
    }
  }
  // Exchange whole triangles. Discarding fragments at the moving rectangle
  // discarded neighbouring MSAA samples too, leaving dotted gaps on the slope.
  return (c,r,covered)=>{
    const {index,stride}=patches[Math.floor(r/tile)*tilesAcross+Math.floor(c/tile)];
    const i=c%tile,j=r%tile,a=j*stride+i,offset=6*(j*(stride-1)+i);
    if(covered)index.array.fill(a,offset,offset+6);
    else index.array.set([a,a+stride,a+1,a+1,a+stride,a+stride+1],offset);
    index.addUpdateRange(offset,6);index.needsUpdate=true;
  };
}
const atmosphereGLSL=`
  vec3 aerialSnow(vec3 radiance,vec3 point,vec3 eye){
    vec3 ray=point-eye;
    float distanceToPoint=length(ray);
    float layer=exp(-max(0.,point.y-1370.)*.00185);
    float eyeLayer=exp(-max(0.,eye.y-1370.)*.00185);
    float mist=.000038+.000113*(eyeLayer+layer)*.5;
    float opticalDepth=max(0.,distanceToPoint-145.)*mist;
    float scattered=(1.-exp(-opticalDepth))*aerialStrength;
    float towardsSun=max(0.,dot(ray/max(1.,distanceToPoint),airSun.xyz));
    vec3 atmosphere=mix(ridgeAir,hazeAir,.24+.48*layer);
    atmosphere=mix(atmosphere,horizonAir,.30*pow(towardsSun,5.)*airSun.w);
    return mix(radiance,atmosphere,scattered);
  }
`;
const shadowBones=[[0,0,.115],[0,1,.104],[1,2,.173],[2,3,.095],[3,4,.078],[2,7,.095],[7,8,.078],
  [1,5,.071],[5,6,.058],[1,9,.071],[9,10,.058]];
const riderShadowGLSL=`
  float bodyShadow(vec2 spot){
    if(shadowArea.w<=0.||distance(spot,shadowArea.xy)>shadowArea.z)return 0.;
    float cover=0.;
    for(int j=0;j<${shadowBones.length};j++){
      vec2 a=shadowStarts[j].xy,b=shadowEnds[j],ab=b-a;
      float along=clamp(dot(spot-a,ab)/max(.0001,dot(ab,ab)),0.,1.);
      float r=shadowStarts[j].z;
      float distanceToBody=length(spot-(a+along*ab));
      cover=max(cover,1.-smoothstep(r*.50,r*1.45,distanceToBody));
    }
    return cover*shadowArea.w;
  }
`;
const ridgeShadowGLSL=`
  float horizonAt(vec2 uv,float tile){
    vec2 corner=vec2(mod(tile,2.),floor(tile*.5));
    vec2 texel=clamp(uv,vec2(0.),vec2(1.))*191.+.5;
    return texture2D(solarHorizons,(corner*192.+texel)/384.).r*.95;
  }
  float ridgeShadow(vec2 uv){
    if(sunHorizon.w<.01)return 0.;
    float horizon=mix(horizonAt(uv,sunHorizon.x),horizonAt(uv,sunHorizon.x+1.),sunHorizon.y);
    return sunHorizon.w*smoothstep(sunHorizon.z-.035,sunHorizon.z+.060,horizon);
  }
`;
function snowMaterial(uniforms,far,refined=false) {
  const mat=new THREE.MeshLambertMaterial({color:0xffffff});
  mat.customProgramCacheKey=()=>far?'distant-snow-v3':refined?'terrain-snow-v1':'near-snow-v6';
  mat.onBeforeCompile=s=>{
    Object.assign(s.uniforms,uniforms);
    s.vertexShader='varying vec3 vGround;\n'+s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvGround=position;');
    if(refined)s.vertexShader='attribute vec3 snowRelief; varying vec3 vSnowRelief;\n'+s.vertexShader.replace('vGround=position;', 'vGround=position; vSnowRelief=snowRelief;');
    s.fragmentShader=`varying vec3 vGround;
      ${refined?'varying vec3 vSnowRelief;':''}
      uniform sampler2D trailMask,ortho,crystals,lampMap; uniform float pisteLights; uniform vec4 lowSun; uniform float hasOrtho; uniform vec4 terrainBounds;
      uniform vec3 ridgeAir,hazeAir,horizonAir; uniform vec4 airSun; uniform float aerialStrength; uniform vec3 solarTint;
      uniform vec3 shadowStarts[${shadowBones.length}]; uniform vec2 shadowEnds[${shadowBones.length}]; uniform vec4 shadowArea;
      uniform sampler2D solarHorizons; uniform vec4 sunHorizon;
      `+glNoise+sceneHeader+scenicGround+atmosphereGLSL+(far?'':iceFacets+riderShadowGLSL+ridgeShadowGLSL)+s.fragmentShader.replace('#include <color_fragment>',far?`
      vec2 p=vGround.xz;
      float n=noise21(p*.00081)*.56+noise21(p*.0034)*.27+noise21(p*.009)*.17;
      float snow=smoothstep(.21,.80,n+(vGround.y-1800.)*.00082);
      vec3 distant=texture2D(ortho,(p-terrainBounds.xy)/terrainBounds.zw).rgb;
      vec3 bank=mix(vec3(.092,.131,.157),vec3(.67,.72,.79),snow);
      float exposed=1.-smoothstep(.08,.45,dot(distant,vec3(.22,.66,.12)));
      vec3 photograph=distant*mix(1.02,.72,exposed)+vec3(.019,.030,.041);
      diffuseColor.rgb=mix(bank,photograph,hasOrtho*.89);
    `:`
      vec2 p=vGround.xz;
      ${refined?'vec3 sculpt=vSnowRelief;':'vec3 sculpt=vec3(0.);'}
      vec2 uv=(p-terrainBounds.xy)/terrainBounds.zw;
      float dist=length(cameraPosition-vGround);
      vec4 m=texture2D(trailMask,uv);
      if(dist<76.){
        // The metre field must interpolate more accurately than a four- or
        // eight-bit filter weight to resolve comb teeth on a 4.9 m mask texel.
        ivec2 size=textureSize(trailMask,0);
        vec2 texel=clamp(uv*vec2(size)-.5,vec2(0.),vec2(size)-1.0001);
        ivec2 k=ivec2(floor(texel));vec2 f=fract(texel);
        m=mix(mix(texelFetch(trailMask,k,0),texelFetch(trailMask,k+ivec2(1,0),0),f.x),
          mix(texelFetch(trailMask,k+ivec2(0,1),0),texelFetch(trailMask,k+ivec2(1,1),0),f.x),f.y);
      }
      vec3 strip=m.rgb/max(m.a,.05);
      vec2 groove=normalize(strip.gb*2.-1.+vec2(.0001)),crossTrail=vec2(-groove.y,groove.x);
      float slow=noise21(p*.009)*.58+noise21(p*.033)*.29+noise21(p*.14)*.13;
      float course=smoothstep(.17,.94,m.a+(slow-.5)*.15)*(1.-sculpt.x);
      vec3 nativeColor=texture2D(ortho,uv).rgb;
      float luma=dot(nativeColor,vec3(.24,.58,.18));
      vec3 snowy=mix(vec3(.64,.72,.83),vec3(.86,.90,.93),slow);
      vec3 timber=mix(vec3(.42,.49,.55),vec3(.76,.81,.84),smoothstep(.29,.75,slow));
      vec3 local=mix(timber,snowy,course);
      vec3 actual=mix(vec3(.053,.088,.117),vec3(.86,.91,.96),smoothstep(.033,.72,luma));
      actual=mix(actual,nativeColor*.92+vec3(.018,.024,.029),.33);
      float distanceBlend=smoothstep(110.,1050.,dist);
      float imageWeight=mix(mix(.22,.87,distanceBlend),mix(.065,.47,distanceBlend),course);
      local=mix(local,actual,hasOrtho*imageWeight);
      local=mix(local,snowy*.96,sculpt.x*.67);
      local=mix(local,vec3(.25,.39,.55),sculpt.y*.82);
      float across=(strip.r-.5)*64.;
      float winds=noise21(p*.21+vec2(4.3,1.7));
      float phase=across*78.+(winds-.5)*1.25;
      float detail=1.-smoothstep(5.,28.,dist);
      float grooming=mix(.38,.86,smoothstep(.26,.69,noise21(p*.108+vec2(18.,-7.))));
      float pisteFinish=course*(1.-sculpt.z);
      float teeth=pisteFinish*detail*grooming*(1.-smoothstep(.80,2.85,fwidth(phase)));
      float ridge=sin(phase),flute=cos(phase)*(.85-.23*ridge);
      float grain=(noise21(p*7.6)-.5)*(1.-smoothstep(8.,30.,dist));
      vec2 relief=texture2D(crystals,p*.47).rg*2.-1.16;
      vec2 broad=texture2D(crystals,p*.081+vec2(.12,.34)).rg*2.-1.16;
      float windSculpt=noise21(vec2(.097*p.x+.047*p.y,.32*p.y-.15*p.x))-.5;
      float facets=dot(relief*.64+broad*.36,normalize(lowSun.xz));
      local*=1.+facets*mix(.26,.13,pisteFinish)*(1.-smoothstep(24.,130.,dist));
      local+=(winds-.5)*vec3(.052,.046,.035)*(1.-smoothstep(14.,110.,dist));
      local+=teeth*(ridge*.021-.009*(1.-ridge))*vec3(1.,.89,.68);
      local+=grain*.037;
      local+=vec3(.083,.100,.126)*windSculpt*mix(1.,.26,pisteFinish)*(1.-smoothstep(35.,190.,dist));
      vec2 snowSlope=(relief*mix(.58,.35,pisteFinish)+broad*mix(.50,.28,pisteFinish))*(1.-smoothstep(28.,105.,dist))
        -crossTrail*(teeth*flute*.105);
      vec2 iceGrid=p*6.4+vec2(7.13,18.2);
      float icePixel=facetFootprint(iceGrid);
      float shimmerPixel=facetFootprint(iceGrid*.36);
      diffuseColor.rgb=max(vec3(.04),local);
    `);
    if(!far) s.fragmentShader=s.fragmentShader.replace('#include <normal_fragment_maps>',`
      #include <normal_fragment_maps>
      vec3 slopeNormal=transformDirectionByInverseViewMatrix(normal,viewMatrix);
      vec3 bump=vec3(snowSlope.x,0.,snowSlope.y);
      vec3 snowNormal=normalize(slopeNormal+bump-slopeNormal*dot(slopeNormal,bump));
      normal=normalize(mat3(viewMatrix)*snowNormal);
    `).replace('#include <opaque_fragment>',`
      float silhouette=max(bodyShadow(vGround.xz),ridgeShadow(uv));
      outgoingLight-=reflectedLight.directDiffuse*silhouette;
      if(lowSun.w>.001&&dist<135.){
        vec3 eye=normalize(cameraPosition-vGround),h=normalize(eye+lowSun.xyz);
        float snowCover=max(max(course,sculpt.x*.76),smoothstep(.40,.73,luma)*hasOrtho*.75);
        float fine=iceReflection(iceGrid,icePixel,snowNormal,h);
        float broadSpark=iceReflection(iceGrid*.36+vec2(5.2,3.1),shimmerPixel,snowNormal,h);
        // Keep the bright strip attached to the slope, and let coarse ice
        // grains flash within it as the view crosses the reflection angle.
        float grazing=pow(1.-clamp(dot(slopeNormal,eye),0.,1.),2.1);
        float shimmer=pow(max(0.,dot(snowNormal,h)),19.);
        float strip=pow(max(0.,dot(slopeNormal,h)),31.);
        vec3 sunlight=reflectedLight.directDiffuse/max(diffuseColor.rgb,vec3(.23));
        float direct=max(sunlight.r,max(sunlight.g,sunlight.b))*(1.-silhouette);
        float weight=lowSun.w*snowCover*(1.-smoothstep(80.,135.,dist));
        float gloss=strip*(.058+.62*grazing)+.18*shimmer*grazing;
        float crystals=16.3*fine*(1.-smoothstep(24.,55.,dist))+12.4*broadSpark*(1.-smoothstep(51.,107.,dist));
        outgoingLight+=solarTint*direct*weight*(gloss+crystals);
      }
      if(pisteLights>.005){
        float pool=texture2D(lampMap,(vGround.xz-terrainBounds.xy)/terrainBounds.zw).r;
        outgoingLight+=diffuseColor.rgb*vec3(.91,.76,.53)*pool*pisteLights*.91;
        if(ridgeScene==RIDGE_LAMPS){
          float spill=smoothstep(.035,.67,pool);
          outgoingLight+=diffuseColor.rgb*vec3(.56,.31,.083)*spill*pisteLights*ridgeBlend;
        }
      }
      #include <opaque_fragment>
    `);
    s.fragmentShader=s.fragmentShader.replace('#include <opaque_fragment>',`
      outgoingLight=aerialSnow(outgoingLight,vGround,cameraPosition);
      if(ridgeScene!=0)outgoingLight=mix(outgoingLight,paintSnow(outgoingLight,vGround,transformDirectionByInverseViewMatrix(normal,viewMatrix),${far?'vec2(.87,.49)':'mix(vec2(.87,.49),groove,course)'}),ridgeBlend);
      #include <opaque_fragment>
    `);
  };
  return mat;
}

export function createSky(scene,scenicUniforms) {
  const col=()=>({value:new THREE.Color()}),real=()=>({value:0}),dir=()=>({value:new THREE.Vector3()});
  const uniforms={...scenicUniforms,zenith:col(),horizonColor:col(),sunDir:dir(),moonDir:dir(),sunColor:col(),cloudColor:col(),cloudiness:real(),roseLight:real(),snow:real(),solar:real(),moonlight:real(),stars:real(),aurora:real(),phase:real()};
  const mat=new THREE.ShaderMaterial({uniforms,side:THREE.BackSide,depthWrite:false,depthTest:false,
    vertexShader:'varying vec3 vDir; void main(){vDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:`varying vec3 vDir;uniform vec3 zenith,horizonColor,sunDir,sunColor,moonDir,cloudColor;
      uniform float cloudiness,roseLight,snow,solar,moonlight,stars,aurora,phase;
      `+glNoise+sceneHeader+scenicSky+`
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
        vec3 sky=mix(horizonColor,zenith,1.-exp(-5.8*h));
        float sunAngle=max(dot(d,sunDir),0.);
        float glint=pow(sunAngle,32.);
        sky+=sunColor*solar*(.13*pow(sunAngle,7.)+.41*glint+.68*pow(sunAngle,630.)+4.2*smoothstep(.99988,.999972,sunAngle));
        vec2 p=d.xz/max(h+.09,.05)*vec2(1.85,4.25);
        vec2 drift=vec2(phase*(.00095+snow*.0017),phase*.00053);
        vec2 q=p+drift;
        float vapor=noise21(q)*.55+noise21(q*2.11+3.6)*.27+noise21(q*4.4)*.13+noise21(q*9.2)*.05;
        float clouds=smoothstep(.67-cloudiness*.29,.88-cloudiness*.23,vapor)*smoothstep(-.04,.12,d.y);
        float stratus=smoothstep(.47,.98,snow);
        vec3 ceiling=mix(horizonColor,zenith,smoothstep(-.01,.57,d.y))*(.89+.19*noise21(q*.44));
        sky=mix(sky,ceiling,stratus*.91);
        if(solar>.025&&h>.002&&stratus<.96){
          // An oblique sheet of ice clouds, sheared along a fixed wind
          // direction. Its perspective compresses the bands near the skyline.
          vec2 upper=d.xz/(h+.065);
          upper=mat2(.86,-.51,.51,.86)*upper;
          vec2 wind=upper*vec2(.34,3.9)+drift*.62;
          float ripples=noise21(wind*.66+vec2(2.,11.));
          float threads=noise21(wind+vec2(ripples*.55,ripples*.29))*.64
            +noise21(wind*2.14+vec2(7.,1.))*.25+noise21(wind*4.18)*.11;
          float coverage=smoothstep(.49,.77,threads)*smoothstep(.026,.126,h);
          vec3 iceCloud=mix(vec3(.60,.70,.84),cloudColor*.92,threads);
          iceCloud+=sunColor*glint*.48;
          sky=mix(sky,iceCloud,coverage*(.58+.20*glint)*(1.-stratus)*solar);
        }
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
        if(roseLight>.001){
          float low=exp(-abs(h-.11)*4.5);
          float forwardGlow=.23+.77*pow(sunAngle,3.);
          float veil=clamp(vapor*.78+clouds*.32,0.,1.);
          vec3 rose=mix(vec3(.67,.28,.46),vec3(1.,.62,.34),forwardGlow);
          sky=mix(sky,rose+sky*.55,roseLight*low*veil*(.43+.31*forwardGlow));
          sky+=sunColor*roseLight*pow(sunAngle,75.)*.26;
        }
        if(ridgeScene!=0)sky=mix(sky,paintSky(sky,d,sunDir,solar,stars,clouds),ridgeBlend);
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
    uniforms.roseLight.value=env.roseLight||0;uniforms.cloudiness.value=env.cloud;uniforms.snow.value=env.snowAmount||0;uniforms.solar.value=env.sunAmount??1;
    uniforms.stars.value=env.starAmount||0;uniforms.moonlight.value=env.moonAmount||0;
    uniforms.aurora.value=env.auroraAmount||0;uniforms.phase.value=env.elapsed||0;
  }};
}

export function bindScenicBuildings(groups,u,actor=false){
  const seen=new Set();
  for(const group of groups)group.traverse(mesh=>{
    const m=mesh.material;
    if(!mesh.isMesh||!m||m.userData.surface==='lettering'||seen.has(m)||(!m.isMeshStandardMaterial&&!m.isMeshLambertMaterial))return;
    seen.add(m);
    const compile=m.onBeforeCompile,key=m.customProgramCacheKey();
    m.customProgramCacheKey=()=>key+'-scenic-resort';
    m.onBeforeCompile=(shader,renderer)=>{
      compile.call(m,shader,renderer);
      Object.assign(shader.uniforms,u);
      const surface=m.userData.surface;
      shader.uniforms.paintSurface={value:actor?4:surface==='timber'?1:['glazing','panorama','occupiedRoom','cabinGlass'].includes(surface)?3:0};
      shader.vertexShader='varying vec3 vScenicBuilding;\n'+shader.vertexShader.replace('#include <project_vertex>',`
        #include <project_vertex>
        vec4 scenicLocal=vec4(transformed,1.);
        #ifdef USE_INSTANCING
          scenicLocal=instanceMatrix*scenicLocal;
        #endif
        vScenicBuilding=(modelMatrix*scenicLocal).xyz;`);
      shader.fragmentShader='uniform int paintSurface;varying vec3 vScenicBuilding;\n'+glNoise+sceneHeader+scenicArchitecture+shader.fragmentShader.replace('#include <opaque_fragment>',`
        vec3 scenicNormal=transformDirectionByInverseViewMatrix(normal,viewMatrix);
        if(ridgeScene!=0)outgoingLight=mix(outgoingLight,paintObject(outgoingLight,vScenicBuilding,scenicNormal,paintSurface),ridgeBlend);
        if(paintSurface==4 && ridgeRose>.001){
          float rim=pow(1.-clamp(dot(normal,normalize(vViewPosition)),0.,1.),2.4);
          float sunlit=smoothstep(-.12,.55,dot(scenicNormal,ridgeSolar.xyz));
          outgoingLight+=ridgeRose*(vec3(1.,.56,.32)*rim*sunlit*.23
            +diffuseColor.rgb*vec3(.12,.11,.18)*(.5+.5*max(-scenicNormal.y,0.)));
        }
        #include <opaque_fragment>`);
    };
  });
}

function makePisteLighting(scene,data) {
  // One baked illuminance map puts light on the actual slope, including the connecting
  // runs. Fixtures reuse two small geometries and distant lamps share one point sprite draw.
  const b=data.bounds,size=1024,map=document.createElement('canvas');map.width=map.height=size;
  const c=map.getContext('2d'); c.fillStyle='#000';c.fillRect(0,0,size,size);c.globalCompositeOperation='lighter';
  const sx=size/(b.maxX-b.minX),sz=size/(b.maxZ-b.minZ);
  const lights=placePisteLights(data);
  for(const light of lights){
    const {x,z,rx,rz,p,shoulder}=light;
    light.y=data.height(x,z);light.mast=8.1;
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
  let shafts;
  function lampShafts(){
    const opacity={value:0};
    const material=new THREE.ShaderMaterial({uniforms:{opacity},transparent:true,depthWrite:false,side:THREE.FrontSide,blending:THREE.AdditiveBlending,
      vertexShader:`varying vec3 eyeDirection,sideNormal;varying float along,distanceM;
        void main(){vec4 w=instanceMatrix*vec4(position,1.);eyeDirection=cameraPosition-w.xyz;distanceM=length(eyeDirection);
          sideNormal=mat3(instanceMatrix)*vec3(normal.x,0.,normal.z);along=.5-position.y;
          gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader:`uniform float opacity;varying vec3 eyeDirection,sideNormal;varying float along,distanceM;
        void main(){float chord=abs(dot(normalize(eyeDirection),normalize(sideNormal)));
          float mist=smoothstep(.005,.10,along)*(1.-smoothstep(.56,1.,along));
          float reach=1.-smoothstep(78.,210.,distanceM);
          gl_FragColor=vec4(1.,.81,.55,opacity*chord*chord*mist*reach*.17);}`
    });
    const cones=new THREE.InstancedMesh(new THREE.ConeGeometry(1,1,20,1,true),material,lights.length);
    const axis=new THREE.Vector3(),head=new THREE.Vector3(),foot=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
    for(const [i,l] of lights.entries()){
      head.set(...points.slice(i*3,i*3+3));
      const x=l.p.x+l.rx*l.shoulder*.27+l.p.dx*7,z=l.p.z+l.rz*l.shoulder*.27+l.p.dz*7;
      foot.set(x,data.height(x,z)+.30,z);axis.subVectors(head,foot);
      dummy.position.copy(foot).lerp(head,.5);dummy.quaternion.setFromUnitVectors(up,axis.clone().normalize());
      dummy.scale.set(6.8,axis.length(),6.8);dummy.updateMatrix();cones.setMatrixAt(i,dummy.matrix);
    }
    cones.name='Light shafts beneath piste lamps';cones.renderOrder=1;group.add(cones);
    return {cones,opacity};
  }
  return {texture,setLight(e){
    const amount=e.lampAmount||0;glowUniform.amount.value=amount;glowUniform.fogDensity.value=e.density;glow.visible=amount>.025;
    const power=e.sceneId==='lamps'?amount*(e.sceneStrength??1):0;
    if(power>.02&&!shafts)shafts=lampShafts();
    if(shafts){shafts.cones.visible=power>.02;shafts.opacity.value=power;}
  }};
}

export async function buildSurface(scene,data,scenicUniforms) {
  const b=data.bounds,fixtures=makePisteLighting(scene,data);
  const uniforms={...scenicUniforms,
    lampMap:{value:fixtures.texture},pisteLights:{value:0},crystals:{value:dataTexture(128,128,255)},
    lowSun:{value:new THREE.Vector4(-.5,.47,-.66,0)},trailMask:{value:prepareTrailMask(data)},
    terrainBounds:{value:new THREE.Vector4(b.minX,b.minZ,b.maxX-b.minX,b.maxZ-b.minZ)},
    ortho:{value:dataTexture(160,160,160)},hasOrtho:{value:0},
    ridgeAir:{value:new THREE.Color()},hazeAir:{value:new THREE.Color()},horizonAir:{value:new THREE.Color()},
    airSun:{value:new THREE.Vector4()},aerialStrength:{value:0},solarTint:{value:new THREE.Color()},
    solarHorizons:{value:dataTexture(0,0,0)},sunHorizon:{value:new THREE.Vector4()},
    shadowStarts:{value:shadowBones.map(()=>new THREE.Vector3())},
    shadowEnds:{value:shadowBones.map(()=>new THREE.Vector2())},shadowArea:{value:new THREE.Vector4()},moonShadow:{value:0}
  };
  const coverCell=addTerrainTiles(scene,data.field,snowMaterial(uniforms,false));
  const detail=data.snowTerrain&&createTerrainDetail(scene,data.field,data.snowTerrain,
    snowMaterial(uniforms,false,true),coverCell);
  let hasSolarHorizons=false;
  await Promise.all([
    loadTexture(asset('art/snow-normal.webp')).then(t=>{t.wrapS=t.wrapT=THREE.RepeatWrapping;uniforms.crystals.value=t;}),
    loadTexture(asset('geo/solar-horizons.png')).then(t=>{
      t.generateMipmaps=false;t.minFilter=THREE.LinearFilter;uniforms.solarHorizons.value=t;hasSolarHorizons=true;
    }).catch(()=>{}),
    loadTexture(asset('geo/winter.jpg'),THREE.SRGBColorSpace).then(t=>{uniforms.ortho.value=t;uniforms.hasOrtho.value=1;}).catch(()=>{}),
    loadData('horizon').then(h=>{
      const hb=h.bounds;
      const far={...uniforms,terrainBounds:{value:new THREE.Vector4(hb.minX,hb.minZ,hb.maxX-hb.minX,hb.maxZ-hb.minZ)},ortho:{value:dataTexture(140,140,140)},hasOrtho:{value:0}};
      addTerrainTiles(scene,new HeightField(h),snowMaterial(far,true),b);
      return loadTexture(asset('geo/horizon.jpg'),THREE.SRGBColorSpace).then(t=>{far.ortho.value=t;far.hasOrtho.value=1;}).catch(()=>{});
    })
  ]);
  const joints=Array.from({length:11},()=>new THREE.Vector3());
  const floor=joints.map(()=>new THREE.Vector2());
  function setRiderShadow(rider){
    const area=uniforms.shadowArea.value,sun=uniforms.lowSun.value;
    const strength=Math.max(uniforms.moonShadow.value,sun.w*THREE.MathUtils.smoothstep(sun.y,.095,.22));
    if(!rider||strength<.015){area.w=0;return;}
    rider.shadowPose(joints);
    const root=rider.group.position;
    const maxTravel=13;
    let span=0;
    for(let i=0;i<joints.length;i++){
      const p=joints[i], above=t=>p.y-t*sun.y-data.height(p.x-t*sun.x,p.z-t*sun.z);
      let lo=0,hi=0;
      if(above(0)>.015){
        hi=.55;
        while(hi<maxTravel&&above(hi)>0){lo=hi;hi=Math.min(maxTravel,hi*1.63);}
        for(let n=0;n<5;n++){const mid=(lo+hi)*.5;if(above(mid)>0)lo=mid;else hi=mid;}
      }
      const projected=floor[i].set(p.x-hi*sun.x,p.z-hi*sun.z);
      span=Math.max(span,Math.hypot(projected.x-root.x,projected.y-root.z));
    }
    for(let i=0;i<shadowBones.length;i++){
      const [a,b,width]=shadowBones[i],p=floor[a];
      uniforms.shadowStarts.value[i].set(p.x,p.y,width*rider.dimensions.scale);
      uniforms.shadowEnds.value[i].copy(floor[b]);
    }
    area.set(root.x,root.z,span+.45,strength*(span>10?.58:.82));
  }
  return {setRiderShadow,detail,locate:detail?.locate,setLight(env){
    uniforms.moonShadow.value=env.sceneId==='moon'?.86*env.moonAmount*(env.sceneStrength??1):0;
    setSnowSun(uniforms.lowSun.value,env);uniforms.pisteLights.value=env.lampAmount||0;fixtures.setLight(env);
    const day=1-env.nightAmount,haze=env.snowAmount;
    uniforms.ridgeAir.value.set(env.fog).multiplyScalar(.70+.10*day);
    uniforms.hazeAir.value.set(env.fog).lerp(uniforms.ridgeAir.value,.20);
    uniforms.horizonAir.value.set(env.horizon).multiplyScalar(.88);
    uniforms.airSun.value.set(...env.sunDir,env.sunAmount);uniforms.solarTint.value.set(env.sun);
    uniforms.aerialStrength.value=(.42+.58*day)*(1-.62*haze);
    const [x,y,z]=env.sunDir;
    const directions=[-1.36,-.45,.45,1.36];
    const angle=clamp(Math.atan2(x,z),directions[0],directions[3]);
    const index=angle<directions[1]?0:angle<directions[2]?1:2;
    const amount=(angle-directions[index])/(directions[index+1]-directions[index]);
    const elevation=y/Math.max(.001,Math.hypot(x,z));
    uniforms.sunHorizon.value.set(index,amount,elevation,hasSolarHorizons?uniforms.lowSun.value.w*.78:0);
  }};
}

async function readForest() {
  try{
    const img=await loadForestImage(asset('geo/forest.png'));if(!img)return null;
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
    const ct=c.getContext('2d',{willReadFrequently:true});ct.drawImage(img,0,0);const out=ct.getImageData(0,0,c.width,c.height);img.close?.();return out;
  }catch{return null;}
}
export async function plantForest(scene,data,scenicUniforms,onGroveChange) {
  const [atlas,cover]=await Promise.all([loadTexture(asset('art/treeline.webp'),THREE.SRGBColorSpace),readForest()]);
  const uniforms={...scenicUniforms,...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),atlas:{value:atlas},groveActive:{value:0},groveFill:{value:.50},
    tint:{value:new THREE.Color(1,1,1)},solarTint:{value:new THREE.Color()},lowSun:{value:new THREE.Vector4(0,1,0,0)}};
  // Regular cards face the viewer. Shadow cards pivot towards the light,
  // using the same crown cutout so shade follows the branches and trunks.
  const treeDepth=new THREE.MeshDepthMaterial({side:THREE.DoubleSide});
  treeDepth.onBeforeCompile=shader=>{
    shader.uniforms.lowSun=uniforms.lowSun;shader.uniforms.treeAtlas=uniforms.atlas;shader.uniforms.groveActive=uniforms.groveActive;
    shader.vertexShader='attribute float modelDetail;attribute vec3 location;attribute vec4 form;uniform vec4 lowSun;varying vec3 crown;varying vec2 shadowSeed;\n'+
      shader.vertexShader.replace('#include <begin_vertex>',`
        crown=vec3((uv.x+floor(form.z))/3.,1.-uv.y,form.z);
        shadowSeed=location.xz*.071;
        vec2 face=normalize(lowSun.xz+vec2(.0001));
        float castHeight=form.y*mix(.60,1.,smoothstep(.10,.54,lowSun.y));
        vec3 transformed=location+vec3(face.y*position.x*form.x,(position.y+.5)*castHeight,-face.x*position.x*form.x);
      `);
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nif(modelDetail>.5)gl_Position=vec4(2.,2.,2.,1.);');
    shader.fragmentShader='uniform float groveActive;uniform sampler2D treeAtlas;varying vec3 crown;varying vec2 shadowSeed;\n'+glNoise+shader.fragmentShader.replace('#include <map_fragment>',`
      vec4 c=texture2D(treeAtlas,crown.xy);
      float bare=step(.45,abs(crown.z-1.));
      float lum=dot(c.rgb,vec3(.22,.68,.10));
      vec2 bough=vec2(fract(crown.x*3.),crown.y);
      float width=abs(bough.x-.5);
      float openings=noise21(bough*vec2(6.1,10.2)+shadowSeed);
      float broken=(.28+.23*smoothstep(.27,.78,openings))*smoothstep(.035,.22,width);
      float cutoff=.36+broken*(.70+.30*bare);
      if(c.a*(1.-(1.-groveActive)*bare*smoothstep(.24,.74,lum))<cutoff)discard;
    `);
  };
  const sm=new THREE.ShaderMaterial({uniforms,fog:true,side:THREE.DoubleSide,
    vertexShader:`#include <common>
      #include <fog_pars_vertex>
      attribute float modelDetail;attribute vec3 location;attribute vec4 form;varying vec2 vUv;varying float vTint;varying float vSpecies;
      varying vec3 vTreeWorld;varying vec4 vBranch;
      void main(){
        vUv=vec2((uv.x+floor(form.z))/3.,1.-uv.y);
        vTint=form.w; vSpecies=form.z;
        vec2 face=normalize(cameraPosition.xz-location.xz+vec2(.001));
        vec3 world=location+vec3(face.y*position.x*form.x,(position.y+.5)*form.y,-face.x*position.x*form.x);
        vTreeWorld=world;
        // Surface coordinates stay attached to a photographed branch as its
        // billboard turns. Each tree has its own fixed distribution of facets.
        vBranch.xy=vec2(position.x*abs(form.x),uv.y*form.y)*9.5+mod(location.xz,113.);
        vBranch.z=position.x*sign(form.x);vBranch.w=length(cameraPosition-location);
        vec4 mvPosition=viewMatrix*vec4(world,1.);
        gl_Position=projectionMatrix*mvPosition;
        if(modelDetail>.5)gl_Position=vec4(2.,2.,2.,1.);
        #include <fog_vertex>
      }`,
    fragmentShader:`uniform float groveActive,groveFill;uniform sampler2D atlas;uniform vec3 tint,solarTint;uniform vec4 lowSun;varying vec2 vUv;varying float vTint;varying float vSpecies;
      varying vec3 vTreeWorld;varying vec4 vBranch;
      #include <fog_pars_fragment>
      `+glNoise+sceneHeader+scenicForest+iceFacets+`
      void main(){
        vec4 c=texture2D(atlas,vUv);
        float lum=dot(c.rgb,vec3(.22,.68,.10));
        float bare=step(.45,abs(vSpecies-1.));
        float alpha=c.a*(1.-bare*(1.-groveActive)*smoothstep(.24,.74,lum));
        float pixel=facetFootprint(vBranch.xy);
        if(alpha<.34)discard;
        vec3 needles=mix(c.rgb,c.rgb*vec3(.68,.69,.72),bare);
        vec3 color=needles*tint*vTint*(.85+.15*(1.-vUv.y));
        if(lowSun.w>.001){
          vec3 eye=normalize(cameraPosition-vTreeWorld);
          float edge=clamp(vBranch.z*2.35,-.94,.94);
          vec2 front=normalize(eye.xz+vec2(.0001));
          vec2 radial=front*sqrt(1.-edge*edge)+vec2(front.y,-front.x)*edge;
          vec3 cap=normalize(vec3(radial.x*.76,1.,radial.y*.76));
          float facing=smoothstep(-.20,.68,dot(cap,lowSun.xyz))
            *mix(.10,1.,smoothstep(-.66,.48,dot(radial,normalize(lowSun.xz))));
          float crown=1.-smoothstep(.71,.89,vUv.y);
          float frontLight=.21+.79*facing;
          float warmth=lowSun.w*(.50+.50*crown);
          color=mix(color,color*mix(vec3(.52,.66,.88),vec3(1.03,1.03,1.10)+solarTint*.74,frontLight),warmth);
          float rim=pow(max(0.,dot(-eye,lowSun.xyz)),5.)*(1.-smoothstep(.18,.50,alpha))*.56;
          color+=solarTint*lowSun.w*rim*lum*(.30+.7*crown);
          if(vBranch.w<58.&&pixel<.81){
            // A light, neutral patch with a darker bough directly beneath it is
            // a snow cap. The open trunk and central bark stay excluded.
            vec4 below=texture2D(atlas,vUv+vec2(0.,.0055));
            float contrast=lum-dot(below.rgb,vec3(.22,.68,.10));
            float chroma=max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b));
            float branchSnow=smoothstep(.19,.54,lum)*(1.-smoothstep(.085,.22,chroma))
              *smoothstep(.035,.19,contrast)*smoothstep(.34,.85,min(c.a,below.a))*crown*smoothstep(.018,.070,abs(vBranch.z));
            float sparkle=iceReflection(vBranch.xy,pixel,cap,normalize(eye+lowSun.xyz));
            color+=solarTint*sparkle*branchSnow*facing*lowSun.w*mix(10.,3.2,bare)*(1.-smoothstep(31.,58.,vBranch.w));
          }
        }
        if(groveActive>.5)color=mix(c.rgb*tint,c.rgb,groveFill)*vTint*.91;
        else if(ridgeScene!=0)color=mix(color,paintTree(color,vTreeWorld,lum,vUv.y),ridgeBlend);
        gl_FragColor=vec4(color,1.);
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
  const sharedDetail=new THREE.InstancedBufferAttribute(new Float32Array(Math.ceil(cell/step)**2),1);
  for(let iz=-8;iz<=8;iz++) for(let ix=-9;ix<=10;ix++){
    const x0=ix*cell,z0=iz*cell,loc=[],forms=[];
    for(let zz=step/2;zz<cell;zz+=step)for(let xx=step/2;xx<cell;xx+=step){
      const x=x0+xx+(rand()-.5)*step*.94,z=z0+zz+(rand()-.5)*step*.94;
      const coverValue=density(x,z);
      if(rand()>Math.max(0,coverValue-.055)*.94)continue;
      const near=data.index.near(x,z);
      if(near.distance<(near.trail?.width||32)*.5+1.3 || nearCable(x,z))continue;
      const apron=data.apronIndex?.near(x,z);
      if(apron?.trail && apron.distance<apron.trail.width*.5+2)continue;
      if(special.some(o=>Math.abs(o.x-x)<o.r&&Math.abs(o.z-z)<o.r&&Math.hypot(x-o.x,z-o.z)<o.r))continue;
      const h=5+rand()**.83*10.5;
      const species=rand(),id=species<.53?0:species<.72?1:2;
      data.obstacles?.tree(x,z,.39+h*.019,h);
      loc.push(x,data.height(x,z)-.25,z);forms.push(h*(id===2?.90:id===1?.91:.90)*(rand()>.5?1:-1),h,id,.83+rand()*.30);
    }
    if(!loc.length)continue;
    const g=new THREE.InstancedBufferGeometry();
    g.setAttribute('modelDetail',sharedDetail);g.index=plane.index;g.setAttribute('position',plane.getAttribute('position'));g.setAttribute('uv',plane.getAttribute('uv'));
    g.setAttribute('location',new THREE.InstancedBufferAttribute(new Float32Array(loc),3));
    g.setAttribute('form',new THREE.InstancedBufferAttribute(new Float32Array(forms),4));g.instanceCount=loc.length/3;
    const center=new THREE.Vector3(x0+cell/2,data.height(x0+cell/2,z0+cell/2)+8,z0+cell/2);
    g.boundingSphere=new THREE.Sphere(center,340);
    const m=new THREE.Mesh(g,sm);m.customDepthMaterial=treeDepth;scene.add(m);chunks.push(m);
  }
  const grove=artForest(scene,chunks,sharedDetail,uniforms,atlas,file=>loadTexture(new URL(file,document.baseURI).href,THREE.SRGBColorSpace),onGroveChange);
  return {
    retryArt:grove.retry,vista:grove.vista,portrait:grove.portrait,
    setLight(env) {
      const id=env.sceneId;
      uniforms.groveFill.value=(id==='galaxy'?.33:id==='starry'?.64:.50)*(1-(id==='galaxy'||id==='starry'?0:.85)*env.nightAmount);
      grove.select((env.sceneStrength??1)>.23?id:null);
      setSnowSun(uniforms.lowSun.value,env);
      uniforms.solarTint.value.set(env.sun);
      uniforms.tint.value.set(env.treeTint??0xffffff).multiplyScalar(1-.33*env.nightAmount);
    },
    locate(x,z,quality,sunX,sunZ,shadowRange) {
      grove.locate(x,z,quality);
      const d=quality==='lite'?1270:quality==='high'?2640:1920;
      for(const mesh of chunks){
        const center=mesh.geometry.boundingSphere.center;
        mesh.visible=(center.x-x)**2+(center.z-z)**2<d*d;
        mesh.castShadow=shadowRange>0&&(center.x-sunX)**2+(center.z-sunZ)**2<(340+shadowRange)**2;
      }
    }
  };
}
