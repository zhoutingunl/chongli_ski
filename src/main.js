import './style.css';
import {glyph,emblem,viewNames,viewPicture} from './icons.js';
import {loadMountain,clamp,resortName,formatTime,difficultyName} from './mountain.js';
import {TrailMap} from './map.js';
import {MountainSound} from './sound.js';
import {MountainMusic,tracks,musicFor} from './music.js';
import {TiltSteering} from './tilt.js';
import {timeOptions,weatherOptions} from './environment.js';
import {setLanguage,t,label} from './language.js';
import {heading,button,choice,seg,row,settingsPanel,environmentPanel,controlsPanel} from './settings.js';
import {createTrailGuide} from './trail-guide.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const prefKey='ridgeline.preferences.v1',recordKey='ridgeline.descents.v1';
function read(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function store(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
const previous=read(prefKey,{});
const prefs={resort:'wanlong',gear:'ski',gender:'male',color:'#aa5536',view:'first',outsideView:'follow',quality:'auto',assist:true,sound:false,controls:true,
  time:'auto',weather:'auto',language:'zh',music:true,followMusic:true,track:'ridge',volume:75,tilt:false,...previous};
if(!previous.time&&previous.env){
  prefs.time=({morning:'day',noon:'day',snow:'day',dusk:'sunset'})[previous.env]||'auto';
  prefs.weather=previous.env==='snow'?'light':'clear';delete prefs.env;
}
if(!timeOptions.some(o=>o.id===prefs.time))prefs.time='auto';
if(!weatherOptions.some(o=>o.id===prefs.weather))prefs.weather='auto';
if(!viewNames[prefs.view])prefs.view='first';
if(!viewNames[prefs.outsideView]||prefs.outsideView==='first')prefs.outsideView='follow';
prefs.volume=clamp(Number.isFinite(+prefs.volume)?+prefs.volume:75,0,100);
const colors={'#aa5536':'赭红','#ba9041':'麦金','#597b78':'松绿','#476d91':'冰蓝','#c5c3b6':'雪灰'};
const sound=new MountainSound(),music=new MountainMusic(sound);
let data,world,mini,large,routeId=prefs.resort+'-classic',mapId=routeId,summitChoice='';
let screen='home',page='',photoOrigin='run',recordTab='times',busy=false,toastTimer,focusBack,restoreRequested=false,recorded=false,tray=false;
const keys=new Set(),holds=new Set(),touches=new Map(),drivePointers=new Map();
let drag=0,trim=0,multi=null,backDepart=false;
const keyDirection={ArrowUp:'up',KeyW:'up',ArrowLeft:'left',KeyA:'left',ArrowDown:'down',KeyS:'down',ArrowRight:'right',KeyD:'right'};
const departureTurn={up:0,left:-Math.PI/2,right:Math.PI/2,down:Math.PI};
const touchDevice=matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>0;
document.documentElement.classList.toggle('touch',touchDevice);
const save=()=>store(prefKey,prefs);
const selectedRoute=()=>data?.routes.find(r=>r.id===routeId)||data?.routes[0];
const panelRoute=()=>data?.routes.find(r=>r.id===mapId)||selectedRoute();
const inWorld=()=>['summit','station','trailhead','run','base','lift'].includes(screen);
const watching=()=>screen==='summit'||screen==='station'||screen==='trailhead';
const meters=n=>Math.round(n).toLocaleString('en-US'),km=n=>(n/1000).toFixed(2)+' km';
const resort=id=>label(resortName(id));
const tick='<span class="tick">'+glyph('check',14)+'</span>';
const tilt=new TiltSteering(updateInputs,reason=>announce(reason==='denied'?t('体感权限未开启，可拖动雪面转弯。','Motion access was declined. Drag the snow to steer.'):t('当前未收到倾斜信号，可拖动雪面转弯。','No tilt signal yet. Drag the snow to steer.')));
const guide=createTrailGuide($('#trail-guide'), selectSign);
function announce(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2700);}
function refreshMusic(){
  const mode=screen==='photo'?photoOrigin:screen;
  music.configure(prefs.music, prefs.volume,prefs.followMusic?musicFor(mode,world?.conditions,world?.sim):prefs.track);
}
function activateAudio(){
  try{if(prefs.music)music.unlock();sound.set(prefs.sound);refreshMusic();}catch{}
}
function refreshSound(){
  $$('[data-act="sound"]').filter(b=>b.classList.contains('icon-disc')||b.closest('.hud-tools')).forEach(b=>{
    b.innerHTML=glyph(prefs.sound?'sound':'mute',19);b.setAttribute('aria-label',prefs.sound?t('关闭环境音','Mute environmental sound'):t('开启环境音','Enable environmental sound'));b.setAttribute('aria-pressed',String(prefs.sound));
  });
}
function showCameraMode(){
  const first=prefs.view==='first',control=$('[data-act="pov"]');
  $('#pov-icon').innerHTML=glyph(first?'eye':'ski',16);$('#pov-label').textContent=label(viewNames[prefs.view]);
  const to=label(viewNames[first?prefs.outsideView:'first']);
  control.title=control.ariaLabel=t('切换至'+to+'视角','Switch to '+to+' camera');
  control.setAttribute('aria-pressed',String(first));control.hidden=screen==='lift';
}
function switchCamera(view){
  if(!viewNames[view])return;
  prefs.view=view;if(view!=='first')prefs.outsideView=view;
  world?.cameraChanged();showCameraMode();save();if(watching())hudVisible(true);
}
function homeChoices(){
  $('#resort-choices').innerHTML=choice('resort','wanlong',resort('wanlong'),prefs.resort)+choice('resort','genting',resort('genting'),prefs.resort);
  $('#gear-choices').innerHTML=choice('gear','ski',label('双板'),prefs.gear,'ski')+choice('gear','board',label('单板'),prefs.gear,'board');
  mini?.select(selectedRoute());
}
function setupText(){
  setLanguage(prefs.language);
  document.title=t('山脊之间 · 万龙与云顶滑雪','Ridgeline · Wanlong & Genting');
  $('#logo').innerHTML=$('.loading-crest').innerHTML=emblem;
  $('.wordmark>span:last-child').innerHTML=t('山脊之间<small>RIDGELINE</small>','Ridgeline<small>CHONGLI</small>');
  $('.location').innerHTML='<span></span>'+t('河北 · 崇礼','CHONGLI · HEBEI');
  $('.start-content h1').innerHTML=t('万龙<span>·</span>云顶','Wanlong<span>·</span>Genting');$('.roman').hidden=prefs.language==='en';
  $('.intro').textContent=t('从红花梁出发，滑向同一座山的两面。','Two ski resorts on opposite faces of Honghualiang.');
  const legends=$$('.start-choices legend');legends[0].textContent=t('出发雪场','Starting resort');legends[1].textContent=t('滑行装备','Equipment');
  function face(sel,icon,txt){for(const el of $$(sel))el.innerHTML=glyph(icon,18)+txt;}
  face('[data-act="start"]','mountain',t('进入山顶','Enter summit'));face('.start-actions [data-act="help"]','controls',t('操作指南','Controls'));
  face('.mini-heading,.narrow-map','map',label('雪场地图'));
  $('.footer-meta').innerHTML=glyph('mountain',16)+label('红花梁')+' <b>2,110 m</b>';
  face('.rotate-note','rotate',t('横屏滑行更开阔','Rotate for a wider view'));$('#map-preview').setAttribute('aria-label',t('打开雪场地图','Open trail map'));
  $('.loading-copy p').textContent=t('进入红花梁','Entering Honghualiang');
  $('#gl').setAttribute('aria-label',t('崇礼三维滑雪场','3D Chongli ski area'));$('#hud').setAttribute('aria-label',t('滑行仪表','Skiing instruments'));
  $('.speed small').firstChild.textContent=t('落差 ','Drop ');
  const ph=$('#photo-place');ph.options[0].text=t('滑行者','Rider');ph.options[1].text=t('山顶餐厅','Summit lodge');ph.options[2].text=t('山下大厅与酒店','Base hall and hotel');
  ph.setAttribute('aria-label',t('选择拍摄位置','Photo location'));
  $('#photo-bar>span').textContent=t('拖动环顾 · 双指平移和缩放','Drag to look · two fingers to pan and zoom');
  $('#shutter').innerHTML=glyph('camera',18)+t('保存照片','Save photo');$('[data-act="exit-photo"]').textContent=label('返回');
  for(const [a,ic,txt] of [['fullscreen','expand',t('全屏显示','Fullscreen')],['pause','menu',t('暂停菜单','Pause menu')],['view','eye',label('切换视角')],['tray','back',label('机位工具')],['photo','camera',label('拍照')],['map','map',label('雪场地图')]]){
    const item=a==='fullscreen'?$('.top-tools [data-act="fullscreen"]'):a==='map'?$('.hud-tools [data-act="map"]'):$('#hud [data-act="'+a+'"]');
    item.innerHTML=glyph(ic,20);item.setAttribute('aria-label',txt);item.title=txt;
  }
  $$('.control').forEach(b=>b.textContent=label({boost:'加速',brake:'刹车',jump:'跳'}[b.dataset.hold]));
  $('[data-hold="jump"]').setAttribute('aria-label',t('按住蓄力，松开起跳','Hold to charge, release to jump'));
  $('#station-card [data-act="map"]').textContent=t('地图选道','Trail map');
  $('#direction-pad').setAttribute('aria-label',t('滑行方向','Riding directions'));
  const directions={up:t('向前起滑或加速','Push off forward or tuck'),left:t('向左起滑或转弯','Push off or turn left'),right:t('向右起滑或转弯','Push off or turn right'),down:t('向后起滑或刹车','Push off behind or brake')};
  for(const key of $$('.dir-key')){key.ariaLabel=directions[key.dataset.drive];key.title=key.ariaLabel;}
  $('#look-reset-text').textContent=t('回正视线','Face forward');showCameraMode();
  $('#station-card [data-act="launch-trail"]').textContent=t('从这里出发','Start here');
  $('#base-actions').setAttribute('aria-label',t('山脚停留','Base area'));
  $('#base-hint').textContent=t('拖动环顾山脚','Drag to look around');
  $('#base-result').textContent=t('本趟成绩','Run stats');
  $('#base-hall-text').textContent=t('看大厅与酒店','Look at the hall & hotel');
  $('#base-restart-text').textContent=t('重滑本线','Ski this run again');
  $('#base-lift-text').textContent=t('乘缆车上山','Ride lift up');
  $('#steering>span').textContent=t('左侧转弯 · 右侧环顾','Steer left · look right');
  $('#steering').setAttribute('aria-label',t('左右拖动转弯','Drag to steer'));
  $('#keyboard-hint').innerHTML=t('方向键滑行 <i></i> 鼠标拖动环顾 <i></i> R 回正 <i></i> 空格蓄力跳','Arrows to ski <i></i> Drag to look <i></i> R to face forward <i></i> Hold Space to jump');
  $('#overlay').setAttribute('aria-label',label('设置'));$('.top-tools [data-act="sound"]').title=t('环境音','Environmental sound');
  $$('.mini-open,[data-glyph]').forEach(el=>el.innerHTML=glyph(el.dataset.glyph));
  homeChoices();refreshSound();if(world?.sim.route)paintHUD();
}
async function ensureData(){if(data)return data;data=await loadMountain();if(!mini){mini=new TrailMap($('#mini-map'),data,true);mini.select(selectedRoute());}return data;}
function clearInputs(){
  keys.clear();holds.clear();touches.clear();drivePointers.clear();backDepart=false;multi=null;drag=trim=0;
  world?.sim.cancelJump?.();updateInputs();
}
function updateInputs(){
  const active=screen==='run'&&!page&&!busy,viewActive=inWorld()&&!page&&!busy;
  const physical=new Set(drivePointers.values());
  for(const key of keys){if(keyDirection[key])physical.add(keyDirection[key]);}
  const keyboard=Number(physical.has('right'))-Number(physical.has('left'));
  const hasTouchSteer=!multi&&[...touches.values()].some(p=>p.role==='steer');
  const lateral=clamp(keyboard*(keys.has('ShiftLeft')||keys.has('ShiftRight')?1:.68)+(hasTouchSteer?drag:keyboard?0:tilt.value),-1,1);
  if(!physical.has('down'))backDepart=false;
  if(world){
    world.input.lookX=viewActive?Number(keys.has('KeyL'))-Number(keys.has('KeyJ')):0;
    world.input.lookY=viewActive?Number(keys.has('KeyU'))-Number(keys.has('KeyO')):0;
    world.input.steer=active?lateral:0;
    world.input.trim=active?clamp(trim+Number(keys.has('KeyI'))-Number(keys.has('KeyK')),-1,1):0;
    world.input.brake=active&&(holds.has('brake')||(physical.has('down')&&!backDepart));
    world.input.boost=active&&(holds.has('boost')||physical.has('up'));
  }
  for(const b of $$('.dir-key'))b.classList.toggle('active',physical.has(b.dataset.drive));
  for(const b of $$('[data-hold]'))b.classList.toggle('active',active&&(b.dataset.hold==='jump'?(holds.has('jump')||keys.has('Space')):!!world?.input[b.dataset.hold]));
  $('#steering').style.setProperty('--drag',(lateral*22)+'px');$('#steering').classList.toggle('edge-set',active&&Math.abs(lateral)>.72);
}
function hudVisible(show){
  $('#home').hidden=screen!=='home';$('#hud').hidden=!show||!!page;$('#photo-bar').hidden=screen!=='photo';
  document.documentElement.classList.toggle('hud-minimal',!prefs.controls||screen!=='run');
  $('#direction-pad').hidden=!watching()&&(screen!=='run'||!prefs.controls);
  $('#look-reset').hidden=!world?.looking||!!page;
  if(screen!=='home')showCameraMode();
  $('#hud').classList.toggle('watching',watching()||screen==='base');$('#lift-strip').hidden=screen!=='lift';$('#station-card').hidden=!watching();
  $('#base-actions').hidden=screen!=='base';
  if(!show||page||(screen!=='summit'&&screen!=='run'))guide.hide();
  $('#tray-tools').hidden=!tray;$('#tray-toggle').setAttribute('aria-expanded',String(tray));$('#near-lift').hidden=true;
  if(watching()){
    const side=world.station.side,lodge=label(side==='wanlong'?'山顶木屋':'金花阁');
    const look=$('#look-choices');look.hidden=screen!=='summit';
    $('#station-card [data-act="launch-trail"]').hidden=screen!=='trailhead';
    $('#station-card [data-act="lift"]').hidden=screen==='trailhead';
    look.innerHTML=[['wide',label('全景')],['lodge',lodge],['lift',label('索道站')],['valley',t('望群山','Ridgeline')]].map(([key,txt])=>choice('look',key,txt,world.station.view)).join('');
  }
}
function discardMap(){if(large){large.observer.disconnect();large=null;}}
async function begin(id=routeId){
  if(busy)return;busy=true;restoreRequested=false;activateAudio();
  if(prefs.tilt&&!tilt.enabled)enableTilt();
  $('#loading').hidden=false;$('#load-text').textContent=label('读取红花梁地形');
  try{
    await ensureData();const route=data.routes.find(r=>r.id===id)||selectedRoute();
    if(!world){const {createWorld}=await import('./world.js');world=await createWorld($('#gl'),data,prefs,worldEvent,s=>$('#load-text').textContent=label(s));}
    discardMap();page='';$('#overlay').hidden=true;routeId=route.id;prefs.resort=route.resort;save();
    recorded=false;screen='summit';summitChoice='';tray=false;clearInputs();world.stage(route);
    hudVisible(true);paintHUD();world.graphics();refreshMusic();
    if(restoreRequested||document.hidden)openPanel('view');
  }catch(e){console.error(e);openPanel('error');}
  finally{busy=false;$('#loading').hidden=true;}
}
function launch(route){
  discardMap();page='';$('#overlay').hidden=true;routeId=route.id;prefs.resort=route.resort;save();
  recorded=false;screen='run';tray=false;clearInputs();tilt.calibrate();world.start(route);hudVisible(true);paintHUD();refreshMusic();
}
function pushOff(direction,sign){
  if(!watching()||page||busy||!world)return false;
  const route=world.pushOff(departureTurn[direction]??0,sign?.routeId||summitChoice||undefined,sign?.heading);
  if(!route)return false;
  recorded=false;screen='run';tray=false;routeId=route.id;prefs.resort=route.resort;save();
  tilt.calibrate();hudVisible(true);paintHUD();refreshMusic();return true;
}
function beginDirection(direction){
  const departing=watching();
  if(departing&&!pushOff(direction))return false;
  if(screen!=='run')return false;
  // Backward on the stationary pad chooses the outlet behind the rider.
  // Subsequent down presses operate the brake normally.
  if(departing&&direction==='down')backDepart=true;
  if(!departing&&direction!=='down'&&!world.sim.airborne&&world.sim.speed<.18)
    world.sim.speed=1.35;
  return true;
}
function selectSign(sign){
  if(!sign||(sign.selectable===false)||!(sign.choiceId||sign.routeId))return;
  if(watching()){pushOff('up',sign);return;}
  if(screen==='run'&&world.sim.chooseDirection(sign.choiceId||sign.routeId,sign.signId)){
    announce(t('岔口转入','At the junction · ')+t(sign.name,sign.en||label(sign.name)));
  }
}
function home(){
  clearInputs();world?.stop();screen='home';page='';discardMap();$('#overlay').hidden=true;
  homeChoices();hudVisible(false);sound.update(0,0);refreshMusic();
}
function worldEvent(type,arg){
  if(type==='guide'){
    if(arg&&!page&&(screen==='run'||screen==='summit'))guide.update({...arg,language:prefs.language});
    else guide.hide();
    return;
  }
  if(type==='hud'&&inWorld()&&!page){
    if(screen==='run'&&arg.route?.id!==routeId){routeId=arg.route.id;announce(t('转入','Joined ')+label(arg.route.name));}
    paintHUD();sound.update(screen==='lift'?3:arg.speed,(arg.skid||0)*.65+(arg.brake||0)*.6,document.hidden);refreshMusic();}
  if(type==='finish'&&!recorded){
    recorded=true;screen='base';tray=false;const records=read(recordKey,[]);
    records.push({routeId:arg.route.id,name:arg.route.name,resort:arg.route.destination,when:new Date().toISOString(),gear:prefs.gear,time:Math.round(arg.elapsed),max:arg.maxSpeed*3.6,dist:arg.travel,drop:Math.round(arg.startY-arg.ground)});
    store(recordKey,records.slice(-100));clearInputs();hudVisible(true);paintHUD();refreshMusic();
  }
  if(type==='disembark'){routeId=arg.route.id;prefs.resort=arg.side;screen=arg.mode;recorded=false;summitChoice='';save();
    hudVisible(true);paintHUD();refreshMusic();announce(arg.mode==='summit'?t('已到山顶，可环顾或选道','At the summit. Look around or choose a trail.'):t('已到站，可环顾或乘回程索道','At the station. Look around or take the return lift.'));}
  if(type==='lost')openPanel('lost');
}
function paintHUD(){
  if(!world?.sim.route)return;
  const s=world.sim,lift=world.liftInfo,r=s.route,info=world.conditions,station=watching()?world.station:null;
  const speed=lift?lift.speed:s.speed;
  $('#speed').textContent=Math.round(speed*3.6);$('#speed-bar').style.width=clamp(speed/28*100,0,100)+'%';
  $('#drop').textContent=station?0:Math.max(0,Math.round(s.startY-s.y));
  const bare=s.trail?.name?.replace(/[（(].*$/,'');let grade=label(difficultyName[s.trail?.difficulty]||'道外');
  const approach=screen==='run'?s.approach:null;
  if(approach)grade=t('连接道','Connector');
  if(screen==='base')grade=t('山脚停留','Base area');
  if(station)grade=station.trailhead?t('雪道起点','Trailhead'):station.summit?t('山顶观景','Summit lookout'):t('索道站','Lift station');
  if(lift)grade=t('索道','Lift');
  $('#elevation').textContent=t('海拔 ','Elevation ')+meters(s.y)+' m  ·  '+grade;
  const trail=station?(station.trailhead?label(r.name):station.summit?(station.side==='wanlong'?label('红花梁'):t('云顶山顶','Genting summit')):label(station.lift.meta.name)):lift?resort(lift.resort)+' · '+label(lift.name):label(bare||'道外');
  $('#trail-name').textContent=screen==='base'?resort(r.destination)+t('山脚',' base'):approach?t(approach.name,approach.en):trail;
  $('#look-reset').hidden=!world.looking||!!page;
  const d=Math.abs(Math.round(s.slope)),dir=lift?(lift.dir>0?t('上行','Ascent'):t('下行','Descent')):'';
  $('#gradient').textContent=station?(station.summit?t('山顶停留','At the summit'):t('站台停留','At the station')):lift?dir:t('坡度 ','Grade ')+d+'° · '+(d<9?t('缓坡','Gentle'):d<20?t('中坡','Moderate'):t('陡坡','Steep'));
  $('#progress').textContent=station?'':lift?Math.round(lift.progress*100)+'%':resort(r.destination)+t('方向 · ',' · ')+Math.round(100*s.along/r.length)+'% · '+formatTime(s.elapsed);
  if(approach)$('#progress').textContent=t('通往','Towards ')+t(approach.target,approach.targetEn)+' · '+formatTime(s.elapsed);
  $('#world-clock').textContent=info.clock;$('#weather-name').textContent=label(info.weatherName)+' · '+label(info.timeName);
  const icon=info.resolvedWeather==='heavy'?'heavy':info.resolvedWeather==='light'?'snow':({day:'sun',evening:'evening',sunset:'dusk',twilight:'twilight',night:'night',aurora:'aurora',dawn:'dawn'}[info.resolvedTime]||'sun');
  if($('#weather-icon').dataset.icon!==icon){$('#weather-icon').innerHTML=glyph(icon);$('#weather-icon').dataset.icon=icon;}
  const flag=screen==='run'?world.nextFlag:null;
  $('#next-flag').hidden=flag==null;
  if(flag!=null)$('#next-flag').textContent=t('下一面旗 · ','Next flag · ')+Math.round(flag)+' m';
  const near=screen==='run'?world.nearbyStation:null;
  $('#near-lift').hidden=!near;
  if(near)$('#near-lift-label').textContent=label(near.name)+' · '+label('上车');
  if(lift){$('#lift-text').textContent=resort(lift.resort)+' · '+label(lift.name)+' · '+dir+' '+Math.round(lift.progress*100)+'%';$('[data-act="skip-lift"]').textContent=lift.dir>0?t('直达上站','Skip to upper station'):t('直达下站','Skip to lower station');}
  if(station){
    $('#station-title').textContent=station.trailhead?label(r.name):station.summit?(station.side==='wanlong'?t('万龙山顶木屋 · 七索上站','Wanlong summit lodge · Lift 7'):t('金花阁 · 云顶一索上站','Jinhua Pavilion · Genting Lift 1')):resort(station.side)+' · '+label(station.lift.meta.name);
    $('#station-note').textContent=t('按方向键起滑 · 拖动环顾','Press a direction to ski · drag to look');
    $('#station-ride').textContent=station.end==='top'?t('乘索道下山','Ride lift down'):t('乘索道上行','Ride lift up');
  }
}
function nav(k,txt,cls=''){return '<button data-act="'+k+'" class="'+cls+'" aria-current="'+(page===k)+'">'+txt+'</button>';}
function navMarkup(){
  const item=(k,name,c)=>nav(k,label(name),c);
  if(screen==='home')return '<span class="nav-label">'+t('红花梁 · 山顶','HONGHUALIANG')+'</span>'+button('close-panel',t('回到出发界面','Back to start'),'resume')+'<hr>'+item('map','雪场地图')+item('help','操作说明')+item('settings','设置')+item('records','排行榜')+nav('sources',t('地形资料','Terrain data'),'nav-small');
  const resume=screen==='base'?t('回到山脚','Back to the base'):screen==='trailhead'?t('回到起点','Back to trailhead'):screen==='summit'?t('回到山顶','Back to summit'):screen==='station'?t('回到站台','Back to station'):screen==='lift'?t('继续乘坐','Continue ride'):t('继续滑','Resume descent');
  const results=screen==='base'?nav('finish',t('本趟成绩','Run stats')):'';
  return '<span class="nav-label">'+t('PAUSED · 暂停','PAUSED')+'</span>'+button('close-panel',resume,'resume')+results+item('map','雪场地图')+button('photo',label('拍照'))+'<hr>'+item('environment','环境')+item('view','视角')+item('rider','角色')+item('records','排行榜')+button('share',label('分享'),'nav-small')+'<hr>'+item('help','操作说明','nav-small')+item('settings','设置','nav-small')+button('restart',t('回到雪道起点','Return to trailhead'),'nav-small')+button('home',t('回到主界面','Main menu'),'nav-small');
}
function openPanel(k){
  if(k==='map'&&!data){ensureData().then(()=>openPanel('map')).catch(()=>openPanel('error'));return;}
  const previousPage=page;if(!previousPage)focusBack=document.activeElement;discardMap();
  page=k;clearInputs();world?.pause(true);sound.update(0,0,document.hidden);
  if(k==='map'&&previousPage!=='map')mapId=(screen==='summit'&&summitChoice)||world?.sim.route?.id||routeId;
  if(k==='map'&&screen==='home')mapId=routeId;
  $('#overlay').hidden=false;$('#overlay').setAttribute('role','dialog');$('#overlay').setAttribute('aria-modal','true');
  $('#hud').hidden=true;guide.hide();$('#pause-nav').innerHTML=navMarkup();renderPanel();
  if(!previousPage)$('#panel button')?.focus({preventScroll:true});
}
function closePanel(){
  if(page==='lost'){location.reload();return;}
  discardMap();page='';$('#overlay').hidden=true;world?.pause(false);if(screen==='run')tilt.calibrate();hudVisible(inWorld());paintHUD();focusBack?.focus?.({preventScroll:true});
}
function sourceText(){
  return '<p class="credit-text">'+t('红花梁近区采用 32 米高程网格，外围约 49 公里山地采用 240 米网格。雪道、索道和建筑轮廓来自公开测绘。山丹丹与翠菊花连接两侧雪场。','The local 32 m elevation grid is surrounded by 49 km of mountains sampled at 240 m. Surveyed pistes, lifts and buildings anchor both resorts. Lily and Aster connect the two sides.')+'</p><p class="credit-text">'+t('雪面底色来自 2025 年 1 月 21 日 Sentinel-2 影像，树群分布参考 2021 年土地覆盖。部分道宽采用估算。人物、地标外观和开场全景为游戏重建。','Snow colour comes from Sentinel-2 imagery of 21 January 2025. Tree placement follows 2021 land cover. Some trail widths are estimated. The rider, landmark façades and opening panorama are reconstructions.')+'</p><p class="credit-text"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors / ODbL</a> · <a href="./assets/geo/mountain.json" download>'+t('下载雪道数据','Download trail data')+'</a> · <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen / USGS</a> · <a href="https://dataspace.copernicus.eu/" target="_blank" rel="noopener">Copernicus Sentinel-2</a> · <a href="https://esa-worldcover.org/en" target="_blank" rel="noopener">ESA WorldCover</a> · <a href="https://polyhaven.com/license" target="_blank" rel="noopener">Poly Haven / CC0</a> · <a href="./assets/art/credits.txt" target="_blank" rel="noopener">'+t('美术记录','Art credits')+'</a></p>';
}
function renderPanel(keep=false){
  const p=$('#panel'),scroll=keep?p.scrollTop:0,openDetails=keep&&p.querySelector('.settings-detail')?.open;
  if(page==='view'){
    p.innerHTML=heading('VIEW','视角')+'<div class="view-grid">'+Object.entries(viewNames).map(([id,txt])=>'<button class="view-tile" aria-pressed="'+(prefs.view===id)+'" data-choice="view" data-value="'+id+'">'+viewPicture(id)+'<b>'+label(txt)+'</b>'+(id===prefs.view?tick:'')+'</button>').join('')+'</div><p class="panel-foot">'+t('右上角一键切换第一人称和外部机位。拖动可环顾四周，点指南针回正。','Use the top camera switch for first or third person. Drag to look around and tap the compass to face forward.')+'</p>';
  }else if(page==='environment')p.innerHTML=environmentPanel(prefs);
  else if(page==='settings')p.innerHTML=settingsPanel(prefs,music.track,sourceText());
  else if(page==='help')p.innerHTML=controlsPanel();
  else if(page==='rider'){
    p.innerHTML=heading('RIDER','角色',t('角色与雪具','Rider and equipment'))+row(t('滑行装备','Equipment'),seg('gear',[['ski','双板','ski'],['board','单板','board']],prefs.gear))+row(label('角色'),seg('gender',[['male','男'],['female','女']],prefs.gender))+row(t('雪服配色','Jacket colour'),'<div class="swatches">'+Object.entries(colors).map(([c,n])=>'<button class="swatch" aria-label="'+label(n)+'" title="'+label(n)+'" data-choice="color" data-value="'+c+'" aria-pressed="'+(c===prefs.color)+'" style="--coat:'+c+'"></button>').join('')+'</div>');
  }else if(page==='map'){
    const r=panelRoute(),side=(screen==='summit'&&world.station?.side)||r.resort;
    const priority={'wanlong-gold':0,'wanlong-silver':1};
    const routes=[...data.routes].sort((a,b)=>Number(b.resort===side)-Number(a.resort===side)||(priority[a.id]??2)-(priority[b.id]??2));
    p.innerHTML=heading('TRAIL MAP','双雪场',label('雪场地图'))+'<div class="map-layout"><div class="map-stage"><canvas id="large-map" aria-label="'+t('万龙与云顶雪道图，可拖动和缩放','Wanlong and Genting trail map. Drag or zoom.')+'"></canvas><span class="north">N ↑</span><span class="map-legend"><i></i>'+label('初级')+' <i></i>'+label('中级')+' <i></i>'+label('高级')+'</span><div class="map-zoom">'+button('zoom-out',glyph('minus'))+button('recenter',glyph('compass'))+button('zoom-in',glyph('plus'))+'</div></div><div class="route-list">'+routes.map(a=>'<button class="route-choice" data-choice="route" data-value="'+a.id+'" aria-pressed="'+(r.id===a.id&&(screen!=='summit'||!!summitChoice))+'"><b>'+label(a.name)+'</b><span>'+resort(a.resort)+(a.resort!==a.destination?' → '+resort(a.destination):'')+' · '+km(a.length)+'</span></button>').join('')+'</div></div><div class="map-action" id="map-action"></div><div class="map-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · Mapzen / USGS</div>';
    $$('.map-zoom button').forEach((b,i)=>b.setAttribute('aria-label',[t('缩小','Zoom out'),t('复位','Reset map'),t('放大','Zoom in')][i]));
    large=new TrailMap($('#large-map'),data);large.select(screen==='summit'&&!summitChoice?null:r,inWorld()?world.sim:null);mapAction();
  }else if(page==='records'){
    const r=inWorld()?world.sim.route:selectedRoute();
    let records=read(recordKey,[]).slice().reverse();
    if(recordTab==='times')records=records.filter(e=>e.routeId===r?.id||e.name===r?.name).sort((a,b)=>a.time-b.time);
    p.innerHTML=heading('LEADERBOARD','本机',t('滑行排行榜','Your descents'))+seg('recordTab',[['times',t('本线用时','Course times')],['recent',t('最近滑行','Recent runs')]],recordTab)+'<p class="panel-foot">'+(recordTab==='times'?label(r?.name)+t(' · 按用时排序',' · fastest first'):t('最近完成的滑行','Recently completed runs'))+'</p>'+
      (records.length?records.slice(0,12).map((e,i)=>'<div class="record"><div><b>'+(recordTab==='times'?(i+1)+'.　':'')+label(e.name)+'</b><small>'+new Date(e.when).toLocaleDateString(t('zh-CN','en-GB'))+' · '+label(e.gear==='ski'?'双板':'单板')+' · '+km(e.dist)+'</small></div><span>'+formatTime(e.time)+'</span></div>').join(''):'<p class="credit-text">'+t('滑抵山脚后，这里会记下你的线路、用时和滑行距离。','Reach the base to record your route, time and distance here.')+'</p>');
  }else if(page==='finish'){
    const s=world.sim,r=s.route;
    p.innerHTML=heading('ARRIVAL','山脚',t('抵达','Arrived at ')+resort(r.destination))+'<p class="finish-summary">'+label(r.name)+'</p><p class="credit-text">'+(r.destination==='wanlong'?label('万龙雪具大厅')+' · '+label('龙宫酒店'):label('云顶滑雪大厅')+' · '+label('云顶大酒店'))+'</p><div class="metrics">'+[[t('滑行距离','Distance'),km(s.travel)],[t('本次用时','Time'),formatTime(s.elapsed)],[t('最高时速','Top speed'),Math.round(s.maxSpeed*3.6)+' km/h']].map(([k,v])=>'<div><small>'+k+'</small><b>'+v+'</b></div>').join('')+'</div><div class="finish-actions">'+button('lift',glyph('lift',20)+t('乘索道上山','Ride lift up'),'launch')+button('base-photo',t('拍大厅与酒店','Photograph the lodge'),'quiet-button')+button('restart',t('再滑一次','Another descent'),'quiet-button')+'</div>';
  }else if(page==='sources')p.innerHTML=heading('TERRAIN','资料',t('地形与影像','Terrain and imagery'))+sourceText();
  else{
    const lost=page==='lost';p.innerHTML=heading('HONGHUALIANG','红花梁',t('雪场未能载入','Unable to load the mountain'))+'<div class="recovery"><p class="credit-text">'+(lost?t('图形上下文已中断，重新载入可回到山顶。','The graphics context was interrupted. Reload to return to the summit.'):t('三维场景需要支持 WebGL 2 的浏览器，也可以重试载入资源。','Use a browser with WebGL 2 or retry loading the mountain assets.'))+'</p>'+button(lost?'reload':'retry',t('重新载入','Reload'),'launch')+'</div>';
  }
  if(openDetails&&p.querySelector('.settings-detail'))p.querySelector('.settings-detail').open=true;
  p.scrollTop=scroll;
}
function mapAction(){
  const r=panelRoute(),s=world?.sim,ready=!(screen==='summit'&&!summitChoice);
  let txt=t('前往','Visit ')+resort(r.resort)+t('山顶',' summit');
  if(!ready)txt=t('请先点选雪道','Choose a trail first');
  else if(screen==='summit'&&r.resort===world.station.side)txt=t('从这条雪道出发','Start this trail');
  else if(screen==='run'&&r.id===s.route.id)txt=t('继续滑行','Resume descent');
  else if(screen==='run'&&s.junctionFor(r.id))txt=t('在前方岔口转入','Take the upcoming junction');
  else if(screen==='run'&&r.closest(s.x,s.z).distance<=64)txt=t('沿此线路滑行','Join this trail');
  $('#map-action').innerHTML='<button class="launch" data-act="apply-route" '+(ready?'':'disabled')+'>'+txt+'</button>'+(ready?'<span class="fine">'+label(difficultyName[r.difficulty])+t(' · 落差 ',' · Drop ')+Math.round(r.drop)+' m</span>':'');
}
function setChoice(kind,v){
  if(kind==='look'){world.lookAroundStation(v);hudVisible(true);paintHUD();return;}
  if(kind==='recordTab'){recordTab=v;renderPanel();return;}
  if(kind==='route'){
    mapId=v;if(screen==='summit')summitChoice=v;
    for(const el of $$('.route-choice'))el.setAttribute('aria-pressed',String(el.dataset.value===v));
    large?.select(panelRoute(),inWorld()?world.sim:null);mapAction();return;
  }
  if(kind==='track'){prefs.track=v;prefs.followMusic=false;prefs.music=true;activateAudio();}
  else if(kind==='resort'){prefs.resort=v;routeId=v+'-classic';homeChoices();}
  else if(kind==='assist'){world?.sim.setAssist(v==='on');prefs.assist=v==='on';}
  else if(kind==='controls'){prefs.controls=v==='on';}
  else{
    prefs[kind]=v;
    if(['gear','gender','color'].includes(kind)){if(world?.sim.route)world.changeRider();homeChoices();}
    if(kind==='view')switchCamera(v);
    if(kind==='time'||kind==='weather'){world?.environment();refreshMusic();}
    if(kind==='quality')world?.graphics();
  }
  save();if(page){renderPanel(true);$$('[data-choice="'+kind+'"]').find(b=>b.dataset.value===v)?.focus({preventScroll:true});}
}
async function enableTilt(){
  const ok=await tilt.enable();prefs.tilt=ok;save();if(page==='settings')renderPanel(true);
}
async function screenFull(){
  try{
    if(document.fullscreenElement)await document.exitFullscreen();
    else if(document.documentElement.requestFullscreen){await document.documentElement.requestFullscreen({navigationUI:'hide'});if(touchDevice)window.screen.orientation?.lock?.('landscape').catch(()=>{});}
    else announce(t('横过手机即可横屏滑行','Rotate your phone for a landscape view.'));
  }catch{announce(t('横过手机即可横屏滑行','Rotate your phone for a landscape view.'));}
}
async function share(){
  const r=world?.sim.route||selectedRoute(),url=new URL(location.href);url.searchParams.set('run',r.id);
  const txt=t('我在崇礼滑'+r.name+'，从'+resortName(r.resort)+'山顶出发。','Ride '+label(r.name)+' from the '+resort(r.resort)+' summit in Chongli.');
  try{
    if(navigator.share)await navigator.share({title:document.title,text:txt,url:url.toString()});
    else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url.toString());announce(t('线路链接已复制','Trail link copied'));}
    else{const el=document.createElement('textarea');el.value=url.toString();document.body.append(el);el.select();const ok=document.execCommand('copy');el.remove();announce(ok?t('线路链接已复制','Trail link copied'):t('可复制浏览器地址分享','Copy the browser address to share'));}
  }catch(e){if(e.name!=='AbortError')announce(t('可复制浏览器地址分享','Copy the browser address to share'));}
}
async function photoSave(){
  const b=$('#shutter');b.disabled=true;
  try{const blob=await world.capture();if(!blob)throw new Error();const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=t('崇礼-','Chongli-')+label(world.sim.route.name)+'-'+Date.now()+'.png';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000);announce(t('雪场照片已导出','Mountain photo saved'));
  }catch{announce(t('导出失败，可再次拍摄','Photo export failed. Try the shutter again.'));}finally{b.disabled=false;}
}
function action(a){
  if(a==='start'||a==='retry')return begin();
  if(a==='fullscreen')return screenFull();
  if(a==='language'){prefs.language=prefs.language==='en'?'zh':'en';save();setupText();$('#pause-nav').innerHTML=navMarkup();renderPanel(true);return;}
  if(a==='sound'){prefs.sound=!prefs.sound;sound.set(prefs.sound);save();refreshSound();if(page==='settings')renderPanel(true);return;}
  if(a==='music'||a==='follow-music'){
    if(a==='music')prefs.music=!prefs.music;
    else{if(prefs.followMusic)prefs.track=music.track.id;prefs.followMusic=!prefs.followMusic;}
    activateAudio();save();renderPanel(true);return;
  }
  if(a==='quality'){const list=['auto','lite','high'];return setChoice('quality',list[(list.indexOf(prefs.quality)+1)%list.length]);}
  if(a==='tilt'){if(!tilt.enabled)return enableTilt();tilt.disable();prefs.tilt=false;save();renderPanel(true);return;}
  if(a==='calibrate'){tilt.calibrate();announce(t('保持当前握姿，正中位置已重设','Hold your phone steady. Centre position reset.'));return;}
  if(a==='close-panel')return closePanel();
  if(a==='pause')return openPanel('view');
  if(a==='tray'){tray=!tray;$('#tray-tools').hidden=!tray;$('#tray-toggle').setAttribute('aria-expanded',String(tray));return;}
  if(a==='pov'){switchCamera(prefs.view==='first'?prefs.outsideView:'first');return;}
  if(a==='center-look'){world?.centerLook();if(watching())hudVisible(true);paintHUD();return;}
  if(a==='view'&&inWorld()&&!page){const vs=Object.keys(viewNames);switchCamera(vs[(vs.indexOf(prefs.view)+1)%vs.length]);announce(label(viewNames[prefs.view])+t('视角',' camera'));return;}
  if(['map','help','view','rider','environment','records','settings','sources','finish'].includes(a))return openPanel(a);
  if(a==='home')return home();
  if(a==='reload')return location.reload();
  if(a==='restart'){
    if(!world?.sim.route||watching()||screen==='lift')return begin(world?.sim.route.id||routeId);
    const route=data.routes.find(r=>r.id===world.sim.route.id)||world.sim.route;discardMap();page='';$('#overlay').hidden=true;screen='trailhead';tray=false;recorded=false;
    clearInputs();world.trailhead(route);hudVisible(true);paintHUD();refreshMusic();return;
  }
  if(a==='launch-trail'&&screen==='trailhead')return launch(world.sim.route);
  if(a==='look-hall'&&screen==='base'){world.lookAtBaseHall();return;}
  if(a==='apply-route'){
    const r=panelRoute();
    if(screen==='summit'&&summitChoice&&r.resort===world.station.side){
      const heading=world.summitHeading(r.id);closePanel();pushOff('up',{routeId:r.id,heading});
    }
    else if(screen==='run'&&(r.id===world.sim.route.id||world.sim.switchRoute(r))){closePanel();paintHUD();}
    else begin(r.id);return;
  }
  if(a==='zoom-in'||a==='zoom-out'){large?.changeZoom(a==='zoom-in'?1.24:.82);return;}
  if(a==='recenter'){large?.reset();return;}
  if(a==='lift'){
    if(!world?.beginRide())return;
    screen='lift';page='';clearInputs();$('#overlay').hidden=true;world.pause(false);hudVisible(true);paintHUD();refreshMusic();return;
  }
  if(a==='skip-lift')return world?.leaveRide();
  if(a==='share')return share();
  if(a==='photo'||a==='base-photo'){
    clearInputs();photoOrigin=screen;page='';screen='photo';$('#overlay').hidden=true;
    const place=a==='base-photo'?'hall':'rider';$('#photo-place').value=place;world.photo(true,place);hudVisible(false);return;
  }
  if(a==='exit-photo'){
    screen=photoOrigin;world.photo(false);
    if(screen==='base'){world.pause(false);hudVisible(true);paintHUD();}else openPanel('view');
    return;
  }
  if(a==='save-photo')return photoSave();
}
document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b||busy||b.disabled)return;
  if(b.dataset.drive&&e.detail===0){beginDirection(b.dataset.drive);return;}
  if(b.dataset.choice)setChoice(b.dataset.choice,b.dataset.value);
  else if(b.dataset.act)action(b.dataset.act);
  else if(b.dataset.hold==='jump'&&e.detail===0&&screen==='run'&&!page)world.sim.jump();
});
document.addEventListener('input',e=>{
  if(e.target.id==='music-volume'){prefs.volume=Number(e.target.value);$('#volume-readout').textContent=prefs.volume+'%';refreshMusic();save();}
});
document.addEventListener('keydown',e=>{
  if(busy||e.altKey||e.ctrlKey||e.metaKey)return;
  if(e.code==='Tab'&&page){
    const all=$$('#overlay button, #overlay a, #overlay input, #overlay summary').filter(b=>b.offsetWidth>0&&!b.disabled);
    if(all.length&&((e.shiftKey&&document.activeElement===all[0])||(!e.shiftKey&&document.activeElement===all.at(-1)))){e.preventDefault();all[e.shiftKey?all.length-1:0].focus();}return;
  }
  if(e.code==='Escape'){if(e.repeat)return;if(screen==='photo')action('exit-photo');else if(page)closePanel();else if(inWorld())openPanel('view');return;}
  if(e.code==='KeyM'&&screen!=='photo'){if(e.repeat)return;if(page==='map')closePanel();else openPanel('map');return;}
  if(page)return;
  if(screen==='photo'){
    if(e.target.matches('select'))return;
    const moves={KeyA:[24,0],KeyD:[-24,0],KeyW:[0,24],KeyS:[0,-24],KeyQ:[0,0,-1],KeyE:[0,0,1]};
    if(moves[e.code]){e.preventDefault();world.panPhoto(...moves[e.code]);}return;
  }
  if(!inWorld())return;
  if(e.code==='KeyR'||e.code==='KeyV'||e.code==='KeyC'){
    if(!e.repeat){
      if(e.code==='KeyR')action('center-look');
      else if(screen!=='lift')action(e.code==='KeyV'?'pov':'view');
    }
    e.preventDefault();return;
  }
  if(['KeyJ','KeyL','KeyU','KeyO'].includes(e.code)){e.preventDefault();keys.add(e.code);updateInputs();return;}
  const way=keyDirection[e.code];
  if(way&&screen!=='lift'){
    e.preventDefault();if(!e.repeat&&!keys.has(e.code))beginDirection(way);
    keys.add(e.code);updateInputs();return;
  }
  if(screen!=='run')return;
  if(['Space','KeyI','KeyK'].includes(e.code))e.preventDefault();
  if(e.code==='Space'){if(!e.repeat&&!holds.has('jump'))world.sim.beginJump();keys.add('Space');updateInputs();return;}
  keys.add(e.code);updateInputs();
});
document.addEventListener('keyup',e=>{const was=keys.delete(e.code);if(was&&e.code==='Space'&&screen==='run'&&!page&&!holds.has('jump'))world.sim.releaseJump();updateInputs();});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){clearInputs();if(inWorld()&&!page)openPanel('view');if(busy)restoreRequested=true;sound.update(0,0,true);}
  else if(screen==='home')sound.update(0,0);
  refreshMusic();
});
window.addEventListener('blur',()=>{clearInputs();if(inWorld()&&!page&&!busy)openPanel('view');});
for(const b of $$('.dir-key')){
  b.addEventListener('pointerdown',e=>{
    if(page||busy||e.button!==0||!beginDirection(b.dataset.drive))return;
    e.preventDefault();b.setPointerCapture(e.pointerId);drivePointers.set(e.pointerId,b.dataset.drive);updateInputs();
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(type,e=>{
    if(drivePointers.delete(e.pointerId))updateInputs();
  });
}
for(const b of $$('[data-hold]')){
  const ids=new Set(),key=b.dataset.hold;
  b.addEventListener('pointerdown',e=>{
    if(screen!=='run'||page||e.button!==0)return;e.preventDefault();b.setPointerCapture(e.pointerId);
    if(key==='jump'&&!ids.size&&!keys.has('Space'))world.sim.beginJump();
    ids.add(e.pointerId);holds.add(key);updateInputs();
  });
  for(const ev of ['pointerup','lostpointercapture','pointercancel'])b.addEventListener(ev,e=>{
    if(!ids.delete(e.pointerId)||ids.size)return;
    const held=holds.delete(key);
    if(key==='jump'&&held&&!keys.has('Space')&&screen==='run'&&!page){if(ev==='pointerup')world.sim.releaseJump();else world.sim.cancelJump();}
    updateInputs();
  });
}
function touchPair(){const [a,b]=[...touches.values()];return a&&b?{x:(a.x+b.x)/2,y:(a.y+b.y)/2,d:Math.hypot(a.x-b.x,a.y-b.y)}:null;}
function touchStart(e){
  if(page||!(inWorld()||screen==='photo')||(e.button!==0&&e.button!==2))return;
  const pad=e.currentTarget.id==='steering',mouse=e.pointerType==='mouse';
  const steer=screen==='run'&&(pad||(!mouse&&e.clientX<innerWidth*.44));
  e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
  touches.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,
    role:steer?'steer':'look',tap:!pad&&e.button===0,originTime:performance.now()});
  if(touches.size>=2){
    const fingers=[...touches.values()];
    for(const pt of fingers)pt.tap=false;
    if(screen==='run'&&fingers.length===2&&fingers[0].role!==fingers[1].role)return;
    for(const pt of fingers)pt.role='look';
    multi=touchPair();drag=trim=0;updateInputs();
  }
}
function touchMove(e){
  const pt=touches.get(e.pointerId);if(!pt||!world)return;
  const dx=e.clientX-pt.x,dy=e.clientY-pt.y;pt.x=e.clientX;pt.y=e.clientY;
  if(Math.hypot(pt.x-pt.startX,pt.y-pt.startY)>6)pt.tap=false;
  if(multi&&touches.size>=2){
    const pair=touchPair();
    const mx=pair.x-multi.x,my=pair.y-multi.y;
    if(screen==='photo'){world.panPhoto(mx,my);world.zoom(multi.d/Math.max(1,pair.d));}
    else world.orbit(mx,my);
    multi=pair;return;
  }
  if(screen==='photo'&&e.shiftKey){world.panPhoto(dx,dy);return;}
  if(pt.role==='look'){world.orbit(dx,dy);return;}
  const range=Math.max(40,Math.min(innerWidth,innerHeight)*.16);
  drag=clamp((pt.x-pt.startX)/range,-1,1);trim=clamp((pt.startY-pt.y)/range,-1,1);updateInputs();
}
function touchEnd(e){
  const pt=touches.get(e.pointerId);if(!pt)return;
  touches.delete(e.pointerId);multi=multi?touchPair():null;
  if(pt.role==='steer')drag=trim=0;
  updateInputs();
  if(pt.tap&&e.type==='pointerup'&&performance.now()-pt.originTime<650&&screen!=='photo'&&screen!=='lift')
    selectSign(world?.pickSign(e.clientX,e.clientY));
}
for(const el of [$('#gl'),$('#steering')]){
  el.addEventListener('pointerdown',touchStart);el.addEventListener('pointermove',touchMove);
  for(const ev of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(ev,touchEnd);
  el.addEventListener('contextmenu',e=>e.preventDefault());
}
$('#gl').addEventListener('wheel',e=>{if(screen==='photo'){e.preventDefault();world.zoom(e.deltaY>0?1.11:.90);}},{passive:false});
$('#photo-place').addEventListener('change',e=>world?.photoPlace(e.target.value));
setupText();refreshMusic();
ensureData().then(()=>{const id=new URLSearchParams(location.search).get('run'),r=data.routes.find(r=>r.id===id);
  if(r){routeId=r.id;prefs.resort=r.resort;homeChoices();}
}).catch(()=>{});
