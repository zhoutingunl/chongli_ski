import {blendColor} from './environment.js';

// In display order: visible from the piste first, then lookout and rarer conditions.
// The automatic itinerary takes the same catalogue in geographical order below.
export const trialRouteId='wanlong-classic';
export const cloudFloor=1830,cloudRoof=1870;
const natural='nature',art='art';
function scene(id,group,name,en,time,weather,note,english,look='ridge'){
  return {id,group,name,en,time,weather,note,english,look};
}
export const scenery=[
  scene('gold',natural,'日照金山','Alpenglow','sunset','clear','看对面山脊的最后一道暖光和背阴沟。','Compare the last warm ridge with the shaded gullies.'),
  scene('monet',art,'莫奈雪境','Impressionist snow','day','clear','留意板前的暖白雪、蓝紫投影和顺坡的短笔触。','Look for warm snow, violet shadows and short strokes on the piste.'),
  scene('ink',art,'水墨崇礼','Chongli in ink','day','light','近松浓墨，远山淡墨。可在岔口检查雪上道名。','Dark pines fade into ink-wash ridges. Check the lettering at a fork.'),
  scene('cloudsea',natural,'云海穿行','Through the cloud sea','evening','clear','云层在海拔 1,830–1,870 米。山顶俯看，滑过玉龙道时穿云。','Look down from the ridge, then cross the 1,830–1,870 m cloud deck on Jade Dragon.'),
  scene('cloudbreak',natural,'云隙光','Cloudbreak','day','clear','看云隙投下的光斑沿坡移动，远近林带随之明暗。','Watch breaks in the clouds send moving pools of light across the snow and trees.'),
  scene('lamps',natural,'灯光夜场','Floodlit pistes','night','clear','沿道边灯具看暖白光池与远处站房。','Follow the pools of lamplight towards the illuminated base.'),
  scene('starry',art,'梵高星空','Painted starry night','night','clear','抬头看钴蓝旋纹与金色星环，转身可看它们留在同一片天空。','Look up at cobalt brushwork and ochre star halos anchored in the sky.','stars'),
  scene('woodblock',art,'浮世绘雪国','Snow-country woodcut','day','light','看分色的山坡、深蓝松枝和山脊上的细墨边。','Look for printed colour blocks, indigo branches and fine ridge rims.'),
  scene('galaxy',art,'星河之下','Beneath the Milky Way','night','clear','抬头沿星河寻找明亮星云和中间断续的暗尘带。','Trace the luminous galactic arm and its broken dark dust lane.','galaxy'),
  scene('mineral',art,'千里江山','Blue-green mountains','evening','clear','脚下仍是白雪，远坡由石绿过渡到石青，向阳脊略带赭金。','White foreground snow gives way to malachite, azurite and ochre ridges.'),
  scene('dust',natural,'钻石尘','Diamond dust','day','clear','在阳光侧面看悬浮冰晶，停在山顶也能看到。','Face across the sun to see drifting ice crystals, even at a standstill.','crystals'),
  scene('spindrift',natural,'晴天吹雪','Sunny spindrift','day','clear','迎风坡肩扬起薄薄雪羽，雪羽贴地流过。','Loose snow streams close to the surface and lifts off exposed crests.'),
  scene('moon',natural,'月光滑雪','Moonlit descent','night','clear','背向灯池看银蓝色雪肩，抬头可见月盘。','Turn away from the lamps to see silver-blue snow shoulders and the moon.','moon'),
  scene('squall',natural,'阵风暴雪','Passing snow squall','day','heavy','一阵迎风雪过去后，前方林带会重新露出来。','Watch the treeline disappear and return as a gust passes.'),
  scene('halo',natural,'日晕与幻日','Halo and sundogs','day','clear','朝太阳看约 22° 日晕，两侧与太阳同高处有亮斑。','Face the sun to find the 22° halo and two bright sundogs at solar elevation.','sun')
];
export const sceneById=new Map(scenery.map(s=>[s.id,s]));
// From the summit to the valley; the cloud deck spans 59–66% on the reference line.
export const stops=[
  [0,'gold'],[.070,'ink'],[.13,'monet'],[.195,'spindrift'],[.25,'halo'],
  [.303,'mineral'],[.365,'dust'],[.422,'cloudbreak'],[.49,'woodblock'],
  [.56,'cloudsea'],[.673,'squall'],[.735,'moon'],[.794,'starry'],[.864,'galaxy'],[.927,'lamps']
];
export class SceneryTrial {
  constructor(){this.close();}
  close(){
    this.active=false;this.id=scenery[0].id;this.frozen=false;this.original=false;
    this.touring=false;this.example=false;this.sky=false;this.route=null;this.fraction=0;
  }
  enter(route,touring=false,along=0){
    this.close();this.active=true;this.frozen=true;this.route=route;this.touring=touring;this.example=touring;
    this.advance(along);
  }
  select(id){
    if(!sceneById.has(id))return;
    this.id=id;this.touring=false;this.original=false;
  }
  step(direction){
    const n=scenery.length,index=scenery.findIndex(s=>s.id===this.id);
    this.select(scenery[(index+direction+n)%n].id);
  }
  advance(along){
    if(!this.active||!this.route?.length||!Number.isFinite(along))return false;
    this.fraction=Math.max(this.fraction,Math.min(1,along/this.route.length));
    if(!this.touring)return false;
    let id=stops[0][1];
    for(const [threshold,next] of stops){if(this.fraction<threshold)break;id=next;}
    if(this.id===id)return false;
    this.id=id;return true;
  }
  get preset(){return sceneById.get(this.id);}
}
// Keep both comparison frames in identical light. Only an explicit preview can
// override a manually chosen time or weather; nothing here writes preferences.
export function trialClimate(trial,opts,climate){
  if(!trial?.active)return climate.sample(opts.time,opts.weather);
  const p=trial.preset;
  const time=trial.example||opts.time==='auto'?p.time:opts.time;
  const weather=trial.example||opts.weather==='auto'?p.weather:opts.weather;
  const base=climate.sample(time,weather);
  if(trial.original)return base;
  const e={...base,sceneId:p.id};
  const gust=.5+.5*Math.sin(e.elapsed*.57+.9*Math.sin(e.elapsed*.19));
  switch(p.id){
    case 'gold':if(e.sunAmount>.35)e.sun=0xffaa51;break;
    case 'cloudbreak':e.cloud=Math.max(e.cloud,.64*e.sunAmount);e.sky=blendColor(e.sky,0x405f83,e.sunAmount);break;
    case 'lamps':e.lampAmount*=1.22;break;
    case 'moon':e.lampAmount*=1-.70*e.nightAmount;e.ambient*=1-.07*e.nightAmount;break;
    case 'spindrift':e.wind=Math.max(e.wind,.63+.27*gust);break;
    case 'squall':
      e.sceneStrength=e.snowAmount;
      e.wind=Math.max(e.wind,gust*.96*e.snowAmount);
      e.density*=1+e.snowAmount*(gust*.92-.43);
      e.snowAmount*=.58+.42*gust;break;
    case 'starry':case 'galaxy':e.cloud*=1-.70*e.starAmount;break;
  }
  return e;
}

const radianceFields=['sky','horizon','fog','sun','hemi','ground','treeTint','cloudColor'];
const weatherFields=['light','ambient','density','exposure','cloud','nightAmount','auroraAmount','starAmount','sunAmount','moonAmount','snowAmount','wind','lampAmount'];

// A moving tour passes through neutral material while its two light rigs blend.
// A frozen comparison always uses the exact endpoint, even mid-transition.
export function blendScenery(previous,next,fraction){
  if(fraction>=1)return next;
  if(fraction<=0)return previous;
  const k=fraction*fraction*(3-2*fraction);
  const frame={...next,sceneId:k<.5?previous.sceneId:next.sceneId,sceneStrength:Math.abs(2*k-1)*((k<.5?previous:next).sceneStrength??1)};
  for(const field of radianceFields)frame[field]=blendColor(previous[field],next[field],k);
  for(const field of weatherFields)frame[field]=previous[field]+(next[field]-previous[field])*k;
  for(const field of ['dir','sunDir','moonDir']){
    const d=next[field].map((v,i)=>previous[field][i]+(v-previous[field][i])*k);
    const length=Math.hypot(...d);
    frame[field]=length>.001?d.map(v=>v/length):next[field];
  }
  if(frame.snowAmount>.005&&frame.resolvedWeather==='clear')frame.resolvedWeather='light';
  return frame;
}
