import * as THREE from 'three';
import {crowdColours,collisionPose} from './piste-traffic.js';

// A few shared batches cover every jacket, limb and board on the piste.
function winterDeck(board){
  const positions=[],indices=[];
  const sections=board?[[-.79,.075,.09],[-.70,.15,.035],[-.48,.15,.01],[0,.125,0],[.48,.15,.01],[.70,.15,.035],[.79,.075,.085]]:
    [[-.88,.025,.105],[-.78,.07,.042],[-.55,.065,.008],[0,.044,0],[.61,.058,.006],[.78,.055,.037]];
  for(const [z,width,y] of sections)positions.push(-width,y,z,width,y,z,-width,y+.019,z,width,y+.019,z);
  for(let i=4;i<positions.length/3;i+=4){
    const k=i-4;
    for(const [a,b] of [[0,1],[1,3],[3,2],[2,0]])indices.push(k+a,i+a,k+b,k+b,i+a,i+b);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  return geometry;
}

export function createPisteGuests(scene,data){
  const group=new THREE.Group();group.name='Piste guests';scene.add(group);
  const cloth=new THREE.MeshStandardMaterial({roughness:.83,metalness:.04});
  const deckMat=new THREE.MeshStandardMaterial({roughness:.48,metalness:.13,side:THREE.DoubleSide});
  const shadowMat=new THREE.MeshBasicMaterial({color:0x253e57,transparent:true,opacity:.15,depthWrite:false});
  const ball=new THREE.SphereGeometry(1,10,7),rod=new THREE.CylinderGeometry(.87,1,1,8);
  function batch(name,geometry,material,capacity){
    const mesh=new THREE.InstancedMesh(geometry,material,capacity);
    mesh.name=name;mesh.count=0;mesh.frustumCulled=false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.add(mesh);return mesh;
  }
  const bodies=batch('Coats, helmets and gloves',ball,cloth,420),limbs=batch('Articulated sleeves and trousers',rod,cloth,350);
  const skis=batch('Twin skis',winterDeck(false),deckMat,40),boards=batch('Snowboards',winterDeck(true),deckMat,24);
  const shadows=batch('Guest contact shadows',ball,shadowMat,22);
  const all=[bodies,limbs,skis,boards,shadows];
  const at=new THREE.Object3D(),piece=new THREE.Object3D(),matrix=new THREE.Matrix4(),torso=new THREE.Object3D();
  const v=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),colors=new Map();
  let parent;
  function stamp(mesh,color){
    if(mesh.count>=mesh.instanceMatrix.count)return;
    piece.updateMatrix();matrix.multiplyMatrices(parent,piece.matrix);
    mesh.setMatrixAt(mesh.count,matrix);
    if(color){
      if(!colors.has(color))colors.set(color,new THREE.Color(color));
      mesh.setColorAt(mesh.count,colors.get(color));
    }
    mesh.count++;
  }
  function shape(mesh,x,y,z,sx,sy,sz,color,roll=0,yaw=0,pitch=0){
    piece.position.set(x,y,z);piece.rotation.set(pitch,yaw,roll,'YXZ');piece.scale.set(sx,sy,sz);stamp(mesh,color);
  }
  function link(x,y,z,xx,yy,zz,radius,color){
    v.set(xx-x,yy-y,zz-z);const length=v.length();
    if(length<.0001)return;
    piece.position.set((x+xx)*.5,(y+yy)*.5,(z+zz)*.5);
    piece.quaternion.setFromUnitVectors(up,v.multiplyScalar(1/length));piece.scale.set(radius,length,radius);stamp(limbs,color);
  }
  const trousers='#243449',gloves='#23303b',visor='#28546c',snowStripe='#dbe5db',skin='#c49375';
  function draw(actors,eye){
    for(const mesh of all)mesh.count=0;
    for(const a of actors){
      if(a.opacity<.015||Math.hypot(a.x-eye.x,a.z-eye.z)>190)continue;
      const yaw=a.heading,fx=Math.sin(yaw),fz=-Math.cos(yaw),rx=-fz,rz=fx;
      const height=data.height(a.x,a.z);
      const pitch=Math.atan2(data.height(a.x+fx*.65,a.z+fz*.65)-data.height(a.x-fx*.65,a.z-fz*.65),1.3);
      const bank=Math.atan2(data.height(a.x+rx*.65,a.z+rz*.65)-data.height(a.x-rx*.65,a.z-rz*.65),1.3);
      at.position.set(a.x,height+.018,a.z);at.rotation.set(pitch,-yaw,bank,'YXZ');
      at.scale.setScalar(a.scale*Math.min(1,.74+.26*a.opacity));at.updateMatrix();parent=at.matrix;
      const p=collisionPose(a.reaction?.age,a.reaction?.released),side=a.reaction?.side||1;
      const lean=a.lean*(a.seated?0:1-p.reach),coat=crowdColours[a.coat],ski=a.gear==='ski';
      const flex=.025*Math.sin(a.phase*2);
      const hipY=(a.seated?.235:.74+flex-.13*Math.abs(lean))-.24*p.reach;
      const hipX=-lean*.41+side*p.recoil*.13,hipZ=a.seated?.18:.065;
      shape(shadows,hipX*.3,.007,.04,a.seated?.49:.34,.013,a.seated?.51:.62);
      const boardYaw=a.seated?Math.PI/2:0;
      const boardZ=a.seated?-.48:0;
      if(!ski)shape(boards,side*p.loose*.93,.011+.06*p.recoil,boardZ-p.loose*.38,1,1,1,coat,0,boardYaw+side*p.turn*.57);
      for(const s of [-1,1]){
        const bx=ski?s*.14:a.seated?s*.235:0,bz=ski?s*lean*.13:a.seated?boardZ:s*.255;
        const free=s===side?p.loose:0;
        if(ski)shape(skis,bx+side*free*.96,.013+.035*free,bz-free*.42,1,1,1,coat,-lean*.52,side*free*.55);
        const kneeX=a.seated?s*.20:bx+hipX*.47+s*.053;
        const kneeY=a.seated?.39:.42-.12*p.reach,kneeZ=a.seated?-.18:bz-.145-.066*p.reach;
        link(hipX+s*.105,hipY,hipZ,kneeX,kneeY,kneeZ,.108,trousers);
        link(kneeX,kneeY,kneeZ,bx,.125,bz,.086,trousers);
        shape(bodies,bx,.099,bz,.080,.082,.147,gloves,0,ski?0:boardYaw+.94);
      }
      shape(bodies,hipX,hipY+.035,hipZ,.205,.16,.145,trousers,-lean*.40);
      torso.position.set(hipX,hipY+.055,hipZ);torso.rotation.set(-.25-.60*p.reach+.19*p.recoil,ski?0:a.seated?0:-.83,lean*.79+side*p.recoil*.40,'YXZ');
      torso.updateMatrix();torso.matrixWorld.multiplyMatrices(at.matrix,torso.matrix);parent=torso.matrixWorld;
      shape(bodies,0,.24,0,.23,.324,.174,coat);
      shape(bodies,0,.078,.002,.219,.077,.165,coat);
      shape(bodies,0,.455,.041,.15,.13,.143,coat);
      if(a.coat%3===0)shape(bodies,0,.245,.12,.156,.205,.095,trousers);
      else shape(bodies,0,.303,.14,.158,.018,.032,snowStripe);
      const nod=a.seated?.025*Math.sin(a.age*2+a.phase):0;
      shape(bodies,0,.585,-.023,.124,.145,.125,skin);
      shape(bodies,0,.656+nod,-.012,.143,.138,.146,a.coat%2?gloves:snowStripe);
      shape(bodies,0,.627+nod,-.083,.144,.051,.101,visor);
      for(const s of [-1,1]){
        const chat=a.seated?(1+Math.sin(a.age*2.2+a.phase+s*1.5))*.5:0;
        const target=s===-side?Math.max(0,p.reach-.18):p.reach;
        const elbowX=s*(.286+.05*Math.abs(lean)),elbowY=.204+.13*chat-.18*target,elbowZ=.008-.10*chat;
        const handX=s*(.30+.09*chat)-hipX*.18,handY=.06+.26*chat-.30*target,handZ=-.18-.13*target;
        link(s*.18,.402,0,elbowX,elbowY,elbowZ,.079,coat);
        link(elbowX,elbowY,elbowZ,handX,handY,handZ,.068,coat);
        shape(bodies,handX,handY,handZ,.061,.076,.060,gloves);
        if(ski){
          link(handX,handY,handZ,s*.42,-hipY+.12,.54,.012,gloves);
          shape(bodies,s*.416,-hipY+.16,.513,.046,.009,.046,gloves);
        }
      }
    }
    for(const mesh of all){
      mesh.visible=mesh.count>0;mesh.instanceMatrix.needsUpdate=true;
      if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    }
  }
  return {group,draw};
}
