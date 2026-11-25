const fs=require('node:fs');
const path=require('node:path');
const project=process.cwd();
const esbuild=require('node:module').createRequire(path.join(project,'package.json'))('esbuild');
const [outDir,stamp,mode]=process.argv.slice(2);
if(!outDir||!/^\d{8}_\d{6}$/.test(stamp)||mode&&mode!=='--stream-art')throw Error('Expected output directory, YYYYMMDD_HHMMSS and optional --stream-art');
fs.mkdirSync(outDir,{recursive:true});
const read=p=>fs.readFileSync(path.join(project,p),'utf8');
const outName='chongli-ridgeline_'+stamp+'.html';
const cdn='https://qupfile.cloudvdn.com/'+outName;

function replaceOne(source,pattern,replacement){
  if(!source.includes(pattern)||source.indexOf(pattern)!==source.lastIndexOf(pattern))throw Error('Unexpected input around '+pattern);
  return source.replace(pattern,()=>replacement);
}
const helper = [
 'let assets; const urls=new Map();',
 'export function packagedAssetUrl(key){',
 '  if(urls.has(key))return urls.get(key);',
 '  if(!assets){const tag=document.getElementById("ridge-assets");assets=JSON.parse(tag.textContent);tag.remove();}',
 '  const entry=assets[key];if(!entry)throw new Error("Missing packaged asset "+key);',
 '  const [type,text,value]=entry;if(type==="external")return new URL(value,document.baseURI).href;let bytes=value;',
 '  if(!text){const decoded=atob(value);bytes=new Uint8Array(decoded.length);for(let i=0;i<bytes.length;i++)bytes[i]=decoded.charCodeAt(i);}',
 '  const url=URL.createObjectURL(new Blob([bytes],{type}));urls.set(key,url);delete assets[key];return url;',
 '}'
].join('\n');
const singleFileAssets={
 name:'packaged-asset-urls',
 setup(build){
   build.onResolve({filter:/^ridge-asset-library$/},()=>({path:'assets',namespace:'embedded'}));
   build.onLoad({filter:/.*/,namespace:'embedded'},()=>({contents:helper,loader:'js'}));
   build.onLoad({filter:/\/src\/(main|platform|landscape|resort)\.js$/},args=>{
     const name=path.basename(args.path);let code=fs.readFileSync(args.path,'utf8');
     if(name==='main.js'){
       code=replaceOne(code,'href="./assets/geo/mountain.json" download','href="\'+packagedAssetUrl("geo/mountain.json")+\'" download="mountain.json"');
       code=replaceOne(code,'href="./assets/art/credits.txt"','href="\'+packagedAssetUrl("art/credits.txt")+\'"');
     } else if(name==='platform.js'){
       code=replaceOne(code,"import.meta.env.BASE_URL+'assets/geo/'+name+'.json'","packagedAssetUrl(\"geo/\"+name+\".json\")");
     } else if(name==='landscape.js'){
       code=replaceOne(code,"const asset = name => import.meta.env.BASE_URL+'assets/'+name;",'const asset=packagedAssetUrl;');
       code=replaceOne(code,'new URL(file,document.baseURI).href',"packagedAssetUrl('groves/'+file)");
     } else {
       const original='new URL('+String.fromCharCode(96)+'assets/resort/'+String.fromCharCode(36)+'{name}.webp'+String.fromCharCode(96)+', document.baseURI).href';
       code=replaceOne(code,original,'packagedAssetUrl("resort/"+name+".webp")');
     }
     return {contents:'import {packagedAssetUrl} from "ridge-asset-library";\n'+code,loader:'js',resolveDir:path.dirname(args.path)};
   });
 }
};
(async()=>{
  const compiled=await esbuild.build({absWorkingDir:project,entryPoints:['src/main.js'],bundle:true,write:false,format:'iife',target:['safari16','chrome100'],platform:'browser',minify:true,legalComments:'inline',loader:{'.css':'empty'},define:{'import.meta.env.BASE_URL':'"/"','process.env.NODE_ENV':'"production"'},plugins:[singleFileAssets]});
  const js=compiled.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
  const types={'.jpg':'image/jpeg','.webp':'image/webp','.png':'image/png','.txt':'text/plain;charset=utf-8','.json':'application/json'};
  const dest='public/assets',table={};const cover='art/ridgeline.webp';
  for(const folder of fs.readdirSync(dest)){
    for(const file of fs.readdirSync(path.join(dest,folder))){
      const key=folder+'/'+file;if(key===cover)continue;
      const ext=path.extname(file),type=types[ext];if(!type)throw Error('Unknown asset '+key);
      const text=ext==='.json'||ext==='.txt',data=fs.readFileSync(path.join(dest,key));
      table[key]=[type,text,data.toString(text?'utf8':'base64')];
    }
  }
  const atlases=JSON.parse(read('src/grove-atlases.json')),surfaces=JSON.parse(read('src/art-surfaces.json'));
  const artFiles=[...Object.values(atlases),...Object.values(surfaces).flatMap(Object.values)],art=[];
  for(const file of artFiles){
    const bytes=fs.readFileSync(path.join('public',file));
    if(mode==='--stream-art'){
      const name=file.replace('.webp','_'+stamp+'.webp');fs.writeFileSync(path.join(outDir,name),bytes,{flag:'wx'});
      table['groves/'+file]=['external',false,name];art.push(name);
    }else table['groves/'+file]=['image/webp',false,bytes.toString('base64')];
  }
  const coverUri='data:image/webp;base64,'+fs.readFileSync(path.join(dest,cover)).toString('base64');
  const css=replaceOne(read('src/style.css'),"url('/assets/art/ridgeline.webp')",'url("'+coverUri+'")');
  const cssmin=await esbuild.transform(css,{loader:'css',minify:true,target:['safari16','chrome100']});
  let html=read('index.html').replace(/^\s*<meta property="og:image"[^>]+>/m,'').replace(/^\s*<link rel="preload" as="image"[^>]+>/m,'');
  html=html.replace(/(<link rel="canonical" href=")[^"]+/,(_,prefix)=>prefix+cdn);
  html=replaceOne(html,'href="./favicon.svg"','href="data:image/svg+xml;base64,'+fs.readFileSync('public/favicon.svg').toString('base64')+'"');
  html=replaceOne(html,'</head>','<style>'+cssmin.code+'</style>\n</head>');
  const lib=JSON.stringify(table).replace(/</g,'\\u003c');
  html=replaceOne(html,'<script type="module" src="/src/main.js"></script>','<script type="application/json" id="ridge-assets">'+lib+'</script>\n<script>'+js+'</script>');
  const filename=path.join(outDir,outName);fs.writeFileSync(filename,html,{flag:'wx'});
  console.log(JSON.stringify({filename,bytes:fs.statSync(filename).size,embeddedAssets:Object.keys(table).length+2-art.length,art,cdn}));
})().catch(e=>{console.error(e);process.exitCode=1;});
