import {activityBoards,rankScore,rankValue} from './ski-engagement.js';
import {engagementAvailable,publicRanks,submitRankScore} from './platform.js';
import {heading,seg,button} from './settings.js';
import {t,label} from './language.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const percent=value=>Number(value.toFixed(1))+'%';
const row=(rank,name,value,detail='')=>'<div class="record"><div><b>'+escape(rank)+'　'+escape(name)+'</b>'+
  (detail?'<small>'+escape(detail)+'</small>':'')+'</div><span>'+escape(value)+'</span></div>';
const note=message=>'<p class="panel-foot">'+message+'</p>';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function createRankings(redraw){
  const cache=new Map(),pending=new Set(),submitted=new Set();
  let unavailable=false,submitting=false;
  const online=()=>!unavailable&&engagementAvailable('ranking');
  async function load(tab,force=false){
    if(!online()||!activityBoards[tab]||pending.has(tab))return;
    if(!force&&Date.now()-(cache.get(tab)?.at||0)<45000)return;
    pending.add(tab);
    try{
      for(let attempt=0;;attempt++){
        try{
          const {rows,mine}=await publicRanks(activityBoards[tab]);
          if(!Array.isArray(rows)||!mine)throw Error('Invalid board');
          cache.set(tab,{at:Date.now(),rows,mine});break;
        }catch(e){
          if(e?.errCode!==2002||attempt>=3)throw e;
          await wait(500*2**attempt);
        }
      }
    }catch(e){
      if([1005,10003,1006].includes(e?.errCode))unavailable=true;
      else cache.set(tab,{at:Date.now(),error:true});
    }finally{pending.delete(tab);redraw();}
  }
  async function submit(tab,progress,activity){
    if(submitting||!online()||!activityBoards[tab])return;
    const {ridden,total}=progress.totals(),score=rankScore(tab,ridden,total,activity.count);
    if(!score)return;
    submitting=true;redraw();
    try{
      await submitRankScore(activityBoards[tab],score);
      submitted.add(tab);cache.delete(tab);await load(tab,true);
    }catch(e){
      if([1005,10003,1006].includes(e?.errCode))unavailable=true;
      else cache.set(tab,{...cache.get(tab),at:Date.now(),submitError:true});
    }finally{submitting=false;redraw();}
  }
  function html(tab,progress,activity){
    const publicMode=online(),kind=!publicMode&&tab==='visits'?'pistes':tab;
    const {ridden,total}=progress.totals(),rate=total?100*ridden/total:0;
    const tabs=[['explore',publicMode?t('探索率榜','Exploration'):t('雪场探索','Exploration')]];
    if(publicMode)tabs.push(['visits',t('滑行次数榜','Piste visits')]);
    tabs.push(['pistes',t('我的雪道占比','My piste shares')]);
    let body=heading('PISTE LOG',publicMode?'雪场排行':'个人雪历',title())+seg('recordTab',tabs,kind);
    if(kind==='pistes'){
      body+=note(t('各雪道滑行次数 ÷ 我的总次数。同一条雪道可重复计入。','Visits to each piste divided by all your visits. Repeat rides count.'));
      return body+(activity.count?activity.pistes.map(({key,count,share},i)=>row(i+1,label(key.split('/')[1]),
        percent(share*100),label(key.startsWith('genting/')?'云顶':'万龙')+' · '+count+t(' 次',' visits'))).join(''):note(t('滑过第一条雪道后，这里会出现你的记录。','Ski a piste to start your log.')));
    }
    if(!publicMode){
      body+=note(t('双雪场已探索 ','Pistes explored ')+ridden+'/'+total+' · '+percent(rate));
      const sides=['wanlong','genting'].map(id=>[id,progress.totals(id)]).sort((a,b)=>b[1].ridden/b[1].total-a[1].ridden/a[1].total);
      return body+sides.map(([id,data],i)=>row(i+1,label(id==='genting'?'云顶':'万龙'),percent(data.total?100*data.ridden/data.total:0),data.ridden+'/'+data.total)).join('')+
        note(t('玩家公开榜可在支持排行榜的小红书小工具中查看。','Player rankings are available in supported Xiaohongshu mini-tools.'));
    }
    const explore=kind==='explore',data=cache.get(kind);
    const local=rankScore(kind,ridden,total,activity.count);
    body+=note(explore?t('按两座雪场已探索的雪道比例排名，每条雪道只计一次。','Ranked by the share of distinct pistes explored across both resorts.'):
      t('按累计滑行次数排名。占比按本榜前 100 名的总次数计算。','Ranked by repeat-inclusive visits. Shares use the total visits of the top 100.'));
    body+=note((explore?t('我的探索率 ','My exploration ')+percent(rate):t('我的滑行 ','My visits ')+activity.count+t(' 次','')));
    const mine=data?.mine;
    const validMine=mine?.status==='EXACT'&&rankValue(kind,mine.score)!=null;
    if(validMine||mine?.status==='OVER_LIMIT'&&(submitted.has(kind)||!explore))body+=note(t('我的排名 ','My rank ')+(validMine?'#'+mine.rank:'500+'));
    if(local>0&&(!validMine||local>mine.score)){
      body+='<button class="setting-pill" data-act="rank-submit"'+(submitting?' disabled':'')+'>'+t('用我的进度上榜','Submit my progress')+'</button>';
    }
    if(data?.submitError)body+=note(t('提交未完成，可再次提交。','Submission did not finish. You can retry.'));
    if(data?.error)return body+note(t('暂时无法读取公开榜。','Rankings are currently unavailable.'))+button('rank-retry',t('重试','Retry'),'setting-pill');
    if(!data?.rows)return body+note(t('正在读取公开榜…','Loading rankings…'));
    const rows=data.rows.filter(r=>rankValue(kind,r.score)!=null);
    const sum=explore?0:rows.reduce((n,r)=>n+r.score,0);
    return body+(rows.length?rows.map(r=>row('#'+r.rank,r.nickname||t('滑雪者','Skier'),explore?percent(rankValue(kind,r.score)):r.score+t(' 次',' visits'),
      explore?'':t('榜内占比 ','Top 100 share ')+percent(100*r.score/sum))).join(''):note(t('还没有玩家上榜。','No ranked skiers yet.')));
  }
  const title=()=>online()?t('雪场排行榜','Mountain rankings'):t('我的雪道记录','My piste log');
  return {load,submit,html,title};
}
