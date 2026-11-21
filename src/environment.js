// One clock drives weather, moving clouds, moonlight and the northern lights. Sampling a
// fixed elapsed time is intentionally independent of the wall clock and of call order.
export const timeOptions = [
  ['auto','自动'],['day','白天'],['evening','傍晚'],['sunset','日落'],
  ['twilight','黄昏'],['night','夜晚'],['aurora','极光之夜'],['dawn','黎明']
].map(([id,label])=>({id,label}));
export const weatherOptions = [['auto','自动'],['clear','晴'],['light','小雪'],['heavy','大雪']].map(([id,label])=>({id,label}));
export const DAY_CYCLE_SECONDS = 720;
export const WEATHER_CYCLE_SECONDS = 384;
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
  dawn:     [0x485e87,0xf4cab7,0xbaaab0,0xffc4a2,0xcdcde7,0x8c8190, .80,1.16,.00017,.98,.30, .28,.37],
  morning:  [0x294e82,0xdbe2df,0x9eb5c1,0xffddb3,0xb7cafa,0x60788f,2.60,1.26,.000072,.98,.32, 0,1],
  day:      [0x2c598c,0xd4e1e7,0x9eb7c5,0xffeee0,0xc4d9fb,0x688198,2.48,1.29,.000064,1.00,.31, 0,1],
  evening:  [0x416494,0xf2d6b6,0xc2ac9f,0xffc389,0xc5cced,0x817989,2.38,1.14,.000096,1.00,.36, .05,1],
  sunset:   [0x536486,0xf5a780,0xce9e95,0xff9d62,0xd8bfc7,0x907686,1.11,1.12,.00017,1.00,.35, .16,.90],
  twilight: [0x34436b,0xc797a8,0x93879f,0xdcacc1,0xb6b9da,0x74718a, .65,1.10,.00019,.95,.31, .51,.07],
  latenight:[0x080f24,0x2d3d5a,0x314059,0xbcd5ff,0x8eaad7,0x3f506f, .53,.98,.00017,.91,.20, 1.0,0],
};
const keys = [[0,'latenight'],[3.9,'latenight'],[5.40,'predawn'],[6.43,'dawn'],[7.86,'morning'],[10.2,'day'],[13.3,'day'],[15.95,'evening'],[16.87,'sunset'],[17.64,'twilight'],[19.3,'night'],[22.4,'latenight'],[24,'latenight']];
const weatherCurve = [[0,0],[63,0],[105,.38],[153,.38],[194,1],[233,1],[277,.38],[313,.38],[355,0],[384,0]];
function sampleCurve(keys,point) {
  let i=1;
  while(i<keys.length-1 && keys[i][0]<point) i++;
  const a=keys[i-1],b=keys[i];
  return [a[1],b[1],smooth(a[0],b[0],point)];
}
function describeHour(h) {
  if(h<5.25 || h>=19) return 'night';
  if(h<7.35) return 'dawn';
  if(h<15) return 'day';
  if(h<16.56) return 'evening';
  if(h<17.22) return 'sunset';
  return 'twilight';
}
function direction(azimuth,altitude) {
  const horizontal=Math.cos(altitude);
  return [Math.sin(azimuth)*horizontal,Math.sin(altitude),Math.cos(azimuth)*horizontal];
}
function calculate(timeMode,weatherMode,elapsed) {
  const total=9.3+elapsed*24/DAY_CYCLE_SECONDS;
  const h=timeMode==='auto'?cycle(total,24):hourAt[timeMode];
  const [a,b,f]=sampleCurve(keys,h),p=palette[a],q=palette[b];
  const tone=i=>blendColor(p[i],q[i],f), value=i=>mix(p[i],q[i],f);
  const [s0,s1,sf]=sampleCurve(weatherCurve,cycle(elapsed,WEATHER_CYCLE_SECONDS));
  const snowAmount=weatherMode==='auto'?mix(s0,s1,sf):{clear:0,light:.38,heavy:1}[weatherMode];
  const resolvedWeather=weatherMode==='auto'?(snowAmount<.13?'clear':snowAmount<.70?'light':'heavy'):weatherMode;
  const nightAmount=value(11), solar=value(12);
  // Aurora is a selectable alpine fantasy; a weaker display can also appear on some clear simulated nights.
  const rareNight=timeMode==='auto' && cycle(Math.floor((total+3.0)/24),3)===2;
  const autoAurora=rareNight ? smooth(0,.8,Math.max(0,(Math.cos((h-23.6)*Math.PI/6)-.26)))*.67 : 0;
  const auroraAmount=(timeMode==='aurora'?1:autoAurora)*(1-.69*snowAmount);
  const resolvedTime=timeMode==='auto'?(auroraAmount>.31?'aurora':describeHour(h)):timeMode;
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
export function createMountainClimate() {
  let prevTime,prevWeather,prevElapsed,result;
  return {sample(timeMode='auto',weatherMode='auto',elapsedSeconds=0) {
    if(!Object.prototype.hasOwnProperty.call(timeNames,timeMode)) timeMode='auto';
    if(!Object.prototype.hasOwnProperty.call(weatherNames,weatherMode)) weatherMode='auto';
    const t=Number.isFinite(elapsedSeconds)?Math.max(0,elapsedSeconds):0;
    if(t!==prevElapsed || prevTime!==timeMode || prevWeather!==weatherMode) {
      result=calculate(timeMode,weatherMode,t);prevTime=timeMode;prevWeather=weatherMode;prevElapsed=t;
    }
    return result;
  }};
}
