// Injected only by the browser test. Run the ordinary simulation and render the
// same frozen WebGL frame with and without its two ski-cut meshes.
function checkRenderedEdges(){
  window.edgeTest=true;
  if(frame)cancelAnimationFrame(frame);
  frame=0;
  start(data.allRoutes.find(r=>r.id==='wanlong-gold'));
  const along=674,f=sim.route.glideFrame(along);
  sim.x=f.x;sim.z=f.z;sim.heading=sim.travelHeading=sim.guideHeading=f.angle;
  sim.speed=84/3.6;sim.automatic.idle=3;sim.automatic.phase=1.7;
  sim.ground=sim.y=data.height(f.x,f.z);sim.joinLine(sim.route,along);sim.surface();
  snap=true;descentFrames.reset();fx.reset();prev=clock=0;
  let time=10000;
  for(let i=0;i<28;i++)loop(time+=1000/60);
  let grounded=0,minimumSpeed=Infinity,sample;
  const hist=scene.getObjectByName('Packed ski grooves'),live=scene.getObjectByName('Working ski edges');
  for(let i=0;i<112;i++){
    loop(time+=1000/30);
    const p=descentFrames.renderPose(),feet=rider.skiFeet;
    minimumSpeed=Math.min(minimumSpeed,p.speed*3.6);
    const outer=feet[0].weight>feet[1].weight?feet[0]:feet[1];
    if(outer.active)grounded++;
    if(i!==69)continue;
    for(const name of ['Curling edge snow','Displaced snow clods','Edge powder and ice crystals','Windblown carve wake'])
      scene.getObjectByName(name).visible=false;
    const cam=camera.clone(),bearing=p.route.glideFrame(p.along).angle;
    cam.position.set(p.x-.78*Math.cos(bearing)+1.36*Math.sin(bearing),p.y+1.10,
      p.z-.78*Math.sin(bearing)-1.36*Math.cos(bearing));
    cam.fov=44;cam.near=.035;cam.updateProjectionMatrix();cam.lookAt(p.x,p.y+.07,p.z);
    const copy=document.createElement('canvas');copy.width=el.width;copy.height=el.height;
    const ctx=copy.getContext('2d',{willReadFrequently:true});
    const render=()=>{
      renderer.render(scene,cam);ctx.drawImage(el,0,0);
      return ctx.getImageData(0,0,copy.width,copy.height).data;
    };
    const withCuts=render(),draws=renderer.info.render.calls;
    hist.visible=live.visible=false;
    const without=render(),removed=draws-renderer.info.render.calls;
    hist.visible=live.visible=true;
    let changed=0;
    for(let k=0;k<withCuts.length;k+=4){
      const delta=Math.max(...[0,1,2].map(c=>Math.abs(withCuts[k+c]-without[k+c])));
      if(delta>4)changed++;
    }
    sample={changed,fraction:changed/(copy.width*copy.height),removed,
      clearance:outer.clearance,rise:Math.abs(outer.edgeRise),name:p.trail?.name};
  }
  return {grounded,minimumSpeed,...sample};
}
