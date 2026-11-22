export const timeOptions = [
  ['auto','自动'],['day','白天'],['evening','傍晚'],['sunset','日落'],
  ['twilight','黄昏'],['night','夜晚'],['aurora','极夜之光'],['dawn','黎明']
].map(([id,label])=>({id,label}));
export const weatherOptions = [['auto','自动'],['clear','晴'],['light','小雪'],['heavy','大雪']].map(([id,label])=>({id,label}));
export const AUTO_STAGE_SECONDS = 120;
const stageFade = 7;
const snowByWeather={clear:0,light:.38,heavy:1};
const hourAt = {day:11.35, evening:15.95, sunset:16.87, twilight:17.64, night:21.6, aurora:23.4, dawn:6.43};
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
  day:      [0x2c598c,0xd4e1e7,0x9eb7c5,0xffeee0,0xbacff7,0x647c93,2.70,1.11,.000064,1.00,.31, 0,1],
  evening:  [0x416494,0xf2d6b6,0xc2ac9f,0xffc083,0xaabde9,0x687091,2.85,.94,.000096,1.00,.36, .05,1],
  sunset:   [0x536486,0xf5a780,0xce9e95,0xffa061,0xaab7e5,0x68617f,2.05,.86,.00017,1.00,.35, .16,.90],
  twilight: [0x34436b,0xc797a8,0x93879f,0xdcacc1,0xa8b8e5,0x625d81, .67,.97,.00019,.95,.31, .51,.07],
  latenight:[0x080f24,0x2d3d5a,0x314059,0xbcd5ff,0x8eaad7,0x3f506f, .53,.98,.00017,.91,.20, 1.0,0],
};
const keys = [[0,'latenight'],[3.9,'latenight'],[5.40,'predawn'],[6.43,'dawn'],[7.86,'morning'],[10.2,'day'],[13.3,'day'],[15.95,'evening'],[16.87,'sunset'],[17.64,'twilight'],[19.3,'night'],[22.4,'latenight'],[24,'latenight']];
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
  const sunAlt=h<6.42 ? Math.max(-.6,(h-6.42)*.21) : h>16.98 ? Math.max(-.6,(16.98-h)*.21) : mix(.009,.47,Math.sin(progress*Math.PI));
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
export function createMountainClimate(random=Math.random) {
  const stages=Object.keys(hourAt), weather=Object.keys(snowByWeather);
  let bag=[], elapsed=0, weatherAge=0, stageAge=0, startStage=0, started=false;
  let previousTime,previousWeather,result;
  function nextWeather(previous) {
    if(!bag.length){
      bag=weather.slice();
      for(let i=bag.length-1;i>0;i--){
        const j=Math.floor(random()*(i+1));
        [bag[i],bag[j]]=[bag[j],bag[i]];
      }
      if(bag.at(-1)===previous)[bag[0],bag[bag.length-1]]=[bag[bag.length-1],bag[0]];
    }
    return bag.pop();
  }
  let from=nextWeather(),to=nextWeather(from),hold=18+random()*14,change=8+random()*6;
  const stageIndex=()=>startStage+Math.floor(stageAge/AUTO_STAGE_SECONDS);
  return {
    startRun(timeMode){
      if(timeMode!=='auto')return;
      startStage=cycle(stageIndex()+Number(started),stages.length);
      stageAge=0;started=true;result=null;
    },
    advance(dt,timeMode,weatherMode,riding){
      if(!Number.isFinite(dt)||dt<=0)return;
      elapsed+=dt;result=null;
      if(riding&&timeMode==='auto'){
        started=true;
        stageAge+=dt;
      }
      if(weatherMode!=='auto')return;
      weatherAge+=dt;
      while(weatherAge>=hold+change){
        weatherAge-=hold+change;
        from=to;to=nextWeather(from);hold=18+random()*14;change=8+random()*6;
      }
    },
    sample(timeMode='auto',weatherMode='auto'){
      if(!Object.prototype.hasOwnProperty.call(hourAt,timeMode))timeMode='auto';
      if(!Object.prototype.hasOwnProperty.call(snowByWeather,weatherMode))weatherMode='auto';
      if(result&&timeMode===previousTime&&weatherMode===previousWeather)return result;
      const index=stageIndex(), phase=stageAge%AUTO_STAGE_SECONDS;
      // Blend on both sides of the boundary while the clock passes through midnight.
      const earlier=phase<stageFade&&stageAge>=AUTO_STAGE_SECONDS;
      const before=stages[cycle(index-Number(earlier),stages.length)];
      const after=stages[cycle(index+1-Number(earlier),stages.length)];
      const progress=earlier?smooth(-stageFade,stageFade,phase):smooth(AUTO_STAGE_SECONDS-stageFade,AUTO_STAGE_SECONDS+stageFade,phase);
      const automatic=timeMode==='auto';
      const h=automatic?cycle(hourAt[before]+cycle(hourAt[after]-hourAt[before],24)*progress,24):hourAt[timeMode];
      const stage=automatic?stages[cycle(index,stages.length)]:timeMode;
      const aurora=automatic?mix(Number(before==='aurora'),Number(after==='aurora'),progress):Number(stage==='aurora');
      const snow=weatherMode==='auto'?mix(snowByWeather[from],snowByWeather[to],smooth(hold,hold+change,weatherAge)):snowByWeather[weatherMode];
      const resolvedWeather=snow<.13?'clear':snow<.70?'light':'heavy';
      previousTime=timeMode;previousWeather=weatherMode;
      return result=calculate(h,stage,aurora,resolvedWeather,snow,elapsed);
    }
  };
}
