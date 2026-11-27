import {colourKeys, riderRoles, outfitFor, fittingColour} from './wardrobe.js';
import './style.css';
import './lobby.css';
import {SceneryTrial,trialRouteId} from './scenery.js';
import {paintScenicControls,groveFeedback} from './scenic-controls.js';
import {glyph,emblem,viewNames,viewPicture} from './icons.js';
import {loadMountain,clamp,resortName,formatTime,difficultyName} from './mountain.js';
import {TrailMap} from './map.js';
import {changeMapSort,defaultMapSort,mapSortFields,mapTravelActions,sortedMapRoutes} from './map-routes.js';
import {canRecordGame,recordGame,captureGameAudio,GAME_CLIP_SECONDS} from './game-recording.js';
import {appleMobile,canShareVideo,shareVideoFile} from './web-video-export.js';
import {ActivityMeter,activityTotals,mergeSkiProgress} from './ski-engagement.js';
import {createRankings} from './activity-rankings.js';
import {capturePhoto,createPhotoEditor} from './field-photo.js';
import {descentTotals} from './piste-splits.js';
import {createPisteProgress,readPisteMarks} from './piste-progress.js';
import {MountainSound} from './sound.js';
import {MountainMusic,tracks,musicFor} from './music.js';
import {TiltSteering,isMiniTool,motionSupported,initializePlatform,read,store,fullscreen,canPublishVideo,publishVideo,photoActions,savePhoto,videoSaveAvailable,saveGameVideo,engagementAvailable,cloudRead,cloudWrite,gameVibration} from './platform.js';
import {createMountainClimate,timeOptions,weatherOptions} from './environment.js';
import {setLanguage,t,label} from './language.js';
import {heading,button,choice,seg,row,settingsPanel,environmentPanel,controlsPanel} from './settings.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const prefKey='ridgeline.preferences.v1',recordKey='ridgeline.descents.v1',pisteKey='ridgeline.pistes.v1',videoKey='ridgeline.videos.v1';
const activityKey='ridgeline.activity.v1',deviceKey='ridgeline.cloud-device.v1';
const setupOptions={
  resort:[['wanlong','万龙'],['genting','云顶']],
  gear:[['ski','双板','ski'],['board','单板','board']],
  gender:[['male','男士'],['female','女士'],['boy','男孩'],['girl','女孩']],
  color:colourKeys.map(id=>[id])
};
const prefs={view:'first',outsideView:'follow',quality:'auto',assist:true,variedMoves:true,sound:false,controls:true,
  time:'auto',weather:'auto',language:'zh',music:true,followMusic:true,track:'ridge',volume:75,tilt:false};
const chosenSetup={};
const trial=new SceneryTrial();
function applySavedPreferences(){
  const previous=read(prefKey,{});
  Object.assign(prefs,previous);
  prefs.outfits=Object.fromEntries(riderRoles.filter(role=>colourKeys.includes(previous.outfits?.[role]))
    .map(role=>[role,previous.outfits[role]]));
  if(!motionSupported)prefs.tilt=false;
  if(isMiniTool)prefs.controls=true;
  for(const [kind,options] of Object.entries(setupOptions)){
    const saved=options.find(([id])=>id===previous[kind]);
    if(saved)chosenSetup[kind]=saved[0];
    prefs[kind]=saved?saved[0]:options[Math.floor(Math.random()*options.length)][0];
  }
  if(!previous.time&&previous.env){
    prefs.time=({morning:'day',noon:'noon',snow:'day',dusk:'sunset'})[previous.env]||'auto';
    prefs.weather=previous.env==='snow'?'light':'clear';delete prefs.env;
  }
  if(!timeOptions.some(o=>o.id===prefs.time))prefs.time='auto';
  if(!weatherOptions.some(o=>o.id===prefs.weather))prefs.weather='auto';
  if(!viewNames[prefs.view])prefs.view='first';
  if(!viewNames[prefs.outsideView]||prefs.outsideView==='first')prefs.outsideView='follow';
  prefs.volume=clamp(Number.isFinite(+prefs.volume)?+prefs.volume:75,0,100);
}
const sound=new MountainSound(),music=new MountainMusic(sound),climate=createMountainClimate();
let mapRegion='',mapPicked=false,clearedMarks;
let data,world,large,pisteProgress,routeId=prefs.resort+'-classic',mapId=routeId,summitChoice='';
let sharedRouteId=new URLSearchParams(location.search).get('run');
let lastArrival=null;
let screen='home',page='',recordTab='explore',busy=false,toastTimer,focusBack,restoreRequested=false,recorded=false,tray=false;
const keys=new Set(),holds=new Set(),touches=new Map(),drivePointers=new Map();
let drag=0,trim=0,multi=null,backDepart=false;
let activity,device;
const meter=new ActivityMeter();
const rankings=createRankings(()=>{if(page==='records')renderPanel(true);});
let cloudTimer,cloudBusy,cloudUnavailable=false,cloudStatus,cloudPending=false;
let feedback,feedbackTime=-Infinity;
let booting=isMiniTool, recording,clip,clipFocus,viewedClip,clockTimer,recordStart;
const keyDirection={ArrowUp:'up',KeyW:'up',ArrowLeft:'left',KeyA:'left',ArrowDown:'down',KeyS:'down',ArrowRight:'right',KeyD:'right'};
const departureTurn={up:0,left:-.70,right:.70,down:Math.PI};
const touchDevice=matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>0;
document.documentElement.classList.toggle('touch',touchDevice);
function save(){
  // A sound, camera or route change must not turn today's random outfit into a saved choice.
  const settings={...prefs};
  for(const kind of Object.keys(setupOptions))delete settings[kind];
  store(prefKey,{...settings,...chosenSetup});
}
const selectedRoute=()=>data?.allRoutes.find(r=>r.id===routeId)||data?.routes[0];
const panelRoute=()=>data?.allRoutes.find(r=>r.id===mapId)||selectedRoute();
const inWorld=()=>['summit','station','trailhead','run','base','lift'].includes(screen);
const watching=()=>screen==='summit'||screen==='station'||screen==='trailhead';
const meters=n=>Math.round(n).toLocaleString('en-US'),km=n=>(n/1000).toFixed(2)+' km';
const skiDistance=n=>Math.round(n)<1000?Math.round(n)+' m':km(n);
const resort=id=>label(resortName(id));
const tick='<span class="tick">'+glyph('check',14)+'</span>';
const tilt=new TiltSteering(updateInputs,reason=>announce(reason==='denied'?t('体感权限未开启，可拖动雪面转弯。','Motion access was declined. Drag the snow to steer.'):t('当前未收到倾斜信号，可拖动雪面转弯。','No tilt signal yet. Drag the snow to steer.')));
function announce(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2700);}
function refreshMusic(){
  const mode=screen;
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
  control.setAttribute('aria-pressed',String(first));control.hidden=screen==='lift'||!!world?.flat;
  $('#tray-tools [data-act="view"]').hidden=!!world?.flat;
}
function switchCamera(view){
  if(!viewNames[view])return;
  prefs.view=view;if(view!=='first')prefs.outsideView=view;
  world?.cameraChanged();showCameraMode();save();if(watching())hudVisible(true);
}
let fittingFront=false;
const fittingAtlas=gear=>import.meta.env.BASE_URL+'assets/art/fitting-'+gear+'.webp';
function outfitName(look){return t(look.name,look.english);}
function swatches(){
  return colourKeys.map(id=>{
    const look=outfitFor(prefs.gender,id),name=outfitName(look);
    return '<button class="swatch outfit-chip" aria-label="'+name+'" title="'+name+'" data-choice="color" data-value="'+id+'" aria-pressed="'+(prefs.color===id)+'" style="--coat:'+look.coat+';--accent:'+look.accent+';--trousers:'+look.pants+'"><span>'+name+'</span></button>';
  }).join('');
}
function modelStyle(role,front){
  const key=role===prefs.gender?prefs.color:fittingColour(role,prefs.outfits);
  const x=colourKeys.indexOf(key),y=riderRoles.indexOf(role)*2+Number(front);
  return 'background-image:url('+fittingAtlas(prefs.gear)+');background-position:'+(100*x/(colourKeys.length-1))+'% '+(y*100/7)+'%';
}
function showHomeRider(){
  const home=$('#home-rider'),look=outfitFor(prefs.gender,prefs.color);
  const role=label(setupOptions.gender.find(([id])=>id===prefs.gender)[1]);
  const gear=label(setupOptions.gear.find(([id])=>id===prefs.gear)[1]);
  home.querySelector('.fitting-model').setAttribute('style',modelStyle(prefs.gender,false));
  $('#kit-rider').textContent=role+' · '+gear;
  $('#kit-colour').textContent=outfitName(look);
  home.style.setProperty('--coat',look.coat);home.style.setProperty('--accent',look.accent);
  home.setAttribute('aria-label',t('换装，','Change outfit, ')+role+' · '+gear+' · '+outfitName(look));
}
function fittingRoom(){
  const turn=fittingFront?t('看背面','Back view'):t('看正面','Front view');
  if(screen==='home'){
    const name=outfitName(outfitFor(prefs.gender,prefs.color));
    const age=prefs.gender==='boy'||prefs.gender==='girl'?' · '+t('5–6 岁','Ages 5–6'):'';
    return '<header class="lobby-fit-head"><h2>'+t('滑雪装扮','Ski outfit')+'</h2><button class="icon-disc" data-act="close-panel" aria-label="'+t('关闭','Close')+'">'+glyph('close',20)+'</button></header>'+
      '<div class="lobby-fit-body"><figure class="lobby-fit-preview"><span class="fitting-model" style="'+modelStyle(prefs.gender,fittingFront)+'"></span>'+
      '<figcaption><strong>'+name+'</strong>'+button('fitting-turn',glyph('rotate',15)+turn,'fitting-turn')+'</figcaption></figure>'+
      '<div class="lobby-fit-options"><fieldset><legend>'+label('角色')+age+'</legend>'+seg('gender',setupOptions.gender,prefs.gender)+'</fieldset>'+
      '<fieldset class="fitting-colours"><legend>'+t('雪服配色','Outfit colours')+'</legend><div>'+swatches()+'</div></fieldset>'+
      '<fieldset><legend>'+t('滑行装备','Equipment')+'</legend>'+seg('gear',setupOptions.gear,prefs.gear)+'</fieldset></div></div>';
  }
  const roles=setupOptions.gender.map(([id,name])=>{
    const age=['boy','girl'].includes(id)?'<small>'+t('5–6 岁','Ages 5–6')+'</small>':'';
    return '<button class="fitting-role" data-choice="gender" data-value="'+id+'" aria-pressed="'+(prefs.gender===id)+'">'+
      '<span class="fitting-model" style="'+modelStyle(id,fittingFront)+'"></span><span class="fitting-tag">'+label(name)+age+'</span></button>';
  }).join('');
  return heading('RIDER','角色',t('雪服试穿','Fitting room'))+
    '<div class="fitting-bar">'+seg('gear',setupOptions.gear,prefs.gear)+button('fitting-turn',glyph('rotate',17)+turn,'fitting-turn')+'</div>'+
    '<div class="fitting-rack" role="group" aria-label="'+label('角色')+'">'+roles+'</div>'+
    '<fieldset class="fitting-colours"><legend>'+t('整套配色','Outfit colours')+'</legend><div>'+swatches()+'</div></fieldset>';
}
function homeChoices(){
  for(const b of $$('#resort-choices button')){
    b.textContent=resort(b.dataset.value);
    b.setAttribute('aria-pressed',String(b.dataset.value===prefs.resort));
  }
  showHomeRider();
}
function setupText(){
  setLanguage(prefs.language);
  document.title=t('山脊之间 · 万龙与云顶滑雪','Ridgeline · Wanlong & Genting');
  $('#logo').innerHTML=$('.loading-crest').innerHTML=emblem;
  $('#lobby-name').innerHTML=t('山脊之间<small>RIDGELINE</small>','Ridgeline<small>CHONGLI</small>');
  $('#lobby-place').textContent=t('河北 · 崇礼','Chongli · Hebei');
  $('#lobby-title').innerHTML=t('万龙<span>·</span>云顶','Wanlong<span>·</span>Genting');$('.lobby-english').hidden=prefs.language==='en';
  $('#lobby-intro').textContent=t('从红花梁出发，滑向同一座山的两面。','Two ski resorts on opposite faces of Honghualiang.');
  $('#resort-label').textContent=t('出发雪场','Starting resort');
  $('#kit-label').textContent=t('我的装扮','My outfit');$('#kit-change').textContent=t('换装','Change');
  function face(sel,icon,txt){for(const el of $$(sel))el.innerHTML=glyph(icon,18)+txt;}
  face('#home [data-act="start"]','lift',t('进入山顶','Enter summit'));
  face('#home [data-act="help"]','controls',t('操作指南','Controls'));
  face('#home [data-act="scenery-start"]','eye',location.hash==='#sansuo'?t('三索上站试景','Third lift art study'):t('同趟试景','Scenery trial'));
  face('#home [data-act="map"]','map',label('雪场地图'));
  $('#lobby-elevation').innerHTML=glyph('mountain',17)+label('红花梁')+' <i>2,110 m</i>';
  $('.loading-copy p').textContent=t('进入红花梁','Entering Honghualiang');
  $('#gl').setAttribute('aria-label',t('崇礼三维滑雪场','3D Chongli ski area'));$('#hud').setAttribute('aria-label',t('滑行仪表','Skiing instruments'));
  $('#drop-label').textContent=t('落差','Drop');
  $('#distance-label').textContent=t('滑程','Distance');
  $('#split-caption').textContent=t('刚滑过','Last piste');
  $('#lift-summary-title').textContent=t('本趟合计','Descent total');
  $('#lift-distance-label').textContent=t('总滑程','Distance');
  $('#lift-time-label').textContent=t('总用时','Time');
  $('#lift-average-label').textContent=t('均速','Average');
  $('#lift-peak-label').textContent=t('最高时速','Top speed');
  paintRecordButton();
  for(const [a,ic,txt] of [['fullscreen','expand',t('全屏显示','Fullscreen')],['pause','menu',t('暂停菜单','Pause menu')],['view','eye',label('切换视角')],['tray','back',t('机位、拍照和录像','Camera, photo and video')],['map','map',label('雪场地图')]]){
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
  $('#base-hint').textContent=t('拖动转身环顾','Drag to turn and look around');
  $('#base-result').textContent=t('本趟成绩','Run stats');
  $('#base-continue-text').textContent=t('滑往娇龙道','Ski to Jiao Dragon');
  $('#career-distance-label').textContent=t('累计滑行里程','Lifetime distance');
  $('#career-visits-label').textContent=t('雪道滑行次数','Piste visits');
  $('#tray-photo-label').textContent=t('拍照','Photo');
  $('#base-explored-label').textContent=t('双雪场已探索','Pistes explored');
  $('#base-hall-text').textContent=t('看大厅与酒店','Look at the hall & hotel');
  $('#base-restart-text').textContent=t('重滑本线','Ski this run again');
  $('#base-lift-text').textContent=t('乘缆车上山','Ride lift up');
  $('#recover-piste').textContent=t('返回最近雪道','Return to nearest piste');
  $('#steering>span').textContent=t('左侧转弯 · 右侧环顾','Steer left · look right');
  $('#steering').setAttribute('aria-label',t('左右拖动转弯','Drag to steer'));
  $('#keyboard-hint').innerHTML=t('方向键滑行 <i></i> 鼠标拖动环顾 <i></i> R 回正 <i></i> 空格蓄力跳','Arrows to ski <i></i> Drag to look <i></i> R to face forward <i></i> Hold Space to jump');
  $('#overlay').setAttribute('aria-label',label('设置'));$('.top-tools [data-act="sound"]').title=t('环境音','Environmental sound');
  $$('[data-glyph]').forEach(el=>el.innerHTML=glyph(el.dataset.glyph));
  homeChoices();refreshSound();if(world?.sim.route)paintHUD();
}
async function ensureData(){
  const loaded=data||await loadMountain();
  if(!data){data=loaded;pisteProgress=createPisteProgress(data,read(pisteKey,[]));}
  return data;
}
function clearInputs(){
  keys.clear();holds.clear();touches.clear();drivePointers.clear();backDepart=false;multi=null;drag=trim=0;
  world?.sim.cancelJump?.();updateInputs();
}
function updateInputs(){
  const active=screen==='run'&&!page&&!busy&&!trial.frozen,viewActive=inWorld()&&!page&&!busy&&!trial.frozen;
  const physical=new Set(drivePointers.values());
  for(const key of keys){if(keyDirection[key])physical.add(keyDirection[key]);}
  const keyboard=Number(physical.has('right'))-Number(physical.has('left'));
  const hasTouchSteer=!multi&&[...touches.values()].some(p=>p.role==='steer');
  const lateral=clamp(keyboard*(keys.has('ShiftLeft')||keys.has('ShiftRight')?1:.68)+(hasTouchSteer?drag:keyboard?0:tilt.value),-1,1);
  if(!physical.has('down'))backDepart=false;
  if(world){
    const look=Number(keys.has('KeyL'))-Number(keys.has('KeyJ'))+(screen==='base'?keyboard:0);
    world.input.lookX=viewActive?clamp(look,-1,1):0;
    world.input.lookY=viewActive?Number(keys.has('KeyU'))-Number(keys.has('KeyO')):0;
    world.input.steer=active?lateral:0;
    world.input.trim=active?clamp(trim+Number(keys.has('KeyI'))-Number(keys.has('KeyK')),-1,1):0;
    world.input.brake=active&&(holds.has('brake')||(physical.has('down')&&!backDepart));
    world.input.boost=active&&(holds.has('boost')||physical.has('up'));
    if(active&&(physical.size||holds.size||keys.has('Space')||Math.abs(world.input.steer)>.15||Math.abs(world.input.trim)>.15)){
      world.sim.dismissRecovery();$('#recover-piste').hidden=true;
    }
  }
  for(const b of $$('.dir-key'))b.classList.toggle('active',physical.has(b.dataset.drive));
  for(const b of $$('[data-hold]'))b.classList.toggle('active',active&&(b.dataset.hold==='jump'?(holds.has('jump')||keys.has('Space')):!!world?.input[b.dataset.hold]));
  $('#steering').style.setProperty('--drag',(lateral*22)+'px');$('#steering').classList.toggle('edge-set',active&&Math.abs(lateral)>.72);
}
function hudVisible(show){
  $('#home').hidden=screen!=='home';$('#hud').hidden=!show||!!page||trial.frozen;paintRecordButton();paintScenicControls(trial,screen,world?.sim,prefs);
  document.documentElement.classList.toggle('hud-minimal',!prefs.controls||screen!=='run');
  $('#direction-pad').hidden=!watching()&&(screen!=='run'||!prefs.controls);
  $('#look-reset').hidden=!world?.looking||!!page;
  if(screen!=='home')showCameraMode();
  $('#hud').classList.toggle('watching',watching()||screen==='base');$('#lift-strip').hidden=screen!=='lift';$('#station-card').hidden=!watching();
  const atFoot=screen==='base',onLift=screen==='lift';
  $('#hud').classList.toggle('on-lift',onLift);
  $('#base-actions').hidden=!atFoot&&!onLift;
  $('.base-controls').hidden=!atFoot;
  if(atFoot||onLift){
    const career=activityTotals(activity,pisteProgress.publicPistes);
    const {ridden,total}=pisteProgress.totals();
    $('#career-distance').textContent=km(career.metres);
    $('#career-visits').textContent=career.count+t(' 次','');
    $('#base-explored').textContent=(total?Math.round(ridden*100/total):0)+'%';
    $('#base-count').textContent='('+ridden+'/'+total+')';
  }
  if(screen!=='lift')$('#lift-summary').hidden=true;
  $('#hud').classList.toggle('has-lift-summary',screen==='lift'&&!$('#lift-summary').hidden);
  if(screen==='base'){
    const sim=world.sim,hall=data.landmarks.find(l=>l.id===sim.route.destination+'-hall');
    const exit=sim.navigation?.valleyExit(sim);
    $('#base-actions [data-act="continue-base"]').hidden=!exit;
    baseExitDirection=null;baseExitHeading=null;
    if(exit&&sim.route.destination==='wanlong'){
      const plan=sim.navigation.valleyLine(sim);
      if(plan)baseExitHeading=plan.frame(Math.min(3,plan.length)).angle;
    }
    paintBaseExit(sim);
    const atHall=hall&&Math.hypot(hall.x-sim.x,hall.z-sim.z)<320;
    $('#base-actions [data-act="look-hall"]').hidden=!atHall;
    $('#base-lift-text').textContent=sim.route.finishKind==='lift-link'?t('乘一索直达山顶','Ride Gondola 1 to summit'):sim.route.finishKind==='training-runout'?t('前往最近索道','Go to nearest lift'):t('乘缆车上山','Ride lift up');
  }
  paintCameraTray();$('#near-lift').hidden=true;
  if(watching()){
    const side=world.station.side,lodge=label(side==='wanlong'?'山顶木屋':'金花阁');
    const look=$('#look-choices');look.hidden=screen!=='summit';
    $('#station-card [data-act="launch-trail"]').hidden=screen!=='trailhead';
    $('#station-card [data-act="lift"]').hidden=screen==='trailhead';
    look.innerHTML=[['wide',label('全景')],['lodge',lodge],['lift',label('索道站')],['valley',t('望群山','Ridgeline')]].map(([key,txt])=>choice('look',key,txt,world.station.view)).join('');
  }
}
function discardMap(){if(large){large.observer.disconnect();large=null;}}
async function begin(id,flat=false,atHead=false){
  if(busy)return;endTrial();checkpoint();busy=true;restoreRequested=false;activateAudio();
  if(prefs.tilt&&!tilt.enabled)enableTilt();
  $('#loading').hidden=false;$('#load-text').textContent=label('读取红花梁地形');
  try{
    await ensureData();const route=data.allRoutes.find(r=>r.id===(id||routeId))||selectedRoute();
    if(screen==='home'){climate.startVisit();world?.environment();}
    if(!world||flat){
      if(!flat){
        try{
          if(isMiniTool&&typeof WeakRef!=='function')throw new Error('旧版图形内核');
          const {createWorld}=await import('./world.js');
          world=await createWorld($('#gl'),data,prefs,worldEvent,s=>$('#load-text').textContent=label(s),climate,pisteProgress);
        }catch(error){if(!isMiniTool)throw error;flat=true;}
      }
      if(isMiniTool&&flat){
        world?.stop();
        const {createFlatWorld}=await import('./xhs/flat-world.js');
        world=createFlatWorld($('#flat-view'),data,prefs,worldEvent,climate,pisteProgress);
        announce(t('已切换到轻量雪道视图','Switched to the lightweight trail view.'));
      }
    }
    discardMap();page='';$('#overlay').hidden=true;routeId=route.id;
    recorded=false;screen=atHead?'trailhead':'summit';summitChoice='';tray=false;clearInputs();
    if(atHead)world.trailhead(route);else world.stage(route);
    hudVisible(true);paintHUD();world.graphics();refreshMusic();
    if(restoreRequested||document.hidden)openPanel('view');
  }catch(e){console.error(e);openPanel('error');}
  finally{busy=false;$('#loading').hidden=true;}
}
function launch(route){
  discardMap();page='';$('#overlay').hidden=true;routeId=route.id;
  recorded=false;screen='run';tray=false;clearInputs();tilt.calibrate();world.start(route);hudVisible(true);paintHUD();refreshMusic();
}
function pushOff(direction,preferred=screen==='summit'?summitChoice||undefined:undefined,heading){
  if(!watching()||page||busy||!world)return false;
  if(world.beforeDeparture(()=>pushOff(direction,preferred,heading)))return false;
  const acrossGenting=screen==='summit'&&world.station?.side==='genting'&&(direction==='left'||direction==='right');
  const turn=acrossGenting?(direction==='left'?-Math.PI/2:Math.PI/2):(departureTurn[direction]??0);
  const route=world.pushOff(turn,preferred,heading);
  if(!route)return false;
  recorded=false;screen='run';tray=false;routeId=route.id;
  tilt.calibrate();hudVisible(true);paintHUD();refreshMusic();return true;
}
function continueDescent(){
  if(screen!=='base'||page||!world||world.beforeDeparture(continueDescent)||!world.continueAtBase())return false;
  screen='run';tray=recorded=false;routeId=world.sim.route.id;
  clearInputs();tilt.calibrate();hudVisible(true);paintHUD();refreshMusic();return true;
}
function beginDirection(direction){
  if(screen==='base'&&(direction==='up'||direction===baseExitDirection))return continueDescent();
  const departing=watching();
  if(departing&&!pushOff(direction))return false;
  if(screen!=='run')return false;
  if(!departing&&direction==='up'&&world.sim.speed<1&&world.looking)world.pushTowardsView();
  // Backward on the stationary pad chooses the outlet behind the rider.
  // Subsequent down presses operate the brake normally.
  if(departing&&direction==='down')backDepart=true;
  return true;
}
function home(){
  endTrial();checkpoint();
  recording?.stop();clearInputs();world?.stop();screen='home';page='';discardMap();$('#overlay').hidden=true;
  if(!data?.allRoutes.some(r=>r.id===routeId&&r.resort===prefs.resort))routeId=prefs.resort+'-classic';
  homeChoices();hudVisible(false);sound.update(0,0);refreshMusic();
}
function saveActivity(sim,force=false){
  if(activity&&meter.sample(activity,device,sim,force)){
    store(activityKey,activity);scheduleCloud();
  }
}
function checkpoint(){
  if(screen==='run'&&world)saveActivity(world.sim,true);
}
function worldEvent(type,arg){
  if(type==='grove'){groveFeedback(arg);paintScenicControls(trial,screen,world?.sim,prefs);return;}
  if(screen==='run'&&(type==='hud'||type==='finish'))saveActivity(arg,type==='finish');
  if(type==='hud'&&screen==='run'&&trial.active&&trial.touring&&!trial.frozen){
    const projected=arg.route===trial.route?{distance:0,along:arg.along}:trial.route.closest(arg.x,arg.z);
    if(projected.distance<100&&trial.advance(projected.along)){
      world.previewScenery(trial,true);paintScenicControls(trial,screen,arg,prefs);
    }
  }
  if(type==='hud'&&screen==='run'){
    if(arg.feedback&&(!feedback||feedback.source!==arg.feedback))feedback={source:arg.feedback,landing:0,tree:0,skier:0};
    if(feedback&&arg.feedback===feedback.source){
      const tree=arg.feedback.tree>feedback.tree,landing=arg.feedback.landing>feedback.landing;
      const skier=arg.feedback.skier>feedback.skier;
      if((tree||landing||skier)&&performance.now()-feedbackTime>240){
        gameVibration(tree||skier?'medium':'light');feedbackTime=performance.now();
      }
      feedback.tree=arg.feedback.tree;feedback.landing=arg.feedback.landing;feedback.skier=arg.feedback.skier;
    }
  }
  if((type==='hud'||type==='finish')&&screen==='run')reportDiscoveries(arg);
  if(type==='hud'&&inWorld()&&!page){
    if(screen==='run'&&arg.route?.id!==routeId)routeId=arg.route.id;
    paintHUD();sound.update(screen==='lift'?3:arg.speed,(arg.skid||0)*.65+(arg.brake||0)*.6,document.hidden);refreshMusic();}
  if(type==='finish'&&!recorded){
    recorded=true;screen='base';tray=false;const records=read(recordKey,[]);
    const sameRun=lastArrival?.visits===arg.pisteVisits;
    const when=sameRun?lastArrival.when:new Date().toISOString();
    lastArrival={visits:arg.pisteVisits,when};
    const prev=records.findIndex(r=>r.sessionId===when);
    const first=arg.continuedFrom;
    const record={activityTracked:true,sessionId:when,when,routeId:first?first.id+'+'+arg.route.id:arg.route.id,
      name:first?first.name+' → '+arg.route.name:arg.route.name,resort:arg.route.destination,gear:prefs.gear,
      time:Math.round(arg.elapsed),max:arg.maxSpeed*3.6,dist:arg.travel,drop:Math.round(arg.startY-arg.ground)};
    if(prev<0)records.push(record);else records[prev]=record;
    store(recordKey,records.slice(-100));gameVibration('heavy');scheduleCloud(3000);clearInputs();hudVisible(true);paintHUD();refreshMusic();
  }
  if(type==='disembark'){routeId=arg.route.id;screen=arg.mode;recorded=false;summitChoice='';
    hudVisible(true);paintHUD();refreshMusic();announce(arg.mode==='summit'?t('已到山顶，可环顾或选道','At the summit. Look around or choose a trail.'):t('已到站，可环顾或乘回程索道','At the station. Look around or take the return lift.'));}
  if(type==='lost'){if(trial.active){trial.close();syncTrialUI();}openPanel('lost');}
}
const discoveryQueue=[];
let discoveryTimer;
function reportDiscoveries(sim){
  const keys=pisteProgress.finishDiscoveries(sim.splits);
  if(!keys.length)return;
  store(pisteKey,pisteProgress.snapshot());scheduleCloud();
  const {ridden,total}=pisteProgress.totals();
  let count=ridden-keys.filter(k=>pisteProgress.publicPistes.has(k)).length;
  for(const key of keys){
    if(pisteProgress.publicPistes.has(key))count++;
    discoveryQueue.push({name:key.split('/').at(-1),ridden:count,total});
  }
  if(!discoveryTimer)showDiscovery();
}
function showDiscovery(){
  const panel=$('#piste-discovery'),item=discoveryQueue.shift();
  if(!item){panel.hidden=true;discoveryTimer=undefined;return;}
  panel.textContent=label(item.name)+' · '+t('雪场已探索 ','Resort explored ')+Math.round(100*item.ridden/item.total)+'% ('+item.ridden+'/'+item.total+')';
  panel.hidden=false;panel.getAnimations?.().forEach(a=>a.cancel());
  panel.animate?.([{opacity:0},{opacity:1,offset:.08},{opacity:1,offset:.84},{opacity:0}],4300);
  discoveryTimer=setTimeout(showDiscovery,4300);
}
let shownSplit,splitLanguage,splitExpires=0;
function paintSplit(splits){
  const split=splits?.completed.at(-1),panel=$('#piste-split'),now=performance.now();
  const fresh=split!==shownSplit;
  if(fresh){shownSplit=split;splitExpires=now+4000;}
  panel.hidden=!split||(screen!=='run'&&screen!=='base')||now>=splitExpires;
  if(panel.hidden)return;
  panel.classList.toggle('fading',now>=splitExpires-550);
  if(!fresh&&prefs.language===splitLanguage)return;
  splitLanguage=prefs.language;
  $('#split-name').textContent=label(split.name);
  $('#split-stats').textContent=skiDistance(split.distance)+' · '+formatTime(split.seconds)+' · '+
    t('均速 ','Avg ')+split.average.toFixed(1)+' km/h';
}

function showLiftSummary(sim){
  const panel=$('#lift-summary');
  const totals=descentTotals(sim);
  panel.hidden=totals.distance<=0;
  if(panel.hidden)return;
  $('#lift-distance').textContent=skiDistance(totals.distance);
  $('#lift-time').textContent=formatTime(totals.seconds);
  $('#lift-average').textContent=totals.average.toFixed(1)+' km/h';
  $('#lift-peak').textContent=totals.peak.toFixed(1)+' km/h';
}
let baseExitHeading=null,baseExitDirection=null;
function paintBaseExit(sim){
  const control=$('#base-continue-text'),icon=control.previousElementSibling;
  if(sim.route.destination==='genting'){control.textContent=t('滑往一索下站','Ski to Gondola 1');icon.textContent='↑';return;}
  const delta=baseExitHeading-world.facing,angle=Math.atan2(Math.sin(delta),Math.cos(delta));
  const dir=baseExitHeading===null?'up':Math.abs(angle)>2.56?'down':Math.abs(angle)<.48?'up':angle<0?'left':'right';
  const turns={left:['左转滑入娇龙道','Turn left onto Jiao Dragon','↰'],right:['右转滑入娇龙道','Turn right onto Jiao Dragon','↱'],
    up:['滑往娇龙道','Ski to Jiao Dragon','↑'],down:['转身滑入娇龙道','Turn back onto Jiao Dragon','↶']};
  baseExitDirection=dir;
  control.textContent=t(turns[dir][0],turns[dir][1]);icon.textContent=turns[dir][2];
}
function paintHUD(){
  if(!world?.sim.route)return;
  const s=world.sim,lift=world.liftInfo,r=s.route,info=world.conditions,station=watching()?world.station:null;
  const speed=lift?lift.speed:s.speed;
  $('#speed').textContent=Math.round(speed*3.6);$('#speed-bar').style.width=clamp(speed/28*100,0,100)+'%';
  $('#drop').textContent=station?0:Math.max(0,Math.round(s.startY-(lift?s.ground:s.y)));
  $('#run-distance').textContent=skiDistance(s.travel);
  if(screen==='base')paintBaseExit(s);
  paintSplit(s.splits);
  const bare=s.trail?.name?.replace(/[（(].*$/,'');let grade=label(difficultyName[s.trail?.difficulty]||'道外');
  const approach=screen==='run'?s.approach:null;
  if(approach)grade=t('连接道','Connector');
  if(screen==='base')grade=r.finishKind==='training-runout'?t('训练场终点','Training runout'):t('山脚停留','Base area');
  if(station)grade=station.trailhead?t('雪道起点','Trailhead'):station.summit?t('山顶观景','Summit lookout'):t('索道站','Lift station');
  if(lift)grade=t('索道','Lift');
  $('#elevation').textContent=t('海拔 ','Elevation ')+meters(s.y)+' m  ·  '+grade;
  const liftStationName=station?.lift?.meta?.name||station?.lift?.name;
  const trail=station?(station.trailhead?label(r.name):station.guide?label(liftStationName)+t('上站',' upper station'):station.summit?(station.side==='wanlong'?label('红花梁'):t('云顶山顶','Genting summit')):label(liftStationName)):lift?resort(lift.resort)+' · '+label(lift.name):label(bare||'道外');
  $('#trail-name').textContent=screen==='base'?(r.finishKind==='training-runout'?label(r.name)+t('终点',' finish'):resort(r.destination)+t('山脚',' base')):approach?t(approach.name,approach.en):trail;
  $('#look-reset').hidden=!world.looking||!!page;
  $('#station-card').classList.toggle('turned',!!station&&world.looking);
  const d=Math.abs(Math.round(s.slope)),uphill=s.slope<-1.1,dir=lift?(lift.dir>0?t('上行','Ascent'):t('下行','Descent')):'';
  const climbText=s.autoSkating?t('自动蹬行','Skating'):uphill?t('上坡 · 按住加速蹬行','Uphill · hold accelerate to push'):null;
  $('#gradient').textContent=station?(station.summit?t('山顶停留','At the summit'):t('站台停留','At the station')):lift?dir:t('坡度 ','Grade ')+d+'° · '+(climbText|| (d<9?t('缓坡','Gentle'):d<20?t('中坡','Moderate'):t('陡坡','Steep')));
  $('#progress').textContent=station?'':lift?Math.round(lift.progress*100)+'%':resort(r.destination)+t('方向 · ',' · ')+Math.round(100*s.along/r.length)+'% · '+formatTime(s.elapsed);
  if(approach)$('#progress').textContent=t('通往','Towards ')+t(approach.target,approach.targetEn)+' · '+formatTime(s.elapsed);
  $('#world-clock').textContent=info.clock;$('#weather-name').textContent=$('#weather-compact').textContent=label(info.weatherName)+' · '+label(info.timeName);
  const icon=info.resolvedWeather==='heavy'?'heavy':info.resolvedWeather==='light'?'snow':({day:'sun',noon:'noon',evening:'evening',sunset:'dusk',twilight:'twilight',night:'night',aurora:'aurora',dawn:'dawn'}[info.resolvedTime]||'sun');
  if($('#weather-icon').dataset.icon!==icon){$('#weather-icon').innerHTML=glyph(icon);$('#weather-icon').dataset.icon=icon;}
  const flag=screen==='run'?world.nextFlag:null;
  $('#next-flag').hidden=flag==null;
  if(flag!=null)$('#next-flag').textContent=t('下一面旗 · ','Next flag · ')+Math.round(flag)+' m';
  const near=screen==='run'?world.nearbyStation:null;
  $('#near-lift').hidden=!near;
  $('#recover-piste').hidden=screen!=='run'||!s.recoveryReady;
  if(near)$('#near-lift-label').textContent=label(near.name)+' · '+label('上车');
  if(lift){$('#lift-text').textContent=resort(lift.resort)+' · '+label(lift.name)+' · '+dir+' '+Math.round(lift.progress*100)+'%';$('[data-act="skip-lift"] span').textContent=lift.dir>0?t('直达上站','Skip to upper station'):t('直达下站','Skip to lower station');}
  if(station){
    $('#station-title').textContent=station.trailhead?label(r.name):station.guide?label(liftStationName)+t('上站',' upper station'):station.summit?(station.side==='wanlong'?t('万龙山顶木屋 · 七索上站','Wanlong summit lodge · Lift 7'):t('云顶山脊 · 芍药花道口','Genting ridge · Peony entrance')):resort(station.side)+' · '+label(liftStationName);
    $('#station-note').textContent=station.summit&&!world.looking?
      t('点 ↑ 顺坡起滑 · 拖动环顾','Tap ↑ to ski downhill · drag to look'):
      t('按方向键起滑 · 拖动环顾','Press a direction to ski · drag to look');
    $('#station-ride').textContent=station.end==='top'?t('乘索道下山','Ride lift down'):t('乘索道上行','Ride lift up');
  }
}
function nav(k,txt,cls=''){return '<button data-act="'+k+'" class="'+cls+'" aria-current="'+(page===k)+'">'+txt+'</button>';}
function navMarkup(){
  const item=(k,name,c)=>nav(k,label(name),c);
  if(screen==='home')return '<span class="nav-label">'+t('红花梁 · 山顶','HONGHUALIANG')+'</span>'+button('close-panel',t('回到出发界面','Back to start'),'resume')+'<hr>'+item('rider','角色')+item('map','雪场地图')+item('help','操作说明')+item('settings','设置')+nav('records',rankings.title())+(lastPhoto||clip||read(videoKey,[]).length?button('share',t('分享雪场','Share the mountain'),'nav-small'):'')+nav('sources',t('地形资料','Terrain data'),'nav-small');
  const resume=screen==='base'?t('回到山脚','Back to the base'):screen==='trailhead'?t('回到起点','Back to trailhead'):screen==='summit'?t('回到山顶','Back to summit'):screen==='station'?t('回到站台','Back to station'):screen==='lift'?t('继续乘坐','Continue ride'):t('继续滑','Resume descent');
  const results=screen==='base'?nav('finish',t('本趟成绩','Run stats')):'';
  return '<span class="nav-label">'+t('PAUSED · 暂停','PAUSED')+'</span>'+button('close-panel',resume,'resume')+results+item('map','雪场地图')+'<hr>'+item('environment','环境')+(world?.flat?'':item('view','视角'))+item('rider','角色')+nav('records',rankings.title())+button('share',t('分享雪场','Share the mountain'),'nav-small')+'<hr>'+item('help','操作说明','nav-small')+item('settings','设置','nav-small')+button('restart',t('回到雪道起点','Return to trailhead'),'nav-small')+button('home',t('回到主界面','Main menu'),'nav-small');
}
function openPanel(k){
  checkpoint();
  recording?.stop();
  if(k==='view'&&world?.flat)k='help';
  if(['map','records'].includes(k)&&!data){ensureData().then(()=>openPanel(k)).catch(()=>openPanel('error'));return;}
  const previousPage=page;if(!previousPage)focusBack=document.activeElement;discardMap();
  page=k;clearInputs();world?.pause(true);sound.update(0,0,document.hidden);
  if(k==='map'&&previousPage!=='map')mapId=(screen==='summit'&&summitChoice)||world?.sim.route?.id||routeId;
  if(k==='map'&&screen==='home')mapId=routeId;
  if(k==='map'&&previousPage!=='map'){
    const r=panelRoute();mapRegion=r?.catalogResort||r?.resort||prefs.resort;mapPicked=false;clearedMarks=null;
  }
  $('#overlay').classList.toggle('lobby-fitting',screen==='home'&&k==='rider');
  $('#overlay').hidden=false;$('#overlay').setAttribute('role','dialog');$('#overlay').setAttribute('aria-modal','true');
  $('#overlay').setAttribute('aria-label',screen==='home'&&k==='rider'?t('滑雪装扮','Ski outfit'):label('设置'));
  $('#hud').hidden=true;$('#pause-nav').innerHTML=navMarkup();renderPanel();
  if(k==='records')rankings.load(recordTab);
  if(!previousPage)$('#panel button')?.focus({preventScroll:true});
}
function closePanel(){
  if(page==='lost'){if(isMiniTool)begin(world?.sim.route?.id,true);else location.reload();return;}
  discardMap();page='';$('#overlay').hidden=true;world?.pause(false);if(screen==='run')tilt.calibrate();hudVisible(inWorld());paintHUD();focusBack?.focus?.({preventScroll:true});
}
function sourceText(){
  if(isMiniTool)return '<p class="credit-text">'+t('部分雪道按雪场图估绘。其余雪道、索道及建筑轮廓 © OpenStreetMap 贡献者（ODbL）。高程来源 Mapzen / AWS Terrain Tiles / USGS。冬季影像来自 Copernicus Sentinel-2，林地参考 ESA WorldCover。建筑材质采用 Poly Haven（CC0）。角色、地标与开场全景为游戏重建。','Some runs are traced from resort maps. Other pistes, lifts and building outlines © OpenStreetMap contributors (ODbL). Elevation: Mapzen / AWS Terrain Tiles / USGS. Winter imagery: Copernicus Sentinel-2. Forest cover: ESA WorldCover. Building materials: Poly Haven (CC0). Riders, landmarks and the opening panorama are game reconstructions.')+'</p>';
  return '<p class="credit-text">'+t('红花梁近区采用 32 米高程网格，外围约 49 公里山地采用 240 米网格。雪道、索道和建筑轮廓来自公开测绘。山丹丹与翠菊花连接两侧雪场。','The local 32 m elevation grid is surrounded by 49 km of mountains sampled at 240 m. Surveyed pistes, lifts and buildings anchor both resorts. Lily and Aster connect the two sides.')+'</p><p class="credit-text">'+t('雪面底色来自 2025 年 1 月 21 日 Sentinel-2 影像，树群分布参考 2021 年土地覆盖。部分线路依据雪场图在地形上估绘，道宽也有估算。人物、地标外观和开场全景为游戏重建。','Snow colour comes from Sentinel-2 imagery of 21 January 2025. Tree placement follows 2021 land cover. Some trails are traced from resort maps and some widths are estimated. The rider, landmark façades and opening panorama are reconstructions.')+'</p><p class="credit-text"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors / ODbL</a> · <a href="./assets/geo/mountain.json" download>'+t('下载雪道数据','Download trail data')+'</a> · <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen / USGS</a> · <a href="https://dataspace.copernicus.eu/" target="_blank" rel="noopener">Copernicus Sentinel-2</a> · <a href="https://esa-worldcover.org/en" target="_blank" rel="noopener">ESA WorldCover</a> · <a href="https://polyhaven.com/license" target="_blank" rel="noopener">Poly Haven / CC0</a> · <a href="./assets/art/credits.txt" target="_blank" rel="noopener">'+t('美术记录','Art credits')+'</a></p>';
}
function renderPanel(keep=false){
  const p=$('#panel'),scroll=keep?p.scrollTop:0,openDetails=keep&&p.querySelector('.settings-detail')?.open;
  if(page==='view'){
    p.innerHTML=heading('VIEW','视角')+'<div class="view-grid">'+Object.entries(viewNames).map(([id,txt])=>'<button class="view-tile" aria-pressed="'+(prefs.view===id)+'" data-choice="view" data-value="'+id+'">'+viewPicture(id)+'<b>'+label(txt)+'</b>'+(id===prefs.view?tick:'')+'</button>').join('')+'</div><p class="panel-foot">'+t('右上角一键切换第一人称和外部机位。拖动可环顾四周，点指南针回正。','Use the top camera switch for first or third person. Drag to look around and tap the compass to face forward.')+'</p>';
  }else if(page==='environment')p.innerHTML=environmentPanel(prefs)+(world?.flat?'':button('scenery-open',t('在当前位置试景','Compare scenes here'),'setting-pill trial-link'));
  else if(page==='settings')p.innerHTML=settingsPanel(prefs,music.track,sourceText())+cloudControls();
  else if(page==='help')p.innerHTML=controlsPanel();
  else if(page==='rider'){
    p.innerHTML=fittingRoom();
  }else if(page==='map'){
    const r=panelRoute(),side=mapRegion||r.resort,visited=t('已滑过','Skied');
    const regions=seg('mapRegion',[['wanlong',resort('wanlong')],['genting',resort('genting')]],side);
    const sortTabs=mapSortFields.map(by=>'<button data-choice="mapSort" data-value="'+by+'"></button>').join('');
    p.innerHTML=heading('TRAIL MAP','双雪场',label('雪场地图'))+
      '<div class="map-regions">'+regions+'<p class="piste-progress"></p></div>'+
      '<div class="map-order"><div class="map-sort-tabs" role="group" aria-label="'+t('雪道排序','Sort trails')+'">'+sortTabs+'</div>'+button('clear-marks','','map-clear')+'</div>'+
      '<div class="map-layout"><div class="map-stage"><canvas id="large-map" aria-label="'+t('万龙与云顶雪道图，可拖动和缩放','Wanlong and Genting trail map. Drag or zoom.')+'"></canvas><span class="north">N ↑</span><span class="map-legend"><i></i>'+label('初级')+' <i></i>'+label('中级')+' <i></i>'+label('高级')+' <i class="piste-ink"></i>'+visited+'</span><div class="map-zoom">'+button('zoom-out',glyph('minus'))+button('recenter',glyph('compass'))+button('zoom-in',glyph('plus'))+'</div></div><div class="route-list"></div></div><div class="map-action" id="map-action"></div><div class="map-attribution">'+(isMiniTool?'© OpenStreetMap contributors · ODbL':'<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>')+' · Mapzen / USGS</div>';
    paintMapList();
    $$('.map-zoom button').forEach((b,i)=>b.setAttribute('aria-label',[t('缩小','Zoom out'),t('复位','Reset map'),t('放大','Zoom in')][i]));
    large=new TrailMap($('#large-map'),data,false,pisteProgress);large.select(screen==='summit'&&!summitChoice?null:r,inWorld()?world.sim:null);mapAction();
  }else if(page==='records'){
    $('#pause-nav [data-act="records"]').textContent=rankings.title();
    p.innerHTML=rankings.html(recordTab,pisteProgress,activityTotals(activity,pisteProgress.publicPistes));
  }else if(page==='finish'){
    const s=world.sim,r=s.route;
    const lift=data.lifts.find(l=>l.id===r.finishLiftId);
    const place=r.finishKind==='training-runout'?t('训练场减速区','Training runout'):lift?label(lift.name)+t('下站',' base station'):r.destination==='wanlong'?label('万龙雪具大厅')+' · '+label('龙宫酒店'):label('云顶滑雪大厅')+' · '+label('云顶大酒店');
    p.innerHTML=heading('ARRIVAL',r.finishKind==='training-runout'?'终点':'山脚',t('抵达','Arrived at ')+resort(r.destination))+'<p class="finish-summary">'+label(r.name)+'</p><p class="credit-text">'+place+'</p><div class="metrics">'+[[t('滑行距离','Distance'),km(s.travel)],[t('本次用时','Time'),formatTime(s.elapsed)],[t('最高时速','Top speed'),Math.round(s.maxSpeed*3.6)+' km/h']].map(([k,v])=>'<div><small>'+k+'</small><b>'+v+'</b></div>').join('')+'</div><div class="finish-actions">'+button('lift',glyph('lift',20)+t('乘索道上山','Ride lift up'),'launch')+button('restart',t('再滑一次','Another descent'),'quiet-button')+button('records',rankings.title(),'quiet-button')+button('share',t('分享雪场','Share the mountain'),'quiet-button')+'</div>';
  }else if(page==='sources')p.innerHTML=heading('TERRAIN','资料',t('地形与影像','Terrain and imagery'))+sourceText();
  else{
    const lost=page==='lost',light=lost&&isMiniTool;
    const detail=light?t('三维画面已中断。轻量雪道视图可以继续选道和滑行。','The 3D scene stopped. Use the lightweight trail view to choose trails and ski.'):
      lost?t('图形上下文已中断，重新载入可回到山顶。','The graphics context was interrupted. Reload to return to the summit.'):
      t('雪场资源读取失败，可以重试。','Retry loading the mountain assets.');
    p.innerHTML=heading('HONGHUALIANG','红花梁',t('雪场未能载入','Unable to load the mountain'))+'<div class="recovery"><p class="credit-text">'+detail+'</p>'+button(light?'flat-mode':lost?'reload':'retry',light?t('使用轻量视图','Use lightweight view'):t('重新载入','Reload'),'launch')+'</div>';
  }
  if(openDetails&&p.querySelector('.settings-detail'))p.querySelector('.settings-detail').open=true;
  p.scrollTop=scroll;
}
function paintMapList(){
  const order=mapSortFields.includes(prefs.mapSort?.by)?prefs.mapSort:defaultMapSort;
  const names={name:t('名称','Name'),length:t('长度','Length'),drop:t('垂降','Drop'),visited:t('是否滑过','Skied')};
  for(const tab of $$('.map-sort-tabs button')){
    const key=tab.dataset.value,active=key===order.by;
    tab.setAttribute('aria-pressed',String(active));
    const visited=order.descending?t('已滑优先','Skied first'):t('未滑优先','Unskied first');
    tab.textContent=active?(key==='visited'?visited:names[key])+(order.descending?' ↓':' ↑'):names[key];
  }
  const {ridden,total}=pisteProgress.totals(mapRegion),visited=t('已滑过','Skied');
  $('.piste-progress').innerHTML=visited+' <b>'+ridden+' / '+total+'</b> '+t('条雪道','pistes');
  const clear=$('[data-act="clear-marks"]');
  clear.textContent=clearedMarks?t('撤销清除','Undo clear'):t('清除双雪场标记','Clear both resorts’ marks');
  clear.disabled=!clearedMarks&&!pisteProgress.completed.size;
  const routes=data.allRoutes.filter(r=>(r.catalogResort||r.resort)===mapRegion);
  const ordered=sortedMapRoutes(routes,pisteProgress,order,prefs.language);
  $('.route-list').innerHTML=ordered.map(r=>{
    const progress=pisteProgress.forRoute(r);
    const mark=progress.ridden===progress.total?glyph('check',12)+visited:visited+' '+progress.ridden+'/'+progress.total;
    const badge=progress.ridden?'<small class="piste-badge">'+mark+'</small>':'';
    const selected=r.id===mapId&&(screen!=='summit'||!!summitChoice);
    const region=resort(r.resort)+(r.resort!==r.destination?' → '+resort(r.destination):'');
    return '<button class="route-choice" data-choice="route" data-value="'+r.id+'" aria-pressed="'+selected+'"><b>'+label(r.name)+badge+'</b><span>'+region+' · '+km(r.pisteDistance??r.length)+' · ↓ '+r.pisteDrop+' m</span></button>';
  }).join('');
}
function resetMapMarks(){
  if(clearedMarks){
    pisteProgress.merge(clearedMarks);clearedMarks=null;
    announce(t('已恢复雪道标记','Piste marks restored'));
  }else{
    // Old saves used the exploration list to reconstruct lifetime visits.
    // Persist that migration before clearing its only original source.
    store(activityKey,activity);
    clearedMarks=pisteProgress.clear();
    clearTimeout(discoveryTimer);discoveryTimer=undefined;discoveryQueue.length=0;$('#piste-discovery').hidden=true;
    announce(t('已清除双雪场的已滑过标记','Cleared skied marks at both resorts'));
  }
  store(pisteKey,pisteProgress.snapshot());large?.draw();paintMapList();scheduleCloud(100);
}
function currentMapActions(){
  const r=panelRoute(),summitExit=screen==='summit'&&r.resort===world.station.side&&Number.isFinite(world.summitHeading(r.id));
  return mapTravelActions(screen,mapPicked||(screen==='summit'&&!!summitChoice),r,world?.sim,summitExit);
}
function mapAction(){
  const r=panelRoute(),[primary,other]=currentMapActions();
  const text={trailhead:t('前往雪道起点','Visit trailhead'),choose:t('请先点选雪道','Choose a trail first'),
    summit:t('从山顶滑向道口','Ski to the entrance'),resume:t('继续滑行','Resume descent'),
    junction:t('在前方岔口转入','Take the upcoming junction'),join:t('沿此线路滑行','Join this trail')};
  const ready=primary!=='choose';
  const survey=r.geometrySource==='resort-diagram'?t(' · 雪场图估绘',' · Traced from resort map'):r.geometrySource==='shared-alignment'?t(' · 共用雪道段',' · Shared piste section'):'';
  const course=r.pisteDistance?t(' · 滑至终点 ',' · Through to finish ')+km(r.length):'';
  $('#map-action').innerHTML='<button class="launch" data-act="apply-route" '+(ready?'':'disabled')+'>'+text[primary]+'</button>'+
    (other?button('join-map-route',text[other],'quiet-button'):'')+
    (ready?'<span class="fine">'+label(difficultyName[r.difficulty])+t(' · 垂降 ',' · Drop ')+r.pisteDrop+' m'+course+survey+'</span>':'');
}
function setChoice(kind,v){
  if(kind==='mapSort'){
    prefs.mapSort=changeMapSort(prefs.mapSort||defaultMapSort,v);save();paintMapList();$('.route-list').scrollTop=0;return;
  }
  if(kind==='mapRegion'){mapRegion=v;mapId=v+'-classic';summitChoice='';mapPicked=false;discardMap();renderPanel(true);return;}
  if(kind==='look'){world.lookAroundStation(v);hudVisible(true);paintHUD();return;}
  if(kind==='recordTab'){recordTab=v;renderPanel();rankings.load(v);return;}
  if(kind==='route'){
    mapId=v;mapPicked=true;if(screen==='summit')summitChoice=v;
    for(const el of $$('.route-choice'))el.setAttribute('aria-pressed',String(el.dataset.value===v));
    large?.select(panelRoute(),inWorld()?world.sim:null);mapAction();return;
  }
  if(Object.prototype.hasOwnProperty.call(setupOptions,kind)){
    if(!setupOptions[kind].some(([id])=>id===v))return;
    const changed=prefs[kind]!==v;
    if(kind==='gender'&&changed){
      if(chosenSetup.color)prefs.outfits[prefs.gender]=prefs.color;
      chosenSetup.color=prefs.color=fittingColour(v,prefs.outfits);
    }
    if(kind==='color')prefs.outfits[prefs.gender]=v;
    chosenSetup[kind]=v;prefs[kind]=v;
    if(kind==='resort'){sharedRouteId=null;routeId=v+'-classic';}
    else if(changed&&world?.sim.route)world.changeRider();
    homeChoices();
  }
  else if(kind==='track'){prefs.track=v;prefs.followMusic=false;prefs.music=true;activateAudio();}
  else if(kind==='assist'){world?.sim.setAssist(v==='on');prefs.assist=v==='on';}
  else if(kind==='variedMoves'){
    prefs.variedMoves=v==='on';save();
    for(const button of $$('#panel [data-choice="variedMoves"]'))button.setAttribute('aria-pressed',String(button.dataset.value===v));
    return;
  }
  else if(kind==='controls'){prefs.controls=v==='on';}
  else{
    prefs[kind]=v;
    if(kind==='view')switchCamera(v);
    if(kind==='time'||kind==='weather'){world?.environment();refreshMusic();}
    if(kind==='quality')world?.graphics();
  }
  save();if(page){renderPanel(true);$$('#panel [data-choice="'+kind+'"]').find(b=>b.dataset.value===v)?.focus({preventScroll:true});}
}
async function enableTilt(){
  const ok=await tilt.enable();prefs.tilt=ok;save();if(page==='settings')renderPanel(true);
}
async function screenFull(){
  try{if(await fullscreen())return;}catch{}
  announce(t('横过手机即可横屏滑行','Rotate your phone for a landscape view.'));
}
function cloudControls(){
  if(!engagementAvailable('cloud'))return '';
  return '<div class="cloud-settings">'+button('sync-cloud',t('同步同账号存档','Sync account save'),'setting-pill')+
    '<small class="score-note">'+(cloudStatus||'')+'</small></div>';
}
function scheduleCloud(delay=60000){
  if(cloudUnavailable||!engagementAvailable('cloud'))return;
  if(cloudTimer&&delay>=60000)return;
  clearTimeout(cloudTimer);cloudTimer=setTimeout(()=>{cloudTimer=null;syncCloud(false);},delay);
}
async function syncCloud(interactive){
  if(cloudBusy){cloudPending=true;return;}
  if(!engagementAvailable('cloud')||(cloudUnavailable&&!interactive))return;
  cloudBusy=true;
  try{
    const rows=await cloudRead();
    cloudUnavailable=false;
    const mine=rows.find(row=>row.content?.device===device);
    const local={...readPisteMarks(read(pisteKey,[])),records:read(recordKey,[]),activity};
    const merged=mergeSkiProgress(local,rows.map(row=>row.content));
    for(const [key,field] of [[recordKey,'records'],[activityKey,'activity']])
      if(JSON.stringify(local[field])!==JSON.stringify(merged[field]))store(key,merged[field]);
    activity=merged.activity;
    if(merged.pistesResetAt!==local.pistesResetAt||JSON.stringify(merged.pistes)!==JSON.stringify(local.pistes)){
      pisteProgress?.merge(merged);
      store(pisteKey,pisteProgress?.snapshot()||readPisteMarks(merged));
      if(clearedMarks&&clearedMarks.pistesResetAt!==merged.pistesResetAt)clearedMarks=null;
      if(page==='map'){large?.draw();paintMapList();}
    }
    if((screen==='base'||screen==='lift')&&!page)hudVisible(true);
    const mineOnly=activity.devices[device];
    const content={device,...merged,activity:{...activity,devices:mineOnly?{[device]:mineOnly}:{}}};
    if(JSON.stringify(mine?.content)!==JSON.stringify(content)){
      if(!mine&&cloudWriteUncertain)throw new Error('Waiting for cloud confirmation');
      if(!mine)cloudWriteUncertain=true;
      const result=await cloudWrite(mine?.id,content);
      if(result?.status==='FAILED')cloudWriteUncertain=false;
      if(result?.status!=='SUCCESS')throw new Error('Unconfirmed cloud save');
      cloudWriteUncertain=false;
    }
    cloudStatus=t('已同步雪道进度和成绩','Piste progress and scores synced');
  }catch(error){
    cloudUnavailable=error.errCode===1006||error.errCode===10003;
    cloudStatus=cloudUnavailable?t('云存档暂未开通，本机存档可用','Cloud saves unavailable. Local saves still work.'):
      t('同步暂未确认，本机存档可用','Could not confirm sync. Local saves still work.');
  }finally{
    cloudBusy=false;
    if(page==='settings'||page==='records')renderPanel(true);
    if(interactive)announce(cloudStatus);
    if(cloudPending){cloudPending=false;scheduleCloud();}
  }
}
let cloudWriteUncertain=false;

const videoDialog=()=>$('#video-dialog');
const videoCanvas=()=>$(world?.flat?'#flat-view':'#gl');
let lastPhoto,pendingCapture,saveNoticeTimer,systemSave=false;
const photos=createPhotoEditor(()=>{if(!page)world?.pause(false);},()=>{
  if(!world||!inWorld())return null;
  lastPhoto=capturePhoto(world.photoFrame());return lastPhoto.canvas;
});
function openPhotos(){
  if(!lastPhoto&&!inWorld())return showVideo(clip||read(videoKey,[])[0]);
  if(!videoDialog().hidden)closeVideo();
  try{
    clearInputs();photos.open(lastPhoto?.canvas||world.photoFrame(),inWorld());world?.pause(true);
  }catch{announce(t('无法读取雪场画面','This view could not be captured.'));}
}
function offerSave(item,text){
  if(item.canvas?item!==lastPhoto:item!==clip)return;
  pendingCapture=item;
  const panel=$('#capture-save'),button=panel.querySelector('button');
  panel.querySelector('span').textContent=text;button.textContent=t('保存','Save');button.disabled=false;panel.hidden=false;
  clearTimeout(saveNoticeTimer);
  saveNoticeTimer=setTimeout(()=>{if(pendingCapture===item){pendingCapture=null;panel.hidden=true;}},9000);
}
function clearSave(item){
  if(pendingCapture===item){pendingCapture=null;$('#capture-save').hidden=true;clearTimeout(saveNoticeTimer);}
}
function saveImagePreview(item){
  const panel=$('#save-image-preview');
  panel.querySelector('img').src=item.url;
  $('#save-image-hint').textContent=t('长按图片保存到相册','Press and hold the image to save.');
  panel.hidden=false;panel.querySelector('button').focus();
}
function closeImagePreview(){
  const panel=$('#save-image-preview');panel.hidden=true;panel.querySelector('img').removeAttribute('src');
  $(trial.frozen?'#scene-photo':'#tray-photo').focus({preventScroll:true});
}
async function exportCapture(item,manual=false,downloadOnly=false){
  if(!item||item.exporting)return item?.exporting;
  const photo=!!item.canvas,apple=iphoneVideo();
  if(!manual&&apple){offerSave(item,photo?t('照片已拍好','Photo ready'):t('录像已完成','Clip ready'));return;}
  const exporting=(async()=>{
    try{
      if(photo&&isMiniTool&&!photoActions().save){if(manual)saveImagePreview(item);else offerSave(item,t('照片已拍好','Photo ready'));return;}
      if(!photo&&isMiniTool&&!videoSaveAvailable()){
        clearSave(item);announce(t('录像已保留在「分享雪场」，此客户端无法存入本机','Clip available in Share the mountain for this session.'));return;
      }else if(manual&&apple&&!downloadOnly&&(photo?photoActions(item.file).share:canShareVideo(item.file))){
        systemSave=true;await shareVideoFile(item.file);
      }else if(photo&&apple&&!downloadOnly){saveImagePreview(item);}
      else if(photo){await savePhoto(item.url,null,item.name);}
      else if(!item.path){item.path=await saveGameVideo(item.blob,item.name);}
      if(!photo&&isMiniTool&&item.path&&!read(videoKey,[]).some(e=>e.path===item.path)){
        store(videoKey,[{name:item.name,path:item.path,when:new Date().toISOString()},...read(videoKey,[])]);
      }
      clearSave(item);
      if(manual&&apple&&!photo&&!canShareVideo(item.file))announce(mobileVideoInstructions());
      else if(!manual||!(apple&&!downloadOnly))announce(isMiniTool?(photo?t('照片已存入相册','Saved to Photos'):t('录像已存入小工具','Clip saved in this mini-tool')):t('已发起下载','Download started'));
    }catch(error){
      if(manual&&photo&&error?.name!=='AbortError'){clearSave(item);saveImagePreview(item);}
      else if(!manual||error?.name==='AbortError')offerSave(item,photo?t('照片待保存','Photo ready'):t('录像待保存','Clip ready'));
      else offerSave(item,t('保存未完成，可重试','Could not save. Try again.'));
    }finally{systemSave=false;}
  })();
  item.exporting=exporting;
  try{return await exporting;}finally{delete item.exporting;}
}
function takePhoto(){
  if(!inWorld()||!world||page)return;
  try{
    lastPhoto=capturePhoto(world.photoFrame());
    tray=false;paintCameraTray();exportCapture(lastPhoto);
  }catch{announce(t('无法拍摄当前画面，请重试','Could not capture the view. Try again.'));}
}
const recordable=()=>inWorld()&&canRecordGame(videoCanvas());
function paintCameraTray(){
  const holder=screen==='base'?$('#base-media'):watching()||screen==='lift'?$('#station-media'):$('.ride-actions');
  const tools=$('.camera-tray');
  if(tools.parentElement!==holder)holder.prepend(tools);
  $('#tray-tools').hidden=!(tray||screen==='base');
  $('#tray-toggle').setAttribute('aria-expanded',String(tray));
  paintRecordButton();
}

function paintRecordButton(){
  const status=$('#game-record'),control=$('#tray-record');
  const seconds=recording?Math.min(GAME_CLIP_SECONDS,Math.floor((performance.now()-recordStart)/1000)):0;
  status.hidden=!recording;
  control.hidden=!recordable();
  const film=$('#scene-film');film.hidden=!recordable();film.setAttribute('aria-pressed',String(!!recording));film.textContent=recording?t('停止录像','Stop recording'):t('录像','Record');
  const label=recording?t('停止录像','Stop recording'):t('开始录像','Start recording');
  for(const item of [status,control]){
    item.setAttribute('aria-pressed',String(!!recording));
    item.ariaLabel=label;item.title=label;
  }
  status.querySelector('span').textContent=t('停止','Stop')+' 0:'+String(seconds).padStart(2,'0');
  control.querySelector('span').textContent=recording?t('停止','Stop'):t('录像','REC');
}
const iphoneVideo=()=>!isMiniTool&&appleMobile();
const embeddedAppleVideo=()=>iphoneVideo()&&/wxwork|micromessenger/i.test(navigator.userAgent);
function mobileVideoInstructions(){
  return embeddedAppleVideo()
    ?t('若企业微信无法下载到「文件」，请从右上角「⋯」在 Safari 中打开游戏，再录制并选择「存储视频」。','If this app cannot download the video to Files, open the game in Safari from the ⋯ menu, then record and choose Save Video.')
    :t('可以先下载到「文件」，再打开视频，点分享 →「存储视频」。','Download to Files, then open the video and choose Share → Save Video.');
}
function startVideo(){
  if(page)closePanel();
  if(!recordable()||recording)return;
  recordStart=performance.now();
  activateAudio();
  let audio;
  try{audio=captureGameAudio(sound.ctx,[prefs.music&&prefs.volume>0&&music.gain,prefs.sound&&sound.master]);}catch{}
  try{
    recording=recordGame(videoCanvas(),result=>{
      clearInterval(clockTimer);recording=null;
      if(result){
        if(clip&&viewedClip!==clip)URL.revokeObjectURL(clip.url);
        const timestamp=new Date().toISOString().replace(/[^0-9]/g,'');
        const name='chongli-'+timestamp+'.'+result.extension;
        const file=typeof File==='function'?new File([result.blob],name,{type:result.blob.type}):null;
        clip={...result,url:URL.createObjectURL(result.blob),name,file};
        exportCapture(clip);
        if(!videoDialog().hidden)showVideo(clip);
      }else announce(t('未录到画面，请重试','No video captured. Try again.'));
      paintRecordButton();if(page)renderPanel(true);
    },{audio,mobile:iphoneVideo()||/Android|Mobile/i.test(navigator.userAgent),miniTool:isMiniTool,unlockCanvas:world.lockVideoCanvas()});
    tray=false;paintCameraTray();clockTimer=setInterval(paintRecordButton,250);
  }catch{
    announce(t('当前设备无法录制游戏画面','Game recording is unavailable on this device'));
  }
}
function showVideo(item=clip){
  if(photos.visible)photos.close();
  const dialog=videoDialog(),player=dialog.querySelector('video');
  if(dialog.hidden){clipFocus=document.activeElement;clearInputs();world?.pause(true);}
  if(viewedClip?.url&&viewedClip!==item&&viewedClip!==clip)URL.revokeObjectURL(viewedClip.url);
  viewedClip=item;
  const url=item?.url||item?.path;
  $('#video-title').textContent=t('分享雪场','Share the mountain');
  const photoTab=$('[data-act="share-photos"]');
  photoTab.textContent=t('雪场照片','Photo');photoTab.hidden=!lastPhoto&&!inWorld();
  dialog.querySelector('.share-media-nav strong').textContent=t('滑行录像','Video');
  $('#video-notice').textContent=url?'':t('录完的片段会出现在这里。','Your recorded clips appear here.');
  player.hidden=!url;
  if(url&&player.getAttribute('src')!==url)player.src=url;
  const library=$('#video-library');library.replaceChildren();
  const entries=isMiniTool?read(videoKey,[]):[];
  for(const entry of entries){
    const button=document.createElement('button');button.className='glass-button';
    button.textContent=new Date(entry.when).toLocaleString(prefs.language==='en'?'en-GB':'zh-CN');
    button.onclick=()=>showVideo(entry.path===clip?.path?clip:entry);library.appendChild(button);
  }
  if(clip&&item!==clip){
    const button=document.createElement('button');button.className='glass-button';button.textContent=t('刚录好的片段','Latest clip');
    button.onclick=()=>showVideo(clip);library.prepend(button);
  }
  library.hidden=!library.childElementCount;
  const save=$('[data-act="save-video"]'),publish=$('[data-act="share-video"]'),download=$('[data-act="download-video"]');
  const appleShare=iphoneVideo()&&canShareVideo(item?.file);
  save.hidden=!item?.blob||!!item.path||(!videoSaveAvailable()&&isMiniTool);
  save.textContent=appleShare?t('存入相册','Save to Photos'):isMiniTool?t('保存到小工具','Save to mini-tool'):t('保存视频','Save video');
  publish.hidden=!canPublishVideo(item);
  publish.textContent=isMiniTool?t('发视频笔记','Post video'):t('分享录像','Share video');
  download.hidden=!appleShare;download.textContent=t('下载到文件','Download to Files');
  if(url&&publish.hidden)$('#video-notice').textContent=t('可保存视频后，在常用应用中分享。','Save this video to share it in another app.');
  if(item&&iphoneVideo()&&!appleShare)$('#video-notice').textContent=mobileVideoInstructions();
  const again=$('[data-act="new-video"]');again.hidden=!recordable();again.textContent=t('录新片段','Record another');
  $('[data-act="close-video"]').textContent=t('返回','Back');dialog.hidden=false;
  $('[data-act="close-video"]').focus({preventScroll:true});
}
function closeVideo(){
  const dialog=videoDialog(),player=dialog.querySelector('video');
  dialog.hidden=true;player.pause();player.removeAttribute('src');player.load();
  if(viewedClip?.url&&viewedClip!==clip)URL.revokeObjectURL(viewedClip.url);
  viewedClip=null;if(!page)world?.pause(false);
  if(clipFocus?.offsetWidth)clipFocus.focus({preventScroll:true});
}
async function shareRecording(){
  const item=viewedClip,control=$('[data-act="share-video"]');
  if(!item||control.disabled)return;
  control.disabled=true;
  try{
    if(isMiniTool&&!item.path&&videoSaveAvailable())await exportCapture(item,true);
    await publishVideo(item);
  }catch(error){
    if(error?.name!=='AbortError')$('#video-notice').textContent=t('分享未完成，可重新分享或保存视频。','Could not share. Try again or save the video.');
  }finally{control.disabled=false;}
}

function syncTrialUI(){
  const notice=$('#capture-save');
  if(trial.frozen)$('#scenery-desk .scene-console').append(notice);
  else if(notice.parentElement!==$('.hud-reading'))$('#piste-split').before(notice);
  hudVisible(inWorld());paintHUD();
}
function endTrial(){
  if(!trial.active)return;
  trial.close();world?.previewScenery?.(null);syncTrialUI();
}
function openTrial(touring=false){
  if(!inWorld()||!world?.previewScenery){
    if(world?.flat)announce(t('同趟试景需要三维雪场，当前为轻量雪道视图。','Scenery trials require the 3D mountain. This device is using the lightweight view.'));
    return;
  }
  if(page)closePanel();
  if(!trial.active)trial.enter(world.sim.route,touring,world.sim.along);
  trial.frozen=true;clearInputs();world.pause(true);world.previewScenery(trial);
  sound.update(0,0);syncTrialUI();$('#scene-list').focus({preventScroll:true});
}
function leaveTrialDesk(play){
  if(!play)endTrial();
  else{
    trial.sky=false;trial.tree=false;trial.fromThirdLift=false;trial.frozen=false;world.previewScenery(trial);
  }
  if(play&&screen==='trailhead')launch(world.sim.route);
  else world.pause(false);
  syncTrialUI();
  (play?$('#scenery-chip'):$('[data-act="pause"]'))?.focus({preventScroll:true});
}
function scenicAction(a){
  if(a==='scenery-start'){
    return begin(trialRouteId,false,true).then(()=>{
      if(screen!=='trailhead'||page)return;
      if(location.hash==='#sansuo'&&world.stageThirdLift?.()){
        trial.enter(world.sim.route);trial.select('ink');trial.fromThirdLift=true;trial.example=true;openTrial();return;
      }
      openTrial(true);
    });
  }
  if(a==='scenery-open')return openTrial();
  if(!trial.frozen)return;
  if(a==='scenery-end'||a==='scenery-play')return leaveTrialDesk(a==='scenery-play');
  if(a==='scenery-retry'){world.retryArt();return;}
  if(a==='scenery-prev'||a==='scenery-next')trial.step(a==='scenery-next'?1:-1);
  if(a==='scenery-compare')trial.original=!trial.original;
  if(a==='scenery-example')trial.example=!trial.example;
  if(a==='scenery-sky'){trial.tree=false;trial.sky=trial.sky===trial.id?false:trial.id;}
  if(a==='scenery-tree'){trial.sky=false;trial.tree=!trial.tree;}
  if(a==='scenery-tour'){
    trial.touring=!trial.touring;trial.original=false;
    trial.advance(trial.route.closest(world.sim.x,world.sim.z).along);
  }
  world.previewScenery(trial,false,a==='scenery-example'&&trial.sky===trial.id);syncTrialUI();
}
$('#scene-list').addEventListener('change',e=>{
  trial.select(e.target.value);world.previewScenery(trial);syncTrialUI();
});
function action(a){
  if(a.startsWith('scenery-'))return scenicAction(a);
  if(a==='fitting-turn'){fittingFront=!fittingFront;renderPanel(true);$('#panel [data-act="fitting-turn"]').focus({preventScroll:true});return;}
  if(a==='start'||a==='retry')return begin();
  if(a==='flat-mode'&&isMiniTool)return begin(world?.sim.route?.id,true);
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
  if(a==='tray'){tray=!tray;paintCameraTray();return;}
  if(a==='pov'){switchCamera(prefs.view==='first'?prefs.outsideView:'first');return;}
  if(a==='center-look'){world?.centerLook();if(watching())hudVisible(true);paintHUD();return;}
  if(a==='view'&&inWorld()&&!page){const vs=Object.keys(viewNames);switchCamera(vs[(vs.indexOf(prefs.view)+1)%vs.length]);announce(label(viewNames[prefs.view])+t('视角',' camera'));return;}
  if(['map','help','view','rider','environment','records','settings','sources'].includes(a))return openPanel(a);
  if(a==='finish')return openPanel('finish');
  if(a==='rank-retry')return rankings.load(recordTab,true);
  if(a==='rank-submit')return rankings.submit(recordTab,pisteProgress,activityTotals(activity,pisteProgress.publicPistes));
  if(a==='sync-cloud')return syncCloud(true);
  if(a==='home')return home();
  if(a==='reload')return location.reload();
  if(a==='restart'){
    checkpoint();
    if(!world?.sim.route||watching()||screen==='lift')return begin(world?.sim.route.id||routeId);
    endTrial();const route=data.allRoutes.find(r=>r.id===(world.sim.continuedFrom?.id||world.sim.route.id))||world.sim.route;discardMap();page='';$('#overlay').hidden=true;screen='trailhead';tray=false;recorded=false;
    clearInputs();world.trailhead(route);hudVisible(true);paintHUD();refreshMusic();return;
  }
  if(a==='launch-trail'&&screen==='trailhead')return launch(world.sim.route);
  if(a==='continue-base')return continueDescent();
  if(a==='look-hall'&&screen==='base'){world.lookAtBaseHall();return;}
  if(a==='clear-marks')return resetMapMarks();
  if(a==='apply-route'||a==='join-map-route'){
    const r=panelRoute(),mode=currentMapActions()[a==='apply-route'?0:1];
    if(!mode||mode==='choose')return;
    if(mode==='resume')return closePanel();
    if(screen==='home'){
      sharedRouteId=null;chosenSetup.resort=prefs.resort=r.resort;save();
      return begin(r.id,false,true);
    }
    if(mode==='summit'){
      const heading=world.summitHeading(r.id);closePanel();pushOff('up',r.id,heading);
    }
    else if(mode==='join'||mode==='junction'){if(world.sim.switchRoute(r)){closePanel();paintHUD();}}
    else {
      endTrial();closePanel();routeId=r.id;screen='trailhead';tray=false;recorded=false;
      clearInputs();world.trailhead(r);hudVisible(true);paintHUD();refreshMusic();
    }
    return;
  }
  if(a==='zoom-in'||a==='zoom-out'){large?.changeZoom(a==='zoom-in'?1.24:.82);return;}
  if(a==='recenter'){large?.reset();return;}
  if(a==='recover-piste'&&screen==='run'){
    if(!world.recoverToPiste()){announce(t('附近暂未找到安全落点','No clear spot on a nearby piste'));return;}
    clearInputs();routeId=world.sim.route.id;paintHUD();return;
  }
  if(a==='lift'){
    if(!world?.beginRide())return;

    if(screen==='run'||screen==='base'){saveActivity(world.sim,true);scheduleCloud(3000);}
    reportDiscoveries(world.sim);showLiftSummary(world.sim);screen='lift';page='';clearInputs();$('#overlay').hidden=true;world.pause(false);hudVisible(true);paintHUD();refreshMusic();return;
  }
  if(a==='skip-lift')return world?.leaveRide();
  if(a==='photo')return takePhoto();
  if(a==='share'||a==='share-photos')return openPhotos();
  if(a==='share-videos')return showVideo(clip||read(videoKey,[])[0]);
  if(a==='share-video')return shareRecording();
  if(a==='save-capture')return exportCapture(pendingCapture,true);
  if(a==='close-save-preview')return closeImagePreview();
  if(a==='record'){
    if(recording){recording.stop();return;}
    return startVideo();
  }
  if(a==='new-video'){closeVideo();if(page)closePanel();return startVideo();}
  if(a==='close-video')return closeVideo();
  if(a==='save-video')return exportCapture(viewedClip,true);
  if(a==='download-video')return exportCapture(viewedClip,true,true);
}
document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b||busy||booting||b.disabled)return;
  if(b.dataset.drive&&e.detail===0){beginDirection(b.dataset.drive);return;}
  if(b.dataset.choice)setChoice(b.dataset.choice,b.dataset.value);
  else if(b.dataset.act)action(b.dataset.act);
  else if(b.dataset.hold==='jump'&&e.detail===0&&screen==='run'&&!page)world.sim.jump();
});
document.addEventListener('input',e=>{
  if(e.target.id==='music-volume'){prefs.volume=Number(e.target.value);$('#volume-readout').textContent=prefs.volume+'%';refreshMusic();save();}
});
document.addEventListener('keydown',e=>{
  if(booting||busy||e.altKey||e.ctrlKey||e.metaKey)return;
  if(!$('#save-image-preview').hidden){if(e.code==='Escape'){e.preventDefault();closeImagePreview();}return;}
  if(photos.visible){photos.key(e);return;}
  if(!videoDialog().hidden){
    if(e.code==='Escape'){e.preventDefault();closeVideo();}
    if(e.code==='Tab'){
      const focusable=$$('#video-dialog button, #video-dialog video').filter(b=>b.offsetWidth>0&&!b.disabled);
      const first=focusable[0],last=focusable.at(-1);
      if(first&&((e.shiftKey&&document.activeElement===first)||(!e.shiftKey&&document.activeElement===last))){
        e.preventDefault();(e.shiftKey?last:first).focus();
      }
    }
    return;
  }
  if(trial.frozen&&!page){
    if(e.code==='Escape'){e.preventDefault();leaveTrialDesk(false);}
    if(e.code==='Tab'){
      const visible=$$('#scenery-desk button,#scenery-desk select').filter(b=>b.offsetWidth&&!b.disabled);
      if((e.shiftKey&&document.activeElement===visible[0])||(!e.shiftKey&&document.activeElement===visible.at(-1))){
        e.preventDefault();visible[e.shiftKey?visible.length-1:0].focus();
      }
    }
    return;
  }
  if(e.code==='Tab'&&page){
    const all=$$('#overlay button, #overlay a, #overlay input, #overlay summary').filter(b=>b.offsetWidth>0&&!b.disabled);
    if(all.length&&((e.shiftKey&&document.activeElement===all[0])||(!e.shiftKey&&document.activeElement===all.at(-1)))){e.preventDefault();all[e.shiftKey?all.length-1:0].focus();}return;
  }
  if(e.code==='Escape'){if(e.repeat)return;if(page)closePanel();else if(inWorld())openPanel('view');return;}
  if(e.code==='KeyM'){if(e.repeat)return;if(page==='map')closePanel();else openPanel('map');return;}
  if(page)return;
  if(e.code==='KeyP'){if(!e.repeat)action('photo');return;}
  if(e.code==='KeyB'){if(!e.repeat)action('record');return;}
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
    if(screen==='base'&&e.repeat&&!keys.has(e.code))return;
    e.preventDefault();if(!e.repeat&&!keys.has(e.code))beginDirection(way);
    keys.add(e.code);updateInputs();return;
  }
  if(screen!=='run')return;
  if(['Space','KeyI','KeyK'].includes(e.code))e.preventDefault();
  if(e.code==='Space'){if(!e.repeat&&!holds.has('jump'))world.sim.beginJump();keys.add('Space');updateInputs();return;}
  keys.add(e.code);updateInputs();
});
document.addEventListener('keyup',e=>{const was=keys.delete(e.code);if(was&&e.code==='Space'&&screen==='run'&&!page&&!holds.has('jump'))world.sim.releaseJump();updateInputs();});
$('#video-dialog video').addEventListener('error',()=>{
  if(!videoDialog().hidden)$('#video-notice').textContent=t('当前设备无法预览这段视频。','This device cannot preview this video.');
});
window.addEventListener('pagehide',checkpoint);
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){checkpoint();clearInputs();if(inWorld()&&!page&&!trial.frozen&&videoDialog().hidden&&!photos.visible&&!systemSave)openPanel('view');if(busy)restoreRequested=true;sound.update(0,0,true);}
  else if(screen==='home')sound.update(0,0);
  refreshMusic();
});
window.addEventListener('blur',()=>{clearInputs();if(inWorld()&&!page&&!trial.frozen&&!busy&&videoDialog().hidden&&!photos.visible&&!systemSave)openPanel('view');});
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
  if(page||!videoDialog().hidden||!inWorld()||(e.button!==0&&e.button!==2))return;
  const pad=e.currentTarget.id==='steering',mouse=e.pointerType==='mouse';
  const steer=screen==='run'&&(pad||(!mouse&&e.clientX<innerWidth*.44));
  e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
  touches.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,
    role:steer?'steer':'look'});
  if(touches.size>=2){
    const fingers=[...touches.values()];
    if(screen==='run'&&fingers.length===2&&fingers[0].role!==fingers[1].role)return;
    for(const pt of fingers)pt.role='look';
    multi=touchPair();drag=trim=0;updateInputs();
  }
}
function touchMove(e){
  const pt=touches.get(e.pointerId);if(!pt||!world)return;
  const dx=e.clientX-pt.x,dy=e.clientY-pt.y;pt.x=e.clientX;pt.y=e.clientY;
  if(multi&&touches.size>=2){
    const pair=touchPair();
    const mx=pair.x-multi.x,my=pair.y-multi.y;
    world.orbit(mx,my);
    multi=pair;return;
  }
  if(pt.role==='look'){world.orbit(dx,dy);return;}
  const range=Math.max(40,Math.min(innerWidth,innerHeight)*.16);
  drag=clamp((pt.x-pt.startX)/range,-1,1);trim=clamp((pt.startY-pt.y)/range,-1,1);updateInputs();
}
function touchEnd(e){
  const pt=touches.get(e.pointerId);if(!pt)return;
  touches.delete(e.pointerId);multi=multi?touchPair():null;
  if(pt.role==='steer')drag=trim=0;
  updateInputs();
}
for(const el of [$('#gl'),$('#steering')]){
  el.addEventListener('pointerdown',touchStart);el.addEventListener('pointermove',touchMove);
  for(const ev of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(ev,touchEnd);
  el.addEventListener('contextmenu',e=>e.preventDefault());
}
function finishBoot(){
  device=read(deviceKey,'');
  if(!device){device=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);store(deviceKey,device);}
  activity=mergeSkiProgress({activity:read(activityKey,null),...readPisteMarks(read(pisteKey,[])),records:read(recordKey,[])}).activity;
  store(activityKey,activity);
  applySavedPreferences();routeId=mapId=prefs.resort+'-classic';
  setupText();refreshMusic();booting=false;
  if(isMiniTool){
    $('#boot-status').hidden=true;
    for(const b of $$('[data-start-ready]'))b.disabled=false;
  }
  if(engagementAvailable('cloud'))syncCloud(false);
  if(sharedRouteId)ensureData().then(()=>{const r=data.allRoutes.find(r=>r.id===sharedRouteId);
    if(r){routeId=r.id;prefs.resort=r.resort;homeChoices();}
  }).catch(()=>{});
}
const platformReady=initializePlatform([prefKey,recordKey,pisteKey,videoKey,activityKey,deviceKey],stage=>{
  announce(stage==='read'?t('无法读取存档，本次仍可滑行','Saved data unavailable. You can still ski.'):
    t('当前改动暂存于本次游玩','Changes are available for this session.'));
});
if(platformReady)platformReady.then(finishBoot,finishBoot);
else finishBoot();
