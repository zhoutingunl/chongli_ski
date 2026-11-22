export const pisteVisitKey=trail=>trail?.resort&&trail.name?trail.resort+'/'+trail.name.trim():null;

export function createPisteProgress(data,saved){
  const completed=new Set(Array.isArray(saved)?saved.filter(id=>typeof id==='string'):[]);
  const publicPistes=new Set(),byName=new Map(), byTrail=new Map(), distance=new Map(), sections=new Map();
  for(const entry of data.trailCatalog||[]){
    const key=pisteVisitKey(entry);publicPistes.add(key);
    for(const name of [entry.name,...(entry.aliases||[])])byName.set(entry.resort+'/'+name,key);
    for(const id of entry.trailIds){
      const existing=byTrail.get(id);
      byTrail.set(id,existing===undefined||existing===key?key:null);
    }
  }
  function canonical(key,id){return byName.get(key)||byTrail.get(id)||key?.split(/[（(]/)[0].trim();}
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
    const keys=parts.map(key=>byName.get(key)||key).filter(key=>distance.has(key));
    if(keys.length===parts.length)routeKeys.set(route.id,keys);
  }
  return {
    sections,completed,
    observe(visits){
      let changed=false;
      const ridden=new Map();
      for(const {key,id,metres} of visits.values()){
        const name=canonical(key,id);
        ridden.set(name,(ridden.get(name)||0)+metres);
      }
      for(const [name,metres] of ridden){
        const length=distance.get(name);
        if(!length||completed.has(name)||metres<Math.min(55,Math.max(12,length*.24)))continue;
        completed.add(name);changed=true;
      }
      return changed;
    },
    visited(route){return routeKeys.get(route.id)?.every(key=>completed.has(key))||false;},
    totals(side){
      let ridden=0,total=0;
      for(const key of publicPistes)if(key.startsWith(side+'/')&&distance.has(key)){
        total++;if(completed.has(key))ridden++;
      }
      return {ridden,total};
    }
  };
}
