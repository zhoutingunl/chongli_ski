import {readPisteMarks} from './piste-progress.js';

// Only finished descents and distinct explored pistes were saved before 1.17.
// Keep their original IDs so two devices restoring the same history count it once.
const names = list => Array.isArray(list) ? list.filter(key=>typeof key==='string' && key.includes('/')) : [];
const counterMap = () => Object.create(null);
const number = value => Number.isFinite(value) && value > 0 ? value : 0;

function mergeCounters(output,input){
  for(const [key,value] of Object.entries(input||{})){
    if(number(value))output[key]=Math.max(output[key]||0,value);
  }
}

export function mergeSkiProgress(local,remote=[]){
  const pistes=new Set(),known=new Set(),records=new Map();
  const legacyDistances=counterMap(),devices=counterMap();
  let pistesResetAt=0;
  for(const snapshot of [local,...remote]){
    if(!snapshot||typeof snapshot!=='object')continue;
    const activity=snapshot.activity;
    const marks=readPisteMarks(snapshot);
    if(marks.pistesResetAt>pistesResetAt){pistes.clear();pistesResetAt=marks.pistesResetAt;}
    if(marks.pistesResetAt===pistesResetAt)for(const key of marks.pistes)pistes.add(key);
    for(const key of names(activity ? activity.known : snapshot.pistes))known.add(key);
    mergeCounters(legacyDistances,activity?.legacyDistances);
    for(const [id,part] of Object.entries(activity?.devices||{})){
      if(!part)continue;
      const writer=devices[id]??={metres:0,visits:counterMap()};
      writer.metres=Math.max(writer.metres,number(part.metres));
      mergeCounters(writer.visits,part.visits);
    }
    for(const run of Array.isArray(snapshot.records)?snapshot.records:[]){
      if(typeof run?.routeId!=='string'||typeof run.when!=='string')continue;
      const id=run.sessionId||run.routeId+'/'+run.when,previous=records.get(id);
      if(!previous||number(run.dist)>=number(previous.dist))records.set(id,run);
      if(!run.activityTracked)legacyDistances[id]=Math.max(legacyDistances[id]||0,Math.round(number(run.dist)));
    }
  }
  return {pistes:[...pistes].sort(),pistesResetAt,records:[...records.values()].sort((a,b)=>a.when.localeCompare(b.when)).slice(-100),
    activity:{known:[...known].sort(),legacyDistances,devices}};
}

export class ActivityMeter {
  source=null;
  metres=0;
  passages=0;
  // HUD updates, arriving, boarding and closing the page can report the same ride.
  // Credit the difference from its last checkpoint. Base traverses retain the source.
  sample(activity,writer,sim,force=false){
    if(!sim?.splits)return false;
    if(this.source!==sim.splits){
      this.source=sim.splits;this.metres=0;this.passages=0;
    }
    const travelled=Math.round(number(sim.travel)),passages=sim.splits.passages;
    const gain=Math.max(0,travelled-this.metres);
    if(passages.length===this.passages && (gain===0 || !force&&gain<50))return false;
    const part=activity.devices[writer]??={metres:0,visits:counterMap()};
    part.metres+=gain;
    for(const key of passages.slice(this.passages))part.visits[key]=(part.visits[key]||0)+1;
    this.metres=travelled;this.passages=passages.length;
    return true;
  }
}

export function activityTotals(activity,publicPistes){
  const visits=counterMap();
  for(const key of activity.known)if(publicPistes.has(key))visits[key]=1;
  let metres=Object.values(activity.legacyDistances).reduce((total,d)=>total+d,0);
  for(const part of Object.values(activity.devices)){
    metres+=part.metres;
    for(const [key,count] of Object.entries(part.visits))if(publicPistes.has(key))visits[key]=(visits[key]||0)+count;
  }
  const count=Object.values(visits).reduce((total,n)=>total+n,0);
  const pistes=Object.entries(visits).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([key,n])=>({key,count:n,share:n/count}));
  return {metres,count,pistes};
}

// Four slots previously held millisecond time trials with integer scores <= 999999.
// Reserve the unused final unit of slot 4 for exploration. New scores sort above
// every historical time, and the documented API preserves the submitted fraction.
export const activityBoards={explore:4,visits:5};
export function rankScore(tab,ridden,total,visits){
  if(tab==='visits')return Math.min(1000000,visits);
  return ridden&&total?999999+Math.min(1,ridden/total):0;
}
export function rankValue(tab,score){
  if(!Number.isFinite(score)||score>1000000)return null;
  if(tab==='visits')return score>0&&Number.isInteger(score)?score:null;
  return score>999999?(score-999999)*100:null;
}
