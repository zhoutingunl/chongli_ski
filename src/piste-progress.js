export const pisteVisitKey=trail=>trail?.resort&&trail.name?trail.resort+'/'+trail.name.trim():null;

export function pisteNames(catalog=[]) {
  const byName=new Map(), byTrail=new Map();
  for(const entry of catalog){
    const key=pisteVisitKey(entry);
    for(const name of [entry.name,...(entry.aliases||[])])byName.set(entry.resort+'/'+name,key);
    if(entry.kind==='connector'){
      for(const side of ['link','wanlong','genting']){
        byName.set(side+'/'+entry.name,key);
        byName.set(side+'/'+entry.name+'联滑线',key);
      }
    }
    for(const id of entry.trailIds){
      const existing=byTrail.get(id);
      byTrail.set(id,existing===undefined||existing===key?key:null);
    }
  }
  return (key,id)=>{
    const bare=key?.split(/[（(]/)[0].trim();
    return byName.get(key)||byTrail.get(id)||byName.get(bare)||bare;
  };
}

export function readPisteMarks(value){
  const list=Array.isArray(value)?value:value?.pistes;
  return {pistes:Array.isArray(list)?list.filter(key=>typeof key==='string'&&key.includes('/')):[],
    pistesResetAt:Number.isSafeInteger(value?.pistesResetAt)&&value.pistesResetAt>0?value.pistesResetAt:0};
}

export function createPisteProgress(data,saved){
  const publicPistes=new Set((data.trailCatalog||[]).map(pisteVisitKey)), distance=new Map(), sections=new Map();
  const canonical=pisteNames(data.trailCatalog);
  const initial=readPisteMarks(saved),completed=new Set(initial.pistes.map(key=>canonical(key)));
  let resetAt=initial.pistesResetAt;
  for(const trail of data.trails){
    const groups=[];
    for(let i=0;i<trail.points.length-1;i++){
      const key=canonical(pisteVisitKey(data.snowSection(trail,i)),trail.id);
      if(!key)continue;
      const [a,b]=[trail.points[i],trail.points[i+1]];
      distance.set(key,(distance.get(key)||0)+Math.hypot(b[0]-a[0],b[1]-a[1]));
      const prev=groups.at(-1);
      if(prev?.key===key&&prev.end===i)prev.end=i+1;
      else groups.push({key,start:i,end:i+1});
    }
    sections.set(trail.id,groups);
  }
  const routeKeys=new Map();
  for(const route of data.allRoutes){
    const side=route.catalogResort||route.resort;
    const parts=route.name.split(/\s*·\s*/).map(name=>side+'/'+name);
    const keys=parts.map(key=>canonical(key)).filter(key=>distance.has(key));
    if(keys.length===parts.length)routeKeys.set(route.id,keys);
  }
  function markPass(key,metres){
    const length=distance.get(key);
    if(!length||completed.has(key)||metres<Math.min(55,Math.max(12,length*.24)))return false;
    completed.add(key);return true;
  }
  const cursors=new WeakMap();
  return {
    sections,completed,publicPistes,
    snapshot(){return {pistes:[...completed].sort(),pistesResetAt:resetAt};},
    clear(now=Date.now()){
      const previous=[...completed];completed.clear();resetAt=Math.max(resetAt+1,now);
      return {pistes:previous,pistesResetAt:resetAt};
    },
    merge(value){
      const {pistes,pistesResetAt}=readPisteMarks(value);
      if(pistesResetAt<resetAt)return;
      if(pistesResetAt>resetAt){completed.clear();resetAt=pistesResetAt;}
      for(const key of pistes)completed.add(canonical(key));
    },
    status(side,option){
      const name=option.name?.split(/\s*·\s*/)[0].trim();
      const key=canonical(side+'/'+name,option.trailId);
      return distance.has(key)?(completed.has(key)?'visited':'new'):null;
    },
    finishDiscoveries(splits){
      if(!splits)return [];
      const first=cursors.get(splits)||0,ends=splits.completed;
      if(first===ends.length)return [];
      const additions=[];
      for(let i=first;i<ends.length;i++){
        const segment=ends[i],key=canonical(segment.key);
        // Splits have already debounced both touching a crossing piste and
        // leaving it. Accept a short surveyed piste as soon as its exit closes.
        if(markPass(key,segment.distance))additions.push(key);
      }
      cursors.set(splits,ends.length);return additions;
    },
    observe(visits){
      const ridden=new Map();
      for(const {key,id,metres} of visits.values()){
        const name=canonical(key,id);ridden.set(name,(ridden.get(name)||0)+metres);
      }
      let changed=false;
      for(const [key,metres] of ridden)if(markPass(key,metres))changed=true;
      return changed;
    },
    forRoute(route){
      const keys=routeKeys.get(route.id)||[];
      return {ridden:keys.filter(key=>completed.has(key)).length,total:keys.length};
    },
    totals(side){
      let ridden=0,total=0;
      for(const key of publicPistes)if((!side||key.startsWith(side+'/'))&&distance.has(key)){
        total++;if(completed.has(key))ridden++;
      }
      return {ridden,total};
    }
  };
}
