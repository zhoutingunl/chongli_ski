import {clamp, SkiRoute} from './mountain.js';
import {label} from './language.js';

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
  datura: {routeId:'genting-valley', name:'曼陀罗', en:'Datura', difficulty:'intermediate'},
  felwort:{routeId:'via-w771168509',name:'花锚',en:'Felwort',difficulty:'intermediate',canonicalId:'genting-valley'}
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
  'genting-to-wanlong':'peony','genting-valley':'datura','via-w771168509':'felwort'})[id];

// Directed OSM way slices, in their original node order. Each adjoining pair
// shares the same survey node. A side run ends on the named itinerary below.
// The path compiler also checks that the eight leaderboard itineraries retain
// their own IDs when they share the downhill leg after a detour.
const sideRuns = [
  ['wanlong-classic', [['w259702568',2,-1],['w483990516',6,-1]]], // 飞龙 → 小龙 → 玉龙
  ['wanlong-silver', [['w259702566',0,10],['w483990516',0,1]]],  // 腾龙 → 银龙大奔头
  ['wanlong-classic', [['w483990516',1,-1]]],                    // 小龙 → 玉龙
  ['wanlong-silver', [['w639930437',0,1],['w483990514',0,-1]]],  // 威龙 → 猛龙 → 玉龙
  ['wanlong-long', [['w259700924',0,-1]]],                       // 游龙 → 卧龙
  ['wanlong-long', [['w771169387',0,-1]]],                       // 短龙 → 长龙
  ['genting-classic', [['w771168496',0,-1],['w771168494',19,-1]]], // 薰衣草 → 紫丁香 → 芍药花
  ['genting-classic', [['w1349252977',0,-1]]],                   // 追逐道 → 芍药花
  ['genting-valley', [['w771168509',0,-1]]]                      // 花锚 → 剪秋萝
];

function directionalName(trail) {
  const name=trail.name.replace('（万龙-云顶连接道）','').replace('（云顶-万龙连接道）','');
  const en=name==='银龙道（上段）'?'Silver Dragon · Upper':name==='银龙道（大奔头）'?'Silver Dragon · Dà Bēntóu':label(name,'en');
  return {trailId:trail.id,name,en,difficulty:trail.difficulty,ref:trail.ref};
}

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
    datura:{via:[],join:2},
    // The south side of lift 1 is open snow in the winter orthophoto and tree
    // cover grid. Pass outside the lower face of its platform onto OSM Felwort.
    felwort:{via:[[600,376.1],[583,376.5],[570.5,382.5]],join:1}
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

function entrySign(data,key,r,link){
  const opt=mouths[key],s=r.distances[link.join]+75,f=r.frame(s),p=[f.x,f.z];
  const width=data.trails.find(t=>t.id===r.legs[0].trailId).width;
  const [x,z]=signPosition(f,width*.42,1);
  return {id:key+'-entry',type:'confirmation',resort:r.resort,x,z,approach:f.angle,
    junctionPosition:p,sourceRouteId:r.id,along:s,options:[optionOnRoute(opt,r,p,s)]};
}

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
    const r=byId.get(opt.routeId);if(r)signs.push(entrySign(data,key,r,links[key]));
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

// Survey nodes are keyed by the projected pair already stored in mountain.json.
// All 70 OSM ways were checked against their original node IDs; the 0.1 m
// projection has no collisions. Never intersect line segments or snap two nearby
// trails here: in this survey none of the unmatched endpoints of a marked run
// is within 13 m of the main itineraries.
function pisteNetwork(data,byId,signs,structures) {
  const lines=new Map(),incidents=new Map(),canonicalEdges=new Map();
  const edgeKey=(a,b)=>pointKey(a)+'>'+pointKey(b);
  const collect=(table,key,value)=>{if(!table.has(key))table.set(key,[]);table.get(key).push(value);};
  for(const t of data.trails){
    const line=new SkiRoute({...t,legs:[{trailId:t.id,startIndex:0,endIndex:t.points.length-1}]},data);
    lines.set(t.id,line);
    for(let i=0;i<t.points.length;i++)collect(incidents,pointKey(t.points[i]),{line,index:i});
  }
  for(const route of byId.values()){
    for(let i=1;i<route.points.length;i++)collect(canonicalEdges,edgeKey(route.points[i-1],route.points[i]),route.id);
  }
  const original=new Map(signs.filter(s=>s.type==='junction').map(s=>[pointKey(s.junctionPosition),s]));
  const paths=new Map(),pathsByEdge=new Map();
  function clearSideRun(raw,legs){
    const points=[raw[0]],indices=[0];
    for(let i=1;i<raw.length;i++){
      const a=raw[i-1],b=raw[i];
      const nearby=structures.filter(o=>o.left<=Math.max(a[0],b[0])&&o.right>=Math.min(a[0],b[0])&&
        o.top<=Math.max(a[1],b[1])&&o.bottom>=Math.min(a[1],b[1]));
      if(nearby.some(o=>segmentHits(a,b,o.ring))){
        // Little Dragon passes Wanlong lift 3. Preserve the junction and ride
        // around the platform within the measured piste width, then re-center.
        const t=Math.min(.12,5/distance(a,b));
        const inset=k=>[a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k];
        const detour=clearConnector(inset(t),inset(1-t),nearby);
        const trail=lines.get(legs.find(l=>l.startIndex<i&&l.endIndex>=i)?.trailId);
        if(!detour||!trail||detour.some(p=>project(p,a,b).distance>trail.width*.45))return null;
        for(const p of detour)append(points,p);
      }
      indices.push(append(points,b));
    }
    return {points,legs:legs.map(l=>({...l,startIndex:indices[l.startIndex],endIndex:indices[l.endIndex]}))};
  }
  for(const [baseId,slices] of sideRuns){
    const points=[],legs=[];
    let continuous=true;
    for(const [id,from,last] of slices){
      const line=lines.get(id);
      if(!line){continuous=false;break;}
      const to=last<0?line.points.length-1:last;
      if(from>=to || !line.points[to] || (points.length&&!samePoint(points.at(-1),line.points[from]))){continuous=false;break;}
      appendSlice(points,legs,line,from,to);
    }
    if(!continuous||points.length<2)continue;
    const resume=points.at(-1),base=byId.get(baseId);
    const end=base.points.findIndex((p,i)=>i<base.points.length-1&&samePoint(resume,p));
    if(end<0)continue;
    const tail=base.points[end+1];
    const permitted=canonicalEdges.get(edgeKey(resume,tail))||[];
    const first=lines.get(slices[0][0]),id='via-'+first.id;
    const cleared=clearSideRun(points,legs);if(!cleared)continue;
    const run={id,first,...cleared,baseId,permitted,resume,templates:new Map()};
    paths.set(id,run);pathsByEdge.set(edgeKey(points[0],points[1]),run);
  }

  function routeFor(choice,plannedId){
    const path=paths.get(choice);
    if(!path)return byId.get(choice);
    const canonicalId=path.permitted.includes(plannedId)?plannedId:path.baseId;
    if(path.templates.has(canonicalId))return path.templates.get(canonicalId);
    const base=byId.get(canonicalId),at=base.points.findIndex(p=>samePoint(p,path.resume));
    const points=path.points.slice(),legs=path.legs.map(l=>({...l}));
    appendSlice(points,legs,base,at);
    const plan=makeRoute(base,points,legs,data);
    // The choice key identifies this row on the sign, while originalId survives
    // the eventual splice and remains an existing leaderboard / deep-link ID.
    plan.id=choice;plan.name=path.first.name;plan.en=directionalName(path.first).en;
    path.templates.set(canonicalId,plan);return plan;
  }

  function arm(incident,node,direction) {
    const {line,index}=incident,s=line.distances[index];
    const p=pair(line.at(s+direction*32));
    return {...directionalName(line),heading:bearing(node,p),flowHeading:direction<0?bearing(p,node):bearing(node,p),position:p};
  }
  function follows(p,center,next) {
    return samePoint(p,next) || (distance(p,center)>.05 && project(p,center,next).distance<.18);
  }
  function routeLeg(route,segment) {
    return route.legs?.find(l=>l.startIndex<=segment&&l.endIndex>segment)?.trailId;
  }
  function directedSite(route,index) {
    const p=route.points[index],key=pointKey(p),ways=incidents.get(key);
    if(!ways||ways.length<2)return null;
    const before=route.points[index-1],next=route.points[index+1];
    const incoming=ways.find(o=>o.index>0&&o.line.id===routeLeg(route,index-1)&&before&&follows(before,p,o.line.points[o.index-1]));
    // An interpolated apron or a coincident flat crossing is not an approached junction.
    if(index>0&&!incoming)return null;
    const exits=ways.filter(o=>o.index+1<o.line.points.length);
    const predicted=next&&exits.find(o=>o.line.id===routeLeg(route,index)&&follows(next,p,o.line.points[o.index+1]));
    if(next&&!predicted || !exits.length)return null;
    const s=route.distances[index];
    const apron=data.summitPlaces[route.resort]?.position;
    const approach=incoming?bearing(pair(route.at(Math.max(0,s-32))),p):apron?bearing(apron,p):route.frame(s).angle;
    const planned=predicted||exits.find(o=>o.line.id===incoming?.line.id)||exits.reduce((a,b)=>
      Math.abs(angleDiff(approach,arm(a,p,1).heading))<Math.abs(angleDiff(approach,arm(b,p,1).heading))?a:b);
    const known=original.get(key);
    const leave=exits.map(o=>{
      const edge=edgeKey(p,o.line.points[o.index+1]),side=pathsByEdge.get(edge),canonical=canonicalEdges.get(edge)||[];
      const official=known?.options.find(v=>canonical.includes(v.routeId));
      let choiceId=official?.routeId||side?.id||canonical.find(id=>id===route.originalId||id===route.id)||canonical[0]||null;
      const canonicalId=choiceId?routeFor(choiceId,route.originalId||route.id)?.originalId||choiceId:null;
      const info=arm(o,p,1);
      if(official)Object.assign(info,{name:official.name,en:official.en,difficulty:official.difficulty});
      return {...info,role:o===planned?'continue':'branch',choiceId,canonicalId,routeId:choiceId,selectable:!!choiceId};
    });
    // A choice exists only if at least two complete downhill itineraries are
    // available at this same point. Other measured arms still get named cues.
    const actionable=next && leave.filter(o=>o.selectable).length>1 && leave.some(o=>o.role==='continue'&&o.selectable);
    for(const o of leave)if(!actionable)Object.assign(o,{selectable:false,routeId:null,choiceId:null});
    const arrivals=ways.filter(o=>o.index>0&&o!==incoming&&!exits.some(e=>e===o&&e!==planned));
    if(leave.length===1&&!arrivals.length&&(!incoming||incoming.line.name===planned.line.name))return null;
    const entering=incoming?directionalName(incoming.line):null;
    const feeders=arrivals.map(o=>({...arm(o,p,-1),role:'incoming',selectable:false,choiceId:null,canonicalId:null,routeId:null}));
    const distinct=leave.filter((o,i)=>leave.findIndex(a=>a.trailId===o.trailId)===i);
    const type=distinct.length>1?'fork':feeders.length?'merge':'transition';
    const current=distinct.find(o=>o.role==='continue');
    const sorted=distinct.sort((a,b)=>a===current?-1:b===current?1:angleDiff(approach,a.heading)-angleDiff(approach,b.heading));
    const resort=[planned.line.resort,incoming?.line.resort,route.resort].find(v=>v==='wanlong'||v==='genting');
    const id=known?.id||'piste-'+(incoming?incoming.line.id+'-'+incoming.index:ways[0].line.id+'-'+ways[0].index+'-start');
    return {id,siteId:'node-'+key,type,resort,position:p,junctionPosition:p,index,along:s,approach,
      from:entering,current,fromTrailId:entering?.trailId||null,options:[...sorted,...feeders],actionable:!!actionable};
  }
  const events=new WeakMap();
  function guidanceOn(route){
    if(!route)return [];
    if(events.has(route))return events.get(route);
    const result=[];
    for(let i=0;i<route.points.length;i++){
      // The terminal vertex still describes the continuation for a free rider
      // approaching along a single observed piste instead of a paper itinerary.
      if(i===route.points.length-1&&!lines.has(route.id))continue;
      const point=directedSite(route,i);if(point)result.push(point);
    }
    events.set(route,result);return result;
  }
  return {guidanceOn,routeFor,lines,routeLeg};
}

export function createSkiNavigation(data) {
  if(navigators.has(data))return navigators.get(data);
  const byId=new Map(data.routes.map(r=>[r.id,r instanceof SkiRoute?r:new SkiRoute(r,data)]));
  const structures=[...data.buildings.map(b=>structure(b.footprint)),...data.lifts.flatMap(l=>[0,1].map(end=>structure(terminalRing(l,end))))];
  const links=summitLinks(data),signs=makeSigns(data,byId,links,structures);
  const network=pisteNetwork(data,byId,signs,structures);
  const entries=new Map(byId),flower=network.routeFor(mouths.felwort.routeId);
  if(flower){
    entries.set(flower.id,flower);
    const summit=signs.find(s=>s.type==='summit'&&s.resort==='genting'),foot=summit.junctionPosition;
    const line=summitRoute(data,flower,links,foot,structures);
    if(line){summit.options.push(optionOnRoute(mouths.felwort,line,foot,0,13));signs.push(entrySign(data,'felwort',flower,links.felwort));}
  }
  const summitGuides=new Map(signs.filter(s=>s.type==='summit').map(s=>{
    const options=s.options.map(o=>({...o,trailId:entries.get(o.routeId).legs[0].trailId,choiceId:o.routeId,
      canonicalId:o.canonicalId||o.routeId,flowHeading:o.heading,role:'entry',selectable:true}));
    return [s.resort,{id:s.id,siteId:s.id,type:'summit',resort:s.resort,position:s.junctionPosition,
      junctionPosition:s.junctionPosition,approach:s.approach,along:0,distance:0,from:null,current:null,options,actionable:true}];
  }));
  const graph=trailGraph(data),goals={wanlong:new Set(),genting:new Set()};
  for(const r of byId.values())goals[r.destination].add(pointKey(r.points.at(-1)));
  // The west Wanlong and southern Genting lift bases have their own snow fronts.
  for(const trailId of ['w483990519','w1280793047','w771168520']){
    const t=data.trails.find(v=>v.id===trailId);if(t)goals[t.resort].add(pointKey(t.points.at(-1)));
  }
  const junctionCache=new WeakMap(),chosenFork=new WeakMap(),previewRun=new WeakMap();
  const gates=new Map();
  for(const [key,opt] of Object.entries(mouths)){
    const route=entries.get(opt.routeId);if(route)gates.set(route.legs[0].trailId,{key,route,opt});
  }
  function captureGate(planned,history,foot,travelHeading){
    const near=data.index.near(...foot),gate=gates.get(near.trail?.id);
    if(!gate||gate.route.resort!==planned.resort||planned.approach?.target===gate.opt.name||near.distance>near.trail.width*.35)return null;
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
    const stations=network.guidanceOn(route).filter(site=>site.actionable).map(site=>{
      const options=site.options.filter(o=>o.selectable);
      const namedExits=[];
      for(const o of options){
        if(o.name&&o.choiceId&&Number.isFinite(o.heading)&&!namedExits.some(other=>
          other.choiceId===o.choiceId||other.name===o.name||Math.abs(angleDiff(other.heading,o.heading))<.018))namedExits.push(o);
      }
      return {sign:{...site,options},index:site.index,along:site.along,current:site.current,namedExits};
    });
    junctionCache.set(route,stations);return stations;
  }
  function changeBranch(route,station,routeId){
    if(station.current.routeId===routeId)return route;
    const template=network.routeFor(routeId,route.originalId||route.id),p=station.sign.junctionPosition;
    if(!template||!station.sign.options.some(o=>o.routeId===routeId))return null;
    const idx=template.points.findIndex(v=>samePoint(v,p));if(idx<0)return null;
    const points=[],legs=[];
    appendSlice(points,legs,route,0,station.index);appendSlice(points,legs,template,idx);
    const canonical=byId.get(template.originalId||template.id);
    const out=stopOutsideTerminal(makeRoute({...canonical,resort:route.resort},points,legs,data,route.approach),structures,data);
    // Steering commits the new itinerary slightly before the surveyed node.
    // Its old decision is already made even while the shared approach continues.
    chosenFork.set(out,{siteId:station.sign.siteId,along:station.along});
    return out;
  }
  // On the map, some actual trailheads are precisely the point where two ways
  // split. Their outlet must be chosen at the standing foot before any distance
  // has accumulated, instead of searching again for a nearby parallel piste.
  const sharedStarts=[];
  for(const raw of byId.values()){
    const first=network.guidanceOn(raw)[0];
    if(first?.index===0&&first.actionable)sharedStarts.push({raw,first});
  }
  function directTrailhead(raw,first,foot,heading,preferred){
    const choices=first.options.filter(o=>o.selectable);
    const next=choices.reduce((best,o)=>Math.abs(angleDiff(heading,o.heading))<Math.abs(angleDiff(heading,best.heading))?o:best);
    const chosen=choices.find(o=>o.choiceId===preferred&&Math.abs(angleDiff(heading,o.heading))<=Math.abs(angleDiff(heading,next.heading))+.10)||next;
    const source=network.routeFor(chosen.choiceId,raw.id),base=byId.get(chosen.canonicalId);
    const at=source.points.findIndex(p=>samePoint(p,first.position));
    if(at<0)return null;
    const points=[],legs=[];appendSlice(points,legs,source,at);points[0]=foot;
    const route=stopOutsideTerminal(pushInDirection(makeRoute(base,points,legs,data),heading,data,structures),structures,data);
    route.departedJunction=first.id;
    return route;
  }
  function departure(side,x,z,heading,preferred){
    const foot=[x,z],place=data.summitPlaces[side];
    if(!place||!Number.isFinite(x)||!Number.isFinite(z))return null;
    if(!Number.isFinite(heading))heading=place.heading;
    if(distance(foot,place.position)>6){
      const origin=sharedStarts.find(({raw,first})=>raw.resort===side&&distance(foot,first.position)<1.6);
      if(origin)return directTrailhead(origin.raw,origin.first,foot,heading,preferred);
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
    const raw=entries.get(id),route=pushInDirection(summitRoute(data,raw,links,foot,structures),heading,data,structures);
    if(route&&raw.originalId&&byId.has(raw.originalId))route.name=byId.get(raw.originalId).name;
    return stopOutsideTerminal(route,structures,data);
  }
  function summitHeading(side,routeId){
    const route=entries.get(routeId),entry=mouths[entryOf(routeId)];
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
  function guidanceOn(route){
    return network.guidanceOn(typeof route==='string'?(network.routeFor(route)||network.lines.get(route)):route);
  }
  const safeStarts=new WeakMap();
  function safeRun(route){
    if(typeof route==='string')route=byId.get(route);
    if(!route)return null;
    if(!safeStarts.has(route))safeStarts.set(route,stopOutsideTerminal(route,structures,data));
    return safeStarts.get(route);
  }
  function observedPiste(track,x,z,frame,separation,heading){
    const nearest=track.closest(x,z),local=track.frame(nearest.along);
    const betterHeading=Number.isFinite(heading)&&Math.abs(angleDiff(heading,local.angle))+.28<Math.abs(angleDiff(heading,frame.angle));
    return nearest.distance<track.width*.52&&(separation>nearest.distance+4||separation>track.width*.45||betterHeading)?nearest:null;
  }
  function guidance(sim){
    if(!sim?.route)return null;
    if(sim.mode==='summit'){
      const site=summitGuides.get(sim.route.resort);
      return site?{...site,selectedChoiceId:mouths[entryOf(sim.route.id)]?.routeId||null}:null;
    }
    if(sim.mode!=='run'&&sim.mode!=='trailhead')return null;
    let route=sim.route,along=sim.along||0,observed=false;
    const heading=sim.travelHeading??sim.heading;
    if(sim.opts?.assist===false && Number.isFinite(sim.x)&&Number.isFinite(sim.z)){
      const frame=route.frame(along),track=network.lines.get(sim.trail?.id);
      const separation=Math.hypot(frame.x-sim.x,frame.z-sim.z);
      if(track && track.id!==network.routeLeg(route,frame.index)){
        const observedAt=observedPiste(track,sim.x,sim.z,frame,separation,heading);
        if(observedAt){route=track;along=observedAt.along;observed=true;}
      }else if(!track&&separation>28)return null;
      if((sim.speed||0)>1.2&&Number.isFinite(heading)&&Math.cos(angleDiff(heading,route.frame(along).angle))<-.12)return null;
    }
    const speed=Math.max(0,sim.speed||0),sites=guidanceOn(route);
    for(const site of sites){
      const lead=site.along-along;
      if(lead<-.8)continue;
      if(lead>155)break;
      const visible=site.type==='fork'?clamp(98+speed*3.5,98,155):clamp(68+speed*2.9,68,140);
      if(lead>visible)continue;
      const unavailable=observed||sim.passedJunctions?.has(site.id);
      const options=unavailable?site.options.map(o=>({...o,selectable:false,choiceId:null,routeId:null})):site.options;
      const selectedChoiceId=unavailable?null:sim.requestedTurn?.id===site.id?sim.requestedTurn.routeId:site.current?.choiceId||null;
      return {...site,options,actionable:site.actionable&&!unavailable,distance:Math.max(0,lead),selectedChoiceId};
    }
    return null;
  }
  function upcomingChoice(sim){
    if(sim?.mode!=='run'||!sim.route||!Number.isFinite(sim.along)||sim.onTrail===false)return null;
    const {route,x,z}=sim;
    if(!Number.isFinite(x)||!Number.isFinite(z))return null;
    const speed=Math.max(0,sim.speed||0),ahead=clamp(34+5.2*speed,43,155);
    const free=sim.opts?.assist===false;
    // Free skiing updates its progress at intervals. Project the actual boots
    // before testing a fork so the print disappears as the skier crosses it.
    const along=free?route.closest(x,z).along:sim.along;
    const run=sim.passedJunctions||sim;
    let preview=previewRun.get(run);
    if(preview?.route!==route){
      // A restart may deliberately reuse a spliced route. It still approaches
      // this fork from above; a live turn first sees the new route at its node.
      const recent=chosenFork.get(route);
      const justTurned=recent&&sim.along>1&&sim.along>=recent.along-30.1&&sim.along<=recent.along+1;
      preview={route,taken:justTurned?recent.siteId:null};
      previewRun.set(run,preview);
    }
    if(along<(route.approach?.endDistance||0))return null;
    for(const {sign:site,namedExits:options} of stationsOn(route)){
      const lead=site.along-along;
      if(lead>ahead)break;
      // A trailhead shared by two itineraries has no incoming snow to print on.
      if(lead<=0||!site.fromTrailId||site.type!=='fork'||options.length<2||preview.taken===site.siteId||
        sim.passedJunctions?.has(site.id)||route.departedJunction===site.id)continue;
      const frame=route.frame(along),way=network.lines.get(network.routeLeg(route,frame.index));
      const offset=Math.hypot(x-frame.x,z-frame.z),heading=sim.travelHeading??sim.heading;
      if(!way||offset>(way.width||36)*.56||!Number.isFinite(heading)||Math.cos(angleDiff(heading,frame.angle))<=.05)return null;
      const track=network.lines.get(sim.trail?.id);
      if(track&&track.id!==way.id&&observedPiste(track,x,z,frame,offset,heading))return null;
      const intent=sim.requestedTurn;
      const selectedChoiceId=intent?.id===site.id&&options.some(o=>o.choiceId===intent.routeId)?intent.routeId:site.current.choiceId;
      return {...site,options,distance:lead,heading:site.approach,selectedChoiceId};
    }
    return null;
  }
  const nav={signs,stationsOn,changeBranch,departure,summitHeading,stationExit,captureGate,guidanceOn,guidance,upcomingChoice,safeRun,canonical:id=>network.routeFor(id)};
  navigators.set(data,nav);return nav;
}

export const getSkiSigns=data=>createSkiNavigation(data).signs;
