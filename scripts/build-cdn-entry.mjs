import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import {gzipSync} from 'node:zlib';

// Wrap a standalone release HTML in a small CDN entry. A range retry on a
// mobile connection only repeats its missing block. The full HTML also works
// independently, and provides the payload for browsers without gzip streams.
const [source,stamp]=process.argv.slice(2);
if(!source||!/^\d{8}_\d{6}$/.test(stamp))throw Error('Expected standalone HTML path and YYYYMMDD_HHMMSS');
const html=await readFile(source), packed=gzipSync(html,{level:9});
const compressed='chongli-snow_'+stamp+'.bin', entry='chongli-ski_'+stamp+'.html';
const asset=(name,data)=>({name,bytes:data.length,hash:createHash('sha256').update(data).digest('hex')});
const favicon=await readFile(new URL('../public/favicon.svg',import.meta.url),'base64');
const manifest={compressed:asset(compressed,packed),html:asset(basename(source),html)};

async function openGame(files){
  const meter=document.querySelector('progress'),status=document.querySelector('output'),retry=document.querySelector('button');
  const zipped=typeof DecompressionStream==='function';
  const file=zipped?files.compressed:files.html;
  const block=64*1024,parts=new Array(Math.ceil(file.bytes/block));
  let received=0,started=false;
  meter.max=file.bytes;
  function update(bytes=received){
    meter.value=bytes;
    status.textContent=Math.round(bytes*100/file.bytes)+'%';
  }
  // One progressing response is usually faster on a phone than many short
  // requests competing for bandwidth. Keep completed blocks if it stalls.
  async function readStream(){
    if(typeof ReadableStream!=='function')return;
    const controller=new AbortController(),buffer=new Uint8Array(file.bytes);
    let offset=0,timer;
    const watch=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),15000);};
    try{
      watch();
      const response=await fetch(file.name,{signal:controller.signal});
      if(response.status!==200||!response.body?.getReader)return;
      const reader=response.body.getReader();
      while(offset<buffer.length){
        watch();
        const {value,done}=await reader.read();
        if(done)break;
        buffer.set(value,offset);offset+=value.length;update(offset);
      }
    }catch{
      // The range workers below can resume even after a partial response.
    }finally{
      clearTimeout(timer);controller.abort();
      for(let i=0;i<parts.length;i++){
        const start=i*block,end=Math.min(start+block,file.bytes);
        if(end>offset)break;
        parts[i]=buffer.subarray(start,end);received=end;
      }
      update();
    }
  }
  async function fetchPart(i){
    const start=i*block,end=Math.min(start+block,file.bytes)-1;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(file.name+'?part='+i,{headers:{Range:'bytes='+start+'-'+end},signal:controller.signal});
      if(!response.ok)throw Error('HTTP '+response.status);
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(response.status===200&&bytes.length===file.bytes)return bytes.subarray(start,end+1);
      if(response.status!==206||bytes.length!==end-start+1||
          response.headers.get('Content-Range')!=='bytes '+start+'-'+end+'/'+file.bytes)throw Error('Incomplete range');
      return bytes;
    }finally{clearTimeout(timer);}
  }
  async function load(){
    retry.hidden=true;
    let next=0,failed=false;
    async function worker(){
      while(next<parts.length&&!failed){
        const i=next++;
        if(parts[i])continue;
        for(let trial=0;trial<3;trial++){
          try{
            const bytes=await fetchPart(i);parts[i]=bytes;received+=bytes.length;update();break;
          }catch{if(trial===2)failed=true;}
        }
      }
    }
    update();
    try{
      if(!started){started=true;await readStream();}
      if(received<file.bytes)await Promise.all(Array.from({length:3},worker));
      if(failed)throw Error('Download interrupted');
      const blob=new Blob(parts);
      if(window.crypto?.subtle){
        const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
        const hex=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
        if(hex!==file.hash){parts.fill(undefined);received=0;throw Error('Incomplete payload');}
      }
      const content=zipped?await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text():await blob.text();
      document.open();document.write(content);document.close();
    }catch{
      status.textContent='连接中断 · '+Math.round(received*100/file.bytes)+'%';
      retry.hidden=false;
    }
  }
  retry.addEventListener('click',load);await load();
}

const documentSource=`<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#192a31">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${favicon}"><title>山脊之间 · 万龙与云顶滑雪</title><meta name="description" content="从崇礼红花梁出发，在万龙与云顶之间联滑。">
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(155deg,#253e4a,#111f28);color:#f5f3eb;font:15px system-ui,sans-serif}main{width:min(74vw,330px)}h1{font:normal 38px Georgia,serif;letter-spacing:.14em;margin:0 0 24px}p{display:flex;justify-content:space-between}output{font-variant-numeric:tabular-nums;color:#edce99}progress{width:100%;height:4px;accent-color:#edce99}button{margin-top:18px;color:#1c303a;background:#edce99;border:0;border-radius:4px;padding:10px 18px}</style>
<main><h1>山脊之间</h1><p>载入崇礼雪场 <output>0%</output></p><progress></progress><button hidden>继续载入</button></main>
<script>(${openGame.toString()})(${JSON.stringify(manifest)})</script></html>`;
const folder=dirname(source);
await writeFile(join(folder,compressed),packed,{flag:'wx'});
await writeFile(join(folder,entry),documentSource,{flag:'wx'});
console.log(JSON.stringify({entry,compressed,bytes:packed.length,cdn:'https://qupfile.cloudvdn.com/'+entry}));
