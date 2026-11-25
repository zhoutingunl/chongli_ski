export const timeOptions = [
  ['auto','自动'],['day','白天'],['noon','正午'],['evening','傍晚'],['sunset','日落'],
  ['twilight','黄昏'],['night','夜晚'],['aurora','极夜之光'],['dawn','黎明']
].map(([id,label])=>({id,label}));
export const weatherOptions = [['auto','自动'],['clear','晴'],['light','小雪'],['heavy','大雪']].map(([id,label])=>({id,label}));
export const AUTO_STAGE_SECONDS = 120;
const stageFade = 7;
const weatherFade=4;
const snowByWeather={clear:0,light:.38,heavy:1};
const hourAt = {day:9.65, noon:12, evening:15.95, sunset:16.87, twilight:17.64, night:21.6, aurora:23.4, dawn:6.43};
const timeNames = Object.fromEntries(timeOptions.map(o=>[o.id,o.label]));
const weatherNames = Object.fromEntries(weatherOptions.map(o=>[o.id,o.label]));
const clamp = (value,min=0,max=1) => Math.max(min,Math.min(max,value));
const mix = (a,b,t) => a+(b-a)*t;
const smooth = (lo,hi,v) => { const t=clamp((v-lo)/(hi-lo)); return t*t*(3-2*t); };
const cycle=(n,length)=>((n%length)+length)%length;
export function blendColor(a,b,t) {
  const r=Math.round(mix((a>>16)&255,(b>>16)&255,t));
  const g=Math.round(mix((a>>8)&255,(b>>8)&255,t));
  return (r<<16)|(g<<8)|Math.round(mix(a&255,b&255,t));
}
// The RGB values represent display-referred colours. Three converts them to linear light.
const palette = {
  night:    [0x0b142e,0x354667,0x37465f,0xbdd5ff,0x96b0df,0x455573, .54,.98,.00018,.89,.23, 1.0,0.00],
  predawn:  [0x222f50,0x9b849a,0x746f89,0xc2d4ed,0xb1bbd9,0x67667e, .54,1.08,.00016,.93,.27, .63,0.0],
  dawn:     [0x485e87,0xf4cab7,0xbaaab0,0xffc092,0xb3c4e8,0x777589,1.42,1.04,.00017,.98,.30, .28,.37],
  morning:  [0x294e82,0xdbe2df,0x9eb5c1,0xffddb3,0xb7cafa,0x60788f,2.60,1.26,.000072,.98,.32, 0,1],
  day:      [0x2c598c,0xd4e1e7,0x9eb7c5,0xffe2bd,0xaac5f7,0x637794,2.85,1.04,.000064,1.00,.31, 0,1],
  noon:     [0x285e94,0xd5e6ef,0xa4bfce,0xfff1da,0xb5cff2,0x697f96,2.88,1.10,.000060,.99,.28, 0,1],
  evening:  [0x416494,0xf2d6b6,0xc2ac9f,0xffc083,0xaabde9,0x687091,2.85,.94,.000096,1.00,.36, .05,1],
  sunset:   [0x536486,0xf5a780,0xce9e95,0xffa061,0xaab7e5,0x68617f,2.05,.86,.00017,1.00,.35, .16,.90],
  twilight: [0x34436b,0xc797a8,0x93879f,0xdcacc1,0xa8b8e5,0x625d81, .67,.97,.00019,.95,.31, .51,.07],
  latenight:[0x080f24,0x2d3d5a,0x314059,0xbcd5ff,0x8eaad7,0x3f506f, .53,.98,.00017,.91,.20, 1.0,0],
};
const keys = [[0,'latenight'],[3.9,'latenight'],[5.40,'predawn'],[6.43,'dawn'],[7.86,'morning'],[10.2,'day'],[12,'noon'],[14,'day'],[15.95,'evening'],[16.87,'sunset'],[17.64,'twilight'],[19.3,'night'],[22.4,'latenight'],[24,'latenight']];
function sampleCurve(keys,point) {
  let i=1;
  while(i<keys.length-1 && keys[i][0]<point) i++;
  const a=keys[i-1],b=keys[i];
  return [a[1],b[1],smooth(a[0],b[0],point)];
}
function direction(azimuth,altitude) {
  const horizontal=Math.cos(altitude);
  return [Math.sin(azimuth)*horizontal,Math.sin(altitude),Math.cos(azimuth)*horizontal];
}
function calculate(h,resolvedTime,aurora,resolvedWeather,snowAmount,elapsed) {
  const [a,b,f]=sampleCurve(keys,h),p=palette[a],q=palette[b];
  const tone=i=>blendColor(p[i],q[i],f), value=i=>mix(p[i],q[i],f);
  const nightAmount=value(11),solar=value(12);
  const auroraAmount=aurora*(1-.69*snowAmount);
  const overcast=smooth(0,1,snowAmount), haze=Math.pow(snowAmount,.78);
  const cloudBase=blendColor(0xa6b5bf,0x41516d,nightAmount);
  const snowHorizon=blendColor(0xe0e6e7,0x52637f,nightAmount);
  const cloudColor=blendColor(0xf5f3ec,0x8795b4,nightAmount);
  const fog=blendColor(tone(2),snowHorizon,haze*.89);
  const progress=clamp((h-6.42)/(16.98-6.42));
  const sunAz=mix(1.36,-1.37,progress);
  const middayLift=.085*smooth(9.8,12,h)*(1-smooth(12,14.9,h));
  const sunAlt=h<6.42 ? Math.max(-.6,(h-6.42)*.21) : h>16.98 ? Math.max(-.6,(16.98-h)*.21) : mix(.009,.408,Math.sin(progress*Math.PI))+middayLift;
  const sunDir=direction(sunAz,sunAlt), moonDir=direction(2.61,.39);
  const moon=smooth(.32,.87,nightAmount);
  const dx=mix(sunDir[0],moonDir[0],moon), dy=mix(Math.max(.012,sunDir[1]),moonDir[1],moon), dz=mix(sunDir[2],moonDir[2],moon);
  const norm=Math.hypot(dx,dy,dz)||1;
  const minute=Math.floor(h*60+.000001);
  return {
    resolvedTime,resolvedWeather,clock:String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0'),
    timeName:timeNames[resolvedTime], weatherName:weatherNames[resolvedWeather], elapsed,
    sky:blendColor(tone(0),cloudBase,haze*.87), horizon:blendColor(tone(1),snowHorizon,haze*.93),fog,
    sun:blendColor(tone(3),cloudColor,haze*.76), hemi:blendColor(tone(4),cloudColor,haze*.64),ground:tone(5),
    light:value(6)*(1-.78*overcast-.16*snowAmount),ambient:value(7)*(1+.14*snowAmount),
    density:value(8)+.00049*snowAmount+.00301*overcast*overcast,exposure:value(9)*(1-.025*overcast),
    dir:[dx/norm,dy/norm,dz/norm], sunDir,moonDir, cloud:clamp(value(10)+haze*.65),
    roseLight:0,nightAmount,auroraAmount,starAmount:smooth(.29,.94,nightAmount)*(1-.95*overcast),
    sunAmount:solar*(1-.90*overcast),moonAmount:moon*(1-.82*overcast),snowAmount,
    wind:clamp(.13+.70*snowAmount+.13*Math.sin(elapsed*.062+.7)**2),treeTint:blendColor(0xfcf8f0,0x7d97bd,nightAmount),
    lampAmount:smooth(.11,.72,nightAmount),cloudColor
  };
}
const roseHours=new Set(['dawn','evening','sunset']);
// Low-angle warm light on sun-facing snow, with cool skylight in its shadows.
export function roseAlpenglow(env, strength) {
  const k=clamp(strength)*(1-smooth(0,.42,env.snowAmount));
  if(!k)return env;
  return {...env,roseLight:k,sky:blendColor(env.sky,0x877fb1,.79*k),
    horizon:blendColor(env.horizon,0xffceac,.87*k),fog:blendColor(env.fog,0xc2a5c1,.59*k),
    cloudColor:blendColor(env.cloudColor,0xffbed3,.86*k),sun:blendColor(env.sun,0xffcd9a,.84*k),
    hemi:blendColor(env.hemi,0xb8aee8,.71*k),ground:blendColor(env.ground,0x776b96,.77*k),
    treeTint:blendColor(env.treeTint,0xffeadc,.43*k),light:env.light+.44*k,ambient:env.ambient+.08*k,
    cloud:clamp(env.cloud+.12*k),sunAmount:mix(env.sunAmount,.96,.68*k)};
}

function newWeatherPlan(random) {
  // Four showers add up to 40 s. Splitting one clear interval across the
  // boundary prevents two full clear spells joining between successive stages.
  const jitter=radius=>Math.floor(random()*(2*radius+1))-radius;
  const a=jitter(2),b=jitter(2),c=jitter(3),d=jitter(3);
  const snow=[10+a,10-a,10+b,10-b],clear=[20+c,20+d,20-c,20-d];
  const heavyFirst=random()<.5;
  let start=Math.floor(clear[0]/2);
  return snow.map((duration,i)=>{
    const period={start,duration,level:(i%2===0)===heavyFirst?1:.38};
    start+=duration+(clear[i+1]||0);return period;
  });
}

function scheduledSnow(period,phase) {
  if(!period)return 0;
  const time=phase-period.start;
  return period.level*smooth(0,weatherFade,time)*(1-smooth(period.duration-weatherFade,period.duration,time));
}

export function createMountainClimate(random=Math.random) {
  const stages=Object.keys(hourAt);
  const drawStage=()=>Math.min(stages.length-1,Math.floor(random()*stages.length));
  let elapsed=0,weatherAge=0,stageAge=0,startStage=drawStage();
  let previousTime,previousWeather,result,weatherSlot=-1,weatherPlan;
  const stageIndex=()=>startStage+Math.floor(stageAge/AUTO_STAGE_SECONDS);
  let arrival=null;
  const skyChoices=new Map();
  function roseAt(index) {
    if(!roseHours.has(stages[cycle(index,stages.length)]))return 0;
    if(!skyChoices.has(index)){
      skyChoices.set(index,Number(random()<.60));
      for(const old of skyChoices.keys())if(old<index-2)skyChoices.delete(old);
    }
    return skyChoices.get(index);
  }
  function automaticLight(){
    const index=stageIndex(), phase=stageAge%AUTO_STAGE_SECONDS;
    const earlier=phase<stageFade&&stageAge>=AUTO_STAGE_SECONDS;
    const before=stages[cycle(index-Number(earlier),stages.length)];
    const after=stages[cycle(index+1-Number(earlier),stages.length)];
    const progress=earlier?smooth(-stageFade,stageFade,phase):smooth(AUTO_STAGE_SECONDS-stageFade,AUTO_STAGE_SECONDS+stageFade,phase);
    let hour=cycle(hourAt[before]+cycle(hourAt[after]-hourAt[before],24)*progress,24);
    let aurora=mix(Number(before==='aurora'),Number(after==='aurora'),progress);
    const from=index-Number(earlier);
    let rose=roseAt(from);
    if(progress>0)rose=mix(rose,roseAt(from+1),progress);
    if(arrival){
      const fade=smooth(0,2*stageFade,elapsed-arrival.start);
      const arc=cycle(hour-arrival.hour+12,24)-12;
      hour=cycle(arrival.hour+arc*fade,24);
      aurora=mix(arrival.aurora,aurora,fade);rose=mix(arrival.rose,rose,fade);
    }
    return {hour,aurora,rose,stage:stages[cycle(index,stages.length)]};
  }
  return {
    startVisit(){
      startStage=drawStage();stageAge=weatherAge=0;
      arrival=null;skyChoices.clear();weatherSlot=-1;result=null;
    },
    arriveUpperStation(timeMode){
      if(timeMode!=='auto')return;
      const light=automaticLight();
      arrival={hour:light.hour,aurora:light.aurora,rose:light.rose,start:elapsed};
      startStage=stageIndex()+1;
      stageAge=0;weatherSlot=-1;result=null;
    },
    advance(dt,timeMode,_weatherMode,riding){
      if(!Number.isFinite(dt)||dt<=0)return;
      elapsed+=dt;result=null;
      if(arrival&&elapsed-arrival.start>=2*stageFade)arrival=null;
      if(!riding)return;
      weatherAge+=dt;
      if(timeMode==='auto')stageAge+=dt;
    },
    sample(timeMode='auto',weatherMode='auto'){
      if(!Object.prototype.hasOwnProperty.call(hourAt,timeMode))timeMode='auto';
      if(!Object.prototype.hasOwnProperty.call(snowByWeather,weatherMode))weatherMode='auto';
      if(result&&timeMode===previousTime&&weatherMode===previousWeather)return result;
      const automatic=timeMode==='auto';
      const {hour,stage,aurora,rose}=automatic?automaticLight():
        {hour:hourAt[timeMode],stage:timeMode,aurora:Number(timeMode==='aurora')};
      let snow=snowByWeather[weatherMode],resolvedWeather=weatherMode;
      if(weatherMode==='auto'){
        const age=automatic?stageAge:weatherAge;
        const slot=Math.floor(age/AUTO_STAGE_SECONDS);
        if(slot!==weatherSlot){
          weatherSlot=slot;
          weatherPlan=newWeatherPlan(random);
        }
        const weatherPhase=age%AUTO_STAGE_SECONDS;
        const period=weatherPlan.find(p=>weatherPhase>=p.start&&weatherPhase<p.start+p.duration);
        snow=scheduledSnow(period,weatherPhase);
        resolvedWeather=period?(snow<.70?'light':'heavy'):'clear';
      }
      previousTime=timeMode;previousWeather=weatherMode;
      const base=calculate(hour,stage,aurora,resolvedWeather,snow,elapsed);
      return result=automatic && weatherMode==='auto'?roseAlpenglow(base,rose):base;
    }
  };
}
