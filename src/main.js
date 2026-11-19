import './style.css';
import {glyph,emblem,viewNames,viewPicture} from './icons.js';
import {loadMountain,clamp,resortName,formatTime,difficultyName} from './mountain.js';
import {TrailMap} from './map.js';
import {MountainSound} from './sound.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const prefKey='ridgeline.preferences.v1',recordKey='ridgeline.descents.v1';
function read(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function store(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
const prefs={resort:'wanlong',gear:'ski',gender:'male',color:'#aa5536',view:'follow',env:'morning',quality:'auto',assist:true,sound:false,controls:true,...read(prefKey,{})};
const envs={morning:['清晨晴空','09:18','sun'],noon:['午后薄云','13:26','cloud'],snow:['林间小雪','10:42','snow'],dusk:['山脊日落','16:32','dusk']};
const colors={'#aa5536':'赭红','#ba9041':'麦金','#597b78':'松绿','#476d91':'冰蓝','#c5c3b6':'雪灰'};
if(!envs[prefs.env])prefs.env='morning';if(!viewNames[prefs.view])prefs.view='follow';
const sound=new MountainSound();let data,world,mini,large,routeId=prefs.resort+'-classic',mapId=routeId;
let screen='home',page='',photoOrigin='run',recordTab='times',busy=false,toastTimer=0,focusBack,restoreRequested=false,recorded=false;
const keys=new Set(),holds=new Set(),touches=new Map();let drag=0,multi=null;
const touchDevice=matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>0;
document.documentElement.classList.toggle('touch',touchDevice);
const save=()=>store(prefKey,prefs);
const selectedRoute=()=>data?.routes.find(r=>r.id===routeId)||data?.routes[0];
const panelRoute=()=>data?.routes.find(r=>r.id===mapId)||selectedRoute();
const isSki=()=>screen==='run'||screen==='lift';
const meters=n=>Math.round(n).toLocaleString('en-US');
const km=n=>(n/1000).toFixed(2)+' km';
const tick='<span class="tick">'+glyph('check',14)+'</span>';
const button=(action,text,cls='')=>'<button class="'+cls+'" data-act="'+action+'">'+text+'</button>';
const choice=(kind,id,label,selected,icon='')=>'<button data-choice="'+kind+'" data-value="'+id+'" aria-pressed="'+(id===selected)+'">'+(icon?glyph(icon,18):'')+label+'</button>';
const heading=(en,cn)=>'<div class="panel-head"><div><span class="panel-kicker">'+en+'</span><h2 class="panel-title">'+cn+'</h2></div><button class="icon-disc" data-act="close-panel" aria-label="关闭">'+glyph('close',18)+'</button></div>';
function announce(message){const t=$('#toast');t.textContent=message;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2500);}
function refreshSound(){
  $$('[data-act="sound"]').forEach(b=>{b.innerHTML=glyph(prefs.sound?'sound':'mute',19);b.setAttribute('aria-label',prefs.sound?'关闭环境音':'开启环境音');b.setAttribute('aria-pressed',String(prefs.sound));});
}
function homeChoices(){
  $('#resort-choices').innerHTML=choice('resort','wanlong','万龙',prefs.resort)+choice('resort','genting','云顶',prefs.resort);
  $('#gear-choices').innerHTML=choice('gear','ski','双板',prefs.gear,'ski')+choice('gear','board','单板',prefs.gear,'board');
  mini?.select(selectedRoute()); 
}
function initializeIcons(){ $('#logo').innerHTML=$('.loading-crest').innerHTML=emblem;
  $$('.play-icon').forEach(el=>el.innerHTML=glyph('play',18));$$('[data-glyph]').forEach(el=>el.innerHTML=glyph(el.dataset.glyph));
  for(const [act,g] of [['fullscreen','expand'],['pause','menu'],['view','eye']])$$('[data-act="'+act+'"]').forEach(el=>el.innerHTML=glyph(g));
  $('.hud-tools [data-act="map"]').innerHTML=glyph('map');$('#shutter').innerHTML=glyph('camera',18)+'保存照片';refreshSound();
}
async function ensureData(){if(data)return data;data=await loadMountain();
  if(!mini){mini=new TrailMap($('#mini-map'),data,true);mini.select(selectedRoute());}
  return data;
}
function clearInputs(){keys.clear();holds.clear();touches.clear();multi=null;drag=0;world?.releaseOrbit?.();updateInputs();}
function updateInputs(){
  const active=screen==='run'&&!page&&!busy;
  if(world){world.input.steer=active?clamp(drag+(keys.has('ArrowRight')||keys.has('KeyD')?1:0)-(keys.has('ArrowLeft')||keys.has('KeyA')?1:0),-1,1):0;
    world.input.brake=active&&(holds.has('brake')||keys.has('ArrowDown')||keys.has('KeyS'));world.input.boost=active&&(holds.has('boost')||keys.has('ArrowUp')||keys.has('KeyW'));}
  for(const b of $$('[data-hold]'))b.classList.toggle('active',!!world?.input[b.dataset.hold]);
  $('#steering').style.setProperty('--drag',(drag*18)+'px');
}
function hudVisible(show){
  $('#home').hidden=screen!=='home';$('#hud').hidden=!show||!!page;$('#photo-bar').hidden=screen!=='photo';
  document.documentElement.classList.toggle('hud-minimal',!prefs.controls||screen==='lift');
  $('#lift-strip').hidden=screen!=='lift';
}
async function begin(id=routeId){
  if(busy)return;busy=true;restoreRequested=false;
  $('#loading').hidden=false;$('#load-text').textContent='读取红花梁地形';sound.set(prefs.sound);
  try{
    await ensureData();const route=data.routes.find(r=>r.id===id)||selectedRoute();
    if(!world){const {createWorld}=await import('./world.js');world=await createWorld($('#gl'),data,prefs,worldEvent,s=>$('#load-text').textContent=s);}
    if(large){large.observer.disconnect();large=null;}page='';$('#overlay').hidden=true;
    routeId=route.id;prefs.resort=route.resort;save();recorded=false;screen='run';clearInputs();
    world.start(route);hudVisible(true);paintHUD();world.graphics();
    if(restoreRequested||document.hidden)openPanel('view');
  }catch(e){console.error(e);openPanel('error');}
  finally{busy=false;$('#loading').hidden=true;}
}
function home(){
  clearInputs();world?.stop();screen='home';page='';if(large){large.observer.disconnect();large=null;}
  $('#overlay').hidden=true;$('#fork-prompt').hidden=true;homeChoices();hudVisible(false);sound.update(0,0);
}
function worldEvent(type,arg){
  if(type==='hud'&&isSki()&&!page){paintHUD();sound.update(screen==='lift'?3:arg.speed,Math.abs(arg.steer)*.7+arg.brake,document.hidden);}
  if(type==='finish'&&!recorded){
    recorded=true;screen='finish';const records=read(recordKey,[]);
    records.push({routeId:arg.route.id,name:arg.route.name,resort:arg.route.destination,when:new Date().toISOString(),gear:prefs.gear,time:Math.round(arg.elapsed),max:arg.maxSpeed*3.6,dist:arg.travel,drop:Math.round(arg.startY-arg.ground)});
    store(recordKey,records.slice(-100));clearInputs();openPanel('finish');
  }
  if(type==='disembark'){prefs.resort=arg;routeId=arg+'-classic';screen='run';recorded=false;save();hudVisible(true);announce('已到山顶，可以滑行');}
  if(type==='lost'){openPanel('lost');}
}
function paintHUD(){
  if(!world||!world.sim.route)return;
  const s=world.sim,lift=world.liftInfo,r=s.route,info=envs[prefs.env];
  $('#speed').textContent=String(Math.round((lift?5.9:s.speed)*3.6));$('#speed-bar').style.width=clamp(s.speed/28*100,0,100)+'%';
  $('#drop').textContent=Math.max(0,Math.round(s.startY-s.y));
  const bare=s.trail?.name?.replace(/（[^）]*）/g,'').replace(/\([^)]*\)/g,'');
  $('#elevation').textContent='海拔 '+meters(s.y)+' m  ·  '+(lift?'索道':difficultyName[s.trail?.difficulty]||'道外');
  $('#trail-name').textContent=lift?resortName(lift.resort)+' · '+lift.name:(bare||'道外');
  const d=Math.abs(Math.round(s.slope));$('#gradient').textContent=lift?'前往山顶':'坡度 '+d+'° · '+(d<9?'缓坡':d<20?'中坡':'陡坡');
  $('#progress').textContent=lift?'上行 '+Math.round(lift.progress*100)+'%':resortName(r.destination)+'方向 · '+Math.round(100*s.along/r.length)+'% · '+formatTime(s.elapsed);
  $('#world-clock').textContent=info[1];$('#weather-name').textContent=info[0];
  if($('#weather-icon').dataset.icon!==info[2]){$('#weather-icon').innerHTML=glyph(info[2]);$('#weather-icon').dataset.icon=info[2];}
  const fork=screen==='run'?s.fork:null;$('#fork-prompt').hidden=!fork;
  if(fork){$('#fork-text').textContent='联滑岔口 · '+Math.round(fork.ahead)+' m';$('#fork-button').textContent='转入'+(r.resort==='wanlong'?'山丹丹 · 去云顶':'翠菊花 · 回万龙');}
  if(lift)$('#lift-text').textContent=resortName(lift.resort)+' · '+lift.name+'上行  '+Math.round(lift.progress*100)+'%';
}
function navMarkup(){
  if(screen==='home')return '<span class="nav-label">红花梁 · 山顶</span>'+button('close-panel','回到出发界面','resume')+'<hr>'+nav('map','雪场地图')+nav('help','操作说明')+nav('settings','设置')+nav('records','排行榜')+nav('sources','地形资料','nav-small');
  if(screen==='finish')return '<span class="nav-label">抵达 · 山脚</span>'+nav('finish','本次滑行')+nav('records','排行榜')+nav('map','雪场地图')+'<hr>'+button('home','回到主界面','nav-small');
  return '<span class="nav-label">PAUSED · 暂停</span>'+button('close-panel',screen==='lift'?'继续乘坐':'继续滑','resume')+nav('map','雪场地图')+(screen==='lift'?'':button('photo','拍照'))+'<hr>'+nav('environment','环境')+nav('view','视角')+nav('rider','角色')+nav('records','排行榜')+button('share','分享','nav-small')+'<hr>'+nav('help','操作说明','nav-small')+nav('settings','设置','nav-small')+button('restart','回到雪道起点','nav-small')+button('home','回到主界面','nav-small');
}
function nav(k,label,cls=''){return '<button data-act="'+k+'" class="'+cls+'" aria-current="'+(page===k)+'">'+label+'</button>';}
function openPanel(k){
  if(k==='map'&&!data){ensureData().then(()=>openPanel('map')).catch(()=>openPanel('error'));return;}
  const wasPage=page;if(!wasPage)focusBack=document.activeElement;
  if(large){large.observer.disconnect();large=null;}
  page=k;clearInputs();world?.pause(true);sound.update(0,0,document.hidden);
  if(k==='map'&&wasPage!=='map')mapId=world&&isSki()?world.sim.route.id:routeId;
  $('#overlay').hidden=false;$('#overlay').setAttribute('role','dialog');$('#overlay').setAttribute('aria-modal','true');
  $('#hud').hidden=true;$('#pause-nav').innerHTML=navMarkup();
  renderPanel();
  if(!wasPage)$('#panel button')?.focus({preventScroll:true});
}
function closePanel(){
  if(screen==='finish'){if(page!=='finish')openPanel('finish');else home();return;}
  if(page==='lost'){location.reload();return;}
  if(large){large.observer.disconnect();large=null;}
  page='';$('#overlay').hidden=true;world?.pause(false);hudVisible(isSki());focusBack?.focus?.({preventScroll:true});
}
const seg=(kind,list,selected)=>'<div class="segments">'+list.map(([key,label,ic])=>choice(kind,key,label,selected,ic||'')).join('')+'</div>';
const row=(label,c,desc='')=>'<div class="settings-row"><div><b>'+label+'</b>'+(desc?'<small>'+desc+'</small>':'')+'</div>'+c+'</div>';
function renderPanel(){
  const p=$('#panel');p.scrollTop=0;
  if(page==='view'){
    p.innerHTML=heading('VIEW · 视角','滑行视角')+'<div class="view-grid">'+Object.entries(viewNames).map(([id,label])=>'<button class="view-tile" aria-pressed="'+(prefs.view===id)+'" data-choice="view" data-value="'+id+'">'+viewPicture(id)+'<b>'+label+'</b>'+(id===prefs.view?tick:'')+'</button>').join('')+'</div><p class="panel-foot">滑行中轻点眼形图标轮换视角，双指拖动可环顾四周。</p>';
  }else if(page==='environment'){
    p.innerHTML=heading('WEATHER · 环境','山间天色')+'<div class="option-grid">'+Object.entries(envs).map(([id,[name,t,ic]])=>'<button class="option-tile" data-choice="env" data-value="'+id+'" aria-pressed="'+(id===prefs.env)+'">'+glyph(ic,29)+'<span>'+name+'<small>'+t+'</small></span>'+(id===prefs.env?tick:'')+'</button>').join('')+'</div>';
  }else if(page==='rider'){
    p.innerHTML=heading('RIDER · 角色','角色与雪具')+row('滑行装备',seg('gear',[['ski','双板','ski'],['board','单板','board']],prefs.gear))+row('角色',seg('gender',[['male','男'],['female','女']],prefs.gender))+row('雪服配色','<div class="swatches">'+Object.entries(colors).map(([c,n])=>'<button class="swatch" aria-label="'+n+'" title="'+n+'" data-choice="color" data-value="'+c+'" aria-pressed="'+(c===prefs.color)+'" style="--coat:'+c+'"></button>').join('')+'</div>');
  }else if(page==='settings'){
    p.innerHTML=heading('OPTIONS · 设置','滑行设置')+row('循线辅助',seg('assist',[['on','开启'],['off','关闭']],prefs.assist?'on':'off'),'开启后顺着所选线路下山，关闭后可自由选线。')+row('画面',seg('quality',[['lite','流畅'],['auto','自动'],['high','精细']],prefs.quality))+row('屏幕按键',seg('controls',[['on','显示'],['off','隐藏']],prefs.controls?'on':'off'))+row('环境音',seg('audio',[['on','开启'],['off','关闭']],prefs.sound?'on':'off'))+'<p class="panel-foot">'+button('sources','查看地形与影像来源','quiet-button')+'</p>';
  }else if(page==='help'){
    const action=(title,txt,k)=>'<div class="ctrl-row"><strong>'+title+'</strong><span>'+txt+'</span><span>'+k+'</span></div>',key=k=>'<kbd>'+k+'</kbd>';
    p.innerHTML=heading('CONTROLS · 操作','操作说明')+action('转弯','按住雪面，向左或向右拖动',key('A')+' '+key('D')+' / '+key('←')+' '+key('→'))+action('加速','按住「加速」压低重心',key('W')+' / '+key('↑'))+action('刹车','按住「刹车」减速至停下',key('S')+' / '+key('↓'))+action('跳跃','轻点「跳」起跳',key('空格'))+action('视角','点眼形图标切换，双指环顾',key('C'))+action('地图 / 暂停','点右上角地图或菜单',key('M')+' / '+key('Esc'))+'<p class="panel-foot">在山丹丹或翠菊花岔口可转往另一侧。滑到山脚后可搭乘索道回山顶。</p>';
  }else if(page==='map'){
    const r=panelRoute();
    const routes=[...data.routes].sort((a,b)=>Number(b.resort===r.resort)-Number(a.resort===r.resort));
    p.innerHTML=heading('TRAIL MAP · 双雪场','雪场地图')+'<div class="map-layout"><div class="map-stage"><canvas id="large-map" aria-label="万龙与云顶雪道图，可拖动和缩放"></canvas><span class="north">N ↑</span><span class="map-legend"><i></i>初级 <i></i>中级 <i></i>高级</span><div class="map-zoom">'+button('zoom-out',glyph('minus'))+button('recenter',glyph('compass'))+button('zoom-in',glyph('plus'))+'</div></div><div class="route-list">'+routes.map(t=>'<button class="route-choice" data-choice="route" data-value="'+t.id+'" aria-pressed="'+(r.id===t.id)+'"><b>'+t.name+'</b><span>'+resortName(t.resort)+(t.resort!==t.destination?' 至 '+resortName(t.destination):'')+' · '+km(t.length)+'</span></button>').join('')+'</div></div><div class="map-action" id="map-action"></div><div class="map-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · Mapzen / USGS</div>';
    const zb=$$('.map-zoom button');['缩小','复位','放大'].forEach((l,i)=>zb[i].setAttribute('aria-label',l));
    large=new TrailMap($('#large-map'),data);large.select(r,isSki()?world.sim:null);mapAction();
  }else if(page==='records'){
    const r=isSki()||screen==='finish'?world.sim.route:selectedRoute();
    let records=read(recordKey,[]).slice().reverse();
    if(recordTab==='times')records=records.filter(e=>e.routeId===r?.id||e.name===r?.name).sort((a,b)=>a.time-b.time);
    const tabs=seg('recordTab',[['times','本线用时'],['recent','最近滑行']],recordTab);
    p.innerHTML=heading('LEADERBOARD · 本机','滑行排行榜')+tabs+'<p class="panel-foot">'+(recordTab==='times'?(r?.name||'所选线路')+' · 按用时排序':'最近完成的滑行')+'</p>'+
      (records.length?records.slice(0,12).map((e,i)=>'<div class="record"><div><b>'+(recordTab==='times'?(i+1)+'.　':'')+e.name+'</b><small>'+new Date(e.when).toLocaleDateString('zh-CN')+' · '+(e.gear==='ski'?'双板':'单板')+' · '+km(e.dist)+'</small></div><span>'+formatTime(e.time)+'</span></div>').join(''):'<p class="credit-text">滑抵山脚后，这里会记下你的线路、用时和滑行距离。</p>');
  }else if(page==='finish'){
    const s=world.sim,r=s.route;const dest=resortName(r.destination);
    p.innerHTML=heading('ARRIVAL · 山脚','抵达'+dest)+'<p class="finish-summary">'+r.name+'</p><p class="credit-text">'+(r.destination==='wanlong'?'万龙雪具大厅 · 龙宫酒店':'云顶滑雪大厅 · 云顶大酒店')+'</p><div class="metrics">'+[['滑行距离',km(s.travel)],['本次用时',formatTime(s.elapsed)],['最高时速',Math.round(s.maxSpeed*3.6)+' km/h']].map(([k,v])=>'<div><small>'+k+'</small><b>'+v+'</b></div>').join('')+'</div><div class="finish-actions">'+button('lift',glyph('lift',20)+'乘索道上山','launch')+button('base-photo','环顾山脚','quiet-button')+button('restart','再滑一次','quiet-button')+'</div>';
  }else if(page==='sources'){
    p.innerHTML=heading('TERRAIN · 资料','地形与影像')+'<p class="credit-text">红花梁近区采用 32 米高程网格，外围约 49 公里山地采用 240 米网格。雪道、索道、建筑轮廓来自公开测绘。双场联滑使用山丹丹与翠菊花联络道。</p><p class="credit-text">雪面底色来自 2025 年 1 月 21 日的 Sentinel-2 影像，树群分布参考 2021 年土地覆盖。部分雪道宽度采用估算。人物、地标外观及开场全景为游戏重建。</p><p class="credit-text"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors / ODbL</a> · <a href="./assets/geo/mountain.json" download>下载雪道数据</a> · <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen / USGS</a> · <a href="https://dataspace.copernicus.eu/" target="_blank" rel="noopener">Copernicus Sentinel-2</a> · <a href="https://esa-worldcover.org/en" target="_blank" rel="noopener">ESA WorldCover</a> · <a href="https://polyhaven.com/license" target="_blank" rel="noopener">Poly Haven 材质 / CC0</a> · <a href="./assets/art/credits.txt" target="_blank" rel="noopener">美术生成记录</a></p>';
  }else{
    const lost=page==='lost';p.innerHTML=heading('红花梁','雪场未能载入')+'<div class="recovery"><p class="credit-text">'+(lost?'图形上下文已中断。重新载入可回到山顶。':'三维场景需要支持 WebGL 2 的浏览器。也可以重新载入雪场资源。')+'</p>'+button(lost?'reload':'retry','重新载入','launch')+'</div>';
  }
}
function mapAction(){
  const r=panelRoute(),s=world?.sim;let label='从山顶出发';
  if(screen==='run'&&r.id===s.route.id)label='继续滑行';
  else if(screen==='run'&&r.closest(s.x,s.z).distance<=64)label='沿此线路滑行';
  else if(screen!=='home')label='从此线山顶出发';
  $('#map-action').innerHTML=button('apply-route',label,'launch')+'<span class="fine">'+difficultyName[r.difficulty]+' · 落差 '+Math.round(r.drop)+' m</span>';
}
function setChoice(kind,v){
  if(kind==='recordTab'){recordTab=v;renderPanel();return;}
  if(kind==='route'){
    mapId=v;for(const el of $$('.route-choice'))el.setAttribute('aria-pressed',String(el.dataset.value===v));
    large?.select(panelRoute(),isSki()?world.sim:null);mapAction();return;
  }
  if(kind==='audio'){prefs.sound=v==='on';sound.set(prefs.sound);refreshSound();}
  else if(kind==='resort'){prefs.resort=v;routeId=v+'-classic';homeChoices();}
  else if(kind==='assist'){const on=v==='on';world?.sim.setAssist(on);prefs.assist=on;}
  else if(kind==='controls'){prefs.controls=v==='on';}
  else{prefs[kind]=v;
    if(['gear','gender','color'].includes(kind)){world?.changeRider();homeChoices();}
    if(kind==='view')world?.cameraChanged();
    if(kind==='env')world?.environment();
    if(kind==='quality')world?.graphics();
  }
  save();if(page){renderPanel();const b=$$('[data-choice="'+kind+'"]').find(b=>b.dataset.value===v);b?.focus({preventScroll:true});}
}
async function screenFull(){
  try{
    if(document.fullscreenElement)await document.exitFullscreen();
    else if(document.documentElement.requestFullscreen){await document.documentElement.requestFullscreen({navigationUI:'hide'});if(touchDevice)window.screen.orientation?.lock?.('landscape').catch(()=>{});}
    else announce('当前浏览器使用窗口显示，横过手机即可滑行');
  }catch{announce('当前窗口已可横屏滑行');}
}
async function share(){
  const r=world?.sim.route||selectedRoute(),url=new URL(location.href);url.searchParams.set('run',r.id);
  const text='我在崇礼滑'+r.name+'，从'+resortName(r.resort)+'山顶出发。';
  try{
    if(navigator.share){await navigator.share({title:'山脊之间 · 万龙与云顶',text,url:url.toString()});}
    else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url.toString());announce('线路链接已复制');}
    else{const t=document.createElement('textarea');t.value=url.toString();document.body.append(t);t.select();const ok=document.execCommand('copy');t.remove();announce(ok?'线路链接已复制':'可复制浏览器地址分享');}
  }catch(e){if(e.name!=='AbortError')announce('可复制浏览器地址分享');}
}
async function photoSave(){
  const b=$('#shutter');b.disabled=true;
  try{const blob=await world.capture();if(!blob)throw new Error();const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='崇礼-'+world.sim.route.name+'-'+Date.now()+'.png';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000);announce('雪场照片已导出');
  }catch{announce('导出失败，可再次拍摄');}finally{b.disabled=false;}
}
function action(a){
  if(a==='start'||a==='retry')return begin();
  if(a==='fullscreen')return screenFull();
  if(a==='sound'){prefs.sound=!prefs.sound;sound.set(prefs.sound);save();refreshSound();return;}
  if(a==='close-panel')return closePanel();
  if(a==='pause')return openPanel('view');
  if(a==='view'&&isSki()&&!page){const vs=Object.keys(viewNames);prefs.view=vs[(vs.indexOf(prefs.view)+1)%vs.length];world.cameraChanged();save();announce(viewNames[prefs.view]+'视角');return;}
  if(['map','help','view','rider','environment','records','settings','sources','finish'].includes(a))return openPanel(a);
  if(a==='home')return home();
  if(a==='reload')return location.reload();
  if(a==='restart')return begin(world?.sim.route.id||routeId);
  if(a==='jump'){world?.sim.jump();return;}
  if(a==='junction'){
    const f=world?.sim.fork;if(f&&world.sim.switchRoute(f.route)){routeId=f.route.id;announce('已接入'+f.route.name);}return;
  }
  if(a==='apply-route'){
    const r=panelRoute();if(screen==='run'&&(r.id===world.sim.route.id||world.sim.switchRoute(r))){routeId=r.id;closePanel();paintHUD();}
    else begin(r.id);return;
  }
  if(a==='zoom-in'||a==='zoom-out'){large?.changeZoom(a==='zoom-in'?1.24:.82);return;}
  if(a==='recenter'){large?.reset();return;}
  if(a==='lift'){screen='lift';page='';$('#overlay').hidden=true;world.beginRide();world.pause(false);hudVisible(true);paintHUD();return;}
  if(a==='skip-lift')return world?.leaveRide();
  if(a==='share')return share();
  if(a==='photo'||a==='base-photo'){
    photoOrigin=screen;page='';screen='photo';$('#overlay').hidden=true;
    const place=a==='base-photo'?'hall':'rider';$('#photo-place').value=place;world.photo(true,place);hudVisible(false);return;
  }
  if(a==='exit-photo'){screen=photoOrigin;world.photo(false);openPanel(screen==='finish'?'finish':'view');return;}
  if(a==='save-photo')return photoSave();
}
document.addEventListener('click',e=>{
  const btn=e.target.closest('button');if(!btn||busy)return;
  if(btn.dataset.choice)setChoice(btn.dataset.choice,btn.dataset.value);else if(btn.dataset.act)action(btn.dataset.act);
});
document.addEventListener('keydown',e=>{
  if(busy||e.altKey||e.ctrlKey||e.metaKey)return;
  if(e.code==='Tab'&&page){
    const all=$$('#overlay button, #overlay a').filter(b=>b.offsetWidth>0&&!b.disabled);
    if(!all.length)return;
    if((e.shiftKey&&document.activeElement===all[0])||(!e.shiftKey&&document.activeElement===all.at(-1))){e.preventDefault();all[e.shiftKey?all.length-1:0].focus();}return;
  }
  if(e.code==='Escape'){if(e.repeat)return;if(screen==='photo')action('exit-photo');else if(page)closePanel();else if(isSki())openPanel('view');return;}
  if(e.code==='KeyM'&&screen!=='photo'){if(e.repeat)return;if(page==='map')closePanel();else openPanel('map');return;}
  if(page||screen!=='run')return;
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyA','KeyD','KeyS','KeyW','KeyC'].includes(e.code))e.preventDefault();
  if(e.code==='Space'&&!e.repeat){world.sim.jump();return;}
  if(e.code==='KeyC'&&!e.repeat){action('view');return;}
  keys.add(e.code);updateInputs();
});
document.addEventListener('keyup',e=>{keys.delete(e.code);updateInputs();});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){clearInputs();if(isSki()&&!page)openPanel('view');if(busy)restoreRequested=true;sound.update(0,0,true);}
  else if(screen==='home')sound.update(0,0);
});
window.addEventListener('blur',()=>{clearInputs();if(isSki()&&!page&&!busy)openPanel('view');});
for(const b of $$('[data-hold]')){
  const map=new Set();b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);map.add(e.pointerId);holds.add(b.dataset.hold);updateInputs();});
  for(const ev of ['pointerup','lostpointercapture','pointercancel'])b.addEventListener(ev,e=>{map.delete(e.pointerId);if(!map.size)holds.delete(b.dataset.hold);updateInputs();});
}
function touchStart(e){
  if(page||!(isSki()||screen==='photo')||e.button!==0)return;
  e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);touches.set(e.pointerId,{x:e.clientX,y:e.clientY,start:e.clientX});
  if(touches.size===2){multi=touchPair();drag=0;updateInputs();}
}
function touchPair(){
  const [a,b]=[...touches.values()];return a&&b?{x:(a.x+b.x)/2,y:(a.y+b.y)/2,d:Math.hypot(a.x-b.x,a.y-b.y)}:null;
}
function touchMove(e){
  const p=touches.get(e.pointerId);if(!p||!world)return;const dx=e.clientX-p.x,dy=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;
  if(touches.size>=2){const pair=touchPair();if(multi){world.orbit(pair.x-multi.x,pair.y-multi.y);if(screen==='photo')world.zoom(multi.d/Math.max(1,pair.d));}multi=pair;return;}
  if(screen==='photo'||screen==='lift'){world.orbit(dx,dy);return;}
  drag=clamp((e.clientX-p.start)/Math.max(40,Math.min(innerWidth,innerHeight)*.16),-1,1);updateInputs();
}
function touchEnd(e){
  if(!touches.has(e.pointerId))return;touches.delete(e.pointerId);multi=null;
  for(const v of touches.values())v.start=v.x;
  if(touches.size<2&&screen==='run')world?.releaseOrbit?.();
  drag=0;updateInputs();
}
for(const el of [$('#gl'),$('#steering')]){
  el.addEventListener('pointerdown',touchStart);el.addEventListener('pointermove',touchMove);
  for(const ev of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(ev,touchEnd);
}
$('#gl').addEventListener('wheel',e=>{if(screen==='photo'){e.preventDefault();world.zoom(e.deltaY>0?1.11:.90);}},{passive:false});
$('#photo-place').addEventListener('change',e=>world?.photoPlace(e.target.value));
initializeIcons();homeChoices();
ensureData().then(()=>{const id=new URLSearchParams(location.search).get('run'),r=data.routes.find(r=>r.id===id);
  if(r){routeId=r.id;prefs.resort=r.resort;homeChoices();}
}).catch(()=>{});
