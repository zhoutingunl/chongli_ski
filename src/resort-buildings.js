// Footprints remain the public OSM polygons in mountain.json. The source of
// the tier count is independent: only Liyuan's six floors are documented here.
const labels = [
  {name:'云顶世界酒店',en:'Genting World Hotel',id:'w468688157',resort:'genting',near:[2094.6,-105.1]},
  {name:'云顶丽苑',en:'Genting Residence',id:'w1368622243',resort:'genting',near:[1615,-303]},
  {name:'双龙酒店',en:'Shuanglong Hotel',id:'w259557731',resort:'wanlong',near:[-786,-1572]},
  {name:'盛龙公寓',en:'Shenglong Apartments',id:'w1032077621',resort:'wanlong',near:[-255,-1580]},
  {name:'万龙阅读空间',en:'Wanlong Reading Room',id:'w1153883030',resort:'wanlong',near:[-219,-33]},
  {name:'雪板寄存处',en:'Ski Storage',id:'w1153883045',resort:'wanlong',near:[-803,-1480]}
];

export const resortBuildingLabels=labels;
const signIndex=new Map(labels.map((l,i)=>[l.id,i]));
const specs=new Map();
const add=(ids,style,floors,source='estimate')=>{
  for(const id of ids)specs.set(id,{style,floors,source});
};
add(['w468688157'],'world',5);
add(Array.from({length:8},(_,i)=>'w136862224'+i),'liyuan',6,'published');
add(['w259557731'],'shuanglong',5);
add(['w1032077621'],'shenglong',5);
add(['w1153883030'],'reading',2);
add(['w1153883045'],'storage',2);
add(['w1153883037','w1153883038'],'annex',3);
add(['w1153883029','w1153883044','w259725252','w259554782','w1153883033'],'service',2);
add(['w259724875','w259724876','w259724877','w259724878','w259724879','w259724880','w259724881',
  'w259725251','w1153883034','w1153883035','w1153883036'],'chalets',2);

export function resortBuildingSpec(building){
  const spec=specs.get(building.id);
  if(!spec)return null;
  const documented=spec.source==='published';
  const floors=documented?spec.floors:building.levels??spec.floors;
  const labelIndex=signIndex.get(building.id);
  return {...spec,floors,source:documented?'published':building.levels?'osm':spec.source,labelIndex,
    sign:labelIndex===undefined?undefined:labels[labelIndex]};
}

export function resortBuildingPlaces(buildings=[]){
  const byId=new Map(buildings.map(b=>[b.id,b]));
  return labels.flatMap(l=>{
    const b=byId.get(l.id);
    return b?[{...l,kind:'building',x:b.x,z:b.z}]:[];
  });
}
