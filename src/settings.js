import {glyph} from './icons.js';
import {timeOptions,weatherOptions} from './environment.js';
import {tracks} from './music.js';
import {t,label} from './language.js';

export const button=(action,content,cls='')=>'<button class="'+cls+'" data-act="'+action+'">'+content+'</button>';
export const choice=(kind,id,txt,selected,icon='')=>'<button data-choice="'+kind+'" data-value="'+id+'" aria-pressed="'+(id===selected)+'">'+(icon?glyph(icon,17):'')+txt+'</button>';
export const seg=(kind,list,selected)=>'<div class="segments">'+list.map(([key,name,ic])=>choice(kind,key,label(name),selected,ic)).join('')+'</div>';
export const row=(name,control,desc='')=>'<div class="settings-row"><div><b>'+name+'</b>'+(desc?'<small>'+desc+'</small>':'')+'</div>'+control+'</div>';
export function heading(en,cn,title=''){
  const text=t(en+' · '+cn,en);
  return '<div class="panel-head"><div><span class="panel-kicker">'+text+'</span>'+(title?'<h2 class="panel-title">'+title+'</h2>':'')+'</div><button class="icon-disc" data-act="close-panel" aria-label="'+t('关闭','Close')+'">'+glyph('close',18)+'</button></div>';
}
const icons={auto:'auto',day:'sun',evening:'evening',sunset:'dusk',twilight:'twilight',night:'night',aurora:'aurora',dawn:'dawn',clear:'sun',light:'snow',heavy:'heavy'};
function optionTiles(kind,list,value){
  return '<div class="climate-grid">'+list.map(o=>'<button class="climate-tile" data-choice="'+kind+'" data-value="'+o.id+'" aria-pressed="'+(value===o.id)+'">'+glyph(icons[o.id],27)+'<span>'+label(o.label)+'</span></button>').join('')+'</div>';
}
export function environmentPanel(prefs){
  return heading('TIME','时段')+optionTiles('time',timeOptions,prefs.time)+'<h3 class="panel-kicker weather-title">'+t('WEATHER · 天气','WEATHER')+'</h3>'+optionTiles('weather',weatherOptions,prefs.weather)+'<p class="panel-foot">'+t('自动时段随雪场时钟昼夜交替，自动天气随游戏时间变化。','Auto time follows the mountain clock. Auto weather changes as you explore.')+'</p>';
}
function pill(action,txt,active=false){
  return '<button class="setting-pill" data-act="'+action+'" aria-pressed="'+active+'">'+txt+'</button>';
}
export function settingsPanel(prefs,song,sources){
  const musicGrid=tracks.map(track=>{
    const playing=song.id===track.id;
    return '<button class="track" data-choice="track" data-value="'+track.id+'" aria-pressed="'+(playing&&!prefs.followMusic)+'" data-playing="'+(playing&&prefs.music)+'"><b>'+t(track.name,track.en)+'</b><small>'+t(track.desc,track.sub)+'</small></button>';
  }).join('');
  return heading('SETTINGS','设置')+'<div class="settings-tools">'+
    pill('sound',t('声音 '+(prefs.sound?'开':'关'),'Sound '+(prefs.sound?'on':'off')),prefs.sound)+
    button('language',t('English','中文'),'setting-pill')+button('quality',t('画质 ','Quality · ')+label({auto:'自动',lite:'流畅',high:'精细'}[prefs.quality]),'setting-pill')+button('environment',label('环境'),'setting-pill')+'</div>'+
    '<div class="music-head"><span>'+t('背景音乐','Background music')+'</span><div>'+pill('follow-music',t('随环境切换','Follow environment'),prefs.followMusic)+pill('music',t('音乐 '+(prefs.music?'开':'关'),'Music '+(prefs.music?'on':'off')),prefs.music)+'</div></div><div class="track-grid">'+musicGrid+'</div>'+
    '<div class="music-mix"><div><p id="now-playing">'+(prefs.music?t('正在播放 · ','Playing · '):t('已静音 · ','Muted · '))+t(song.name,song.en)+' / '+song.bpm+' BPM</p><small>'+t('点选曲目固定播放，或随环境切换。','Pick a track to keep it, or follow the environment.')+'</small></div><label for="music-volume">'+t('音乐音量','Music volume')+' <input id="music-volume" type="range" min="0" max="100" value="'+prefs.volume+'"> <output id="volume-readout">'+prefs.volume+'%</output></label></div>'+
    '<details class="settings-detail"><summary>'+t('滑行设置','Riding options')+'</summary>'+row(t('循线辅助','Trail assist'),seg('assist',[['on','开启'],['off','关闭']],prefs.assist?'on':'off'),t('顺着所选线路滑行，关闭可自由选线。','Follow the selected line or steer freely with assist off.'))+
    row(t('屏幕按键','Touch controls'),seg('controls',[['on','显示'],['off','隐藏']],prefs.controls?'on':'off'))+'</details>'+
    '<div class="tilt-setting">'+pill('tilt',t('倾斜转弯 '+(prefs.tilt?'开':'关'),'Tilt steering '+(prefs.tilt?'on':'off')),prefs.tilt)+(prefs.tilt?button('calibrate',t('校准','Calibrate'),'setting-pill'):'')+'</div>'+
    '<details class="source-detail"><summary>'+t('数据来源','Data sources')+'</summary>'+sources+'</details><small class="version">'+t('版本','Version')+' 1.1.0</small>';
}
export function controlsPanel(){
  const controls=[
    [t('倾斜手机','Tilt phone'),t('在设置里打开倾斜转弯。出发或继续滑行时的握姿为正中。','Enable tilt steering in Settings. Your grip at departure or resume sets the centre.'),''],
    [t('按住拖动','Drag sideways'),t('左右拖动转弯，越过刻度以板刃切雪。','Drag to steer. Cross the mark to set the edge.'),'A / D · ← →'],
    [t('上下拖动','Drag vertically'),t('往上压板头，往下压板尾。','Drag up for nose pressure, down for tail pressure.'),'I / K'],
    [t('跳','Jump'),t('按住蓄力，松开起跳。','Hold to load your legs. Release to jump.'),t('空格','Space')],
    [t('加速','Tuck'),t('按住压低身体，双板在低速时会撑杖。','Hold to tuck. Skiers plant their poles at low speed.'),'W / ↑'],
    [t('刹车','Brake'),t('按住横板刹车，松开恢复滑行。','Hold to skid and brake. Release to glide.'),'S / ↓'],
    [t('雪场地图','Trail map'),t('在地图选雪道出发，在索道站旁点「上车」。','Select a run on the map. Tap Board lift beside a station.'),'M'],
    [t('机位','Camera'),t('展开右侧箭头，点眼形图标换视角。','Open the right arrow and tap the eye to cycle cameras.'),'C'],
    [t('两指拖动','Two fingers'),t('滑行时用双指环顾，停在山顶时用单指即可。','Look around while riding. At the summit, one finger is enough.'),''],
    [t('拍照','Photo'),t('暂停菜单中点「拍照」冻结雪场。拖动环顾，双指平移或缩放，再按快门存图。','Freeze the scene from the pause menu. Drag to look, pan or pinch with two fingers, then save.'),'WASD · Q / E']
  ];
  return heading('CONTROLS','操作说明')+'<div class="controls-guide">'+controls.map(([title,body,key])=>'<div class="ctrl-row"><strong>'+title+'</strong><span>'+body+'</span><span>'+key+'</span></div>').join('')+'</div>';
}
