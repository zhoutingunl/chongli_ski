export const GAME_CLIP_SECONDS=15;

export function canRecordGame(canvas){
  return typeof canvas?.captureStream==='function'&&typeof MediaRecorder==='function';
}

function recordingOptions(canvas, mobile, miniTool, withAudio) {
  const fps=mobile||miniTool?30:60;
  const pixels=canvas.width*canvas.height;
  const rate=pixels*fps*(miniTool?.11:mobile?.16:.20);
  const videoBitsPerSecond=Math.round(Math.min(miniTool?4500000:mobile?10000000:28000000,Math.max(miniTool?2000000:mobile?4500000:8500000,rate)));
  const aac=withAudio?',mp4a.40.2':'',opus=withAudio?',opus':'';
  return {fps,videoBitsPerSecond,types:[
    `video/mp4;codecs=avc1.640033${aac}`,`video/mp4;codecs=avc1${aac}`,'video/mp4',
    `video/webm;codecs=vp9${opus}`,`video/webm;codecs=vp8${opus}`,'video/webm',''
  ]};
}

export function recordGame(canvas,finish,{audio=null,mobile=false,miniTool=false,unlockCanvas}={}){
  const {fps,videoBitsPerSecond,types}=recordingOptions(canvas,mobile,miniTool,!!audio);
  let tracks=[],recorder,timer,ending=false;
  const chunks=[];
  const release=()=>{
    clearTimeout(timer);
    for(const track of tracks)track.stop();
    audio?.release();
    unlockCanvas?.();
  };
  try{
    const stream=canvas.captureStream(fps);
    tracks=stream.getVideoTracks();
    if(!tracks.length)throw new Error('No canvas video track');
    if(audio)stream.addTrack(audio.track);
    const settings={videoBitsPerSecond,...(audio?{audioBitsPerSecond:160000}:{})};
    let lastError;
    for(const mimeType of types){
      if(mimeType&&MediaRecorder.isTypeSupported&&!MediaRecorder.isTypeSupported(mimeType))continue;
      try{
        recorder=new MediaRecorder(stream,mimeType?{...settings,mimeType}:settings);
        // Finalize MP4 in one segment. Some iOS builds generate fragments that
        // play in a browser when joined but fail to import into Photos.
        recorder.start();
        break;
      }catch(error){lastError=error;recorder=null;}
    }
    if(!recorder)throw lastError||new Error('No video encoder available');
    recorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data);};
    recorder.onerror=()=>{if(ending)return;ending=true;release();finish(null);};
    recorder.onstop=()=>{
      if(ending)return;
      ending=true;release();
      const type=(recorder.mimeType||chunks[0]?.type||'video/webm').split(';')[0];
      const blob=new Blob(chunks,{type});
      finish(blob.size?{blob,extension:type==='video/mp4'?'mp4':'webm'}:null);
    };
  }catch(error){ending=true;release();throw error;}
  function stop(){
    clearTimeout(timer);
    if(recorder.state!=='inactive')recorder.stop();
  }
  timer=setTimeout(stop,GAME_CLIP_SECONDS*1000);
  return {stop};
}

export function captureGameAudio(context, sources) {
  const active=sources.filter(Boolean);
  if(!active.length||typeof context?.createMediaStreamDestination!=='function')return null;
  const destination=context.createMediaStreamDestination();
  const track=destination.stream.getAudioTracks()[0];
  if(!track)return null;
  const mix=context.createGain();
  mix.gain.value=.88;
  mix.connect(destination);
  for(const source of active)source.connect(mix);
  return {track,release(){
    for(const source of active)source.disconnect(mix);
    mix.disconnect();
    track.stop();
  }};
}
