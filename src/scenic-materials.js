import * as THREE from 'three';
import {scenery,cloudFloor,cloudRoof} from './scenery.js';

const identifiers=new Map(scenery.map((s,i)=>[s.id,i+1]));
const defines=[...identifiers].map(([id,n])=>'#define RIDGE_'+id.toUpperCase()+' '+n).join('\n');
export function sceneryUniforms(){
  return {ridgeScene:{value:0},ridgeBlend:{value:1},ridgeClock:{value:0},ridgeSolar:{value:new THREE.Vector4()},ridgeNight:{value:0}};
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
    float through=min(exitM-entry,220.);
    vec3 at=eye+d*(entry+.49*through);
    vec2 drift=vec2(ridgeClock*.006,-ridgeClock*.0025);
    float banks=.62*noise21(at.xz*.0028+drift)+.26*noise21(at.xz*.0093-drift*.34)+.12*noise21(at.xz*.024);
    float veil=(1.-exp(-through*(.012+.032*banks)))*smoothstep(2.0,22.,lengthM);
    float edge=smoothstep(0.,7.,at.y-${cloudFloor}.0)*smoothstep(0.,7.,${cloudRoof}.0-at.y);
    veil*=mix(.12,1.,edge)*smoothstep(.14,.56,banks);
    vec3 cloud=mix(vec3(.36,.44,.56),vec3(1.02,.94,.79),banks*.78+.15*clamp(d.y*-2.,0.,1.));
    cloud*=mix(1.,.20,ridgeNight);
    return mix(color,cloud,veil*.94);
  }
`;

export const scenicGround=`
  vec3 paintSnow(vec3 c,vec3 world,vec3 normalW){
    if(ridgeScene==0)return c;
    vec3 view=world-cameraPosition;float distanceM=length(view);
    vec2 p=world.xz;
    float y=sceneLuma(c),light=clamp(dot(normalW,ridgeSolar.xyz),0.,1.);
    float remote=smoothstep(115.,1150.,distanceM);
    if(ridgeScene==RIDGE_GOLD){
      float altitude=smoothstep(1610.,1980.,world.y);
      float exposure=smoothstep(-.11,.27,dot(normalW,ridgeSolar.xyz));
      float crest=smoothstep(.17,.83,altitude*(.31+.69*exposure));
      float gold=crest*(.24+.76*remote)*ridgeSolar.w;
      c=mix(c,c*vec3(1.58,1.08,.48)+vec3(.49,.185,.015)*crest,gold*.88);
      c=mix(c,c*vec3(.71,.86,1.12),(1.-crest)*remote*.61*ridgeSolar.w);
    }else if(ridgeScene==RIDGE_MONET){
      vec2 brush=mat2(.80,-.60,.60,.80)*p;
      float tuft=noise21(brush*vec2(.52,1.85));
      float stroke=(tuft-.5)*(1.-smoothstep(12.,70.,distanceM))+.34*(noise21(p*.042)-.5);
      float bright=smoothstep(.30,1.06,y+.29*light+stroke*.30);
      vec3 paint=mix(vec3(.28,.32,.61),vec3(1.17,1.04,.79),bright)+stroke*vec3(.14,.105,.15);
      c=mix(c,paint*mix(.78,1.12,clamp(y,0.,1.)),.70-.14*remote);
    }else if(ridgeScene==RIDGE_INK){
      float wash=noise21(p*.025)*.56+noise21(p*.091)*.30+noise21(p*.0042)*.14;
      float relief=clamp(y*.77+.15*normalW.y+.09*wash,0.,1.);
      float ink=smoothstep(.17,.91,relief);
      vec3 paper=mix(vec3(.055,.082,.085),vec3(1.10,1.075,.961),ink);
      c=mix(paper,vec3(.81,.846,.81),remote*(.24+.25*wash));
      c+=(wash-.5)*(.09-.045*remote);
    }else if(ridgeScene==RIDGE_WOODBLOCK){
      float value=clamp(y*.82+.10*normalW.y,0.,1.);
      float tier=.30*smoothstep(.22,.27,value)+.32*smoothstep(.42,.47,value)+.38*smoothstep(.66,.72,value);
      vec3 printColor=mix(vec3(.042,.104,.185),vec3(.96,.96,.84),tier);
      float grazing=1.-smoothstep(.015,.15,abs(dot(normalize(-view),normalW)));
      c=mix(printColor,c,.21);
      c=mix(c,vec3(.055,.13,.18),grazing*remote*.58);
    }else if(ridgeScene==RIDGE_MINERAL){
      float rock=clamp(.24+.53*y+.19*normalW.y+.10*noise21(p*.006),0.,1.);
      vec3 mineral=mix(vec3(.033,.18,.235),vec3(.15,.49,.40),rock);
      mineral=mix(mineral,vec3(.52,.67,.66),smoothstep(.62,1.,rock));
      float edge=smoothstep(1810.,2130.,world.y)*smoothstep(.23,.59,light);
      mineral+=edge*vec3(.27,.13,.014);
      c=mix(c,mineral,remote*.87);
    }else if(ridgeScene==RIDGE_CLOUDBREAK){
      float sun=groundCloudGap(world);
      c=mix(c,c*mix(vec3(.58,.71,.90),vec3(1.24,1.14,.95),sun),ridgeSolar.w*.93);
     }else if(ridgeScene==RIDGE_SPINDRIFT){
      vec2 wind=mat2(.943,-.333,.333,.943)*p;
      float bank=noise21(wind*.093+vec2(-ridgeClock*.22,3.));
      vec2 swept=wind*vec2(.29,1.63)+vec2(-ridgeClock*.89,bank*.94);
      float feather=smoothstep(.55,.85,noise21(swept)) * smoothstep(.48,.76,bank);
      c+=feather*(1.-smoothstep(13.,75.,distanceM))*vec3(.24,.27,.30)*ridgeSolar.w;
    }else if(ridgeScene==RIDGE_MOON){
      c+=vec3(.045,.075,.12)*ridgeNight*smoothstep(.20,.81,normalW.y)*(.38+.62*remote);
    }else if(ridgeScene==RIDGE_CLOUDSEA){
      c=crossCloudDeck(c,cameraPosition,world);
    }
    return c;
  }
`;
export const scenicForest=`
  vec3 paintTree(vec3 c,vec3 world,float lum){
    float d=length(cameraPosition-world);
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
  float nightBrush(vec3 d,vec3 center,float twist){
    vec3 east=normalize(cross(vec3(0.,1.,0.),center)),north=cross(center,east);
    vec2 uv=vec2(dot(d,east),dot(d,north));float r=length(uv);
    float angle=atan(uv.y,uv.x);
    float stroke=sin(3.*angle+twist*r+2.4*noise21(uv*8.))*.5+.5;
    return pow(stroke,2.2)*exp(-r*r*11.)*smoothstep(.59,.88,dot(d,center));
  }
  vec3 paintSky(vec3 c,vec3 d,vec3 solarDir,float solar,float night,float clouds){
    if(ridgeScene==0)return c;
    float up=smoothstep(-.01,.18,d.y);
    if(ridgeScene==RIDGE_HALO&&solar>.08){
      // Prismatic red inside the 22-degree circle; sundogs share solar elevation.
      float angle=acos(clamp(dot(d,solarDir),-1.,1.));
      vec3 offset=(angle-vec3(.378,.387,.396))/.013;vec3 arc=exp(-offset*offset);
      float side=sceneBell((d.y-solarDir.y)/.031)*sceneBell((angle-.393)/.032);
      c+=(arc*.48+vec3(1.32,.99,.65)*side)*up*solar*(1.-.4*clouds);
    }else if(ridgeScene==RIDGE_STARRY&&night>.05){
      vec3 center=normalize(vec3(.41,.48,-.74)),other=normalize(vec3(-.44,.35,-.71));
      float curl=nightBrush(d,center,32.)+.84*nightBrush(d,other,-28.);
      float strokes=.5+.5*sin(d.y*95.+5.*sin(d.x*7.+d.z*3.)+7.*noise21(d.xz*5.));
      vec3 cobalt=vec3(.014,.036,.133)+vec3(.074,.148,.32)*(curl*1.5+.21*strokes);
      vec3 v=d*11.;float seed=hash21(floor(v.xy)+floor(v.z)*13.1);
      vec3 off=fract(v)-.5;float r=length(off);
      float star=(1.-smoothstep(.045,.13,r))+.35*sceneBell((r-.20)/.045);
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
      float band=sceneBell((uv.y+.030*sin(uv.x*8.))/.19);
      float lane=sceneBell((uv.y+.018*sin(uv.x*16.)+(patches-.5)*.055)/.038);
      c+=vec3(.19,.225,.38)*band*(1.-.87*lane)*(.21+patches*1.40)*night*up*(1.-clouds*.6);
    }else if(ridgeScene==RIDGE_INK){
      c=mix(vec3(.68,.73,.72),vec3(.97,.96,.875),clamp(sceneLuma(c)*.64+.29+d.y*.19,0.,1.));
    }else if(ridgeScene==RIDGE_WOODBLOCK){
      c=mix(c,mix(vec3(.87,.76,.64),vec3(.21,.43,.54),smoothstep(-.03,.46,d.y)),.64);
    }else if(ridgeScene==RIDGE_CLOUDSEA){
      c=crossCloudDeck(c,cameraPosition,cameraPosition+d*26000.);
    }else if(ridgeScene==RIDGE_CLOUDBREAK&&solar>.08){
      // Project the same advecting field sampled by the terrain onto the cloud layer.
      vec2 shadowAt=cameraPosition.xz+d.xz*max(100.,(2520.-cameraPosition.y)/max(d.y,.04));
      float gap=cloudGap(shadowAt);
      c=mix(c,vec3(.44,.51,.63),up*(1.-gap)*.69);
    }else if(ridgeScene==RIDGE_SQUALL){
      float streak=noise21(d.xz*vec2(7.,22.)+vec2(ridgeClock*.046,0.));
      c=mix(c,vec3(.46,.54,.64),up*(.13+.31*streak));
    }
    return c;
  }
`;
