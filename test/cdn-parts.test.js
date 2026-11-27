import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';

test('CDN 分块在瞬断时单独补传，旧浏览器也能校验并还原同一份完整网页',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ski-entry-test-'));
  try{
    const source=join(dir,'ski.html'),original='<title>雪场</title>'+randomBytes(410000).toString('base64');
    await writeFile(source,original);
    const script=fileURLToPath(new URL('../scripts/build-cdn-entry.mjs',import.meta.url));
    const info=JSON.parse(execFileSync(process.execPath,[script,source,'20261127_000001','--parts'],{encoding:'utf8'}));
    const pieces=await Promise.all(info.parts.map(name=>readFile(join(dir,name))));
    assert.ok(pieces.length>=3&&pieces.every(p=>p.length<=160*1024));
    assert.equal(gunzipSync(Buffer.concat(pieces)).toString(),original);
    const entry=await readFile(join(dir,info.entry),'utf8');
    const records=Array.from(entry.matchAll(/"hash":"([a-f0-9]{64})"/g),m=>m[1]);
    assert.deepEqual(records,pieces.map(p=>createHash('sha256').update(p).digest('hex')));
    const inline=entry.match(/<script>([\s\S]+?)<\/script>/)[1];
    const elements={progress:{value:0},output:{},button:{addEventListener(){}}};
    const tries=new Map();let rendered;
    const fetch=async name=>{
      const n=tries.get(name)||0;tries.set(name,n+1);
      if(name===info.parts[1]&&!n)throw Error('offline');
      return new Response(pieces[info.parts.indexOf(name)]);
    };
    const doc={querySelector:s=>elements[s],open(){},write(html){rendered=html;},close(){}};
    await runInNewContext(inline,{window:{crypto:globalThis.crypto},crypto:globalThis.crypto,document:doc,fetch,
      AbortController,Blob,Response,TextDecoder,setTimeout,clearTimeout});
    assert.equal(rendered,original);assert.equal(tries.get(info.parts[1]),2);
    assert.equal(tries.get(info.parts[0]),1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
