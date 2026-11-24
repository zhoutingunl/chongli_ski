const groomed = Object.freeze({kind:'groomed', relief:0, depth:0, rim:0, strength:0});
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function smooth(lo, hi, x) {
  const t = clamp((x-lo)/(hi-lo), 0, 1);
  return t*t*(3-2*t);
}
function hash(x,z) {
  const n = Math.imul(x, 374761393) + Math.imul(z, 668265263);
  const h = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x,z) {
  const i=Math.floor(x), j=Math.floor(z), u=smooth(0,1,x-i), v=smooth(0,1,z-j);
  const a=hash(i,j)*(1-u)+hash(i+1,j)*u, b=hash(i,j+1)*(1-u)+hash(i+1,j+1)*u;
  return a+(b-a)*v;
}

const layouts = [
  ['w771169115','pipe',18],
  ['w956358946','moguls',15],
  ['w1349252978','moguls',14],
];
const gladedTrails = new Set(['w1353185034','diagram-wanlong-mist']);

function course(trail,kind,width) {
  const [[x,z]]=trail.points, [ex,ez]=trail.points.at(-1);
  const length=Math.hypot(ex-x,ez-z);
  const start=kind==='pipe'?Math.max(0,(length-220)*.5):0;
  return {kind,width,x,z,dx:(ex-x)/length,dz:(ez-z)/length,length,start,
    end:length-start,
    bounds:{minX:Math.min(x,ex)-width,minZ:Math.min(z,ez)-width,maxX:Math.max(x,ex)+width,maxZ:Math.max(z,ez)+width}};
}

function bumpField(along, across, width) {
  const s=along+noise(along*.09,6)*1.66;
  const row=Math.floor(s/4.6);
  let lift=0;
  for(let j=row-1;j<=row+1;j++){
    const d=s-(j+.5)*4.6+(hash(j,98)-.5)*1.20;
    const x=across+(j%2)*1.46+Math.sin(j*1.3)*.32;
    const i=Math.floor(x/3.4), r=hash(j,i);
    const side=x-(i+.5)*3.4+(r-.5)*.55;
    const radius=Math.hypot(side/(1.14+r*.42),d/(1.76+r*.47));
    const height=(.36+.30*r)*(1-smooth(.05,1,radius));
    lift=Math.max(lift,height);
  }
  const trough=(noise(across*.34,along*.25)-.65)*.13;
  return (lift+trough)*(1-smooth(width-4,width,Math.abs(across)));
}

// Use survey coordinates for the park and the FIS competition profile for
// the approximate halfpipe shape (220 m course, 22 m wide, 7.2 m walls).
export function createSnowTerrain(baseHeight,index,trails,apronIndex) {
  const byId=new Map(trails.map(trail=>[trail.id,trail]));
  const features=layouts.flatMap(([id,kind,width])=>{
    const trail=byId.get(id);
    return trail ? [course(trail,kind,width)] : [];
  });
  // A groomed crossing through a bump field has a clear centre and feathered
  // edges; the rest of the race lane keeps its full relief and snow response.
  function apronFringe(x,z,halfWidthRatio,fade){
    const hit=apronIndex?.near(x,z);
    if(!hit?.trail)return 1;
    const edge=hit.trail.width*halfWidthRatio;
    return smooth(edge,edge+fade,hit.distance);
  }
  function measure(x,z,out,nearest) {
    for(const f of features){
      const b=f.bounds;
      if(x<b.minX||x>b.maxX||z<b.minZ||z>b.maxZ)continue;
      const rx=x-f.x, rz=z-f.z, along=rx*f.dx+rz*f.dz, across=rz*f.dx-rx*f.dz;
      const side=Math.abs(across);
      if(along<=f.start||along>=f.end||side>=f.width)continue;
      let strength=smooth(f.start,f.start+18,along)*(1-smooth(f.end-22,f.end,along));
      let relief,rim=0,ramp=0;
      if(f.kind==='pipe'){
        const u=clamp((side-3.45)/7.55,0,1);
        const profile=.68*(1-Math.sqrt(1-.986*u*u))/(1-Math.sqrt(.014))+.32*u*u;
        const sideMask=1-smooth(11.4,f.width,side);
        const floor=baseHeight(f.x+along*f.dx,f.z+along*f.dz);
        relief=(floor+7.2*profile-baseHeight(x,z))*sideMask*strength;
        rim=smooth(10.18,10.55,side)*(1-smooth(10.94,11.29,side))*strength;
        ramp=strength*sideMask;
      }else{
        strength*=apronFringe(x,z,.24,5);
        if(!strength)return 0;
        relief=bumpField(along,across,f.width)*strength;
      }
      if(out)Object.assign(out,{kind:f.kind,relief,depth:0,rim,strength,across,along,ramp});
      return relief;
    }

    const near=nearest||index.near(x,z);
    const glade=near.trail && gladedTrails.has(near.trail.id);
    const edge=(near.trail?.width||36)*.5;
    let fringe=glade?1:smooth(edge+1,edge+15,near.distance);
    if(fringe)fringe*=apronFringe(x,z,.5,8);
    if(fringe<=0)return 0;
    const wind=noise(x*.057,z*.045);
    const drift=noise(x*.126+z*.052,z*.149-x*.023);
    const ripple=noise(x*.29,z*.24);
    const depth=fringe*(.11+.27*wind+.14*drift+(glade?.19:0));
    const relief=fringe*(.32*(wind-.4)+.32*(drift-.30)+.14*(ripple-.50))*(glade?1.74:1);
    if(out)Object.assign(out,{kind:'powder',relief,depth,rim:0,strength:fringe});
    return relief;
  }
  return {
    features,
    height(x,z){return baseHeight(x,z)+measure(x,z);},
    sample(x,z,near) {
      const out={};
      measure(x,z,out,near);
      return out.kind ? out : groomed;
    }
  };
}

export function snowResponse(height,x,z,dx,dz,speed,surface,dimensions,board) {
  const span=clamp(.65+speed*.071+(dimensions?.deckLength??1)*.26,.75,2.9);
  const ground=height(x,z), behind=height(x-dx*span,z-dz*span), ahead=height(x+dx*span,z+dz*span);
  const load=(ahead+behind-2*ground)*speed*speed/(9.81*span*span);
  const rise=(ground-behind)*speed/span;
  const length=dimensions?.deckLength??(board?1.585:1.753), width=dimensions?.deckWidth??(board?.288:.127);
  const area=length*width*(board?.84:1.42);
  const pressure=(dimensions?.mass??74)*.316/(74*area);
  const flotation=1-.73*smooth(1.2,20,speed);
  return {load,rise, sink:surface.depth*clamp(pressure,.52,1.37)*flotation*.63};
}
