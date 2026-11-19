import * as THREE from 'three';
import {clamp,randomGenerator,resortName} from './mountain.js';

function localInstances(scene,geometry,material,items) {
  const mesh=new THREE.InstancedMesh(geometry,material,items.length),object=new THREE.Object3D();
  const matrices=new Float32Array(items.length*16);
  for(let i=0;i<items.length;i++){
    const [x,y,z,sx,sy,sz,ry=0]=items[i];object.position.set(x,y,z);object.scale.set(sx,sy,sz);object.rotation.y=ry;object.updateMatrix();object.matrix.toArray(matrices,i*16);
  }
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.count=0;mesh.frustumCulled=false;scene.add(mesh);
  return (x,z)=>{
    let count=0;const target=mesh.instanceMatrix.array;
    for(let i=0;i<items.length;i++){
      const m=i*16,dx=matrices[m+12]-x,dz=matrices[m+14]-z;
      if(dx*dx+dz*dz>520*520)continue;
      target.set(matrices.subarray(m,m+16),count*16);count++;
    }
    mesh.count=count;mesh.visible=count>0;mesh.instanceMatrix.needsUpdate=true;
  };
}
function sign(scene,data,x,z,angle,title,small,color='#22556a') {
  const c=document.createElement('canvas');c.width=768;c.height=244;
  const ct=c.getContext('2d');ct.fillStyle=color;ct.fillRect(0,0,c.width,c.height);ct.strokeStyle='#e6eadd';ct.lineWidth=6;ct.strokeRect(9,9,750,226);
  ct.fillStyle='#f9f8ef';ct.font='600 72px "PingFang SC","Microsoft YaHei",sans-serif';ct.textBaseline='middle';ct.fillText(title,40,98,680);
  ct.font='36px "PingFang SC",sans-serif';ct.fillStyle='#d3e1dd';ct.fillText(small,44,183,660);
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;
  const group=new THREE.Group();group.position.set(x,data.height(x,z),z);group.rotation.y=-angle;
  const board=new THREE.Mesh(new THREE.BoxGeometry(3.7,1.18,.13),new THREE.MeshLambertMaterial({color:0x364649}));
  board.position.y=2.45;group.add(board);
  const front=new THREE.Mesh(new THREE.PlaneGeometry(3.67,1.16),new THREE.MeshBasicMaterial({map:tex}));front.position.set(0,2.45,.069);group.add(front);
  const steel=new THREE.MeshLambertMaterial({color:0x586363});
  for(const xx of [-1.28,1.28]){const post=new THREE.Mesh(new THREE.CylinderGeometry(.064,.077,2.65,7),steel);post.position.set(xx,1.28,0);group.add(post);}
  scene.add(group);
}
function distAlong(points,s) {
  for(let i=1;i<points.length;i++){
    const [x,z]=points[i-1],[bx,bz]=points[i],dx=bx-x,dz=bz-z,d=Math.hypot(dx,dz);
    if(d>s){const t=s/d;return {x:x+t*dx,z:z+t*dz,rx:-dz/d,rz:dx/d};}s-=d;
  }
}
export function courseDetails(scene,data) {
  const poles=[],caps=[],netPos=[],rand=randomGenerator(18359);
  for(const trail of data.trails){
    for(let s=22;s<8000;s+=63){
      const p=distAlong(trail.points,s);if(!p)break;
      for(const side of [-1,1]){
        const w=(trail.width||34)*.48*side;
        const x=p.x+p.rx*w,z=p.z+p.rz*w,y=data.height(x,z);
        poles.push([x,y+.86,z,.066,1.74,.066]);caps.push([x,y+1.51,z,.076,.30,.076]);
      }
    }
  }
  const plank=new THREE.CylinderGeometry(.5,.55,1,6);
  const batches=[localInstances(scene,plank,new THREE.MeshLambertMaterial({color:0xc45a3b}),poles),
    localInstances(scene,plank,new THREE.MeshLambertMaterial({color:0xf3cf77}),caps)];
  const netCanvas=document.createElement('canvas');netCanvas.width=netCanvas.height=64;
  const nc=netCanvas.getContext('2d');nc.strokeStyle='rgba(206,68,36,.80)';nc.lineWidth=3.4;
  for(let i=0;i<=64;i+=16){nc.beginPath();nc.moveTo(i,0);nc.lineTo(i,64);nc.moveTo(0,i);nc.lineTo(64,i);nc.stroke();}
  nc.fillStyle='rgba(227,82,42,.96)';nc.fillRect(0,0,64,4);nc.fillRect(0,62,64,2);
  const nt=new THREE.CanvasTexture(netCanvas);nt.wrapS=THREE.RepeatWrapping;nt.colorSpace=THREE.SRGBColorSpace;nt.anisotropy=4;
  const uv=[],netPoles=[];
  for(const r of data.routes.filter(r=>r.id.endsWith('classic'))){
    const start=r.frame(18);
    sign(scene,data,start.x-start.dz*8.5,start.z+start.dx*8.5,start.angle,r.resort==='wanlong'?'长龙道':'芍药花',resortName(r.resort)+'滑雪场   ·   山顶出发');
    const count=r.resort==='wanlong'?800:356;
    const fork=r.frame(count-23);
    sign(scene,data,fork.x+fork.dz*12,fork.z-fork.dx*12,fork.angle,r.resort==='wanlong'?'山丹丹联络道':'翠菊花联络道','联滑    '+(r.resort==='wanlong'?'前往云顶':'前往万龙'),'#315853');
    const last=r.frame(r.length-38);
    sign(scene,data,last.x+last.dz*10,last.z-last.dx*10,last.angle,'雪具大厅',r.resort==='wanlong'?'龙宫酒店    ·    索道下站':'云顶大酒店    ·    索道下站');
    for(const offset of [26,r.length*.48,r.length-90]){
      const side=rand()<.5?-1:1, vs=[];
      for(let s=0;s<60;s+=4.4){
        const p=r.frame(offset+s),x=p.x-p.dz*16.2*side,z=p.z+p.dx*16.2*side,y=data.height(x,z);
        netPoles.push([x,y+.84,z,.085,1.75,.085]);
        vs.push([x,y+.16,z,x,y+1.42,z]);
        const a=vs.at(-2),b=vs.at(-1);if(!a)continue;
        netPos.push(...a.slice(0,3),...b.slice(0,3),...a.slice(3),...a.slice(3),...b.slice(0,3),...b.slice(3));
        uv.push(0,0,3,0,0,1,0,1,3,0,3,1);
      }
    }
  }
  batches.push(localInstances(scene,plank,new THREE.MeshLambertMaterial({color:0xc94b31}),netPoles));
  const ng=new THREE.BufferGeometry();ng.setAttribute('position',new THREE.Float32BufferAttribute(netPos,3));ng.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  scene.add(new THREE.Mesh(ng,new THREE.MeshBasicMaterial({map:nt,side:THREE.DoubleSide,alphaTest:.43,transparent:false})));
  // The other mapped resort buildings retain their surveyed footprint and roof line.
  const taken=new Set(data.landmarks.map(l=>l.buildingId).filter(Boolean));
  const walls=[],roofs=[],wallUv=[];
  for(const b of data.buildings){
    if(taken.has(b.id)||b.footprint.length<4)continue;
    const pts=b.footprint.slice();if(pts.length>1&&pts[0][0]===pts.at(-1)[0]&&pts[0][1]===pts.at(-1)[1])pts.pop();
    const h=clamp((b.levels||1)*3.2+1.5,4.1,38),y=pts.reduce((a,p)=>a+data.height(...p),0)/pts.length;
    const vectors=pts.map(p=>new THREE.Vector2(...p));
    const triangles=THREE.ShapeUtils.triangulateShape(vectors,[]);
    for(const f of triangles){for(const i of [f[0],f[2],f[1]])roofs.push(pts[i][0],y+h,pts[i][1]);}
    for(let i=0;i<pts.length;i++){
      const a=pts[i],t=pts[(i+1)%pts.length],pa=[a[0],Math.min(data.height(...a),y)-1,a[1]],pb=[t[0],Math.min(data.height(...t),y)-1,t[1]],pc=[a[0],y+h,a[1]],pd=[t[0],y+h,t[1]];
      walls.push(...pa,...pb,...pc,...pc,...pb,...pd);
      const width=Math.hypot(t[0]-a[0],t[1]-a[1])/8.4,levels=Math.max(1,Math.round(h/3.65));
      wallUv.push(0,0,width,0,0,levels,0,levels,width,0,width,levels);
    }
  }
  const facade=document.createElement('canvas');facade.width=256;facade.height=100;
  const fc=facade.getContext('2d');fc.fillStyle='#b4a99b';fc.fillRect(0,0,256,100);
  fc.fillStyle='#8d8378';fc.fillRect(0,3,256,3);fc.fillStyle='#e2e1d6';fc.fillRect(0,0,256,3);
  for(const x of [17,95,177]){
    fc.fillStyle='#6c6b65';fc.fillRect(x,28,55,41);fc.fillStyle='#718993';fc.fillRect(x+3,31,49,35);
    fc.fillStyle='#536773';fc.fillRect(x+4,50,48,15);fc.fillStyle='#bfc2b7';fc.fillRect(x+26,30,2,36);fc.fillRect(x-2,68,59,3);
  }
  const facadeTex=new THREE.CanvasTexture(facade);facadeTex.colorSpace=THREE.SRGBColorSpace;facadeTex.wrapS=facadeTex.wrapT=THREE.RepeatWrapping;facadeTex.anisotropy=4;
  for(const [vertices,col] of [[walls,0xf4eeeb],[roofs,0xd7dbdb]]){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));if(vertices===walls)g.setAttribute('uv',new THREE.Float32BufferAttribute(wallUv,2));g.computeVertexNormals();scene.add(new THREE.Mesh(g,new THREE.MeshLambertMaterial({color:col,map:vertices===walls?facadeTex:null,side:THREE.DoubleSide})));
  }
  return {locate(x,z){for(const update of batches)update(x,z);}};
}

export function makeSnowFX(scene,data) {
  const size=80,c=document.createElement('canvas');c.width=c.height=size;
  const ct=c.getContext('2d'),g=ct.createRadialGradient(40,40,0,40,40,39);g.addColorStop(0,'rgba(255,255,255,.88)');g.addColorStop(.35,'rgba(248,252,255,.62)');g.addColorStop(1,'rgba(255,255,255,0)');ct.fillStyle=g;ct.fillRect(0,0,size,size);
  const sprite=new THREE.CanvasTexture(c),max=220,particles=new Float32Array(max*3),speeds=new Float32Array(max*3),life=new Float32Array(max),scale=new Float32Array(max);
  const pg=new THREE.BufferGeometry();pg.setAttribute('position',new THREE.BufferAttribute(particles,3).setUsage(THREE.DynamicDrawUsage));pg.setAttribute('size',new THREE.BufferAttribute(scale,1).setUsage(THREE.DynamicDrawUsage));
  const mat=new THREE.ShaderMaterial({uniforms:{sprite:{value:sprite},screen:{value:500}},transparent:true,depthWrite:false,
    vertexShader:`attribute float size;
      uniform float screen;
      void main(){
        vec4 eye=modelViewMatrix*vec4(position,1.);
        gl_Position=projectionMatrix*eye;
        gl_PointSize=clamp(size*screen/max(.1,-eye.z),0.,152.);
      }`,
    fragmentShader:'uniform sampler2D sprite;void main(){gl_FragColor=texture2D(sprite,gl_PointCoord)*vec4(.94,.97,1.,.43);}'});
  const spray=new THREE.Points(pg,mat);spray.frustumCulled=false;spray.renderOrder=3;scene.add(spray);
  const limit=1800,tg=new THREE.BufferGeometry(),tracks=new Float32Array(limit*18);
  tg.setAttribute('position',new THREE.BufferAttribute(tracks,3).setUsage(THREE.DynamicDrawUsage));
  const tm=new THREE.Mesh(tg,new THREE.MeshBasicMaterial({color:0x718da2,transparent:true,opacity:.20,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
  tm.frustumCulled=false;tm.renderOrder=1;scene.add(tm);
  let head=0,used=0,next=0,last=null,emit=0;
  const rand=randomGenerator(150),snowCount=360, flakes=new Float32Array(snowCount*3);
  const fg=new THREE.BufferGeometry();fg.setAttribute('position',new THREE.BufferAttribute(flakes,3));
  for(let i=0;i<snowCount;i++){flakes[i*3]=(rand()-.5)*52;flakes[i*3+1]=rand()*24-9;flakes[i*3+2]=(rand()-.5)*52;}
  const falling=new THREE.Points(fg,new THREE.PointsMaterial({map:sprite,transparent:true,opacity:.76,color:0xffffff,size:.075,depthWrite:false}));scene.add(falling);falling.frustumCulled=false;
  const mark=(x,z)=>[x,data.height(x,z)+.055,z];
  return {
    reset(){last=null;head=used=0;tg.setDrawRange(0,0);life.fill(0);scale.fill(0);pg.attributes.size.needsUpdate=true;},
    update(p,dt,weather,view){
      falling.visible=weather==='snow';if(falling.visible){
        falling.position.copy(view);for(let i=0;i<snowCount;i++){flakes[i*3+1]-=dt*(1.7+i%3*.28);flakes[i*3]+=dt*.62;if(flakes[i*3+1]<-9)flakes[i*3+1]+=24;if(flakes[i*3]>26)flakes[i*3]-=52;}fg.attributes.position.needsUpdate=true;
      }
      const fx=Math.sin(p.heading),fz=-Math.cos(p.heading),rx=-fz,rz=fx;
      if(p.airHeight<.12&&p.speed>.8&&p.mode==='run'){
        const cur={x:p.x-fx*.62,z:p.z-fz*.62,rx,rz};
        if(!last||Math.hypot(cur.x-last.x,cur.z-last.z)>8){last=cur;}
        if(Math.hypot(cur.x-last.x,cur.z-last.z)>.43){
          for(const lane of p.gear==='ski'?[-.19,.19]:[0]){
            const w=p.gear==='ski'?.055:.14,pt=(f,k)=>mark(f.x+f.rx*(lane+k),f.z+f.rz*(lane+k));
            tracks.set([...pt(last,-w),...pt(cur,-w),...pt(last,w),...pt(last,w),...pt(cur,-w),...pt(cur,w)],head*18);
            head=(head+1)%limit;used=Math.min(used+1,limit);
          }
          last=cur;tg.setDrawRange(0,used*6);tg.attributes.position.needsUpdate=true;
        }
        emit+=dt*Math.min(120,p.speed*(.7+Math.abs(p.steer)*3.0+p.brake*4.1));
        while(emit>=1){
          emit--;const k=next%max,i=k*3;next++;const side=(rand()-.5)*.64,fan=side*2.4-p.steer*.98;
          particles[i]=p.x-fx*.65+rx*side;particles[i+1]=p.y+.10;particles[i+2]=p.z-fz*.65+rz*side;
          speeds[i]=rx*fan*3-fx*(1+rand()*3);speeds[i+1]=.85+rand()*(1.6+Math.abs(p.steer)*1.8);speeds[i+2]=rz*fan*3-fz*(1+rand()*3);
          life[k]=.48+rand()*.58;
        }
      }else{last=null;}
      for(let k=0;k<max;k++){const i=k*3;if(life[k]<=0){scale[k]=0;continue;}life[k]-=dt;
        particles[i]+=speeds[i]*dt;particles[i+1]+=speeds[i+1]*dt;particles[i+2]+=speeds[i+2]*dt;speeds[i+1]-=dt*2.1;
        scale[k]=Math.max(0,Math.min(1,life[k]*3))*(.30+(1-life[k])*.92);
      }
      pg.attributes.position.needsUpdate=true;pg.attributes.size.needsUpdate=true;mat.uniforms.screen.value=innerHeight*(devicePixelRatio>1?1.18:1);
    }
  };
}
