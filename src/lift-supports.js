const supportClearance=4.5;

export function placeLiftSupports(points,data){
  const distances=[0];
  for(let i=1;i<points.length;i++)distances.push(distances[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
  const end=distances.at(-1);
  const radius=data.trails.reduce((max,t)=>Math.max(max,(t.width||38)*.5+supportClearance),0);
  function position(along){
    const i=distances.findIndex(d=>d>=along);
    const a=points[i-1],b=points[i],weight=(along-distances[i-1])/(distances[i]-distances[i-1]);
    return [a[0]+(b[0]-a[0])*weight,a[1]+(b[1]-a[1])*weight];
  }
  function clear([x,z]){
    return ![...data.index.corridors(x,z,radius)].some(h=>h.distance<(h.trail.width||38)*.5+supportClearance)
      &&!data.obstacles.contact(x,z,supportClearance);
  }

  const candidates=[];
  for(let i=1;i<points.length;i++){
    const start=distances[i-1],gap=distances[i]-start;
    const divisions=points.length===2?Math.ceil(gap/122):gap>230?Math.ceil(gap/160):1;
    for(let part=1;part<divisions;part++)candidates.push(start+part*gap/divisions);
    if(i<points.length-1)candidates.push(distances[i]);
  }
  const placed=[{along:0,point:points[0]}];
  let last=0;
  for(const [i,along] of candidates.entries()){
    const forwardLimit=Math.min(end-18,(along+(candidates[i+1]??end))*.5);
    const backwardLimit=Math.max(last+18,i===0?18:(along+candidates[i-1])*.5);
    for(const shift of [0,-4,4,-8,8,-14,14,-22,22,-32,32,-46,46,-62,62]){
      const next=along+shift;
      if(next<backwardLimit||next>forwardLimit)continue;
      const point=position(next);
      if(clear(point)){placed.push({along:next,point});last=next;break;}
    }
  }
  placed.push({along:end,point:points.at(-1)});
  const result=[points[0]];
  for(let i=1;i<placed.length;i++){
    const lower=placed[i-1].along,upper=placed[i].along;
    // On a long overlap with a piste, a small local detour places the span's
    // intermediate supports behind the edge without shifting either terminal.
    if(upper-lower>340){
      const count=Math.ceil((upper-lower)/225);
      let side=0;
      for(let step=1;step<count;step++){
        const along=lower+(upper-lower)*step/count;
        const p=position(along),a=position(along-5),b=position(along+5);
        const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz)||1;
        const pad=[0,8,14,20,26,32,38].flatMap(v=>v?[v*(side||1),-v*(side||1)]:[0])
          .map(offset=>({offset,point:[p[0]-dz*offset/len,p[1]+dx*offset/len]}))
          .find(candidate=>clear(candidate.point));
        if(pad){side=Math.sign(pad.offset)||side;result.push(pad.point);}
      }
    }
    result.push(placed[i].point);
  }
  return result;
}
