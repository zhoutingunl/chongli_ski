// Local coordinates: the root is at y=0, crown height is one. Sprays and their
// snow loads have depth; moving around a tree reveals the underside of a bough.
const tau=2*Math.PI;
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mul=(a,k)=>a.map(v=>v*k);
const mix=(a,b,k)=>add(a,mul(sub(b,a),k));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>mul(a,1/(Math.hypot(...a)||1));
const up=[0,1,0];
function seeded(seed){return ()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};}
export function woodlandTree(style,species,variant){
  const random=seeded(13267+species*733+variant*2707),positions=[],pigments=[],shades=[],brush=[];
  const {mark}=style;
  let spray=null;
  function triangle(a,b,c,colour,shade){
    positions.push(...a,...b,...c);pigments.push(colour,colour,colour);shades.push(shade,shade,shade);
    for(const point of [a,b,c]){
      if(!spray){brush.push(-2,0);continue;}
      const v=sub(point,spray.a),d=spray.dir,t=spray.side;
      brush.push((v[0]*d[0]+v[1]*d[1]+v[2]*d[2])/spray.length,(v[0]*t[0]+v[2]*t[2])/spray.width);
    }
  }
  function tube(a,b,r0,r1,sides,colour=0){
    const axis=unit(sub(b,a)),right=unit(cross(axis,Math.abs(axis[1])>.90?[1,0,0]:up)),front=cross(axis,right);
    function ring(angle){return add(mul(right,Math.cos(angle)),mul(front,Math.sin(angle)));}
    for(let i=0;i<sides;i++){
      const v=ring(tau*i/sides),w=ring(tau*(i+1)/sides);
      const a0=add(a,mul(v,r0)),a1=add(a,mul(w,r0)),b0=add(b,mul(v,r1)),b1=add(b,mul(w,r1));
      const band=colour===0&&i===1?1:colour,shade=.87+.12*Math.cos(i*2.4);
      triangle(a0,a1,b0,band,shade);triangle(a1,b1,b0,band,shade);
    }
  }
  // A single brush-shaped sprig: an ink wedge, block-print cut, curled oil
  // stroke, rounded dab, gilded edge or thin frost. Its top is a snow cap.
  function frond(a,b,width,load){
    const dir=unit(sub(b,a)),side=unit(cross(dir,up)),mid=mix(a,b,.48);
    spray={a,dir,side,width,length:Math.hypot(...sub(b,a))};
    const wide=mul(side,width),underside=add(mid,[0,-width*.55,0]);
    const left=add(mid,wide),right=sub(mid,wide),ridge=add(mid,[0,width*load,0]);
    const tip=add(b,[0,mark==='flame'?width*.96:0,0]),s=.86+random()*.18;
    triangle(a,underside,left,2,s);triangle(underside,tip,left,3,s);triangle(a,right,underside,2,s);triangle(right,tip,underside,2,s);
    const coat=mark==='nib'?.65:mark==='cut'?.78:.88;
    const l=mix(ridge,left,coat),r=mix(ridge,right,coat),end=mix(ridge,tip,.84+random()*.13);

    // The dark margins and pale cap share only edges. Overlapping coplanar
    // triangles here would shimmer as the eye moves past the branch.
    triangle(a,left,l,3,s);triangle(left,tip,l,3,s);triangle(l,tip,end,3,s);
    triangle(a,r,right,3,s);triangle(right,r,tip,2,s);triangle(r,end,tip,3,s);
    if(mark==='dab'){
      const back=add(mix(a,ridge,.54),[0,width*.23,0]),nose=add(mix(ridge,end,.59),[0,width*.19,0]);
      triangle(back,l,ridge,4,s);triangle(back,ridge,r,5,s);triangle(l,nose,ridge,4,s);triangle(ridge,nose,r,5,s);triangle(l,end,nose,5,s);triangle(nose,end,r,6,s);
    }else{
      triangle(a,l,ridge,4,s);triangle(l,end,ridge,4,s);triangle(a,ridge,r,5,s);triangle(ridge,end,r,5,s);
      if(mark==='gilt'||mark==='flame'){
        const offset=[0,width*.055,0];
        triangle(add(mix(ridge,l,.18),offset),add(end,offset),add(ridge,offset),6,s);
      }
    }
    spray=null;
  }
  const lean=(variant?-.032:.025)*(mark==='flame'?1.8:1),bend=mark==='flame'?.030:.012;
  const stem=y=>[lean*y*y+bend*Math.sin(y*5.1)*y,y,.016*Math.sin(y*4.3+variant)*y];
  function trunk(y,young=false){return (young?.012:.017)*Math.pow(Math.max(.002,1-y),.76)+.0007;}
  for(let k=0;k<8;k++)tube(stem(k/8),stem((k+1)/8),trunk(k/8),trunk((k+1)/8),6);
  if(species===2){
    // Open deciduous crown. Forks rebranch in depth; rime settles on only
    // one side of the twig. Keep sky holes between the principal limbs.
    function fork(a,az,length,radius,depth,rise){
      const arc=(random()-.48)*.74+style.sweep*.41;
      const mid=add(a,[Math.cos(az)*length*.48,length*rise*.44,Math.sin(az)*length*.48]);
      const tip=add(mid,[Math.cos(az+arc)*length*.45,length*rise*.67,Math.sin(az+arc)*length*.45]);
      tube(a,mid,radius,radius*.76,depth>1?4:3);tube(mid,tip,radius*.78,radius*.45,3);
      const capA=add(mid,[0,radius*.83,0]),capB=add(tip,[0,radius*.53,0]);
      if(depth||random()<.68)frond(capA,capB,radius*(mark==='dab'?2.7:1.28),style.cap*.42);
      if(!depth)return;
      fork(tip,az+arc+(random()-.42)*.67,length*(.58+random()*.13),radius*.53,depth-1,rise*1.22);
      fork(mix(mid,tip,.28),az+arc+(random()>.5?1:-1)*(.59+random()*.78),length*.59,radius*.47,depth-1,rise*1.12);
    }
    for(let j=0;j<14;j++){
      const y=.21+j*.049,angle=j*2.40+random()*.43;
      fork(stem(y),angle,(.12+.15*Math.sin((y-.05)*Math.PI))*(1.-.47*y)*style.spread,.0075*(1.1-.58*y),2,.62+random()*.55);
    }
  }else{
    const dense=species===1,tiers=style.tiers+(dense?1:0),start=dense?.10:.23;
    for(let j=0;j<tiers;j++){
      const h=start+(j+.37)/tiers*(.98-start),base=(1-h)**.75*(dense?.48:.38)*style.spread;
      const count=(dense?8:7)+(j%2),phase=j*2.37+random()*.7;
      for(let k=0;k<count;k++){
        const y=h+(random()-.5)*(dense?.083:.13),angle=phase+(k+random()*.45)*tau/count;
        const a=stem(y),span=base*(.74+random()*.37),swirl=style.sweep*(.45+random()*.8);
        const clearance=Math.min(1,Math.max(.01,y-.032)/(span*(style.droop*3.3+.21)));
        const path=t=>add(a,[Math.cos(angle+swirl*t)*span*t,clearance*span*(-style.droop*3.3*Math.sin(Math.PI*t*.87)+style.lift*2.8*t*t),Math.sin(angle+swirl*t)*span*t]);
        const mid=path(.55),end=path(1),radius=.0037+.007*span;
        tube(a,mid,radius,radius*.63,3);tube(mid,end,radius*.66,.0009,3);
        const sprays=style.sprays+(dense?1:0);
        for(let s=0;s<sprays;s++){
          const t=(s+.8)/(sprays+1),startP=path(t),az=angle+swirl*t;
          for(const side of [-1,1]){
            const lateral=span*(.28-.16*t)*side*(.75+.48*random()),ahead=span*(.21+.07*random());
            const tip=add(startP,[Math.cos(az)*ahead-Math.sin(az)*lateral,-span*clearance*(dense?.08:.038)+style.lift*lateral*side,Math.sin(az)*ahead+Math.cos(az)*lateral]);
            const width=span*(.080-.037*t)*(dense?1:.72)*(mark==='cut'?1.22:1);
            frond(startP,tip,width,style.cap);
            // The pendant bud divides into two thinner, overlapping sprays.
            const joint=mix(startP,tip,.59);
            for(const sideBud of [-1,1]){
              const wing=sideBud*width*(1.25+random()*.8),drop=clearance*span*(.018+random()*.087);
              const bud=add(tip,[-Math.sin(az)*wing+Math.cos(az)*ahead*.20,-drop,Math.cos(az)*wing+Math.sin(az)*ahead*.20]);
              const back=mix(joint,bud,.48),spread=mul(unit(cross(sub(bud,joint),up)),width*.30);
              triangle(joint,add(back,spread),bud,sideBud>0?4:3,s===0?.96:.88);triangle(joint,bud,sub(back,spread),sideBud>0?5:2,.97);
            }
          }
        }
        frond(mid,end,.041*span,style.cap);
      }
    }
  }
  let top=1;for(let i=1;i<positions.length;i+=3)top=Math.max(top,positions[i]);
  for(let i=1;i<positions.length;i+=3)positions[i]/=top;
  return {positions,pigments,shades,brush};
}
