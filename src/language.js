let language='zh';
export function setLanguage(value){language=value==='en'?'en':'zh';document.documentElement.lang=language==='en'?'en':'zh-CN';}
export const t=(zh,en)=>language==='en'?en:zh;
const labels={
  '万龙':'Wanlong','云顶':'Genting','红花梁':'Honghualiang','山顶':'Summit','雪场地图':'Trail map','拍照':'Photo','环境':'Environment','视角':'Camera','角色':'Rider','排行榜':'Leaderboard','分享':'Share','操作说明':'Controls','设置':'Settings','机位工具':'Camera tools','切换视角':'Switch camera','关闭':'Close','返回':'Back',
  '双板':'Skis','单板':'Snowboard','男士':'Man','女士':'Woman','男孩':'Boy','女孩':'Girl','赭红':'Rust','麦金':'Wheat','松绿':'Pine','冰蓝':'Glacier','雪灰':'Snow',
  '追尾':'Follow','第一人称':'First person','雪板尖':'Board tips','贴雪':'Snow level','俯瞰':'Overhead','左侧':'Left side','右侧':'Right side','正面':'Front','远摄':'Telephoto',
  '自动':'Auto','白天':'Day','傍晚':'Evening','日落':'Sunset','黄昏':'Twilight','夜晚':'Night','极夜之光':'Aurora','黎明':'Dawn','晴':'Clear','小雪':'Light snow','大雪':'Heavy snow',
  '开启':'On','显示':'Show','隐藏':'Hide','流畅':'Low','精细':'High','初级':'Easy','中级':'Intermediate','高级':'Advanced','专家':'Expert','道外':'Off-piste','刹车':'Brake','加速':'Tuck','跳':'Jump','上车':'Board lift','选择雪道':'Choose a trail','全景':'Panorama','山顶木屋':'Summit lodge','金花阁':'Jinhua Pavilion','索道站':'Lift station',
  '万龙山顶木屋':'Wanlong summit lodge','万龙雪具大厅':'Wanlong ski hall','云顶滑雪大厅':'Genting ski hall','龙宫酒店':'Longgong Hotel','云顶大酒店':'Genting Grand Hotel',
  '金龙道 · 玉龙道':'Golden Dragon · Jade Dragon','银龙道 · 大奔头':'Silver Dragon · Dà Bēntóu','长龙道 · 玉龙道':'Long Dragon · Jade Dragon','长龙道 · 卧龙道':'Long Dragon · Sleeping Dragon','芍药花 · 雪绒花':'Peony · Edelweiss','曼陀罗 · 剪秋萝':'Datura · Catchfly','山丹丹联滑线':'Lily Traverse to Genting','翠菊花联滑线':'Aster Traverse to Wanlong',
  '游龙道':'Wandering Dragon','银龙道':'Silver Dragon','腾龙道':'Rising Dragon','金龙道':'Golden Dragon','飞龙道':'Flying Dragon','风龙道':'Wind Dragon','海龙道':'Sea Dragon','云龙道':'Cloud Dragon','雪龙道':'Snow Dragon','霜龙道':'Frost Dragon','炫龙道':'Dazzling Dragon','猛龙道':'Mighty Dragon','酷龙道':'Cool Dragon','小龙道':'Little Dragon','中华龙道':'Chinese Dragon','玉龙道':'Jade Dragon','娇龙道':'Graceful Dragon','五彩龙道':'Rainbow Dragon','威龙道':'Grand Dragon','祥龙道':'Lucky Dragon','绿龙道':'Green Dragon','黄龙道':'Yellow Dragon','雪绒花':'Edelweiss','锦带花':'Weigela','蒲公英':'Dandelion','紫丁香':'Lilac','薰衣草':'Lavender','坡面障碍技巧':'Slopestyle','银莲花':'Anemone','野玫瑰':'Wild Rose','狼毒花':'Spurge','曼陀罗':'Datura','田旋花':'Bindweed','玉竹':'Solomon’s Seal','花锚':'Felwort','野罂粟':'Wild Poppy','水杨梅':'Water Avens','向日葵':'Sunflower','铁线莲':'Clematis','凤仙花':'Balsam','太浩岩壁':'Tahoe Wall','蓝刺头/迪桑特挑战之道':'Globe Thistle / Descente Challenge','白芷花':'Angelica','风铃草':'Bellflower','布勒道':'Buller','百里香':'Thyme','野蔷薇':'Wild Briar','天仙子':'Henbane','U型池':'Halfpipe','长龙道':'Long Dragon','短龙道':'Short Dragon','雨龙道':'Rain Dragon','恐龙道':'Dinosaur','山丹丹':'Lily Traverse','芍药花':'Peony','雪上技巧':'Moguls','空中技巧':'Aerials','卧龙道':'Sleeping Dragon','逸龙道':'Leisure Dragon','山脊连接道':'Ridge Traverse','翠菊花':'Aster Traverse','追逐道':'Ski Cross','拉链蘑菇':'Zipper Moguls','蓝刺头':'Globe Thistle','紫龙道':'Purple Dragon','剪秋萝':'Catchfly','雪上技巧索道':'Moguls Lift',
  '翔龙道':'Soaring Dragon','大奔头':'Da Bentou','雾龙道':'Mist Dragon','赤龙道':'Red Dragon','柳兰':'Fireweed','花苜蓿':'White Clover','金莲花':'Golden Lotus','金莲花入口':'Golden Lotus entrance','风铃草入口':'Bellflower entrance','平行大回转':'Parallel Giant Slalom','障碍追逐':'Ski Cross','U型场地':'Halfpipe','空中技巧训练基地':'Aerials training area','云顶滑雪地形公园':'Genting Terrain Park','单板练习区':'Snowboard practice area','霜龙谷':'Frost Dragon Glade',
  '读取红花梁地形':'Loading Honghualiang terrain','铺展雪道与远山':'Drawing trails and distant ridges','装配雪具与索道':'Fitting equipment and lifts'
};
const numbers={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
export function label(str, lang=language){
  if(!str||lang!=='en')return str||'';
  if(labels[str])return labels[str];
  const match=str.match(/^([一二三四五六七八九]|\d+)索/);
  if(match)return 'Lift '+(numbers[match[1]]??match[1]);
  return labels[str.replace(/[（(].*$/,'')]||str;
}
