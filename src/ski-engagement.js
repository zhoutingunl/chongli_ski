export const GOLD_ROUTE_ID='wanlong-piste-7';
export function weekStart(now=Date.now()){
  const day=86400000,offset=8*3600000,localDay=Math.floor((now+offset)/day);
  return (localDay-((localDay+3)%7))*day-offset;
}
export function challengeBoard({gear,assist}){
  return (gear==='board'?3:1)+(assist?0:1);
}
export function challengeScore(seconds){
  return 1000000-Math.min(1000000,Math.max(1,Math.round(seconds*1000)));
}

export function mergeSkiProgress(local,remote){
  const snapshots=[local,...remote].filter(v=>v&&typeof v==='object');
  const pistes=new Set(),records=new Map(),weekly=new Map();
  const items=value=>Array.isArray(value)?value:[];
  for(const snapshot of snapshots){
    for(const trail of items(snapshot.pistes))if(typeof trail==='string')pistes.add(trail);
    for(const run of items(snapshot.records))if(typeof run?.routeId==='string'&&typeof run.when==='string')records.set(run.routeId+'/'+run.when,run);
    for(const run of items(snapshot.weekly)){
      if(!Number.isFinite(run?.seconds)||!Number.isFinite(run.week)||!Number.isInteger(run.board)||run.board<1||run.board>4||run.seconds<=0)continue;
      const id=run.week+'/'+run.board;
      if(!weekly.has(id)||run.seconds<weekly.get(id).seconds)weekly.set(id,run);
    }
  }
  return {
    pistes:[...pistes].sort(),
    records:[...records.values()].sort((a,b)=>a.when.localeCompare(b.when)).slice(-100),
    weekly:[...weekly.values()].sort((a,b)=>a.week-b.week).slice(-16)
  };
}
