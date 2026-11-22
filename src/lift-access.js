const distance=(x,z,p)=>Math.hypot(x-p[0],z-p[1]);

export function arrivalLift(data,route){
  const end=route.points.at(-1);
  const lifts=(data.lifts||[]).filter(lift=>lift.resort===route.destination);
  const mapped=lifts.find(lift=>lift.id===route.finishLiftId);
  if(mapped)return mapped;
  const main=lifts.find(lift=>lift.id===(route.destination==='wanlong'?'w1368988315':'w469393391'));
  if(main&&distance(...end,main.points[0])<140)return main;
  return lifts.sort((a,b)=>distance(...end,a.points[0])-distance(...end,b.points[0]))[0];
}

// The hall, outdoor stopping area and two adjacent terminals share one snow forecourt.
export function atWanlongForecourt(data,route,x,z){
  if(route.destination!=='wanlong'||route.finishKind==='training-runout')return false;
  const hall=data.landmarks?.find(place=>place.id==='wanlong-hall'),end=route.points.at(-1);
  if(!hall||distance(hall.x,hall.z,end)>76||distance(x,z,end)>91)return false;
  return Math.abs(data.height(x,z)-data.height(...end))<15;
}

export function nearbyLiftStation(data,sim){
  if(!sim.route||!['run','finished'].includes(sim.mode))return null;
  const {route,x,z}=sim;
  if(sim.mode==='finished'||(!sim.airborne&&sim.speed<3&&atWanlongForecourt(data,route,x,z))){
    const lift=arrivalLift(data,route);
    if(lift)return {lift,end:'bottom'};
  }
  let nearest=null,min=48;
  for(const lift of data.lifts){
    for(const end of ['bottom','top']){
      const p=end==='top'?lift.points.at(-1):lift.points[0];
      const gap=distance(x,z,p);
      if(gap<min){min=gap;nearest={lift,end};}
    }
  }
  return nearest;
}
