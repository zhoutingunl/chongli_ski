import {label} from './language.js';

export const mapSortFields=['name','length','drop','visited'];
export const defaultMapSort={by:'visited',descending:false};

export function changeMapSort(current,by){
  if(!mapSortFields.includes(by))return current;
  return {by,descending:by===current.by&&!current.descending};
}

export function sortedMapRoutes(routes,progress,order,language){
  const collator=new Intl.Collator(language==='en'?'en':'zh-CN',{numeric:true});
  const rows=routes.map(route=>{
    const name=label(route.name,language),{ridden,total}=progress.forRoute(route);
    const value=order.by==='drop'?route.pisteDrop:order.by==='length'?(route.pisteDistance??route.length):
      total?ridden/total:0;
    return {route,name,value};
  });
  const direction=order.descending?-1:1;
  rows.sort((a,b)=>{
    const names=collator.compare(a.name,b.name);
    return (order.by==='name'?names:a.value-b.value)*direction||names||a.route.id.localeCompare(b.route.id);
  });
  return rows.map(row=>row.route);
}

// An explicit tap during a descent always offers the physical start. A join
// or resume stays available separately, even when the routes share a runout.
export function mapTravelActions(screen,selected,route,sim,summitExit){
  if(screen==='summit')return [selected?(summitExit?'summit':'trailhead'):'choose'];
  if(screen!=='run')return ['trailhead'];
  if(!selected)return ['resume'];
  if(route.id===sim.route.id)return ['trailhead','resume'];
  if(sim.junctionFor(route.id))return ['trailhead','junction'];
  if(route.closest(sim.x,sim.z).distance<=64)return ['trailhead','join'];
  return ['trailhead'];
}
