// Three short voices share one instrument bus for each arrangement. Notes are
// scheduled against the audio clock so paint time never changes the rhythm.
export const tracks=[
  {id:'daylight',name:'晴雪初行',en:'First Tracks',desc:'白昼 · 清亮琴音',sub:'Daylight · clear keys',bpm:92,root:62,wave:'triangle',steps:[0,4,7,12,9,7,4,2],bass:[0,-5,-3,-7],decay:.64},
  {id:'pines',name:'松间回声',en:'Pine Echoes',desc:'林间 · 木质拨弦',sub:'Forest · plucked strings',bpm:88,root:57,wave:'triangle',steps:[0,7,3,10,7,5,3,2],bass:[0,-2,-5,-7],decay:.38},
  {id:'drift',name:'浮雪漫游',en:'Powder Drift',desc:'粉雪 · 绵长氛围',sub:'Powder · drifting pads',bpm:66,root:63,wave:'sine',steps:[0,null,7,10,null,14,12,null],bass:[0,-5,-2,-7],decay:1.8},
  {id:'ridge',name:'云脊远望',en:'Across the Ridge',desc:'高山 · 空灵泛音',sub:'Summit · airy harmonics',bpm:82,root:62,wave:'sine',steps:[0,7,null,14,12,null,9,7],bass:[0,-5,-3,-7],decay:1.25},
  {id:'wind',name:'逐风疾驰',en:'Chasing the Wind',desc:'疾驰 · 律动低音',sub:'Speed · rhythmic bass',bpm:120,root:55,wave:'triangle',steps:[0,3,7,10,7,12,10,5],bass:[0,0,-5,-2],decay:.31},
  {id:'storm',name:'风雪穿行',en:'Through the Storm',desc:'风雪 · 低沉脉冲',sub:'Blizzard · low pulses',bpm:76,root:53,wave:'triangle',steps:[0,null,2,3,7,null,5,2],bass:[0,-2,-5,-2],decay:.68},
  {id:'homeward',name:'暮色归途',en:'Home at Dusk',desc:'日落 · 温暖电琴',sub:'Sunset · warm electric keys',bpm:74,root:60,wave:'triangle',steps:[4,7,9,7,4,2,0,null],bass:[0,-5,-3,-7],decay:1.1},
  {id:'stars',name:'星河雪境',en:'Snow under Stars',desc:'星夜 · 玻璃钟声',sub:'Night · glass bells',bpm:60,root:67,wave:'sine',steps:[0,null,7,null,14,12,null,9],bass:[0,-3,-5,-7],decay:1.9},
  {id:'cable',name:'缆车云端',en:'Above the Cable',desc:'索道 · 轻柔摇曳',sub:'Gondola · gentle sway',bpm:78,root:59,wave:'sine',steps:[0,4,7,null,9,7,2,null],bass:[0,-5,-7,-5],decay:1.15}
];
export function musicFor(mode,env,sim){
  if(mode==='lift')return 'cable';
  if(env?.resolvedWeather==='heavy')return 'storm';
  if(['night','aurora'].includes(env?.resolvedTime))return 'stars';
  if(['evening','sunset','twilight'].includes(env?.resolvedTime))return 'homeward';
  if(mode==='summit')return 'ridge';
  if(sim?.speed>16)return 'wind';
  if(env?.resolvedWeather==='light')return 'drift';
  if(mode==='run'&&(!sim?.onTrail||sim.startY-sim.y>190))return 'pines';
  return 'daylight';
}

export class MountainMusic {
  constructor(sound){this.sound=sound;this.track=tracks[3];this.step=0;this.volume=.75;this.on=false;}
  unlock(){
    this.sound.prepare();const ctx=this.sound.ctx;
    if(!ctx)return;
    ctx.resume().catch(()=>{});
    if(this.gain)return;
    this.gain=ctx.createGain();this.gain.gain.value=0;this.gain.connect(ctx.destination);
    this.timer=setInterval(()=>this.schedule(),120);
  }
  configure(enabled,volume,id){
    const song=tracks.find(t=>t.id===id)||tracks[3];
    if(this.track!==song){this.track=song;this.step=0;this.next=0;}
    this.on=enabled;this.volume=volume/100;
    if(!this.gain)return;
    const ctx=this.sound.ctx;
    const level=enabled&&!document.hidden?this.volume*.30:0;
    if(this.level!==level){this.level=level;this.gain.gain.setTargetAtTime(level,ctx.currentTime,.07);}
    this.schedule();
  }
  note(midi,t,length,type,amp,attack=.016){
    const ctx=this.sound.ctx,osc=ctx.createOscillator(),gain=ctx.createGain(),freq=440*2**((midi-69)/12);
    osc.type=type;osc.frequency.setValueAtTime(freq,t);
    gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(amp,t+attack);
    gain.gain.exponentialRampToValueAtTime(.0001,t+length);
    osc.connect(gain).connect(this.gain);osc.onended=()=>{osc.disconnect();gain.disconnect();};osc.start(t);osc.stop(t+length+.025);
  }
  schedule(){
    const ctx=this.sound.ctx;
    if(!this.gain||!this.on||document.hidden||ctx.state!=='running'){this.next=0;return;}
    const now=ctx.currentTime,t=this.track,beat=60/t.bpm;
    if(!this.next||this.next<now)this.next=now+.035;
    while(this.next<now+.24){
      const i=this.step%8,bar=Math.floor(this.step/8),bass=t.root+t.bass[bar%4],n=t.steps[i],at=this.next;
      if(n!==null){
        const note=bass+n+12;
        this.note(note,at,t.decay,t.wave,.23,t.id==='drift'?.14:.018);
        if(['ridge','stars','daylight'].includes(t.id))this.note(note+12,at+.012,t.decay*.56,'sine',.067);
      }
      if(i===0 || (i===4&&['wind','storm','pines'].includes(t.id))){
        this.note(bass-12,at,beat*2.5,'sine',.34,.055);
        this.note(bass+7,at+.06,beat*2,'triangle',.105,.10);
      }
      this.step++;this.next+=beat*.5;
    }
  }
}
