import {isMiniTool,photoActions,savePhoto,sharePhoto} from './platform.js';
import {t} from './language.js';

const maxEdge=1600;
function canvasOf(width,height){
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width));canvas.height=Math.max(1,Math.round(height));
  return canvas;
}
export function snapshot(source){
  const w=source.naturalWidth||source.width,h=source.naturalHeight||source.height;
  if(!w||!h)throw Error('Empty photo');
  const scale=Math.min(1,maxEdge/Math.max(w,h));
  const canvas=canvasOf(w*scale,h*scale);
  canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);
  return canvas;
}

// Match widths for landscape pairs and heights for portrait pairs. A mixed pair
// uses the arrangement closer to a 4:5 print. Both originals keep their full frame.
export function composePhotos(scene,real){
  if(!real)return scene;
  const a=scene.width/scene.height,b=real.width/real.height;
  const stacked=1/(1/a+1/b),side=a+b;
  const vertical=Math.abs(Math.log(stacked/.8))<=Math.abs(Math.log(side/.8));
  const ratio=vertical?stacked:side,edge=maxEdge-10;
  const width=Math.round(ratio>=1?edge:edge*ratio),height=Math.round(ratio>=1?edge/ratio:edge);
  const gap=6,canvas=canvasOf(width+(vertical?0:gap),height+(vertical?gap:0));
  const ctx=canvas.getContext('2d');ctx.fillStyle='#f3eee3';ctx.fillRect(0,0,canvas.width,canvas.height);
  if(vertical){
    const h=Math.round(width/a);
    ctx.drawImage(scene,0,0,width,h);ctx.drawImage(real,0,h+gap,width,height-h);
  }else{
    const w=Math.round(height*a);
    ctx.drawImage(scene,0,0,w,height);ctx.drawImage(real,w+gap,0,width-w,height);
  }
  return canvas;
}

function jpeg(canvas){
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Empty JPEG')),'image/jpeg',.94));
}
function dataUrl(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);
  });
}
export function capturePhoto(frame){
  const canvas=snapshot(frame),url=canvas.toDataURL('image/jpeg',.94),name='chongli-'+Date.now()+'.jpg';
  let file;
  return {canvas,url,name,get file(){
    if(!file&&typeof File==='function'){
      const bytes=Uint8Array.from(atob(url.slice(url.indexOf(',')+1)),c=>c.charCodeAt(0));
      file=new File([bytes],name,{type:'image/jpeg'});
    }
    return file;
  }};
}
async function loadReal(file){
  const url=URL.createObjectURL(file);
  try{
    const img=new Image();
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});
    return snapshot(img);
  }finally{URL.revokeObjectURL(url);}
}

export function createPhotoEditor(onClose,currentFrame){
  const dialog=document.querySelector('#photo-dialog');
  const get=selector=>dialog.querySelector(selector);
  const control=id=>get('[data-photo="'+id+'"]');
  let scene,real,output,focus,revision=0;
  function close(){
    revision++;dialog.hidden=true;scene=real=output=null;
    get('#photo-preview').removeAttribute('src');
    get('#real-camera').value=get('#real-album').value='';
    onClose();if(focus?.offsetWidth)focus.focus({preventScroll:true});
  }
  function setActions(actions){
    control('share').hidden=!actions.share;control('save').hidden=!actions.save;control('note').hidden=!actions.note;
    control('share').textContent=actions.share==='note'?t('发图文笔记','Create post'):isMiniTool?t('发给好友','Send to a friend'):t('分享图片','Share image');
    control('note').textContent=t('发图文笔记','Create post');
    control('save').textContent=t('保存图片','Save image');
  }
  async function render(){
    const id=++revision;output=null;
    control('note').disabled=control('share').disabled=control('save').disabled=true;
    control('remove').hidden=!real;
    get('#photo-title').textContent=t('分享雪场','Share the mountain');
    try{
      const blob=await jpeg(composePhotos(scene,real)),url=await dataUrl(blob);
      if(id!==revision)return;
      const file=typeof File==='function'?new File([blob],'chongli-'+Date.now()+'.jpg',{type:'image/jpeg'}):null;
      const actions=photoActions(file);setActions(actions);
      output={url,file};
      get('#photo-preview').src=url;
      get('#photo-status').textContent=!actions.share&&!actions.save?t('长按预览图保存。','Press and hold the preview to save.'):
        !actions.share?t('可保存图片后分享。','Save the image to share it.'):'';
    }catch{if(id===revision)get('#photo-status').textContent=t('照片生成失败，请重新拍摄。','Could not create this photo. Please retake it.');}
    finally{if(id===revision)control('note').disabled=control('share').disabled=control('save').disabled=!output;}
  }
  for(const id of ['camera','album']){
    control(id).addEventListener('click',()=>{const input=get('#real-'+id);input.value='';input.click();});
    get('#real-'+id).addEventListener('change',async e=>{
      const file=e.target.files[0];if(!file)return;
      const id=++revision;
      try{const photo=await loadReal(file);if(id!==revision)return;real=photo;await render();}
      catch{if(id===revision)get('#photo-status').textContent=t('无法读取这张照片，请重新选择图片。','Could not read this photo. Choose another image.');}
    });
  }
  control('retake').addEventListener('click',()=>{
    const frame=currentFrame?.();if(!frame)return;
    scene=snapshot(frame);render();
  });
  control('close').addEventListener('click',close);
  control('remove').addEventListener('click',()=>{real=null;render();});
  for(const act of ['save','share','note'])control(act).addEventListener('click',async()=>{
    if(!output)return;
    const id=revision;const b=control(act);b.disabled=true;
    try{
      if(act==='save'){
        await savePhoto(output.url,output.file);
        if(id===revision)get('#photo-status').textContent=isMiniTool?t('已保存至相册。','Saved to Photos.'):t('已请求下载。如浏览器未显示下载，可长按图片保存。','Download requested. You can also press and hold the image to save.');
      }else await sharePhoto(output.url,output.file,act==='note');
    }catch(error){if(id===revision&&error?.name!=='AbortError')get('#photo-status').textContent=t('操作未完成，可重试或长按图片保存。','Try again, or press and hold the image to save.');}
    finally{if(id===revision)b.disabled=false;}
  });
  return {
    get visible(){return !dialog.hidden;},close,
    key(e){
      if(e.code==='Escape'){e.preventDefault();close();}
      else if(e.code==='Tab'){
        const buttons=[...dialog.querySelectorAll('button')].filter(b=>!b.hidden&&!b.disabled);
        const first=buttons[0],last=buttons.at(-1);
        if((e.shiftKey&&document.activeElement===first)||(!e.shiftKey&&document.activeElement===last)){
          e.preventDefault();(e.shiftKey?last:first).focus();
        }
      }
    },
    open(frame,allowRetake=true){
      scene=snapshot(frame);real=null;focus=document.activeElement;dialog.hidden=false;
      get('[data-act="share-videos"]').textContent=t('滑行录像','Video');
      get('.share-media-nav strong').textContent=t('雪场照片','Photo');
      control('retake').hidden=!currentFrame||!allowRetake;control('retake').textContent=t('重拍雪景','Retake ski view');
      get('#photo-preview').alt=t('照片预览','Photo preview');
      get('#photo-hint').textContent=t('拍一张实景或从相册选图，即可和眼前的雪场拼成一张。','Take or choose a real photo to pair with this view.');
      get('#photo-status').textContent='';control('camera').textContent=t('拍实景','Take a photo');
      control('album').textContent=t('选相册照片','Choose photo');control('remove').textContent=t('仅用雪场照','Remove real photo');
      control('close').setAttribute('aria-label',t('返回雪场','Back to the slope'));
      control('close').focus({preventScroll:true});render();
    }
  };
}
