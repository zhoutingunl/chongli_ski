import {clamp,resortName,difficultyColor} from './mountain.js';

function pisteBounds(data) {
  const pts=data.trails.flatMap(t=>t.points);
  return {minX:Math.min(...pts.map(p=>p[0]))-320,maxX:Math.max(...pts.map(p=>p[0]))+320,
          minZ:Math.min(...pts.map(p=>p[1]))-300,maxZ:Math.max(...pts.map(p=>p[1]))+300};
}
function contours(data,box,step=56) {
  const lines = [];
  for(let z=box.minZ-400;z<=box.maxZ+400;z+=step){
    for(let x=box.minX-400;x<=box.maxX+400;x+=step){
      const corners=[[x,z],[x+step,z],[x+step,z+step],[x,z+step]];
      const h=corners.map(p=>data.height(...p));
      for(let level=Math.ceil(Math.min(...h)/40)*40;level<=Math.max(...h);level+=40){
        const hits=[];
        for(let i=0;i<4;i++){
          const k=(i+1)%4;
          if((h[i]<level)===(h[k]<level))continue;
          const f=(level-h[i])/(h[k]-h[i]);
          hits.push([corners[i][0]+f*(corners[k][0]-corners[i][0]),corners[i][1]+f*(corners[k][1]-corners[i][1])]);
        }
        if(hits.length>=2)lines.push(hits);
      }
    }
  }
  return lines;
}

export class TrailMap {
  constructor(canvas,data,mini=false) {
    this.el=canvas; this.ctx=canvas.getContext('2d'); this.data=data; this.mini=mini;
    this.box=pisteBounds(data);
    this.lines=data.contourLines ||= contours(data,this.box);
    this.zoom=1; this.panX=0; this.panZ=0; this.points=new Map();
    if(!mini) this.enablePan();
    this.observer=new ResizeObserver(()=>this.draw()); this.observer.observe(canvas);
  }
  enablePan(){
    const el=this.el, positions=()=>[...this.points.values()];
    el.addEventListener('pointerdown',e=>{
      el.setPointerCapture(e.pointerId);this.points.set(e.pointerId,[e.clientX,e.clientY]);
    });
    el.addEventListener('pointermove',e=>{
      const old=this.points.get(e.pointerId);
      if(!old)return;
      const before=positions(); this.points.set(e.pointerId,[e.clientX,e.clientY]);const after=positions();
      if(before.length===2){
        const distance=ps=>Math.hypot(ps[1][0]-ps[0][0],ps[1][1]-ps[0][1]);
        this.zoom=clamp(this.zoom*distance(after)/Math.max(1,distance(before)),0.85,4.5);
      }else{
        this.panX+=(e.clientX-old[0])/this.scale;this.panZ+=(e.clientY-old[1])/this.scale;
      }
      this.draw();
    });
    for(const type of ['pointerup','lostpointercapture','pointercancel'])el.addEventListener(type,e=>this.points.delete(e.pointerId));
    el.addEventListener('wheel',e=>{e.preventDefault();this.changeZoom(e.deltaY>0?0.85:1.18);},{passive:false});
  }
  changeZoom(factor){this.zoom=clamp(this.zoom*factor,0.85,4.5);this.draw();}
  reset(){this.zoom=1;this.panX=this.panZ=0;this.draw();}
  select(route,position){this.route=route;this.position=position;this.draw();}
  draw(){
    const {el,ctx:c,box:b,mini}=this;
    const w=el.clientWidth,h=el.clientHeight;
    if(!w||!h)return;
    const dpr=Math.min(devicePixelRatio||1,2);
    if(el.width!==Math.round(w*dpr)||el.height!==Math.round(h*dpr)){el.width=Math.round(w*dpr);el.height=Math.round(h*dpr);}
    c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
    const s=Math.min(w/(b.maxX-b.minX),h/(b.maxZ-b.minZ))*this.zoom*(mini?1.28:.94);
    this.scale=s;
    const cx=(b.minX+b.maxX)/2-this.panX,cz=(b.minZ+b.maxZ)/2-this.panZ;
    const px=x=>(x-cx)*s+w/2,pz=z=>(z-cz)*s+h/2;
    function line(points){c.moveTo(px(points[0][0]),pz(points[0][1]));for(let i=1;i<points.length;i++)c.lineTo(px(points[i][0]),pz(points[i][1]));}
    c.lineJoin='round';c.lineCap='round';
    c.strokeStyle=mini?'rgba(212,232,232,.17)':'rgba(174,198,195,.22)';c.lineWidth=mini?.64:.8;c.beginPath();
    for(const seg of this.lines) line(seg);c.stroke();
    if(!mini){
      c.strokeStyle='rgba(207,215,211,.47)';c.lineWidth=.9;c.setLineDash([3,4]);c.beginPath();
      for(const l of this.data.lifts)line(l.points);c.stroke();c.setLineDash([]);
    }
    for(const t of this.data.trails){
      c.globalAlpha=mini?.38:.52;c.strokeStyle=mini?'#d5e1e3':(difficultyColor[t.difficulty]||'#b8caca');c.lineWidth=mini?.83:1.55;c.beginPath();line(t.points);c.stroke();
    }
    c.globalAlpha=1;
    if(this.route){
      c.strokeStyle='#f3ce8a';c.lineWidth=mini?1.75:3;c.beginPath();line(this.route.points);c.stroke();
      for(const point of [this.route.points[0],this.route.points.at(-1)]){
        c.fillStyle='#eed29c';c.beginPath();c.arc(px(point[0]),pz(point[1]),mini?2.4:4,0,Math.PI*2);c.fill();
      }
    }
    const points=this.data.landmarks.filter(l=>l.kind==='hall'||(!mini&&l.kind==='lodge'));
    for(const l of points){
      const x=px(l.x),z=pz(l.z),base=l.kind==='hall';
      if(!base){c.strokeStyle='#f2e2b8';c.strokeRect(x-2.5,z-2.5,5,5);}
      const fontSize=mini?11:base?15:12;
      c.font=(base?'500 ':'')+fontSize+'px "PingFang SC","Microsoft YaHei",sans-serif';
      c.textAlign=l.resort==='genting'?'left':'right';c.textBaseline='middle';
      const label=base?(mini?resortName(l.resort):resortName(l.resort)+'雪场'):l.name;
      const tx=clamp(x+(l.resort==='genting'?9:-9),c.textAlign==='right'?c.measureText(label).width+4:4,c.textAlign==='left'?w-c.measureText(label).width-4:w-4);
      const ty=clamp(z+(base?-5:12),9,h-10);
      c.lineWidth=3;c.strokeStyle='rgba(23,38,42,.85)';c.strokeText(label,tx,ty);c.fillStyle=base?'#f5f6ee':'#dfceb1';c.fillText(label,tx,ty);
    }
    if(this.position&&!mini){
      const x=px(this.position.x),y=pz(this.position.z);
      c.fillStyle='#ffffff';c.strokeStyle='#377b80';c.lineWidth=3;c.beginPath();c.arc(x,y,5.5,0,2*Math.PI);c.fill();c.stroke();
    }
  }
}
