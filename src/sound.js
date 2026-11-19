export class MountainSound {
  constructor(){this.enabled=false;}
  prepare(){
    if(this.ctx)return;
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)return;
    this.ctx=new Audio();
    const ctx=this.ctx, buffer=ctx.createBuffer(1,ctx.sampleRate*3,ctx.sampleRate),d=buffer.getChannelData(0);
    let brown=0;
    for(let i=0;i<d.length;i++){brown=(brown+.03*(Math.random()*2-1))/1.027;d[i]=brown*4+(Math.random()-.5)*.12;}
    const src=ctx.createBufferSource();src.buffer=buffer;src.loop=true;
    this.filter=ctx.createBiquadFilter();this.filter.type='lowpass';this.filter.frequency.value=650;
    this.master=ctx.createGain();this.master.gain.value=0;
    src.connect(this.filter).connect(this.master).connect(ctx.destination);src.start();
  }
  set(on){this.enabled=on;if(on){try{this.prepare();this.ctx?.resume().catch(()=>{});}catch{this.enabled=false;}}this.update(0,0);}
  update(speed,edge,muted=false){
    if(!this.ctx)return;
    const t=this.ctx.currentTime,on=this.enabled&&!muted;
    this.master.gain.setTargetAtTime(on?.10+Math.min(speed/32,1)*.35+edge*.16:0,t,.15);
    this.filter.frequency.setTargetAtTime(370+speed*38+edge*1550,t,.18);
  }
}
