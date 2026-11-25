import * as THREE from 'three';
import {scenery,cloudFloor,cloudRoof} from './scenery.js';

const identifiers=new Map(scenery.map((s,i)=>[s.id,i+1]));
const defines=[...identifiers].map(([id,n])=>'#define RIDGE_'+id.toUpperCase()+' '+n).join('\n');
export function sceneryUniforms(){
  return {ridgePaintedSky:{value:null},hasPaintedSky:{value:0},ridgePaintedSnow:{value:null},hasPaintedSnow:{value:0},ridgeScene:{value:0},ridgeBlend:{value:1},ridgeClock:{value:0},ridgeSolar:{value:new THREE.Vector4()},ridgeNight:{value:0}};
}
export function applySceneryUniforms(u,e){
  u.ridgeScene.value=identifiers.get(e.sceneId)||0;
  u.ridgeBlend.value=e.sceneStrength??1;
  u.ridgeClock.value=e.elapsed;
  u.ridgeSolar.value.set(...e.sunDir,e.sunAmount);
  u.ridgeNight.value=e.nightAmount;
}

export const sceneHeader=defines+`
  uniform int ridgeScene;
  uniform float ridgeClock,ridgeNight,ridgeBlend;
  uniform vec4 ridgeSolar;
  float sceneBell(float x){return exp(-x*x);}
  float sceneLuma(vec3 c){return dot(c,vec3(.23,.65,.12));}
  float cloudGap(vec2 onLayer){
    vec2 p=onLayer*.0037+ridgeClock*vec2(-.0052,.0021);
    return smoothstep(.38,.66,noise21(p)*.71+.29*noise21(2.4*p+4.8));
  }
  float groundCloudGap(vec3 world){
    float t=max(0.,2520.-world.y)/max(.12,ridgeSolar.y);
    return cloudGap(world.xz+ridgeSolar.xz*t);
  }
  // Integrate a 40 m slab along the view ray, including for ground and trees
  // under the deck. Optical distance goes to zero in front of the first bank.
  vec3 crossCloudDeck(vec3 color,vec3 eye,vec3 point){
    vec3 ray=point-eye;
    float lengthM=length(ray);
    if(lengthM<1.)return color;
    vec3 d=ray/lengthM;
    float dy=abs(d.y)<.0001?(d.y<0.?-.0001:.0001):d.y;
    float a=(${cloudFloor}.0-eye.y)/dy,b=(${cloudRoof}.0-eye.y)/dy;
    float entry=clamp(min(a,b),0.,lengthM),exitM=clamp(max(a,b),0.,lengthM);
    if(exitM<=entry)return color;
    float through=min(exitM-entry,235.);
    vec3 at=eye+d*(entry+.49*through);
    vec2 drift=vec2(ridgeClock*.006,-ridgeClock*.0025);
    float banks=.62*noise21(at.xz*.0028+drift)+.26*noise21(at.xz*.0093-drift*.34)+.12*noise21(at.xz*.024);
    float wisps=noise21(at.xz*.041+vec2(at.y*.091,drift.x));
    float veil=(1.-exp(-through*(.010+.035*banks)))*smoothstep(9.,44.,lengthM);
    float edge=smoothstep(0.,7.,at.y-${cloudFloor}.0)*smoothstep(0.,7.,${cloudRoof}.0-at.y);
    veil*=mix(.08,1.,edge)*smoothstep(.23,.64,banks+.13*(wisps-.5));
    vec3 cloud=mix(vec3(.36,.44,.56),vec3(1.02,.94,.79),banks*.78+.15*clamp(d.y*-2.,0.,1.));
    cloud*=mix(1.,.20,ridgeNight);
    return mix(color,cloud,veil*.94);
  }
`;

export const scenicGround=`
  uniform sampler2D ridgePaintedSnow;uniform float hasPaintedSnow;
  // Blend two fixed paper-grain directions. Moving shadows and changes in
  // piste direction never slide the pigment or arrange the dabs in a grid.
  float pigmentDab(vec2 p,vec2 grain,float width,float seed){
    float footprint=max(length(dFdx(p)),length(dFdy(p)));
    p+=vec2(seed,seed*.73);
    vec2 warp=vec2(noise21(p*.28),noise21(p*.21+4.1))-.5;
    vec2 a=mat2(.918,-.397,.397,.918)*(p+warp*.84);
    vec2 b=mat2(.299,.954,-.954,.299)*(p-warp*.63);
    float ratio=.50/max(.075,width);
    float along=noise21(a*vec2(.61,ratio)),across=noise21(b*vec2(.58,ratio));
    float bias=smoothstep(.10,.92,abs(dot(grain,vec2(.918,.397))));
    float paint=mix(across,along,bias);
    float bristle=noise21(a*vec2(1.30,ratio*2.7));
    return smoothstep(.42,.82,paint*.79+bristle*.21)*(1.-smoothstep(.21,.80,footprint));
  }
  vec3 paintSnow(vec3 c,vec3 world,vec3 normalW,vec2 courseDir){
    vec3 view=world-cameraPosition;float distanceM=length(view);
    vec2 p=world.xz;
    float y=sceneLuma(c),light=clamp(dot(normalW,ridgeSolar.xyz),0.,1.);
    float remote=smoothstep(70.,950.,distanceM);
    if(ridgeScene==RIDGE_GOLD){
      float face=dot(normalW,ridgeSolar.xyz),height=smoothstep(1725.,2070.,world.y);
      float crest=smoothstep(.46,.81,height*.55+.45*smoothstep(.015,.39,face)+.06*(noise21(p*.013)-.5));
      vec3 dusk=c*vec3(.62,.74,1.05);
      vec3 rim=c*vec3(1.37,.91,.47)+vec3(.46,.13,.014)*crest;
      return mix(c,mix(dusk,rim,crest),(.38+.54*remote)*ridgeSolar.w);
    }
    if(ridgeScene==RIDGE_CLOUDSEA)return crossCloudDeck(c,cameraPosition,world);
    if(ridgeScene==RIDGE_CLOUDBREAK){
      float sun=groundCloudGap(world);
      vec3 shaft=c*mix(vec3(.60,.70,.87),vec3(1.31,1.13,.83),sun);
      // The snow patch and the short column above it see the same gap in cloud.
      vec3 midway=mix(cameraPosition,world,.68);
      float air=groundCloudGap(midway)*smoothstep(140.,1500.,distanceM);
      return mix(c,shaft+vec3(.19,.14,.065)*air,ridgeSolar.w);
    }
    if(ridgeScene==RIDGE_MOON){
      float face=dot(normalW,normalize(vec3(.47,.38,-.79)));
      return mix(c,c*mix(vec3(.54,.68,.93),vec3(1.13,1.18,1.30),smoothstep(-.05,.66,face))+vec3(.012,.022,.043)*remote,ridgeNight);
    }
    if(ridgeScene==RIDGE_SPINDRIFT){
      vec2 wind=mat2(.943,-.333,.333,.943)*p;
      float bank=noise21(wind*vec2(.034,.067)+vec2(-ridgeClock*.13,3.));
      vec2 swept=wind*vec2(.13,1.40)+vec2(-ridgeClock*.73,bank*.80);
      float feather=smoothstep(.54,.83,noise21(swept))*smoothstep(.53,.77,bank);
      return c+feather*(1.-smoothstep(20.,87.,distanceM))*vec3(.21,.24,.27)*ridgeSolar.w;
    }
    if(ridgeScene!=RIDGE_MONET&&ridgeScene!=RIDGE_INK&&ridgeScene!=RIDGE_STARRY&&ridgeScene!=RIDGE_WOODBLOCK&&ridgeScene!=RIDGE_GALAXY&&ridgeScene!=RIDGE_MINERAL)return c;
    // Multi-scale marks follow local relief. Retain finer original shadows under
    // feet, beside a tree or along a carved edge.
    vec2 downhill=normalize(normalW.xz+vec2(.014,.006));
    vec2 grain=normalize(courseDir*.36+downhill*.44+vec2(.49,.19));
    float wash=noise21(p*.055)*.50+noise21(p*.22)*.29+noise21(p*.013)*.21;
    float small=pigmentDab(p*7.5+6.3,grain,.15,12.);
    float medium=pigmentDab(p*2.2,grain,.19,5.1);
    float broken=pigmentDab(p*1.35+17.4,grain,.12,2.);
    float shading=clamp(y/(y+.48),0.,1.);
    float contact=clamp(.57+.65*shading,.59,1.);
    float rel=smoothstep(.19,.84,shading*.85+.20*light+(wash-.50)*.61);
    vec3 art=c;
    if(ridgeScene==RIDGE_MONET){
      float field=clamp(.13+.67*rel+.75*(wash-.43),0.,1.);
      art=mix(vec3(.27,.28,.58),vec3(1.12,.75,.54),field);
      art=mix(art,vec3(.69,.65,.88),(.16+.39*small)*(1.-field*.36));
      art=mix(art,vec3(1.30,1.01,.77),medium*(.25+.52*field));
      art+=vec3(.13,.072,.065)*broken;
    }else if(ridgeScene==RIDGE_INK){
      float grainPaper=noise21(p*1.8)*.52+wash*.48;
      float valley=smoothstep(.22,.81,shading*.89+normalW.y*.16+(wash-.5)*.45);
      vec3 paper=mix(vec3(.20,.23,.25),vec3(1.03,1.00,.90),valley);
      float dry=(.26*medium+.22*small+.13*broken)*smoothstep(.27,.80,1.-rel+.32*grainPaper);
      art=paper*(1.-dry)+vec3((grainPaper-.5)*.078);
      art=mix(art,vec3(.68,.70,.68),remote*(.22+.25*wash));
    }else if(ridgeScene==RIDGE_STARRY){
      vec2 curl=normalize(grain+vec2(sin(p.y*.039),cos(p.x*.052))*.77);
      float sweep=pigmentDab(p*1.47+2.,curl,.10,2.7);
      art=mix(vec3(.030,.055,.225),vec3(.195,.29,.63),clamp(.23+shading*.72+(wash-.5)*.89,0.,1.));
      art=mix(art,vec3(.42,.57,.91),small*.44+medium*.45);
      art=mix(art,vec3(.82,.75,.51),sweep*smoothstep(.54,.77,wash)*.59);
      art*=1.-.17*broken;
      art=mix(c,art,.46+.52*ridgeNight);
    }else if(ridgeScene==RIDGE_WOODBLOCK){
      float block=.46*smoothstep(.36,.40,rel)+.33*smoothstep(.56,.61,rel)+.21*smoothstep(.74,.78,rel);
      block=mix(.11+.88*rel,block,.13+.60*remote);
      art=mix(vec3(.18,.28,.39),vec3(.98,.91,.76),block);
      art=mix(art,vec3(.15,.28,.37),(.18*broken+.20*small)*(1.-.52*block));
      art=mix(art,vec3(1.08,.92,.71),medium*.32);
      float ridge=1.-smoothstep(.015,.13,abs(dot(normalize(-view),normalW)));
      art=mix(art,vec3(.048,.103,.14),remote*ridge*.60);
    }else if(ridgeScene==RIDGE_MINERAL){
      float strata=clamp(.31+.48*rel+.42*(noise21(p*.007)-.5)+.35*normalW.x,0.,1.);
      vec3 mountain=mix(vec3(.023,.15,.23),vec3(.074,.42,.34),strata);
      float contour=smoothstep(.18,.72,light)*smoothstep(.23,.68,normalW.y-.25*normalW.z);
      mountain+=vec3(.38,.23,.075)*smoothstep(.55,.85,strata)*contour;
      art=mix(vec3(.43,.57,.60),vec3(1.14,.99,.72),clamp(shading*.87+wash*.38,0.,1.));
      art+=vec3(.12,.10,.038)*(medium+small*.6);
      art=mix(art,mountain,smoothstep(65.,820.,distanceM)*.96);
    }else{
      float rime=.047*small+.052*medium;
      vec3 silver=(c*vec3(.72,.86,1.12)+vec3(.012,.022,.048))*(.82+.24*wash)+vec3(.47,.63,.90)*rime;
      art=mix(c,silver,ridgeNight);
    }
    if(hasPaintedSnow>.5){
      // Two independently oriented canvas patches vary the brush field over
      // the mountain. Pigment lives in metres, and cannot move with the eye.
      vec2 first=mat2(.91,.415,-.415,.91)*p*.109;
      vec2 second=mat2(.36,.933,-.933,.36)*p*.149+vec2(.37,.14);
      float patchWeight=smoothstep(.30,.72,noise21(p*.071));
      vec3 oil=mix(texture2D(ridgePaintedSnow,first).rgb,texture2D(ridgePaintedSnow,second).rgb,patchWeight);
      oil*=.58+.69*shading+.17*rel; // retain light, relief and contact shadows
      float weight= (ridgeScene==RIDGE_STARRY?.87:.79)*(1.-smoothstep(75.,390.,distanceM));
      art=mix(art,oil,weight);
    }
    float dim=1.-.76*ridgeNight;
    if(ridgeScene==RIDGE_STARRY||ridgeScene==RIDGE_GALAXY)dim=1.;
    return mix(c,art*contact*dim,ridgeScene==RIDGE_GALAXY?.85:.93);
  }
`;
export const scenicForest=`
  vec3 paintTree(vec3 c,vec3 world,float lum,float heightUV){
    float d=length(cameraPosition-world);
    if(ridgeScene==RIDGE_GOLD){
      float rim=(1.-smoothstep(.06,.64,heightUV))*smoothstep(.14,.59,lum)*ridgeSolar.w;
      return mix(c*mix(vec3(1.),vec3(.83,.86,1.01),ridgeSolar.w),c*vec3(1.55,1.08,.50)+vec3(.24,.07,.006),.76*rim);
    }
    if(ridgeScene==RIDGE_MOON)return c*mix(vec3(1.),mix(vec3(.63,.75,.98),vec3(1.13,1.22,1.31),smoothstep(.27,.68,lum)*(1.-heightUV*.60)),ridgeNight);
    if(ridgeScene==RIDGE_INK){
      float ink=smoothstep(.035,.67,sceneLuma(c));
      return mix(mix(vec3(.024,.048,.053),vec3(.82,.84,.77),ink),vec3(.68,.72,.69),smoothstep(50.,1400.,d)*.72);
    }
    if(ridgeScene==RIDGE_WOODBLOCK){
      float block=.48*smoothstep(.13,.16,lum)+.52*smoothstep(.44,.49,lum);
      return mix(mix(vec3(.031,.083,.133),vec3(.72,.82,.78),block),c,.16);
    }
    if(ridgeScene==RIDGE_MONET)return mix(c,mix(vec3(.13,.17,.28),vec3(.84,.84,.73),smoothstep(.07,.65,lum)),.47);
    if(ridgeScene==RIDGE_MINERAL)return mix(c,vec3(.047,.24,.224)+lum*.39,smoothstep(120.,1050.,d)*.84);
    if(ridgeScene==RIDGE_CLOUDBREAK)return c*mix(vec3(1.),mix(vec3(.61,.72,.86),vec3(1.21,1.10,.89),groundCloudGap(world)),ridgeSolar.w);
    if(ridgeScene==RIDGE_CLOUDSEA)return crossCloudDeck(c,cameraPosition,world);
    return c;
  }
`;

export const scenicSky=`
  uniform sampler2D ridgePaintedSky;uniform float hasPaintedSky;
  float nightBrush(vec3 d,vec3 center,float twist){
    vec3 east=normalize(cross(vec3(0.,1.,0.),center)),north=cross(center,east);
    vec2 uv=vec2(dot(d,east),dot(d,north));float r=length(uv);
    float angle=atan(uv.y,uv.x);
    uv.x*=1.21;
    float brushPhase=angle*2.+twist*r+2.7*noise21(uv*9.)+.38*noise21(uv*71.);
    float stroke=.5+.5*sin(brushPhase);
    float bristles=smoothstep(.25,.80,noise21(uv*71.+vec2(angle*4.,r*9.)));
    float cuts=.50+.50*sin(12.*angle+twist*r*3.8+5.*noise21(uv*34.));
    return (.69*pow(stroke,2.3)+.31*pow(cuts,3.))*(.62+.66*bristles)*exp(-r*r*16.)*smoothstep(.59,.88,dot(d,center));
  }
  vec3 paintSky(vec3 c,vec3 d,vec3 solarDir,float solar,float night,float clouds){
    if(ridgeScene==0)return c;
    float up=smoothstep(-.01,.18,d.y);
    if(ridgeScene==RIDGE_HALO&&solar>.08){
      // Prismatic red inside the 22-degree circle; sundogs share solar elevation.
      float angle=acos(clamp(dot(d,solarDir),-1.,1.));
      vec3 offset=(angle-vec3(.380,.384,.389))/.014;vec3 arc=.24*exp(-offset*offset)+.76*vec3(sceneBell((angle-.385)/.018));
      float side=sceneBell((d.y-solarDir.y)/.031)*sceneBell((angle-.393)/.032);
      c+=(arc*.33+vec3(1.16,.99,.83)*side)*up*solar*(1.-.4*clouds);
    }else if(ridgeScene==RIDGE_STARRY&&night>.05){
      if(hasPaintedSky>.5){
        float az=atan(d.x,-d.z);float u=fract(az*.31830989+.52+.029*sin(az));
        float v=clamp(.85-asin(clamp(d.y,-1.,1.))*.95+.031*sin(az),.025,.985);
        vec3 stroke=texture2D(ridgePaintedSky,vec2(u,v)).rgb;
        float seam=1.-smoothstep(0.,.035,min(u,1.-u));
        stroke=mix(stroke,texture2D(ridgePaintedSky,vec2(1.-u,v)).rgb,.5*seam);
        stroke=mix(stroke,vec3(.025,.050,.14),smoothstep(.90,1.,d.y)*.91);
        return mix(c,stroke*.93+c*.038,smoothstep(-.09,.055,d.y)*night);
      }
      vec3 center=normalize(vec3(.41,.48,-.74)),other=normalize(vec3(-.44,.35,-.71));
      float curl=nightBrush(d,center,36.)+.84*nightBrush(d,other,-31.);
      curl+=.76*nightBrush(d,normalize(vec3(.39,.23,.88)),-33.)+.60*nightBrush(d,normalize(vec3(-.86,.36,.23)),27.);
      float strokes=noise21(d.xz*19.+d.y*vec2(8.,-17.))*.67+.33*noise21(d.xy*73.);
      float grain=noise21(d.xy*260.+d.z*29.);
      vec3 cobalt=vec3(.014,.030,.143)+vec3(.105,.204,.55)*(curl*1.83+.20*strokes);
      cobalt+=vec3(.061,.092,.16)*smoothstep(.52,.79,grain)*strokes;
      vec3 v=d*11.;float seed=hash21(floor(v.xy)+floor(v.z)*13.1);
      vec3 off=fract(v)-.5;float r=length(off);
      float star=(1.-smoothstep(.028,.098,r))+.12*sceneBell((r-.125)/.030);
      cobalt+=vec3(1.92,1.13,.19)*star*smoothstep(.59,.87,seed);
      // Three large fixed stars also anchor the whorls in a narrow phone view.
      float s1=acos(clamp(dot(d,center),-1.,1.)),s2=acos(clamp(dot(d,other),-1.,1.));
      float s3=acos(clamp(dot(d,normalize(vec3(.12,.67,-.73))),-1.,1.));
      float a=min(min(s1,s2),s3);
      float pigment=noise21(d.xz*85.+d.y*11.);
      float uneven=a+.006*(pigment-.5);
      cobalt+=vec3(1.55,.92,.18)*(exp(-a*a*1710.)+.33*sceneBell((uneven-.047)/.022)+.17*sceneBell((uneven-.086)/.019));
      cobalt+=vec3(.020,.033,.048)*(pigment-.5)*(1.+1.6*curl);
      c=mix(c,cobalt+c*.29,up*night*.94);
    }else if(ridgeScene==RIDGE_GALAXY&&night>.05){
      vec3 normal=normalize(vec3(.46,.63,.625)),axis=normalize(cross(normal,vec3(0.,1.,0.)));
      vec2 uv=vec2(dot(d,axis),dot(d,normal));
      float patches=noise21(d.xz*20.+d.y*6.)*.67+.33*noise21(d.yz*61.);
      float band=sceneBell((uv.y+.030*sin(uv.x*8.))/.112);
      float lane=sceneBell((uv.y+.018*sin(uv.x*16.)+(patches-.5)*.055)/.038);
      c*=mix(vec3(1.),vec3(.67,.72,.90),night*up);
      c+=mix(vec3(.22,.24,.38),vec3(.53,.35,.27),patches*.65)*band*(1.-.87*lane)*(.21+patches*1.40)*night*up*(1.-clouds*.6);
    }else if(ridgeScene==RIDGE_INK||ridgeScene==RIDGE_MONET||ridgeScene==RIDGE_WOODBLOCK||ridgeScene==RIDGE_MINERAL){
      vec2 cloudUV=vec2(d.x*2.8-d.z*1.3,d.y*8.7+.27*noise21(d.xz*4.1));
      float field=.72*noise21(cloudUV)+.39*noise21(cloudUV*2.8+d.z*.61)+.19*noise21(cloudUV*7.);
      float fleck=noise21(d.xy*153.+d.z*43.);
      vec3 painted=c;
      if(ridgeScene==RIDGE_MONET){
        vec3 dawn=mix(vec3(1.12,.69,.48),vec3(.43,.53,.79),smoothstep(-.04,.55,d.y));
        painted=mix(dawn,vec3(.87,.61,.68),smoothstep(.49,.96,field)*.79);
        painted+=vec3(.16,.104,.065)*smoothstep(.70,.92,field+.10*fleck);
      }else if(ridgeScene==RIDGE_INK){
        float mist=smoothstep(.21,1.02,field*.66+.33*sceneLuma(c));
        painted=mix(vec3(.97,.96,.89),vec3(.55,.60,.61),mist*.69)+vec3((fleck-.5)*.028);
      }else if(ridgeScene==RIDGE_WOODBLOCK){
        painted=mix(vec3(.92,.71,.53),vec3(.035,.16,.265),smoothstep(-.045,.47,d.y));
        float relief=smoothstep(.73,.76,field);
        painted=mix(painted,vec3(.97,.67,.47),relief*(.22+.78*sceneBell((d.y-.13)/.16))*.83);
        painted=mix(painted,vec3(.46,.43,.42),.37*(smoothstep(.70,.73,field)-relief)*up);
      }else{
        painted=mix(vec3(1.29,.91,.44),vec3(.57,.66,.64),smoothstep(.015,.64,d.y));
        painted+=vec3(.25,.17,.06)*smoothstep(.73,.95,field);
      }
      c=mix(c,painted,(.85-.69*ridgeNight));
    }else if(ridgeScene==RIDGE_CLOUDSEA){
      c=crossCloudDeck(c,cameraPosition,cameraPosition+d*26000.);
    }else if(ridgeScene==RIDGE_CLOUDBREAK&&solar>.08){
      // Project the same advecting field sampled by the terrain onto the cloud layer.
      vec2 shadowAt=cameraPosition.xz+d.xz*max(100.,(2520.-cameraPosition.y)/max(d.y,.04));
      float gap=cloudGap(shadowAt);
      c=mix(c,vec3(.37,.44,.54),up*(1.-gap)*.75);
      vec3 samplePoint=cameraPosition+d*min(2400.,max(150.,(2520.-cameraPosition.y)/max(d.y,.04))*.55);
      float ray=groundCloudGap(samplePoint)*(.2+.8*pow(max(dot(d,solarDir),0.),3.));
      c+=vec3(.27,.19,.10)*ray*solar*smoothstep(-.05,.12,d.y);
    }else if(ridgeScene==RIDGE_SQUALL){
      float streak=noise21(d.xz*vec2(7.,22.)+vec2(ridgeClock*.046,0.));
      c=mix(c,vec3(.46,.54,.64),up*(.13+.31*streak));
    }
    return c;
  }
`;

export const scenicArchitecture=`
  vec3 paintObject(vec3 original,vec3 world,vec3 n,int surface){
    if(ridgeScene==RIDGE_CLOUDSEA)return crossCloudDeck(original,cameraPosition,world);
    if(ridgeScene==RIDGE_CLOUDBREAK)return original*mix(vec3(1.),mix(vec3(.72,.80,.91),vec3(1.25,1.10,.88),groundCloudGap(world)),ridgeSolar.w);
    if(ridgeScene!=RIDGE_INK&&ridgeScene!=RIDGE_STARRY&&ridgeScene!=RIDGE_MONET&&ridgeScene!=RIDGE_WOODBLOCK&&ridgeScene!=RIDGE_MINERAL&&ridgeScene!=RIDGE_GALAXY)return original;
    // Roof snow, timber and the vertical panels keep different grain and finish.
    vec2 paper=abs(n.y)>.64?world.xz:vec2(abs(n.x)>.65?world.z:world.x,world.y);
    float grain=noise21(paper*vec2(1.8,6.4)+noise21(paper*.36)*1.6);
    float value=sceneLuma(original),shade=value/(value+.32),cap=smoothstep(.45,.86,n.y)*smoothstep(.23,.66,shade);
    float dry=(grain-.5)*(1.-smoothstep(.23,.75,max(fwidth(paper.x),fwidth(paper.y))));
    vec3 paint=original;
    if(ridgeScene==RIDGE_INK){
      paint=mix(vec3(.030,.038,.040),vec3(.92,.90,.81),smoothstep(.09,.81,shade+dry*.13));
      paint*=1.-.21*smoothstep(.59,.86,grain)*(1.-cap);
    }else if(ridgeScene==RIDGE_MONET){
      paint=mix(vec3(.16,.17,.31),vec3(.96,.72,.55),shade);
      paint=mix(paint,vec3(1.04,.86,.80),cap*.76)+dry*vec3(.18,.14,.19);
    }else if(ridgeScene==RIDGE_STARRY){
      paint=mix(vec3(.015,.033,.095),vec3(.33,.49,.80),clamp(shade*1.33+dry*.24,0.,1.));
      paint+=vec3(.38,.24,.07)*cap*smoothstep(.55,.83,grain);
    }else if(ridgeScene==RIDGE_WOODBLOCK){
      float level=.39*smoothstep(.18,.205,shade)+.31*smoothstep(.39,.42,shade)+.30*smoothstep(.65,.67,shade);
      paint=mix(vec3(.035,.080,.104),vec3(.49,.42,.31),level);
      paint=mix(paint,vec3(.88,.88,.76),cap*.96);
    }else if(ridgeScene==RIDGE_MINERAL){
      paint=mix(vec3(.055,.15,.18),vec3(.78,.62,.34),shade)+dry*vec3(.15,.12,.055);
      paint=mix(paint,vec3(.90,.89,.69),cap*.72);
    }else{
      paint=original*vec3(.77,.86,1.15)+cap*vec3(.033,.048,.077);
    }
    if(surface==3)return mix(original,paint,.32); // glass and occupied windows
    float weight=surface==4?.44:surface==1?.82:.72;
    float illumination=ridgeScene==RIDGE_STARRY||ridgeScene==RIDGE_GALAXY?1.:1.-.81*ridgeNight;
    return mix(original,paint*illumination,weight);
  }
`;
