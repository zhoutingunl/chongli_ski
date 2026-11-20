import {clamp, SkiRoute} from './mountain.js';

const navigators = new WeakMap();
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const bearing = (a, b) => Math.atan2(b[0] - a[0], a[1] - b[1]);
const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const pair = p => [p.x, p.z];
const pointKey = p => p.join(',');
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];

const mouths = {
  long:   {routeId:'wanlong-long',   name:'长龙道', en:'Long Dragon', difficulty:'intermediate'},
  gold:   {routeId:'wanlong-gold',   name:'金龙道', en:'Golden Dragon', difficulty:'advanced'},
  silver: {routeId:'wanlong-silver', name:'银龙道', en:'Silver Dragon', difficulty:'advanced'},
  peony:  {routeId:'genting-classic',name:'芍药花', en:'Peony', difficulty:'intermediate'},
  datura: {routeId:'genting-valley', name:'曼陀罗', en:'Datura', difficulty:'intermediate'}
};
const forks = [
  {id:'wanlong-jade-fork', resort:'wanlong', reference:'wanlong-classic', afterLeg:0, options:[
    {routeId:'wanlong-classic',name:'玉龙道',en:'Jade Dragon',difficulty:'intermediate'},
    {...mouths.long, name:'长龙道 · 卧龙道',en:'Long Dragon · Sleeping Dragon'},
    {routeId:'wanlong-to-genting',name:'山丹丹 · 至云顶',en:'Lily · to Genting',difficulty:'intermediate'}
  ]},
  {id:'genting-aster-fork',resort:'genting',reference:'genting-to-wanlong',afterLeg:0,options:[
    {routeId:'genting-to-wanlong',name:'翠菊花 · 至万龙',en:'Aster · to Wanlong',difficulty:'easy'},
    {...mouths.peony, name:'芍药花 · 雪绒花',en:'Peony · Edelweiss'}
  ]}
];
const entryOf = id => ({'wanlong-classic':'long','wanlong-long':'long','wanlong-to-genting':'long',
  'wanlong-gold':'gold','wanlong-silver':'silver','genting-classic':'peony',
  'genting-to-wanlong':'peony','genting-valley':'datura'})[id];

// Open snow between the measured piste mouths is not a named trail. The short
// interpolated apron lines pass outside terminal and building footprints. The
// longer ridge links use OSM way 582002975 (Wanlong footpath), 259702568
// (Flying Dragon) and 1558228879 (the track west of Genting's Jinhua Pavilion).
function summitLinks(data) {
  const flying = data.trails.find(t => t.id === 'w259702568').points;
  const [a,b] = flying;
  return {
    silver:{via:[[a[0]+(b[0]-a[0])*.49,a[1]+(b[1]-a[1])*.49],b],join:0},
    gold:{via:[[-287,-60],[-277,-54],[-248,-52.5]],join:0},
    long:{via:[[-281,-43],[-268,-33],[-262.7,-18],[-224.7,-3.2]],join:0},
    peony:{via:[[593,337],[576.8,322.2],[557,280.3],[511,285.8],[502.3,281.1],[491.3,207.4]],join:0},
    // The 1-lift unloading apron lies east of Datura's first surveyed node.
    // Join its forward reach instead of doubling back through the terminal.
    datura:{via:[],join:2}
  };
}

function project(p, a, b) {
  const dx=b[0]-a[0], dz=b[1]-a[1], len=dx*dx+dz*dz;
  const t=len?clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dz)/len,0,1):0;
  const q=[a[0]+t*dx,a[1]+t*dz];
  return {t, point:q, distance:distance(p,q)};
}

function append(points, p) {
  if (!points.length || distance(points.at(-1),p) > .006) points.push(p);
  return points.length-1;
}

function appendLeg(legs, id, from, to) {
  if (!id || to<=from) return;
  const last=legs.at(-1);
  if(last?.trailId===id && last.endIndex===from) last.endIndex=to;
  else legs.push({trailId:id,startIndex:from,endIndex:to});
}

function appendSlice(points,legs,raw,first,last=raw.points.length-1) {
  const start=append(points,raw.points[first]);
  for(let i=first+1;i<=last;i++) append(points,raw.points[i]);
  for(const leg of raw.legs||[]) {
    const a=Math.max(first,leg.startIndex),b=Math.min(last,leg.endIndex);
    appendLeg(legs,leg.trailId,start+a-first,start+b-first);
  }
}

function ringContains(p,ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
const orientation=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
function segmentHits(a,b,ring){
  if(ringContains(a,ring)||ringContains(b,ring))return true;
  for(let i=0;i<ring.length;i++){
    const c=ring[i],d=ring[(i+1)%ring.length];
    if(orientation(a,b,c)*orientation(a,b,d)<0 && orientation(c,d,a)*orientation(c,d,b)<0)return true;
  }
  return false;
}

function terminalRing(lift,end){
  const p=end?lift.points.at(-1):lift.points[0],next=end?lift.points.at(-2):lift.points[1];
  const length=distance(p,next),dx=(next[0]-p[0])/length,dz=(next[1]-p[1])/length;
  // Include the platform steps and space for a carved turn around its corner.
  return [[-10,-15],[10,-15],[10,15],[-10,15]].map(([s,f])=>[p[0]-dz*s+dx*f,p[1]+dx*s+dz*f]);
}

function structure(ring) {
  const xs=ring.map(p=>p[0]),zs=ring.map(p=>p[1]);
  return {ring,left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...zs),bottom:Math.max(...zs)};
}

// Only station-to-piste links need this small visibility graph. Fixed ski tracks
// retain every surveyed vertex. A 2 m buffer leaves room to skate past each corner.
function clearConnector(start,end,structures) {
  if(distance(start,end)<.01)return [start];
  const close=structures.filter(r=>r.right>=Math.min(start[0],end[0])-35&&r.left<=Math.max(start[0],end[0])+35&&
    r.bottom>=Math.min(start[1],end[1])-35&&r.top<=Math.max(start[1],end[1])+35);
  // Older saved station poses can land in an adjacent terminal. Let the first
  // segment skate out through its nearest edge without moving its starting foot.
  const clear=(a,b)=>!close.some(ob=>{
    if(a===start&&ringContains(start,ob.ring)&&!ringContains(b,ob.ring))return false;
    return segmentHits(a,b,ob.ring);
  });
  if(clear(start,end))return [start,end];
  const nodes=[start,end];
  for(const {ring} of close){
    const cx=ring.reduce((v,p)=>v+p[0],0)/ring.length,cz=ring.reduce((v,p)=>v+p[1],0)/ring.length;
    for(const p of ring){
      const len=Math.hypot(p[0]-cx,p[1]-cz)||1;
      const q=[p[0]+(p[0]-cx)*3/len,p[1]+(p[1]-cz)*3/len];
      if(!close.some(ob=>ringContains(q,ob.ring)))nodes.push(q);
    }
  }
  const cost=nodes.map(()=>Infinity),prev=nodes.map(()=>-1),seen=new Set();cost[0]=0;
  while(true){
    let next=-1;
    for(let i=0;i<nodes.length;i++)if(!seen.has(i)&&Number.isFinite(cost[i])&&(next<0||cost[i]<cost[next]))next=i;
    if(next<0)return null;
    if(next===1)break;
    seen.add(next);
    for(let i=1;i<nodes.length;i++){
      const score=cost[next]+distance(nodes[next],nodes[i]);
      if(!seen.has(i)&&score<cost[i]&&clear(nodes[next],nodes[i])){cost[i]=score;prev[i]=next;}
    }
  }
  const points=[];for(let i=1;i!==-1;i=prev[i])points.unshift(nodes[i]);return points;
}

function makeRoute(template,points,legs,data,approach=null) {
  const id=template.originalId||template.id;
  const route=new SkiRoute({id,originalId:id,name:template.name,resort:template.resort,destination:template.destination,
    difficulty:template.difficulty,points,legs,trailIds:[...new Set(legs.map(l=>l.trailId))],approach},data);
  route.distance=Math.round(route.length);route.drop=Math.round(route.startHeight-route.endHeight);
  return route;
}

function stopOutsideTerminal(route,structures,data) {
  if(!route)return null;
  const end=route.points.at(-1);
  const local=structures.filter(o=>o.left<=end[0]+28&&o.right>=end[0]-28&&o.top<=end[1]+28&&o.bottom>=end[1]-28);
  const blocked=p=>local.some(o=>ringContains(p,o.ring));
  if(!blocked(end))return route;
  let along=route.length;
  while(along>0&&blocked(pair(route.at(along))))along=Math.max(0,along-1);
  // Surveyed piste geometry may end at the lift node itself. Let the rider
  // finish on the snow front, just outside the machinery and queue entrance.
  along=Math.max(0,along-3);
  if(along<1.5)return route;
  const q=route.at(along),points=route.points.slice(0,q.index+1);
  append(points,[q.x,q.z]);
  const legs=[];
  for(const l of route.legs)appendLeg(legs,l.trailId,l.startIndex,Math.min(l.endIndex,points.length-1));
  const approach=route.approach?{...route.approach,endDistance:Math.min(route.approach.endDistance,along)}:null;
  return makeRoute(route,points,legs,data,approach);
}

function pushInDirection(route,heading,data,structures) {
  if(!route)return null;
  const foot=route.points[0],next=route.points[1],length=distance(foot,next);
  const course=bearing(foot,next),turn=angleDiff(heading,course);
  if(length<6||Math.abs(turn)<.065)return route;
  const span=Math.min(18,length*.78),dx=Math.sin(heading),dz=-Math.cos(heading);
  const fx=Math.sin(course),fz=-Math.cos(course);
  const land=[foot[0]+span*fx,foot[1]+span*fz];
  // An eye-relative push gets its own short, curved skate on the same apron.
  // Beyond that arc every point, including a shared entry, is the original line.
  for(const side of [1,-1]){
    const stride=Math.min(1.45,span*.14),bow=Math.max(0,Math.abs(turn)-2.1)*2.2*side;
    const a=[foot[0]+dx*stride,foot[1]+dz*stride],b=[a[0]+dx*span*.37,a[1]+dz*span*.37];
    const c=[land[0]-fx*span*.36-fz*bow,land[1]-fz*span*.36+fx*bow];
    const pts=[foot,a];
    for(const t of [.18,.38,.6,.81,1]){
      const u=1-t;pts.push([0,1].map(i=>u**3*a[i]+3*u*u*t*b[i]+3*u*t*t*c[i]+t**3*land[i]));
    }
    if(pts.slice(1).some((p,i)=>clearConnector(pts[i],p,structures)?.length!==2))continue;
    const shift=pts.length-1;
    const legs=route.legs.map(l=>({...l,startIndex:l.startIndex?l.startIndex+shift:0,endIndex:l.endIndex+shift}));
    const out=makeRoute(route,[...pts,...route.points.slice(1)],legs,data);
    if(route.approach)out.approach={...route.approach,endDistance:Math.max(0,route.approach.endDistance+out.length-route.length)};
    return out;
  }
  return route;
}

function summitRoute(data,raw,links,foot,structures) {
  const key=entryOf(raw.id),link=links[key];
  const targets=[...link.via, raw.points[link.join]];
  const first=clearConnector(foot,targets[0],structures);
  if(!first)return null;
  const points=[...first],legs=[];
  for(const p of targets.slice(1))append(points,p);
  const entryIndex=points.length-1;
  if(key==='silver')appendLeg(legs,'w259702568',first.length-1,entryIndex);
  appendSlice(points,legs,raw,link.join);
  const route=makeRoute(raw,points,legs,data);
  route.approach={kind:'summit',name:'山顶连接区',en:'Summit apron',target:mouths[key].name,targetEn:mouths[key].en,
    endDistance:route.distances[key==='silver'?first.length-1:entryIndex]};
  return route;
}

function optionOnRoute(option,route,anchor,along,reach=35) {
  const p=pair(route.at(Math.min(route.length,along+reach)));
  return {...option,heading:bearing(anchor,p),position:p};
}

function signPosition(f,width,side) {return [f.x-f.dz*side*width,f.z+f.dx*side*width];}

function makeSigns(data,byId,links,structures) {
  const signs=[];
  for(const side of ['wanlong','genting']) {
    const place=data.summitPlaces[side],foot=place.position;
    const entries=side==='wanlong'?['silver','gold','long']:['peony','datura'];
    const options=entries.map(key=>{
      const opt=mouths[key],r=summitRoute(data,byId.get(opt.routeId),links,foot,structures);
      return optionOnRoute(opt,r,foot,0,13);
    });
    const [x,z]=side==='wanlong'?[-306.5,-42.3]:[611,358.2];
    signs.push({id:side+'-summit',type:'summit',resort:side,x,z,approach:place.heading,junctionPosition:foot,upstreamPosition:foot,options});
  }
  for(const def of forks){
    const r=byId.get(def.reference),i=r.legs[def.afterLeg].endIndex,p=r.points[i],s=r.distances[i];
    const f=r.frame(s-12),[x,z]=signPosition(f,Math.min(12,(data.index?.near(f.x,f.z).trail?.width||30)*.42),-1);
    const options=def.options.map(opt=>{const o=byId.get(opt.routeId),j=o.points.findIndex(v=>samePoint(v,p));return optionOnRoute(opt,o,p,o.distances[j]);});
    signs.push({id:def.id,type:'junction',resort:def.resort,x,z,approach:bearing(pair(r.at(s-42)),p),
      junctionPosition:p,upstreamPosition:pair(r.at(s-48)),sourceRouteId:r.id,along:s,options});
  }
  for(const [key,opt] of Object.entries(mouths)){
    const r=byId.get(opt.routeId),s=r.distances[links[key].join]+75,f=r.frame(s),p=[f.x,f.z];
    const width=data.trails.find(t=>t.id===r.legs[0].trailId).width;
    const [x,z]=signPosition(f,width*.42,1);
    signs.push({id:key+'-entry',type:'confirmation',resort:r.resort,x,z,approach:f.angle,
      junctionPosition:p,sourceRouteId:r.id,along:s,options:[optionOnRoute(opt,r,p,s)]});
  }
  return signs;
}

// OSM ways share exact node coordinates. The graph also covers satellite lift
// areas that are outside the eight preselected itineraries on the paper map.
function trailGraph(data) {
  const graph=new Map();
  const node=p=>{const k=pointKey(p);if(!graph.has(k))graph.set(k,{p,edges:[]});return graph.get(k);};
  for(const trail of data.trails){
    for(let i=1;i<trail.points.length;i++){
      const a=node(trail.points[i-1]),b=node(trail.points[i]);
      a.edges.push({to:b,trail,length:distance(a.p,b.p)});
    }
  }
  return graph;
}

function traverseToBase(start,graph,goals,height) {
  const source=graph.get(pointKey(start));
  if(!source)return [];
  const cost=new Map([[source,0]]),previous=new Map(),queue=[source];
  for(let i=0;i<queue.length;i++){
    const n=queue[i];
    for(const edge of n.edges){
      const c=cost.get(n)+edge.length;
      if(c>=(cost.get(edge.to)??Infinity))continue;
      cost.set(edge.to,c);previous.set(edge.to,{from:n,trail:edge.trail});queue.push(edge.to);
    }
  }
  let best=null,score=Infinity;
  for(const [n,length] of cost){
    if(!goals.has(pointKey(n.p)))continue;
    if(length<score){best=n;score=length;}
  }
  if(!best){
    for(const n of cost.keys()){
      if(n.edges.length)continue;
      const h=height(...n.p);
      if(h<score){best=n;score=h;}
    }
  }
  const path=[];
  for(let n=best;n&&n!==source;){
    const incoming=previous.get(n);if(!incoming)break;
    path.unshift({point:n.p,trail:incoming.trail});n=incoming.from;
  }
  return path;
}

function nearestSegments(foot,trails,side) {
  const result=[];
  for(const trail of trails){
    if(trail.resort!==side&&trail.resort!=='link')continue;
    let best=null;
    for(let i=1;i<trail.points.length;i++){
      const q=project(foot,trail.points[i-1],trail.points[i]);
      if(!best||q.distance<best.distance)best={...q,trail,end:i};
    }
    if(best)result.push(best);
  }
  return result.sort((a,b)=>a.distance-b.distance);
}

function projectedEntry(foot,hit,structures){
  const {trail,end}=hit,first=hit.point;
  const forbidden=p=>structures.some(ob=>ob.left<=p[0]&&ob.right>=p[0]&&ob.top<=p[1]&&ob.bottom>=p[1]&&ringContains(p,ob.ring));
  const clearDownhill=(p,idx)=>{
    let remain=42,a=p;
    for(let k=idx;k<trail.points.length&&remain>0;k++){
      const b=trail.points[k],len=distance(a,b);if(len<.01)continue;
      const t=Math.min(1,remain/len),end=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
      if(structures.some(o=>o.right>=Math.min(a[0],end[0])&&o.left<=Math.max(a[0],end[0])&&
        o.bottom>=Math.min(a[1],end[1])&&o.top<=Math.max(a[1],end[1])&&segmentHits(a,end,o.ring)))return false;
      a=b;remain-=len;
    }
    return true;
  };
  let at=first;
  // A measured centerline sometimes starts at the surveyed center of a lift
  // terminal. Join outside its roof, in the direction of normal piste travel.
  for(let i=end;i<trail.points.length;i++){
    const b=trail.points[i],len=distance(at,b),steps=Math.max(1,Math.ceil(len/3));
    for(let n=0;n<=steps;n++){
      const t=n/steps,p=[at[0]+(b[0]-at[0])*t,at[1]+(b[1]-at[1])*t];
      if(distance(first,p)>62)return null;
      if(forbidden(p)||!clearDownhill(p,i))continue;
      const from=clearConnector(foot,p,structures);
      if(from)return {from,end:i};
    }
    at=b;
  }
  return null;
}

function selectLocalRoute(data,byId,graph,goals,structures,side,foot,heading,preferred) {
  const hits=nearestSegments(foot,data.trails,side),limit=(hits[0]?.distance??0)+36;
  const candidates=[];
  for(const hit of hits){
    if(hit.distance>limit)break;
    const entry=projectedEntry(foot,hit,structures);if(!entry)continue;
    const {trail}=hit,to=trail.points[entry.end],join=entry.from.at(-1);
    const first=entry.from.find(p=>distance(foot,p)>1)||to;
    const direction=bearing(foot,first);
    const miles=entry.from.reduce((sum,p,i,arr)=>i?sum+distance(p,arr[i-1]):0,0);
    const score=miles+Math.abs(angleDiff(heading,direction))*7;
    const templates=[];
    for(const r of byId.values()){
      if(r.resort!==side)continue;
      const idx=r.points.findIndex((p,i)=>i>0&&samePoint(p,to)&&samePoint(r.points[i-1],trail.points[entry.end-1]));
      if(idx<=0)continue;
      if(!r.legs.some(l=>l.trailId===trail.id&&l.startIndex<idx&&l.endIndex>=idx))continue;
      templates.push({r,idx});
    }
    const match=templates.find(o=>o.r.id===preferred)||templates.find(o=>o.r.id===side+'-classic')||templates[0];
    if(distance(foot,join)<1 && match && match.r.length-match.r.distances[match.idx]<2 && distance(join,to)<2)continue;
    candidates.push({hit,entry,match,score:score-(match?4:0)-(match?.r.id===preferred?7:0)});
  }
  candidates.sort((a,b)=>a.score-b.score);
  for(const {hit,entry,match} of candidates){
    const {trail}=hit,points=[...entry.from],legs=[],entryIndex=points.length-1;
    const next=append(points,trail.points[entry.end]);appendLeg(legs,trail.id,entryIndex,next);
    let template=match?.r;
    if(match){
      appendSlice(points,legs,template,match.idx);
    }else{
      const path=traverseToBase(trail.points[entry.end],graph,goals[side],data.height);
      for(const step of path){const a=points.length-1,b=append(points,step.point);appendLeg(legs,step.trail.id,a,b);}
      template={id:side+'-'+trail.id,name:trail.name,resort:side,destination:side,difficulty:trail.difficulty};
    }
    if(points.length<2)continue;
    const r=makeRoute(template,points,legs,data);
    if(r.length<2)continue;
    r.approach={kind:'lift',name:'索道连接区',en:'Lift apron',target:trail.name,targetEn:trail.name,endDistance:r.distances[entryIndex]};
    return r;
  }
  return null;
}

export function createSkiNavigation(data) {
  if(navigators.has(data))return navigators.get(data);
  const byId=new Map(data.routes.map(r=>[r.id,r instanceof SkiRoute?r:new SkiRoute(r,data)]));
  const structures=[...data.buildings.map(b=>structure(b.footprint)),...data.lifts.flatMap(l=>[0,1].map(end=>structure(terminalRing(l,end))))];
  const links=summitLinks(data),signs=makeSigns(data,byId,links,structures),junctions=signs.filter(s=>s.type==='junction');
  const graph=trailGraph(data),goals={wanlong:new Set(),genting:new Set()};
  for(const r of byId.values())goals[r.destination].add(pointKey(r.points.at(-1)));
  // The west Wanlong and southern Genting lift bases have their own snow fronts.
  for(const trailId of ['w483990519','w1280793047','w771168520']){
    const t=data.trails.find(v=>v.id===trailId);if(t)goals[t.resort].add(pointKey(t.points.at(-1)));
  }
  const junctionCache=new WeakMap();
  const gates=new Map();
  for(const [key,opt] of Object.entries(mouths)){
    const route=byId.get(opt.routeId);gates.set(route.legs[0].trailId,{key,route,opt});
  }
  function captureGate(planned,history,foot,travelHeading){
    const near=data.index.near(...foot),gate=gates.get(near.trail?.id);
    if(!gate||gate.route.resort!==planned.resort||entryOf(planned.id)===gate.key||near.distance>near.trail.width*.35)return null;
    const raw=gate.route,q=raw.closest(...foot),f=raw.frame(q.along);
    // A free skier can traverse the top apron after pushing off. Recognize the
    // new mouth only inside its mapped corridor and travelling down the piste.
    if(q.along<2 || q.along>205 || Math.abs(angleDiff(travelHeading,f.angle))>.66)return null;
    const at=raw.at(q.along+15),join=[at.x,at.z];
    const connector=clearConnector(foot,join,structures);if(!connector)return null;
    const points=[...history],legs=[],here=append(points,foot);
    for(const p of connector.slice(1))append(points,p);
    append(points,raw.points[at.index+1]);appendLeg(legs,near.trail.id,here,points.length-1);
    appendSlice(points,legs,raw,at.index+1);
    const r=stopOutsideTerminal(makeRoute(raw,points,legs,data),structures,data);
    r.approach={kind:'summit',name:'山顶连接区',en:'Summit apron',target:gate.opt.name,targetEn:gate.opt.en,endDistance:r.distances[here]};
    return {route:r,along:r.distances[here]};
  }
  function stationsOn(route){
    if(junctionCache.has(route))return junctionCache.get(route);
    const stations=[];
    for(const sign of junctions){
      const index=route.points.findIndex((p,i)=>i>0&&i<route.points.length-1&&samePoint(p,sign.junctionPosition));
      if(index<0)continue;
      const forward=route.points[index+1];
      const current=sign.options.find(o=>{
        const alt=byId.get(o.routeId),i=alt.points.findIndex(p=>samePoint(p,sign.junctionPosition));
        return i>=0&&samePoint(forward,alt.points[i+1]);
      });
      if(current)stations.push({sign,index,along:route.distances[index],current});
    }
    stations.sort((a,b)=>a.along-b.along);junctionCache.set(route,stations);return stations;
  }
  function changeBranch(route,station,routeId){
    if(station.current.routeId===routeId)return route;
    const template=byId.get(routeId),p=station.sign.junctionPosition;
    if(!template||!station.sign.options.some(o=>o.routeId===routeId))return null;
    const idx=template.points.findIndex(v=>samePoint(v,p));if(idx<0)return null;
    const points=[],legs=[];
    appendSlice(points,legs,route,0,station.index);appendSlice(points,legs,template,idx);
    const out=makeRoute({...template,resort:route.resort},points,legs,data,route.approach);
    return stopOutsideTerminal(out,structures,data);
  }
  function departure(side,x,z,heading,preferred){
    const foot=[x,z],place=data.summitPlaces[side];
    if(!place||!Number.isFinite(x)||!Number.isFinite(z))return null;
    if(!Number.isFinite(heading))heading=place.heading;
    if(distance(foot,place.position)>6){
      const local=selectLocalRoute(data,byId,graph,goals,structures,side,foot,heading,preferred);
      return stopOutsideTerminal(pushInDirection(local,heading,data,structures),structures,data);
    }
    const sign=signs.find(s=>s.type==='summit'&&s.resort===side);
    const key=entryOf(preferred),preferredMouth=mouths[key];
    const ranked=sign.options.map(o=>({o,error:Math.abs(angleDiff(heading,o.heading))})).sort((a,b)=>a.error-b.error);
    // Three virtual itineraries have precisely the same Long Dragon mouth.
    // A paper-map intention only breaks ties there or within a small sight cone.
    const favored=preferredMouth&&ranked.find(c=>c.o.routeId===preferredMouth.routeId&&c.error<=ranked[0].error+.10);
    const id=favored?preferred:ranked[0].o.routeId;
    const route=pushInDirection(summitRoute(data,byId.get(id),links,foot,structures),heading,data,structures);
    return stopOutsideTerminal(route,structures,data);
  }
  function summitHeading(side,routeId){
    const route=byId.get(routeId),entry=mouths[entryOf(routeId)];
    if(!entry||route?.resort!==side)return null;
    return signs.find(s=>s.type==='summit'&&s.resort===side).options.find(o=>o.routeId===entry.routeId)?.heading??null;
  }
  function stationExit(lift,end){
    const high=end==='top',p=high?lift.points.at(-1):lift.points[0],q=high?lift.points.at(-2):lift.points[1];
    const len=distance(p,q),ax=(q[0]-p[0])/len,az=(q[1]-p[1])/len;
    for(const side of [14,-14,19,-19,23,-23])for(const forward of [6,0,-7,13]){
      const foot=[p[0]+az*side+ax*forward,p[1]-ax*side+az*forward];
      if(!structures.some(ob=>ob.left-1<foot[0]&&ob.right+1>foot[0]&&ob.top-1<foot[1]&&ob.bottom+1>foot[1]&&ringContains(foot,ob.ring)) && !data.obstacles?.contact(...foot))return foot;
    }
    return [p[0]+az*24,p[1]-ax*24];
  }
  const nav={signs,stationsOn,changeBranch,departure,summitHeading,stationExit,captureGate,canonical:id=>byId.get(id)};
  navigators.set(data,nav);return nav;
}

export const getSkiSigns=data=>createSkiNavigation(data).signs;
