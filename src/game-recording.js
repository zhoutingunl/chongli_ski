export const GAME_CLIP_SECONDS=15;

export function canRecordGame(canvas){
  return typeof canvas?.captureStream==='function'&&typeof MediaRecorder==='function';
}

export function recordGame(canvas,finish){
  const stream=canvas.captureStream(24);
  const types=['video/mp4;codecs=avc1.42001E','video/mp4','video/webm;codecs=vp8','video/webm'];
  const mimeType=types.find(type=>MediaRecorder.isTypeSupported?.(type));
  const tracks=stream.getTracks(),chunks=[];
  let recorder,timer,ending=false;
  const release=()=>{clearTimeout(timer);for(const track of tracks)track.stop();};
  try{
    if(!stream.getVideoTracks().length)throw new Error('No canvas video track');
    recorder=new MediaRecorder(stream,{...(mimeType?{mimeType}:{}),videoBitsPerSecond:1800000});
    recorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data);};
    recorder.onerror=()=>{if(ending)return;ending=true;release();finish(null);};
    recorder.onstop=()=>{
      if(ending)return;
      ending=true;release();
      const type=recorder.mimeType||chunks[0]?.type||mimeType||'video/webm';
      const blob=new Blob(chunks,{type});
      finish(blob.size?{blob,extension:type.includes('mp4')?'mp4':'webm'}:null);
    };
    recorder.start(250);
  }catch(error){ending=true;release();throw error;}
  function stop(){
    clearTimeout(timer);
    if(recorder.state!=='inactive')recorder.stop();
  }
  timer=setTimeout(stop,GAME_CLIP_SECONDS*1000);
  return {stop};
}
