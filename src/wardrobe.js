// Stable colour keys keep saved preferences usable. Each key selects a complete outfit
// tailored to the rider, in jacket, contrast panel, trousers and helmet order.
export const colourKeys = ['#aa5536', '#ba9041', '#597b78', '#476d91', '#c5c3b6'];
export const riderRoles = ['male', 'female', 'boy', 'girl'];
const signatureColour = {male:'#476d91', female:'#aa5536', boy:'#ba9041', girl:'#597b78'};
export function fittingColour(role, remembered) {
  const key = remembered?.[role];
  return colourKeys.includes(key) ? key : signatureColour[role];
}
const looks = {
  male: [
    ['砖红砂岩','Red sandstone','#ad5338','#edc685','#2b3037','#313842'],
    ['金褐岩层','Amber ridge','#aa772b','#efcf88','#302e32','#393e44'],
    ['冷杉森林','Silver fir','#366d64','#c5ded1','#263c40','#344347'],
    ['深蓝山脊','Alpine blue','#235392','#d4def0','#242c39','#333d4a'],
    ['岩灰雪线','Snowline','#b7b9ac','#474e54','#333941','#505966']
  ],
  female: [
    ['野蔷薇','Wild rose','#cd6585','#fff0ec','#f6edea','#fff4ee'],
    ['杏花初雪','Apricot snow','#df9466','#fff1d8','#f0e7dc','#fff5e2'],
    ['冰湖青','Glacial teal','#4e9d9e','#fff6e9','#edeef0','#fcf8ee'],
    ['鸢尾蓝','Blue iris','#647dbd','#ecf2ff','#eceef9','#f2f3ff'],
    ['珍珠梅','Pearl plum','#b5a1b7','#fff6ef','#f3e9ef','#fff8ef']
  ],
  boy: [
    ['橙蓝探险','Tangerine trek','#ef7637','#294d8c','#263952','#236baf'],
    ['荧光黄蓝','Lime racer','#d2e83d','#265db1','#263552','#2467b6'],
    ['松石青柠','Turquoise lime','#168e9a','#e7e442','#193c56','#d0df35'],
    ['钴蓝青柠','Cobalt lime','#235bba','#d6e439','#222f49','#d5dd32'],
    ['冰川橙','Glacier orange','#8eb9d4','#fa8c40','#243954','#3176b1']
  ],
  girl: [
    ['桃粉云朵','Peach clouds','#f8dfe5','#eb95b6','#9a6eb2','#eb86ac'],
    ['奶杏云朵','Apricot clouds','#fae9d1','#ebb093','#a57da8','#f8a6a6'],
    ['薄荷云朵','Mint clouds','#d3efdf','#92d6c1','#a27cb9','#f39abd'],
    ['天青云朵','Sky clouds','#dceaf7','#a3c8e5','#9d81c5','#e792b6'],
    ['香芋云朵','Lilac clouds','#ede2f6','#caacd9','#9c6cb2','#f39ebf']
  ]
};
export function outfitFor(gender, key) {
  const row = looks[gender] || looks.male;
  const index = colourKeys.indexOf(key);
  const [name, english, coat, accent, pants, helmet] = row[index < 0 ? 0 : index];
  return {name, english, coat, accent, pants, helmet};
}
