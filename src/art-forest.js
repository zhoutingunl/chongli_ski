import * as THREE from 'three';
import atlases from './grove-atlases.json' with {type:'json'};
import surfaces from './art-surfaces.json' with {type:'json'};

// Only completed sets are cached. An older request may finish after a comparison
// has moved on; it can warm the cache but may never change the forest on screen.
export function groveSelection(load,display,report=()=>{},limit=2){
  const ready=new Map(),pending=new Map();
  let wanted=null,shown=null,failed=false;
  function select(id,retry=false){
    id=Object.prototype.hasOwnProperty.call(atlases,id)?id:null;
    if(id===wanted&&!(retry&&failed))return;
    wanted=id;failed=false;
    if(shown){display(null);shown=null;}
    if(!id){report(null,'idle');return;}
    function show(value){shown=id;display(value);report(id,'ready');}
    if(ready.has(id)){
      const value=ready.get(id);ready.delete(id);ready.set(id,value);show(value);return;
    }
    report(id,'loading');
    if(pending.has(id))return;
    const request=Promise.resolve().then(()=>load(id)).then(value=>{
      ready.set(id,value);
      if(wanted===id)show(value);
      while(ready.size>limit){
        const key=[...ready.keys()].find(k=>k!==wanted);
        ready.get(key).dispose();ready.delete(key);
      }
    },()=>{if(wanted===id){failed=true;report(id,'failed');}}).finally(()=>pending.delete(id));
    pending.set(id,request);
  }
  return {select,retry:()=>select(wanted,true)};
}

function geometryOf(tree,palette){
  const n=tree.pigments.length,colours=new Float32Array(n*3);
  for(let i=0;i<n;i++){
    const c=palette[tree.pigments[i]],shade=tree.shades[i];
    colours.set([c.r*shade,c.g*shade,c.b*shade],i*3);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(tree.positions,3));
  g.setAttribute('color',new THREE.BufferAttribute(colours,3));
  g.setAttribute('sprig',new THREE.Float32BufferAttribute(tree.brush,2));g.computeVertexNormals();
  return g;
}
const capacities={lite:10,auto:24,high:40};
export function nearbyGrove(chunks,x,z,quality,previous=new Set()){
  const radius=quality==='lite'?56:quality==='high'?112:84,trees=[];
  for(const mesh of chunks){
    const g=mesh.geometry,center=g.boundingSphere.center;
    if(Math.abs(x-center.x)>radius+180||Math.abs(z-center.z)>radius+180)continue;
    const pos=g.attributes.location.array,form=g.attributes.form.array;
    for(let i=0;i<g.instanceCount;i++){
      const dx=pos[i*3]-x,dz=pos[i*3+2]-z,d2=dx*dx+dz*dz;
      if(d2>radius*radius)continue;
      const key=mesh.id+':'+i,seed=Math.sin(pos[i*3]*.73+pos[i*3+2]*.63)*4927;
      const variation=seed-Math.floor(seed);
      trees.push({mesh,i,key,d2:d2*(previous.has(key)?.85:1),x:pos[i*3],y:pos[i*3+1],z:pos[i*3+2],w:Math.abs(form[i*4]),h:form[i*4+1],slot:2*form[i*4+2]+Number(variation>.5),yaw:variation*6.283});
    }
  }
  return trees.sort((a,b)=>a.d2-b.d2).slice(0,capacities[quality]||capacities.auto);
}

// Pick a real planted tree visible above the shoulder, with an open valley
// behind it. This composes the third-lift reference without moving the skier.
export function woodlandVista(trees,x,y,z,height){
  let best=-Infinity,bearing=null;
  for(const item of trees){
    const dx=item.x-x,dz=item.z-z,range=Math.hypot(dx,dz);
    if(range<12||range>112)continue;
    const nx=dx/range,nz=dz/range,tip=item.y+item.h;
    if(tip<height(x+dx*.52,z+dz*.52)-1)continue;
    const valley=(y-height(x+nx*320,z+nz*320))*.004+(y-height(x+nx*720,z+nz*720))*.0014;
    const angular=Math.abs(item.h/range-.28);
    const score=Math.min(1.5,valley)-angular*2.3+(item.slot<4?.27:0);
    if(score>best){best=score;bearing={x:nx,z:nz};}
  }
  return bearing;
}

export function artForest(scene,chunks,sharedDetail,uniforms,original,loadAtlas,onChange){
  const group=new THREE.Group();group.name='Painted woodland';scene.add(group);
  const mat=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});
  // Pigment carries its own ambient fill. The directional component still turns
  // over the actual facets and the same world-space moon/sun is used by the cards.
  const depth=new THREE.MeshDepthMaterial({side:THREE.DoubleSide});
  function needleShader(shader){
    shader.vertexShader='attribute vec2 sprig;varying vec2 vSprig;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n vSprig=sprig;');
    shader.fragmentShader='varying vec2 vSprig;\n'+shader.fragmentShader.replace('#include <alphatest_fragment>',`
      #include <alphatest_fragment>
      if(vSprig.x>-.2){
        float along=clamp(vSprig.x,0.,1.);
        float wing=abs(vSprig.y)/max(.08,1.-abs(along*2.-1.));
        float quill=along*15.5-abs(vSprig.y)*3.8;
        float pix=fwidth(quill);
        float needles=mix(.5+.5*cos(quill*6.283),.56,smoothstep(.12,.69,pix));
        if(wing>.43+.63*needles)discard;
      }`);
  }
  depth.onBeforeCompile=needleShader;
  mat.onBeforeCompile=shader=>{
    needleShader(shader);shader.uniforms.groveFill=uniforms.groveFill;
    shader.fragmentShader='uniform float groveFill;\n'+shader.fragmentShader.replace('#include <opaque_fragment>',
      'outgoingLight=mix(outgoingLight,diffuseColor.rgb,groveFill);\n#include <opaque_fragment>');
  };
  const stamp=new THREE.Object3D();
  let x=0,z=0,quality='auto',selected=null,visible=new Map();
  function mark(tree,value){
    const g=tree.mesh.geometry;
    if(g.attributes.modelDetail===sharedDetail)g.setAttribute('modelDetail',new THREE.InstancedBufferAttribute(new Float32Array(g.instanceCount),1).setUsage(THREE.DynamicDrawUsage));
    const attr=g.attributes.modelDetail;attr.setX(tree.i,value);attr.needsUpdate=true;
  }
  function locate(cx,cz,q){
    x=cx;z=cz;quality=q;
    if(!selected)return;
    const next=nearbyGrove(chunks,x,z,q,visible),keys=new Map(next.map(o=>[o.key,o]));
    for(const [key,item] of visible)if(!keys.has(key))mark(item,0);
    const counters=Array(6).fill(0);
    for(const tree of next){
      if(!visible.has(tree.key))mark(tree,1);
      stamp.position.set(tree.x,tree.y,tree.z);stamp.rotation.y=tree.yaw;
      stamp.scale.set(tree.w,tree.h,tree.w);stamp.updateMatrix();
      selected.meshes[tree.slot].setMatrixAt(counters[tree.slot]++,stamp.matrix);
    }
    visible=keys;
    selected.meshes.forEach((mesh,i)=>{mesh.count=counters[i];mesh.visible=mesh.count>0;mesh.instanceMatrix.needsUpdate=true;});
  }
  async function load(id){
    const files=Object.entries({atlas:atlases[id],...surfaces[id]});
    const [{woodlandTree},{designs},results]=await Promise.all([import('../art/woodland-mesh.js'),import('../art/woodland-palettes.js'),Promise.allSettled(files.map(([,file])=>loadAtlas(file)))]);
    const textures={},meshes=[];
    function dispose(){
      for(const texture of Object.values(textures))texture.dispose();
      for(const mesh of meshes){mesh.geometry.dispose();mesh.dispose();}
    }
    let failed;
    results.forEach((result,i)=>{if(result.status==='fulfilled')textures[files[i][0]]=result.value;else failed=result.reason;});
    const style=designs[id],palette=style.palette.map(hex=>new THREE.Color('#'+hex));
    try{
      if(failed)throw failed;
      if(textures.sky){textures.sky.wrapS=THREE.RepeatWrapping;textures.sky.needsUpdate=true;}
      if(textures.snow){textures.snow.wrapS=textures.snow.wrapT=THREE.RepeatWrapping;textures.snow.needsUpdate=true;}
      for(let species=0;species<3;species++){
        // Yield between species so the desk keeps accepting selections while a new grove is built.
        await new Promise(resolve=>setTimeout(resolve,0));
        for(let variant=0;variant<2;variant++){
          const geometry=geometryOf(woodlandTree(style,species,variant),palette);
          const mesh=new THREE.InstancedMesh(geometry,mat,capacities.high);mesh.count=0;mesh.frustumCulled=false;
          mesh.customDepthMaterial=depth;mesh.castShadow=true;mesh.receiveShadow=true;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          mesh.name=id+' '+['larch','spruce','birch'][species]+' '+(variant+1);meshes.push(mesh);
        }
      }
    }catch(e){dispose();throw e;}
    return {id,...textures,meshes,dispose};
  }
  const selection=groveSelection(load,value=>{
    if(selected){for(const tree of visible.values())mark(tree,0);visible.clear();group.clear();}
    selected=value;
    uniforms.ridgePaintedSky.value=value?.sky||null;uniforms.hasPaintedSky.value=value?.sky?1:0;
    uniforms.ridgePaintedSnow.value=value?.snow||null;uniforms.hasPaintedSnow.value=value?.snow?1:0;
    uniforms.atlas.value=value?.atlas||original;uniforms.groveActive.value=value?1:0;
    if(value){group.add(...value.meshes);locate(x,z,quality);}
  },onChange);
  return {select:selection.select,retry:selection.retry,locate,
    portrait(x,z){
      const trees=nearbyGrove(chunks,x,z,'high');
      return trees.find(t=>t.slot>>1===1)||trees.find(t=>t.slot<4)||trees[0];
    },
    vista:(x,y,z,height)=>woodlandVista(nearbyGrove(chunks,x,z,'high'),x,y,z,height)};
}
