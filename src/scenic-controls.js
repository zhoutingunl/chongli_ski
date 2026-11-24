import {scenery} from './scenery.js';
import {t,label} from './language.js';
import {timeOptions,weatherOptions} from './environment.js';

const nameOf=p=>t(p.name,p.en);
const el=id=>document.getElementById(id);
export function paintScenicControls(trial,screen,sim,prefs){
  const open=trial.active&&trial.frozen;
  el('scenery-desk').hidden=!open;
  el('scenery-chip').hidden=!trial.active||open;
  if(!trial.active)return;
  const preset=trial.preset,name=nameOf(preset);
  el('scenery-chip').textContent=(trial.original?t('原景','Original'):trial.touring?t('巡览','Tour'):t('试景','Preview'))+' · '+name+' ›';
  if(!open)return;
  const select=el('scene-list'),previous=select.dataset.locale,locale=t('zh','en');
  if(previous!==locale){
    select.textContent='';
    for(const [group,title] of [['nature',t('自然景观','Natural phenomena')],['art',t('艺术画境','Art studies')]]){
      const options=document.createElement('optgroup');options.label=title;
      for(const p of scenery.filter(p=>p.group===group))options.append(new Option(nameOf(p),p.id));
      select.append(options);
    }
    select.dataset.locale=locale;
  }
  select.value=preset.id;
  const kind=preset.group==='nature'?t('自然景观','Natural phenomenon'):t('艺术画境','Art study');
  el('scene-kind').textContent=kind+' · '+String(scenery.indexOf(preset)+1).padStart(2,'0')+' / '+scenery.length;
  el('scene-title').textContent=trial.original?t('同光雪原景','Original in matching light'):name;
  el('scene-route').textContent=(sim?.route?label(sim.route.name):'')+' · '+Math.round(sim?.y||0).toLocaleString()+' m';
  const different=!trial.example&&((prefs.time!=='auto'&&prefs.time!==preset.time)||(prefs.weather!=='auto'&&prefs.weather!==preset.weather));
  el('scene-note').textContent=t(preset.note,preset.english)+(different?t(' 已沿用你的光雪，可点「示例光雪」比较。',' Your settings are in effect. Use Example light for the suggested conditions.'):'');
  const time=label(timeOptions.find(o=>o.id===preset.time).label),weather=label(weatherOptions.find(o=>o.id===preset.weather).label);
  const sample=el('scene-example');sample.textContent=t('示例光雪','Example light')+' · '+time+' / '+weather;
  sample.setAttribute('aria-pressed',String(trial.example));
  const compare=el('scene-original');
  compare.textContent=t('原景对照','Compare original');compare.setAttribute('aria-pressed',String(trial.original));
  const sky=el('scene-sky');sky.textContent=trial.sky===preset.id?t('回原机位','Rider view'):(preset.look==='ridge'?t('望山谷','Valley view'):t('望天空','Sky view'));sky.setAttribute('aria-pressed',String(trial.sky===preset.id));
  const tour=el('scene-tour');tour.textContent=t('沿线自动换景','Tour along the piste');tour.setAttribute('aria-pressed',String(trial.touring));
  el('scene-play').textContent=screen==='trailhead'?t('开滑','Ski now'):screen==='lift'?t('继续乘坐','Continue ride'):screen==='run'?t('继续滑行','Keep skiing'):t('回到雪场','Return to resort');
  el('scene-select-label').textContent=t('选择景观','Choose scene');
  el('scene-exit').textContent=t('结束试景','End trial');
  el('scene-photo').textContent=t('拍照','Take photo');
  for(const [id,zh,en] of [['scene-prev','上一个景观','Previous scene'],['scene-next','下一个景观','Next scene']])
    el(id).setAttribute('aria-label',t(zh,en));
}
