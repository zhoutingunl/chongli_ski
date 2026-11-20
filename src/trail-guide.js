import './trail-guide.css';

const SVG = 'http://www.w3.org/2000/svg';
const obstructions = '.hud-reading,.game-top,#direction-pad,.ride-actions,#steering,#station-card,#look-reset,#near-lift,#fork-prompt,#keyboard-hint,#lift-strip';
const difficulties = {
  easy:['初级','Easy'], intermediate:['中级','Intermediate'], advanced:['高级','Advanced'], expert:['专家','Expert'],
};
const arrowShape = 'M12 20V4M5.8 10.4L12 4l6.2 6.4';
const mergeShape = 'M15 21V3m-4.4 4.6L15 3l4.4 4.6M4 20v-2.5c0-2.7 1.7-4.2 4.6-5.6L15 8.3';
const trailShape = 'M6 11.2 12 4l6 7.2M12 5v7m0 3.4v1.4m0 3v.9';
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const turn = a => Math.atan2(Math.sin(a),Math.cos(a));
const intersects = (a,b,gap=4) => a.x < b.x+b.w+gap && a.x+a.w+gap > b.x &&
  a.y < b.y+b.h+gap && a.y+a.h+gap > b.y;
const finite = Number.isFinite;

function svg(tag,attributes={}) {
  const node=document.createElementNS(SVG,tag);
  for(const [name,value] of Object.entries(attributes))node.setAttribute(name,value);
  return node;
}

function span(className,parent) {
  const node=document.createElement('span');
  node.className=className;parent.append(node);
  return node;
}

function makeMarker(el,lines,canChoose,onChoose) {
  const marker=document.createElement(canChoose?'button':'div');
  marker.className='trail-marker';
  marker.dataset.pick=canChoose?'yes':'no';
  if(canChoose)marker.type='button';
  const face=span('trail-marker-face',marker);
  const icon=span('trail-marker-icon',face);
  const symbol=svg('svg',{viewBox:'0 0 24 24','aria-hidden':'true',fill:'none'});
  const path=svg('path',{'stroke':'currentColor','stroke-width':'1.9','stroke-linecap':'round','stroke-linejoin':'round'});
  symbol.append(path);icon.append(symbol);
  const words=span('trail-marker-words',face);
  const title=span('trail-marker-name',words),note=span('trail-marker-note',words);
  const grade=span('trail-marker-grade',face);
  grade.setAttribute('aria-hidden','true');
  el.append(marker);

  const group=svg('g',{'aria-hidden':'true'}), under=svg('path',{class:'trail-leader-under'}),line=svg('path',{class:'trail-leader-line'});
  const anchor=svg('path',{class:'trail-leader-anchor',d:'M-5 0 0-2.7 5 0 0 2.7Z'});
  group.append(under,line,anchor);lines.append(group);
  const item={marker,group,under,line,anchor,icon,path,grade,title,note,key:'',chosen:null,w:0,h:0,side:0,press:null,rect:null};
  if(canChoose){
    marker.addEventListener('pointerdown',e=>{
      if(e.button!==0||!e.isPrimary||!item.chosen)return;
      item.press={id:e.pointerId,x:e.clientX,y:e.clientY};
      marker.setPointerCapture(e.pointerId);
    });
    marker.addEventListener('pointerup',e=>{
      const press=item.press;item.press=null;
      if(press?.id!==e.pointerId||Math.hypot(e.clientX-press.x,e.clientY-press.y)>9)return;
      if(item.chosen&&!marker.hidden&&!el.hidden)onChoose(item.chosen);
    });
    for(const event of ['pointercancel','lostpointercapture'])marker.addEventListener(event,()=>{item.press=null;});
    // A moving marker may cross a stationary finger whose original touch was on
    // the snow. Only its own pointer gesture or a keyboard/AT click activates it.
    marker.addEventListener('click',e=>{e.stopPropagation();if(e.detail===0&&item.chosen)onChoose(item.chosen);});
    // Focused route choices must receive the same native Space activation as Enter.
    // The game also uses Space to jump when the focus is on the snow.
    for(const ev of ['keydown','keyup'])marker.addEventListener(ev,e=>{
      if(e.key===' '||e.key==='Enter')e.stopPropagation();
    });
  }
  return item;
}

function outsideRole(p,viewHeading,marker) {
  const angle=turn(p.bearing-viewHeading);
  const behind=!p.front;
  if(behind && Math.abs(angle)<Math.PI*.48 && finite(p.y))return p.y>.5?'up':'down';
  if(behind || p.x<-.015 || p.x>1.015){
    let side=behind?(angle<0?-1:1):(p.x<.5?-1:1);
    // A direction directly behind the camera can straddle -π/+π every frame.
    if(behind && Math.abs(angle)>Math.PI-.14 && marker.side)side=marker.side;
    marker.side=side;
    return behind?(side<0?'back-left':'back-right'):(side<0?'left':'right');
  }
  marker.side=0;
  if(p.y<0)return 'up';
  if(p.y>1)return 'down';
  return '';
}

function copyFor(item,option,loc,en) {
  const raw=(en?(option.en||option.name):(option.name||option.en))||'';
  const [title,...extra]=raw.split(/\s*·\s*/);
  const suffix=extra.join(' · ');
  const direction=en?{'back-left':'Behind left','back-right':'Behind right',left:'Off to the left',right:'Off to the right',up:'Look up',down:'Look down'}:
    {'back-left':'左后方','back-right':'右后方',left:'左侧',right:'右侧',up:'抬头',down:'低头'};
  const incoming=option.role==='incoming',passive=!option.selectable;
  const role=incoming?(en?'Merges here':'汇入此道'):passive?(option.role==='continue'?(en?'Continue':'沿此道'):(en?'Side trail':'雪道支线')):'';
  let text=role||direction[loc]||'';
  if(role&&loc)text=en?role+' · '+direction[loc]:direction[loc]+(incoming?'汇入':'连接');
  if(suffix)text=text?(loc?text+' · '+suffix:suffix+' · '+text):suffix;
  const grade=difficulties[option.difficulty]?option.difficulty:'intermediate';
  const key=[raw,text,grade,option.role,loc,en].join('|');
  if(item.key===key)return;
  item.key=key;item.w=0;
  item.title.textContent=title;item.note.textContent=text;item.note.hidden=!text;
  item.marker.dataset.mode=loc?'edge':'anchor';
  item.marker.dataset.kind=incoming?'incoming':passive?'connection':'outgoing';
  item.grade.dataset.grade=grade;
  item.path.setAttribute('d',incoming?mergeShape:passive?trailShape:arrowShape);
  const gradeName=difficulties[grade][en?1:0];
  item.marker.setAttribute('aria-label',[raw,gradeName,role,direction[loc],passive?'':en?'Choose this trail':'选择这条雪道'].filter(Boolean).join(en?', ':'，'));
}

function readLayout(el,avoid) {
  const frame=el.getBoundingClientRect(),style=getComputedStyle(el);
  const w=frame.width,h=frame.height,p=side=>parseFloat(style['padding'+side])||10;
  const blocked=[];
  for(const node of avoid){
    const r=node.getBoundingClientRect();
    if(r.width>1&&r.height>1)blocked.push({x:r.left-frame.left,y:r.top-frame.top,w:r.width,h:r.height});
  }
  return {w,h,left:p('Left'),right:w-p('Right'),top:p('Top'),bottom:h-p('Bottom'),blocked};
}

function placeMarker(item,aim,screen,occupied) {
  const {w,h}=item,left=screen.left,right=Math.max(left,screen.right-w),top=screen.top,bottom=Math.max(top,screen.bottom-h);
  const dx=Math.min(w*.62,82),dy=h+5;
  const targetX=clamp(aim.x-w/2,left,right),targetY=clamp(aim.y-h/2,top,bottom);
  let best=null,bestCost=Infinity;
  function tryAt(x,y){
    x=clamp(x,left,right);y=clamp(y,top,bottom);
    const cost=(x-targetX)**2*(aim.edge?9:1)+(y-targetY)**2;
    if(cost>=bestCost)return;
    const rect={x,y,w,h};
    if(occupied.some(r=>intersects(rect,r)))return;
    best=rect;bestCost=cost;
  }
  tryAt(targetX,targetY);
  if(bestCost===0)return best;
  const yEdges=[top,bottom,targetY];
  for(const b of occupied)yEdges.push(b.y-h-5,b.y+b.h+5);
  // An off-screen outlet stays on its true side, even beside a tall portrait HUD.
  if(aim.edge){
    for(const y of yEdges)tryAt(targetX,y);
    if(best)return best;
  }
  for(const y of [0,-1,1,-2,2,-3,3])for(const x of [0,-1,1,-2,2]){
    tryAt(targetX+x*dx,targetY+y*dy);
  }
  // The edges of existing rectangles are the exact boundaries of the remaining
  // free space. A coarse grid misses the last corner on a small portrait phone.
  if(!best){
    const xEdges=[left,right,targetX];
    for(const b of occupied)xEdges.push(b.x-w-5,b.x+b.w+5);
    for(const y of yEdges)for(const x of xEdges)tryAt(x,y);
  }
  return best;
}

function drawLeader(item,box,aim,screen) {
  const ax=aim.ax,ay=aim.ay;
  if(aim.mode||!box||ax<5||ax>screen.w-5||ay<5||ay>screen.h-5){item.group.style.display='none';return;}
  const x=clamp(ax,box.x+7,box.x+box.w-7),y=clamp(ay,box.y+2,box.y+box.h-2);
  const dx=ax-x,dy=ay-y,length=Math.hypot(dx,dy);
  if(length<7||screen.blocked.some(b=>ax>=b.x&&ax<=b.x+b.w&&ay>=b.y&&ay<=b.y+b.h)){
    item.group.style.display='none';return;
  }
  const endX=ax-dx/length*4,endY=ay-dy/length*4;
  const d='M'+x.toFixed(1)+' '+y.toFixed(1)+' L'+endX.toFixed(1)+' '+endY.toFixed(1);
  item.group.style.display='';
  item.under.setAttribute('d',d);item.line.setAttribute('d',d);
  item.anchor.setAttribute('transform','translate('+ax.toFixed(1)+' '+ay.toFixed(1)+')');
}

export function createTrailGuide(el,onChoose=()=>{}) {
  el.classList.add('trail-guide');el.setAttribute('role','group');el.hidden=true;
  const lines=svg('svg',{class:'trail-guide-lines','aria-hidden':'true'});el.append(lines);
  const hud=el.closest('#hud')||el.parentElement;
  const avoid=[...hud.querySelectorAll(obstructions)];
  const markers=new Map();
  let layout=null,measuredAt=-Infinity,contentKey='';
  const observer=new ResizeObserver(entries=>{
    measuredAt=-Infinity;
    if(entries.some(entry=>entry.target===el))for(const item of markers.values())item.w=0;
  });
  observer.observe(el);for(const node of avoid)observer.observe(node);

  function hide(){if(!el.hidden){el.hidden=true;measuredAt=-Infinity;}}
  function update(context) {
    if(!context?.options?.length||!finite(context.viewHeading)){hide();return;}
    const en=(context.language||document.documentElement.lang).startsWith('en');
    const key=context.id+'|'+en;
    if(el.hidden||contentKey!==key){
      el.hidden=false;el.lang=en?'en':'zh-CN';
      el.setAttribute('aria-label',en?'Trail directions':'雪道方向');
      measuredAt=-Infinity;contentKey=key;
    }
    const active=new Set(),pending=[];
    for(const o of context.options){
      const s=o.screen;
      if(!s || !finite(s.bearing) || (s.front&&(!finite(s.x)||!finite(s.y))))continue;
      const selectable=Boolean(o.selectable && (o.choiceId||o.routeId));
      const option=selectable===o.selectable?o:{...o,selectable};
      const id=[context.id,o.choiceId||o.trailId||o.routeId||o.name,o.role,selectable].join('|');
      if(active.has(id))continue;
      active.add(id);
      if(!markers.has(id))markers.set(id,makeMarker(el,lines,selectable,onChoose));
      const item=markers.get(id);
      item.chosen=selectable?{...o,id:context.id,signId:context.id,type:context.type}:null;
      const loc=outsideRole(s,context.viewHeading,item);
      copyFor(item,option,loc,en);
      const mainBearing=context.current?.heading??context.approach??context.viewHeading;
      const incoming=o.role==='incoming';
      const bearing=incoming?mainBearing:loc?s.bearing:(finite(o.heading)?o.heading:s.bearing);
      const rotation=turn(bearing-context.viewHeading)*180/Math.PI;
      item.icon.style.setProperty('--trail-turn',rotation.toFixed(1)+'deg');
      item.icon.style.setProperty('--trail-mirror',incoming&&Math.sin(o.heading-mainBearing)>0?'-1':'1');
      const selected=selectable && (o.choiceId||o.routeId)===context.selectedChoiceId;
      if(item.marker.dataset.selected!==String(selected)){
        item.marker.dataset.selected=String(selected);
        if(selected)item.marker.setAttribute('aria-current','true');else item.marker.removeAttribute('aria-current');
      }
      if(!item.w)item.marker.hidden=false;
      pending.push({item,s,loc,selectable});
    }
    for(const [id,item] of markers)if(!active.has(id)){item.marker.remove();item.group.remove();markers.delete(id);}
    if(!pending.length){hide();return;}
    for(const {item} of pending)if(!item.w){item.w=item.marker.offsetWidth;item.h=item.marker.offsetHeight;}
    const now=performance.now();
    if(!layout||now-measuredAt>260){layout=readLayout(el,avoid);measuredAt=now;}
    const {w,h}=layout;
    if(w<=1||h<=1){measuredAt=-Infinity;return;}
    const occupied=layout.blocked.slice();
    for(const entry of pending){
      const {item,s,loc}=entry;
      const ax=finite(s.x)?s.x*w:w*.5,ay=finite(s.y)?s.y*h:h*.5;
      const lateral=loc.endsWith('left')?-1:loc.endsWith('right')?1:0;
      const x=lateral<0?layout.left+item.w/2:lateral>0?layout.right-item.w/2:ax;
      let y=ay-17-item.h/2;
      if(lateral)y=loc.startsWith('back')?h*.565:clamp(y,h*.355,h*.655);
      if(loc==='up')y=layout.top+item.h/2;
      if(loc==='down')y=layout.bottom-item.h/2;
      entry.aim={x,y,ax,ay,edge:!!lateral,mode:loc};
    }
    // Keep every selectable outlet first. Screen order breaks ties deterministically
    // when two outgoing centerlines share their first few surveyed metres.
    pending.sort((a,b)=>Number(!!b.item.press)-Number(!!a.item.press)||Number(b.selectable)-Number(a.selectable)||a.aim.x-b.aim.x);
    for(const {item,aim} of pending){
      const rect=item.press&&item.rect&&!occupied.some(o=>intersects(o,item.rect))?item.rect:placeMarker(item,aim,layout,occupied);
      item.rect=rect;
      item.marker.hidden=!rect;
      if(rect){
        item.marker.style.transform='translate3d('+Math.round(rect.x)+'px,'+Math.round(rect.y)+'px,0)';
        occupied.push(rect);
      }
      drawLeader(item,rect,aim,layout);
    }
  }
  function destroy(){
    observer.disconnect();
    for(const item of markers.values())item.marker.remove();
    markers.clear();lines.remove();hide();
  }
  return {update,hide,destroy};
}
