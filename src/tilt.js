import {clamp} from './mountain.js';

export class TiltSteering {
  constructor(changed,onProblem){
    this.changed=changed;this.onProblem=onProblem;this.value=0;this.enabled=false;
    this.read=this.read.bind(this);this.calibrate=this.calibrate.bind(this);
    window.addEventListener('orientationchange',this.calibrate);
    window.screen?.orientation?.addEventListener?.('change',this.calibrate);
  }
  calibrate(){this.zero=null;this.value=0;this.changed();}
  async enable(){
    const sensor=window.DeviceOrientationEvent;
    if(!sensor||!window.isSecureContext){this.disable();this.onProblem('unavailable');return false;}
    try{
      if(typeof sensor.requestPermission==='function'&&await sensor.requestPermission()!=='granted'){
        this.disable();this.onProblem('denied');return false;
      }
    }catch{this.disable();this.onProblem('denied');return false;}
    this.enabled=true;this.calibrate();window.addEventListener('deviceorientation',this.read);
    this.watch=setTimeout(()=>{if(this.enabled&&this.zero===null)this.onProblem('waiting');},3200);
    return true;
  }
  disable(){
    window.removeEventListener('deviceorientation',this.read);clearTimeout(this.watch);
    this.enabled=false;this.calibrate();
  }
  read(e){
    if(!this.enabled||!Number.isFinite(e.beta)||!Number.isFinite(e.gamma))return;
    const rad=Math.PI/180,theta=(window.screen?.orientation?.angle??window.orientation??0)*rad;
    const lateral=Math.sin(e.gamma*rad)*Math.cos(e.beta*rad)*Math.cos(theta)+Math.sin(e.beta*rad)*Math.sin(theta);
    const angle=Math.asin(clamp(lateral,-1,1))/rad;
    if(this.zero===null){this.zero=angle;clearTimeout(this.watch);}
    const delta=angle-this.zero;
    const next=Math.sign(delta)*clamp((Math.abs(delta)-1.8)/17,0,1);
    this.value+=(next-this.value)*.42;this.changed();
  }
}
