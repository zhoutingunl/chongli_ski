import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {webcrypto} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';

test('公网入口在压缩和兼容模式下都按块校验并从中断处续载',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'chongli-entry-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const sample=Buffer.alloc(180000);let seed=73831;
  for(let i=0;i<sample.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;sample[i]=seed&255;}
  const content='<html lang="zh-CN">雪道 '+sample.toString('base64')+'</html>';
  const original=join(dir,'game.html');await writeFile(original,content);
  const script=fileURLToPath(new URL('../scripts/build-cdn-entry.mjs',import.meta.url));
  const {entry,compressed}=JSON.parse(execFileSync(process.execPath,[script,original,'20261124_010000'],{encoding:'utf8'}));
  const code=(await readFile(join(dir,entry),'utf8')).match(/<script>([\s\S]*?)<\/script>/)[1];
  for(const gzip of [true,false]){
    const bytes=await readFile(gzip?join(dir,compressed):original),calls=new Map();
    let interrupted=true,written;
    const button={addEventListener(_,fn){this.click=fn;}},meter={},status={};
    const document={
      querySelector:sel=>({progress:meter,output:status,button})[sel],
      open(){},write(html){written=html;},close(){}
    };
    async function fetch(url,opts){
      assert.equal(url.split('?')[0],gzip?compressed:'game.html');
      const [start,end]=opts.headers.Range.slice(6).split('-').map(Number);
      calls.set(start,(calls.get(start)||0)+1);
      if(start===65536&&interrupted)throw Error('Connection interrupted');
      return new Response(bytes.subarray(start,end+1),{status:206,headers:{'Content-Range':'bytes '+start+'-'+end+'/'+bytes.length}});
    }
    await runInNewContext(code,{document,fetch,Response,Blob,AbortController,setTimeout,clearTimeout,
      crypto:webcrypto,window:{crypto:webcrypto},DecompressionStream:gzip?DecompressionStream:undefined});
    assert.equal(written,undefined);assert.equal(button.hidden,false);assert.equal(calls.get(65536),3);
    interrupted=false;await button.click();
    assert.equal(written,content);assert.equal(calls.get(0),1);assert.equal(calls.get(65536),4);

    for(const broken of [false,true]){
      await t.test(`${gzip?'压缩':'兼容'}入口整包${broken?'中断后仅补缺块':'一次读取完成'}`,async()=>{
        let whole=0,blocks=0;written=undefined;meter.value=0;
        async function streamOrPart(url,opts){
          if(opts.headers){
            const start=Number(opts.headers.Range.slice(6).split('-')[0]);
            assert.ok(start>=65536);blocks++;return fetch(url,opts);
          }
          whole++;
          let first=true;
          return new Response(new ReadableStream({pull(controller){
            if(first){controller.enqueue(bytes.subarray(0,70000));first=false;}
            else if(broken)controller.error(new Error('Dropped stream'));
            else{controller.enqueue(bytes.subarray(70000));controller.close();}
          }}));
        }
        await runInNewContext(code,{document,fetch:streamOrPart,Response,Blob,ReadableStream,AbortController,setTimeout,clearTimeout,
          crypto:webcrypto,window:{crypto:webcrypto},DecompressionStream:gzip?DecompressionStream:undefined});
        assert.equal(written,content);assert.equal(whole,1);
        assert.equal(blocks,broken?Math.ceil(bytes.length/65536)-1:0);
        assert.equal(meter.value,bytes.length);
      });
    }
  }
});
