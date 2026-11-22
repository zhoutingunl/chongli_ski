export function appleMobile(nav=navigator) {
  return /iPhone|iPad|iPod/i.test(nav.userAgent) || (/Mac/i.test(nav.platform)&&nav.maxTouchPoints>1);
}

export function canShareVideo(file,nav=navigator) {
  if(file?.type!=='video/mp4'||typeof nav.share!=='function'||typeof nav.canShare!=='function')return false;
  try{return nav.canShare({files:[file]});}
  catch{return false;}
}

export async function shareVideoFile(file,nav=navigator) {
  const share=nav.share({files:[file]});
  if(typeof share?.then!=='function')throw new Error('File share sheet unavailable');
  await share;
}
