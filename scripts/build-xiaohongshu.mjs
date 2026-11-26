import {build} from 'esbuild';
import postcss from 'postcss';
import {copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const output=path.resolve(process.argv[2]||path.join(root,'../小红书素材/山脊之间-小红书小工具-'+version+'.zip'));
const audit=path.join(root,'../.codex/minitool-zip-builder/scripts/audit_artifact.py');
await mkdir(path.dirname(output),{recursive:true});
const stage=await mkdtemp(path.join(path.dirname(output),'.ridgeline-xhs-'));
const zip=stage+'.zip';
const source=name=>readFile(path.join(root,name),'utf8');
const platforms={
  name:'xiaohongshu-platform',
  setup(b){
    b.onResolve({filter:/^\.\/platform\.js$/},()=>({path:path.join(root,'src/xhs/platform.js')}));
    b.onResolve({filter:/^\.\/world\.js$/},()=>({path:'world',namespace:'deferred-scene'}));
    b.onLoad({filter:/^world$/,namespace:'deferred-scene'},()=>({
      loader:'js',
      contents:
        "let loading;\n"+
        "export async function createWorld(...args){\n"+
        "  if(!loading) loading=new Promise((resolve,reject)=>{\n"+
        "    const script=document.createElement('script');\n"+
        "    const timer=setTimeout(()=>{script.remove();reject(new Error('场景脚本读取超时'));},12000);\n"+
        "    function finish(ok){clearTimeout(timer);script.remove();if(ok&&window.Ridgeline3D)resolve();else reject(new Error('场景脚本读取失败'));}\n"+
        "    script.onload=()=>finish(true);script.onerror=()=>finish(false);script.src='./world.js';document.head.append(script);\n"+
        "  }).catch(error=>{loading=null;throw error;});\n"+
        "  await loading;\n"+
        "  return window.Ridgeline3D.createWorld(...args);\n"+
        "}"
    }));
  }
};
const common={absWorkingDir:root,bundle:true,format:'iife',target:['chrome61','es2017'],
  minify:true,legalComments:'inline',loader:{'.css':'empty'},plugins:[platforms],
  define:{'import.meta.env.BASE_URL':'"./"','process.env.NODE_ENV':'"production"'}};

function values(input) {
  const result=[];let depth=0,start=0;
  for(let i=0;i<input.length;i++){
    const char=input[i];
    if(char==='(')depth++;
    else if(char===')')depth--;
    else if(!depth&&(char===','||/\s/.test(char))){
      if(i>start)result.push(input.slice(start,i));start=i+1;
    }
  }
  if(start<input.length)result.push(input.slice(start));
  return result;
}
function reduceFunctions(input){
  let output='',start=0;
  const math=/\b(clamp|min|max|env)\(/g;let hit;
  while((hit=math.exec(input))){
    output+=input.slice(start,hit.index);
    let end=math.lastIndex,depth=1;
    for(;end<input.length&&depth;end++){
      if(input[end]==='(')depth++;
      else if(input[end]===')')depth--;
    }
    const args=values(input.slice(math.lastIndex,end-1));
    const plain=args.find(arg=>!arg.startsWith('env('))||'0px';
    const chosen=hit[1]==='env'?'0px':hit[1]==='min'?(args.find(arg=>arg.endsWith('%'))||plain):plain;
    output+=reduceFunctions(chosen);
    math.lastIndex=start=end;
  }
  return output+input.slice(start);
}
function adaptStyle(base,extra){
  const ast=postcss.parse(base);
  const enhanced=[];
  ast.walkDecls(d=>{
    if(d.prop==='inset'){
      const [top,right=top,bottom=top,left=right]=values(d.value);
      for(const [prop,value] of Object.entries({top,right,bottom,left}))d.cloneBefore({prop,value});
    }
    if(d.prop==='gap')d.cloneBefore({prop:'grid-gap'});
    if(d.prop==='column-gap')d.cloneBefore({prop:'grid-column-gap'});
    if(d.prop.endsWith('-inline')){
      const name=d.prop.slice(0,-7),[first,second=first]=values(d.value);
      d.cloneBefore({prop:name+'-left',value:first});d.cloneBefore({prop:name+'-right',value:second});
    }
    if(d.prop==='overflow-wrap'&&d.value==='anywhere')d.cloneBefore({value:'break-word'});
    d.value=d.value.replace(/url\((['"]?)\/assets\//g,'url($1./assets/');
    if(!/\b(?:min|max|clamp|env)\(/.test(d.value))return;
    const fallback=reduceFunctions(d.value);
    if(d.prop.startsWith('--')){
      const rule=postcss.rule({selector:d.parent.selector});
      rule.append(d.clone());
      enhanced.push([d.parent,rule]);
      d.value=fallback;
    }else d.cloneBefore({value:fallback});
  });
  // A CSS variable accepts unrecognised functions even on an old engine. Gate
  // those overrides at the end of their original rule, in its original media scope.
  for(const [rule,override] of enhanced.reverse()){
    const supports=postcss.atRule({name:'supports',params:'(width: clamp(1px, 2px, 3px))'});
    supports.append(override);rule.parent.insertAfter(rule,supports);
  }
  return ast.toString().replace(/\benv\(safe-area-inset-(top|right|bottom|left)\)/g,'var(--tool-safe-$1)')+'\n'+extra;
}

try{
  let html=(await source('index.html'))
    .replace(/^.*(?:rel="canonical"|property="og:image").*\n/gm,'')
    .replace(/<button[^>]+data-act="fullscreen"[^>]*><\/button>/,'')
    .replace(/<main id="home">[\s\S]*?<\/main>/, home=>home.replace(/<button\b/g,'<button data-start-ready disabled'))
    .replace('<div class="departure-resort">','<p id="boot-status" role="status">正在准备滑雪。长时间未就绪时，请退出后重新打开。</p>\n        <div class="departure-resort">')
    .replace('</head>','  <link rel="stylesheet" href="./app.css">\n</head>')
    .replace('<script type="module" src="/src/main.js"></script>','<script defer src="./app.js"></script>');
  if(html.includes('type="module"')||!html.includes('./app.js'))throw new Error('Unexpected entry template');
  // Fullscreen is controlled by the container. Keep its element for common text setup.
  html=html.replace('<div class="top-tools">','<div class="top-tools"><button data-act="fullscreen" hidden disabled></button>');
  await writeFile(path.join(stage,'index.html'),html);
  const styles=(await source('src/style.css'))+'\n'+(await source('src/lobby.css'));
  const license=await source('public/RidgeTitle-OFL.txt');
  await writeFile(path.join(stage,'app.css'),'/*! '+license+' */\n'+adaptStyle(styles,await source('src/xhs/container.css')));
  const compatibility=await source('src/xhs/compat.js');
  await Promise.all([
    build({...common,entryPoints:['src/main.js'],outfile:path.join(stage,'app.js'),banner:{js:compatibility}}),
    build({...common,entryPoints:['src/world.js'],outfile:path.join(stage,'world.js'),globalName:'Ridgeline3D'}),
    ...(await readdir(path.join(root,'public'))).filter(file=>/^chongli-(grove|paint)-[\w-]+\.webp$/.test(file)).map(file=>copyFile(path.join(root,'public',file),path.join(stage,file))),
    copyFile(path.join(root,'public/favicon.svg'),path.join(stage,'favicon.svg')),
    ...['art','geo','resort'].map(async folder=>{
      const from=path.join(root,'public/assets',folder),to=path.join(stage,'assets',folder);
      await mkdir(to,{recursive:true});
      const names=await readdir(from);
      for(const name of names){
        if(!/\.(png|jpg|webp|woff|json)$/.test(name))continue;
        if(name.endsWith('.json')){
          const data=JSON.parse(await readFile(path.join(from,name),'utf8')),key=path.basename(name,'.json');
          const heights=data.dem?.heights;
          let decode='';
          if(heights?.every(Number.isSafeInteger)){
            // Store adjacent integer elevation differences. Restore exactly
            // once when the offline data script loads, before handing it to the game.
            for(let i=heights.length-1;i>0;i--)heights[i]-=heights[i-1];
            decode='var h=data.dem.heights;for(var i=1;i<h.length;i++){h[i]+=h[i-1];}\n';
          }
          const json=JSON.stringify(data).replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
          await writeFile(path.join(to,key+'-data.js'),'(function(){var data='+json+';\n'+decode+
            'window.ridgelineTerrain=window.ridgelineTerrain||{};window.ridgelineTerrain['+JSON.stringify(key)+']=data;})();\n');
        }else await copyFile(path.join(from,name),path.join(to,name));
      }
    })
  ]);
  execFileSync('python3',[path.join(root,'scripts/optimize-xhs-assets.py'),stage],{stdio:'inherit'});
  execFileSync('python3',[audit,stage],{stdio:'inherit'});
  execFileSync('zip',['-q','-r','-X',zip,'.'],{cwd:stage,stdio:'inherit'});
  execFileSync('python3',[audit,zip],{stdio:'inherit'});
  execFileSync('unzip',['-tq',zip],{stdio:'inherit'});
  await rename(zip,output);
  console.log(output);
} finally {
  await rm(stage,{recursive:true,force:true});
  await rm(zip,{force:true});
}

