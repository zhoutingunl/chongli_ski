export const timeOptions = [
  ['auto','自动'],['day','白天'],['noon','正午'],['evening','傍晚'],['sunset','日落'],
  ['twilight','黄昏'],['night','夜晚'],['aurora','极夜之光'],['dawn','黎明']
].map(([id,label])=>({id,label}));
export const weatherOptions = [['auto','自动'],['clear','晴'],['light','小雪'],['heavy','大雪']].map(([id,label])=>({id,label}));
export const AUTO_STAGE_SECONDS = 120;
const stageFade = 7;
const snowWindow=AUTO_STAGE_SECONDS/3;
const weatherFade=8;
const snowByWeather={clear:0,light:.38,heavy:1};
const hourAt = {day:9.65, noon:12, evening:15.95, sunset:16.87, twilight:17.64, night:21.6, aurora:23.4, dawn:6.43};
const timeNames = Object.fromEntries(timeOptions.map(o=>[o.id,o.label]));
const weatherNames = Object.fromEntries(weatherOptions.map(o=>[o.id,o.label]));
const clamp = (value,min=0,max=1) => Math.max(min,Math.min(max,value));
const mix = (a,b,t) => a+(b-a)*t;
const smooth = (lo,hi,v) => { const t=clamp((v-lo)/(hi-lo)); return t*t*(3-2*t); };
const cycle=(n,length)=>((n%length)+length)%length;
function blendColor(a,b,t) {
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
    nightAmount,auroraAmount,starAmount:smooth(.29,.94,nightAmount)*(1-.95*overcast),
    sunAmount:solar*(1-.90*overcast),moonAmount:moon*(1-.82*overcast),snowAmount,
    wind:clamp(.13+.70*snowAmount+.13*Math.sin(elapsed*.062+.7)**2),treeTint:blendColor(0xfcf8f0,0x7d97bd,nightAmount),
    lampAmount:smooth(.11,.72,nightAmount),cloudColor
  };
}
function newWeatherPlan(random) {
  const firstClear=18+Math.floor(random()*15);
  const nextClear=21+Math.floor(random()*13);
  const firstSnow=17+Math.floor(random()*7);
  const heavyFirst=random()<.5;
  return [
    {start:firstClear,duration:firstSnow,level:heavyFirst?1:.38},
    {start:firstClear+firstSnow+nextClear,duration:snowWindow-firstSnow,level:heavyFirst?.38:1}
  ];
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
  function automaticLight(){
    const index=stageIndex(), phase=stageAge%AUTO_STAGE_SECONDS;
    const earlier=phase<stageFade&&stageAge>=AUTO_STAGE_SECONDS;
    const before=stages[cycle(index-Number(earlier),stages.length)];
    const after=stages[cycle(index+1-Number(earlier),stages.length)];
    const progress=earlier?smooth(-stageFade,stageFade,phase):smooth(AUTO_STAGE_SECONDS-stageFade,AUTO_STAGE_SECONDS+stageFade,phase);
    let hour=cycle(hourAt[before]+cycle(hourAt[after]-hourAt[before],24)*progress,24);
    let aurora=mix(Number(before==='aurora'),Number(after==='aurora'),progress);
    if(arrival){
      const fade=smooth(0,2*stageFade,elapsed-arrival.start);
      const arc=cycle(hour-arrival.hour+12,24)-12;
      hour=cycle(arrival.hour+arc*fade,24);
      aurora=mix(arrival.aurora,aurora,fade);
    }
    return {hour,aurora,stage:stages[cycle(index,stages.length)]};
  }
  return {
    startVisit(){
      startStage=drawStage();stageAge=weatherAge=0;
      arrival=null;weatherSlot=-1;result=null;
    },
    arriveUpperStation(timeMode){
      if(timeMode!=='auto')return;
      const light=automaticLight();
      arrival={hour:light.hour,aurora:light.aurora,start:elapsed};
      startStage=cycle(stageIndex()+1,stages.length);
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
      const {hour,stage,aurora}=automatic?automaticLight():
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
      return result=calculate(hour,stage,aurora,resolvedWeather,snow,elapsed);
    }
  };
}
