import {snowResponse} from './snow-terrain.js';
import {atWanlongForecourt} from './lift-access.js';
import {AutomaticTurns,automaticCentreGain,edgeAcceleration} from './automatic-turns.js';
import {PisteSplits} from './piste-splits.js';
import {pisteNames,pisteVisitKey} from './piste-progress.js';
import {clamp, mixAngle} from './mountain.js';
import {createSkiNavigation} from './navigation.js';

const G = 9.81;
const TAU = 2 * Math.PI;
const approach = (current, wanted, rate, dt) => current + (wanted - current) * -Math.expm1(-rate * dt);
const angleBetween = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const smooth = (x, lo, hi) => {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};

export const physicsStep=1/90;

export class Descent {
  constructor(data, opts, dimensions = null) {
    this.data = data; this.opts = opts; this.gear = opts.gear;
    this.dimensions = dimensions;
    this.pisteName = pisteNames(data.trailCatalog);
    this.navigation = data.summitPlaces?.wanlong && data.summitPlaces?.genting ? createSkiNavigation(data) : null;
    this.mode = 'idle';
    this.x = this.z = this.y = this.heading = this.travelHeading = this.speed = 0;
    this.airHeight = this.steer = this.brake = this.trim = this.edge = 0;
    this.snowSink = 0; this.snowSoftness = .14; this.groundLoad = 0;
  }

  start(route) {
    this.upperGuide=null;
    this.automatic=new AutomaticTurns();this.autoSkating=false;this.straightTuck=0;this.route = route; this.mode = 'run'; this.gear = this.opts.gear;
    this.junctions=this.navigation?.stationsOn(route)||[];
    this.pisteVisits=new Map();this.splits=new PisteSplits();this.continuedFrom=null;
    this.feedback={landing:0,tree:0};
    this.offPisteRest=this.runoutRest=0;
    this.lastTreeHit=-Infinity;
    this.recoveryReady=false;
    this.passedJunctions=new Set();this.requestedTurn=null;
    this.handSteering=false;this.neutralTime=0;this.courseCheck=0;
    if(route.departedJunction)this.passedJunctions.add(route.departedJunction);
    this.branchShiftX=this.branchShiftZ=0;
    this.along = this.offset = this.edgeSpeed = this.speed = this.maxSpeed = 0;
    this.elapsed = this.travel = this.planIndex = this.freeAge = this.elapsedDrop = 0;
    this.airHeight = this.upSpeed = this.airTime = this.air = 0;
    this.airborne = this.charging = this.forkTaken = false;
    this.charge = this.jumpCooldown = this.launch = this.landing = this.impact = 0;
    this.slope = this.roll = this.steer = this.trim = this.press = this.brake = this.boost = 0;
    this.edge = this.edgeRate = this.pressure = this.skid = this.slipAngle = 0;
    this.snowSink = this.groundLoad = 0;
    this.turn = this.curve = this.spray = this.terrainFlex = this.push = this.stride = 0;
    this.guideLean = this.bankSwap = this.bump = this.lastGrade = this.force = 0;
    this.cutSide = 1; this.contactTime = 5; this.takeoffSpeed = this.verticalAlong = 0; this.flightCos = 1;
    const f = route.glideFrame(0);
    this.departureHeading=this.guideHeading=f.angle;
    this.x = f.x; this.z = f.z; this.heading = this.travelHeading = f.angle;
    this.y = this.ground = this.startY = this.data.height(this.x, this.z);
    this.surface();
  }

  surface() {
    const near = this.pisteContact = this.data.index.near(this.x, this.z);
    const halfWidth = (near.trail?.width || 36) * .5;
    this.snowTerrain=this.data.snowTerrain?.sample(this.x,this.z,near);
    this.snowSoftness = near.trail ? .14 + .78 * smooth(near.distance / halfWidth, .63, 1.32) : .92;
    if(this.snowTerrain?.depth)this.snowSoftness=Math.max(this.snowSoftness,.14+.78*this.snowTerrain.strength);
    this.onTrail = !!near.trail && near.distance < halfWidth * 1.16;
    const named=this.data.snowSection?.(near.trail,near.index)||near.trail;
    this.trail = this.onTrail ? named : null;
    if(this.approach){this.onTrail=true;this.trail=null;this.snowSoftness=.14;return;}
    if (this.guided && Math.abs(this.offset) < 9) {
      const leg = this.route.legs?.find(l => l.startIndex<=this.planIndex && l.endIndex>this.planIndex);
      if (leg) {
        this.trail = near.trail?.id===leg.trailId ? named : this.data.trails.find(t => t.id === leg.trailId) || this.trail;
        this.onTrail = true;
        this.snowSoftness = Math.min(this.snowSoftness,.32);
      }
    }
  }

  get approach() {
    const area=this.route?.approach;
    if(!area || this.along>=area.endDistance-.05)return null;
    if(!this.guided){const p=this.route.at(this.along);if(Math.hypot(this.x-p.x,this.z-p.z)>22)return null;}
    return area;
  }

  beginJump() {
    if (this.mode !== 'run' || this.airborne || this.jumpCooldown > 0 || this.charging) return false;
    this.charging = true; this.charge = 0;
    return true;
  }

  releaseJump() {
    if (!this.charging) return false;
    const charge = this.charge;
    this.cancelJump();
    if (this.mode !== 'run' || this.airborne || this.jumpCooldown > 0) return false;
    const impulse = 1.75 + 3.0 * smooth(charge, 0, 1);
    // Leave the hill with its current vertical velocity, then follow a world-space parabola.
    this.upSpeed = this.verticalAlong + impulse;
    if (!Number.isFinite(this.upSpeed)) this.upSpeed = impulse;
    this.airborne = true; this.airHeight = .012; this.y = this.ground + this.airHeight;
    this.takeoffSpeed = impulse; this.airTime = 0; this.launch = 1; this.jumpCooldown = .22;
    return true;
  }

  cancelJump() { this.charging = false; this.charge = 0; }

  jump() {
    // A discrete accessibility action is a short tap; press/release controls use the methods above.
    return this.beginJump() && this.releaseJump();
  }

  get guided(){return this.opts.assist&&!this.handSteering;}

  freeHeading(heading){
    this.handSteering=true;this.autoSkating=false;this.neutralTime=0;this.courseCheck=0;
    if(Number.isFinite(heading))this.heading=this.travelHeading=heading;
  }

  setAssist(on) {
    if(this.mode!=='run')return;
    this.freeHeading();
    if(on)this.neutralTime=.5;
  }

  joinLine(route,along) {
    const f=route.glideFrame(along);
    const offset=-(this.x-f.x)*f.dz+(this.z-f.z)*f.dx;
    this.branchShiftX=this.x-(f.x-f.dz*offset);this.branchShiftZ=this.z-(f.z+f.dx*offset);
    this.edgeSpeed=this.speed*Math.sin(angleBetween(f.angle,this.travelHeading));
    if(route!==this.route){
      this.junctions=this.navigation?.stationsOn(route)||[];
      this.requestedTurn=null;this.passedJunctions.clear();
    }
    this.offset=offset;this.along=along;this.planIndex=f.index;this.route=route;
  }

  continueAtBase(){
    if(!['finished','run'].includes(this.mode)||this.airborne)return false;
    const next=this.navigation?.valleyLine(this);
    if(!next)return false;
    const stopped=this.mode==='finished';
    this.continuedFrom??={id:this.route.id,name:this.route.name};
    this.mode='run';
    if(stopped){
      this.heading=this.travelHeading=next.frame(0).angle;
      this.speed=2.15;this.push=.75;
    }
    this.joinLine(next,0);
    this.handSteering=!this.opts.assist||(!stopped&&next.finishKind!=='lift-link');this.neutralTime=0;this.courseCheck=.5;
    this.automatic=new AutomaticTurns();this.autoSkating=false;this.straightTuck=0;
    this.runoutRest=this.offPisteRest=0;this.recoveryReady=false;
    this.surface();
    return true;
  }

  recoverToPiste(){
    if(this.mode!=='run'||!this.recoveryReady||this.airborne)return false;
    const target=this.navigation?.recoveryLine(this);
    if(!target)return false;
    this.splits.finish();
    const {plan,along,frame}=target;
    this.x=frame.x;this.z=frame.z;this.y=this.ground=this.data.height(this.x,this.z);
    this.heading=this.travelHeading=frame.angle;
    this.joinLine(plan,along);
    this.speed=this.offset=this.edgeSpeed=this.branchShiftX=this.branchShiftZ=0;
    this.air=this.airHeight=this.upSpeed=this.verticalAlong=this.snowSink=0;
    this.edge=this.edgeRate=this.skid=this.slipAngle=this.steer=this.brake=this.boost=this.trim=this.push=0;
    this.press=this.pressure=this.curve=this.impact=this.landing=this.spray=this.bump=0;
    this.requestedTurn=null;this.cancelJump();this.automatic=new AutomaticTurns();this.autoSkating=false;this.straightTuck=0;
    this.handSteering=!this.opts.assist;this.neutralTime=0;this.courseCheck=.4;
    this.offPisteRest=this.runoutRest=0;this.lastTreeHit=-Infinity;this.recoveryReady=false;
    this.surface();
    return true;
  }

  junctionFor(routeId) {
    return this.junctions?.find(m=>m.along>=this.along-1 && !this.passedJunctions.has(m.sign.id) &&
      m.sign.options.some(o=>o.routeId===routeId));
  }

  switchRoute(route) {
    const upcoming=this.junctionFor(route.id);
    if(upcoming){this.rememberTurn(upcoming,route.id);return true;}
    const nearest = route.closest(this.x, this.z);
    if (nearest.distance > 64) return false;
    this.joinLine(route,nearest.along);
    this.handSteering=!this.opts.assist;
    return true;
  }

  activeJunction(lookAhead=155,behind=2) {
    return this.junctions?.find(m=>{
      const lead=m.along-this.along,p=m.sign.junctionPosition;
      return !this.passedJunctions.has(m.sign.id)&&lead>=-behind&&lead<=lookAhead&&
        (this.opts.assist||Math.hypot(this.x-p[0],this.z-p[1])<Math.max(32,lead+40));
    });
  }

  chooseDirection(routeId,signId) {
    if(this.mode!=='run')return false;
    const m=this.activeJunction();
    if(!m||(signId&&signId!==m.sign.id)||!m.sign.options.some(o=>o.routeId===routeId))return false;
    this.rememberTurn(m,routeId);return true;
  }

  rememberTurn(mark,routeId) {
    const option=mark.sign.options.find(o=>o.routeId===routeId);
    this.requestedTurn={id:mark.sign.id,routeId,name:option.name,en:option.en,canonicalId:option.canonicalId||routeId};
  }

  updateLine(input,dt) {
    const turning=Math.abs(input.steer||0)>.16;
    if(turning){
      if(!this.handSteering)this.freeHeading();
      this.neutralTime=0;
      this.requestedTurn=null;
    }else this.neutralTime+=dt;
    if(this.airborne)return;
    if(this.handSteering||!this.opts.assist){
      this.courseCheck-=dt;
      if(this.courseCheck>0)return;
      this.courseCheck=.14;
      const match=this.navigation?.alignTravel(this);
      if(match && (!turning || match.error<.49)){
        if(match.route!==this.route || (this.handSteering&&this.neutralTime>.42))
          this.joinLine(match.route,match.along);
        if(this.opts.assist && this.neutralTime>.42 && !input.brake)this.handSteering=false;
      }
      return;
    }
    const intent=this.requestedTurn;
    if(!intent)return;
    const mark=this.activeJunction(29,2);
    if(!mark||mark.sign.id!==intent.id)return;
    const branch=this.navigation.changeBranch(this.route,mark,intent.routeId);
    if(branch)this.joinLine(branch,this.along);
    this.requestedTurn=null;
  }

  get fork() {
    if(this.navigation){
      const m=this.activeJunction();if(!m)return null;
      const options=m.sign.options,alt=options.find(o=>o.routeId!==m.current.routeId&&o.routeId.includes('-to-'))||options.find(o=>o.routeId!==m.current.routeId);
      return alt?{id:m.sign.id,route:this.navigation.canonical(alt.routeId),ahead:Math.max(0,m.along-this.along),options}:null;
    }
    if (this.forkTaken || !this.route?.id.endsWith('classic')) return null;
    const there = this.route.resort === 'wanlong' ? 'genting' : 'wanlong';
    const alt = this.data.routes.find(r => r.id === this.route.resort + '-to-' + there);
    if (!alt) return null;
    const a=this.route.points,b=alt.points;let i=0;
    while(i+1<Math.min(a.length,b.length)&&a[i+1][0]===b[i+1][0]&&a[i+1][1]===b[i+1][1])i++;
    const ahead=this.route.distances[i]-this.along;
    return ahead>=-5&&ahead<155?{route:alt,ahead:Math.max(0,ahead)}:null;
  }

  tick(dt, input = {}) {
    if (this.mode !== 'run' || !(dt > 0)) return;
    // The runtime supplies 90 Hz. Larger direct or replay steps use the same maximum interval.
    const n = Math.max(1, Math.ceil(dt / physicsStep - 1e-7));
    for (let i = 0; i < n && this.mode === 'run'; i++) this.step(dt/n, input);
  }

  step(dt, input) {
    const continueValley=this.route.destination==='genting'?input.boost:input.steer<-.16;
    if(continueValley&&!input.brake&&this.route.length-this.along<90&&this.navigation?.valleyExit(this)){
      this.continueAtBase();
    }
    this.updateLine(input,dt);
    this.gear = this.opts.gear;
    const board = this.gear === 'board', assisted = this.guided, airborne = this.airborne;
    const oldX = this.x, oldZ = this.z, oldGround = this.ground, oldDirection = this.travelHeading;
    const oldSpeed = this.speed, beforeEdge = this.edge;
    this.elapsed += dt;
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    if (this.charging) this.charge = Math.min(1, this.charge + dt / .78);
    this.launch *= Math.exp(-dt*11);
    this.impact *= Math.exp(-dt*6.8);
    this.landing = approach(this.landing, this.impact, 18, dt);
    this.steer = approach(this.steer, clamp(input.steer || 0,-1,1), 12, dt);
    this.trim = approach(this.trim, clamp(input.trim || 0,-1,1), 8, dt);
    this.brake = approach(this.brake, +!!input.brake, 10, dt);
    this.boost = approach(this.boost, +!!input.boost, 8, dt);
    if (Math.abs(this.steer) > .16) this.cutSide = Math.sign(this.steer);
    const skidCommand = smooth(Math.abs(this.steer), .72, .97);
    const cut = Math.max(this.brake * .98, skidCommand);
    const skidTarget = airborne ? 0 : cut * (.72 + .28*smooth(oldSpeed,.25,3.7));
    this.skid = approach(this.skid, skidTarget, skidTarget > this.skid ? 5.7 : 4.2, dt);
    const demand = clamp(this.steer + (assisted ? this.guideLean * (1 - .64*Math.abs(this.steer)) : 0) +
      this.cutSide * this.brake * (1-Math.abs(this.steer))*.55, -1, 1);
    const spring = airborne ? 32 : 69;
    this.edgeRate += (spring * (demand - this.edge) - (airborne ? 10.6 : 13.9)*this.edgeRate) * dt;
    this.edge = clamp(this.edge + this.edgeRate * dt, -1, 1);
    this.bankSwap = approach(this.bankSwap, clamp(Math.abs(this.edgeRate)/4.2,0,1), 12, dt);
    if (beforeEdge * this.edge < 0) this.bankSwap = Math.max(.72, this.bankSwap);
    const load = Math.abs(this.edge);

    const fx = Math.sin(oldDirection), fz = -Math.cos(oldDirection);
    const surface=this.snowTerrain, textured=surface?.kind&&surface.kind!=='groomed';
    const pipe=surface?.kind==='pipe';
    const span=textured?.55:2;
    const gx=(this.data.height(oldX+span,oldZ)-this.data.height(oldX-span,oldZ))/(2*span);
    const gz=(this.data.height(oldX,oldZ+span)-this.data.height(oldX,oldZ-span))/(2*span);
    const grade=clamp(-(gx*fx+gz*fz),pipe?-4.5:-.85,pipe?4.5:1.18),crossGrade=gx*(-fz)+gz*fx;
    const contact=textured&&!airborne?snowResponse(this.data.height,oldX,oldZ,fx,fz,oldSpeed,surface,this.dimensions,board):null;
    this.groundLoad=approach(this.groundLoad,clamp(contact?.load??0,-.95,2.2),13,dt);
    const theta = Math.atan(grade), normal = 1 / Math.hypot(1,gx,gz);
    const climbLink=this.route.id==='wanlong-aster-climb'&&this.trail?.id==='w1349252976';
    const climb = climbLink&&grade<-.015?1:smooth(-grade,.004,.085);
    const climbPace = 2.15/(1+Math.max(0,-grade)*4);
    const remaining = Math.max(0,this.route.length-this.along);
    const canGlide=assisted&&this.onTrail&&!!this.pisteContact?.trail&&!this.approach;
    this.automatic.update(input,oldSpeed,canGlide,this.charging,airborne,dt);
    // Keep taking strides across a crest until there is enough speed to glide.
    // Steering, braking, jumping or entering the stopping area releases the assist.
    const canSkate=assisted&&this.onTrail&&!airborne&&!this.charging&&this.automatic.handsFree&&remaining>12;
    this.autoSkating=canSkate&&(this.autoSkating?oldSpeed<=20/3.6:oldSpeed<10/3.6&&grade<-.005);
    const manualPush=this.boost*(1-smooth(oldSpeed,3.8*(1-climb)+climbPace*.65*climb,8.7*(1-climb)+climbPace*1.3*climb));
    const shuffle = Math.max(manualPush,Number(this.autoSkating))*(1-this.brake)*(1-cut);
    this.push = approach(this.push, airborne ? 0 : shuffle, 8, dt);
    this.press = airborne ? 0 : Math.sign(this.trim)*smooth(Math.abs(this.trim),.57,.98)*
      (1-.60*this.skid)*(1-.57*this.push);
    this.stride = (this.stride + dt * (.71 + oldSpeed*.047) * (this.push>.015 ? 1 : 0)) % 1;
    const stroke = board ? Math.max(0,Math.sin((this.stride-.12)*TAU))**1.25 :
      Math.abs(Math.sin(this.stride*TAU))**1.45;
    const assistance = assisted && !airborne ? 1 - Math.max(this.brake, cut) : 0;
    this.straightTuck = this.automatic.tuck;
    const tuck = Math.max(this.boost * smooth(oldSpeed,3,11),this.straightTuck);
    const gravity = G * Math.sin(theta);
    const end = this.route.points.at(-1);
    const baseRange = Math.hypot(this.x-end[0],this.z-end[1]);
    const runout = assisted ? remaining : Math.max(0,baseRange-18);
    const powder = smooth(this.snowSoftness, .14, .92);
    if (!airborne) {
      const powderDrag=contact?.sink?Math.min(1.6,contact.sink*(2.7+.24*oldSpeed)):0;
      const bumpDrag=surface?.kind==='moguls' ? surface.strength*(.0032*oldSpeed*oldSpeed + .49*Math.max(0,this.groundLoad)) : 0;
      const resistance = .21 + .47*powder + powderDrag + bumpDrag + (board ? .0054 : .0048) * (1-.37*tuck) * oldSpeed*oldSpeed;
      const edgeLoss = load*load*(.12+.038*oldSpeed)*(1+.22*powder);
      const cutting = (this.skid*(2.8+.38*oldSpeed) + this.brake*(6.30+.11*oldSpeed))*(1+.12*powder);
      const drag = resistance*(1-Math.max(0,this.trim)*.075) + Math.max(0,-this.trim)*(.09+load*.22);
      // On a steep return traverse, a deliberate pole/skate step can still
      // gain ground. Manual strokes taper off at walking pace on steep climbs.
      let acceleration = gravity + this.push*(.68 + (board ? 4.5 : 3.45)*stroke + climb*Math.max(0,-gravity)*.95) - drag - edgeLoss - cutting;
      // Surveyed traverses contain short uphill and flat patches. The guide skates through
      // them after departure while manual braking still holds at a standstill.
      const cruiseFloor=3.05*(1-climb)+.80*climb;
      if (oldSpeed < cruiseFloor && assistance > .001 && !(climbLink&&grade<-.012)) {
        const glide = Math.min(1.8,(cruiseFloor-oldSpeed)*1.55);
        acceleration += Math.max(0,glide-acceleration) * assistance;
      }
      this.speed = clamp(oldSpeed + acceleration*dt,0,34.5);
      // Ease out on the snow front before coming to rest. Free skiers can pass
      // beside this area and continue across the hill.
      if(remaining<220 && (assisted || baseRange<80)){
        const stopLimit=Math.min(Math.sqrt(6.6*runout),1.45*runout);
        this.speed=Math.min(this.speed,stopLimit);
      }
    } else {
      this.speed = Math.max(0,oldSpeed - .0008*oldSpeed*oldSpeed*dt);
    }
    const planarSpeed = this.speed * (airborne ? this.flightCos : Math.cos(theta));
    const distance = planarSpeed * dt;
    const grip = clamp(1 + this.trim*.19 - this.skid*.49 - .09*powder + (contact?.load ? .13*this.groundLoad : 0),.35,1.22);
    const radius = (board ? 12.4 : 15.8) + oldSpeed*.16;
    const curvature = Math.sign(this.edge) * Math.pow(load,1.28) * grip / radius;
    if (assisted) {
      const width = clamp((this.trail?.width || 38)*.47,9,31);
      const here=this.route.glideFrame(this.along),ahead=this.route.glideFrame(this.along+Math.max(13,planarSpeed*.95));
      const junction=this.activeJunction(32+planarSpeed*.62,2);
      const clear=Math.min(smooth(remaining,24,61),junction?smooth(junction.along-this.along,9,32+planarSpeed*.62):1);
      const {offset:lane,speed:laneVelocity,load:guidedArc}=this.automatic.line(planarSpeed,width,grade,crossGrade,angleBetween(here.angle,ahead.angle),clear,dt);
      const steeringGain = this.automatic.active ? automaticCentreGain : .24;
      const recentre = (lane-this.offset)*(steeringGain+.47*smooth(Math.abs(this.offset),width*.55,width*1.04));
      const pull = edgeAcceleration(this.steer*planarSpeed*.59 + laneVelocity + recentre,this.edgeSpeed,planarSpeed,grip);
      const traction = airborne ? .06 : 1;
      const maxLat = (.90 + planarSpeed*planarSpeed / radius * .78) * traction;
      this.edgeSpeed += clamp(pull*dt, -maxLat*dt, maxLat*dt);
      this.edgeSpeed = clamp(this.edgeSpeed, -planarSpeed*.75, planarSpeed*.75);
      this.offset += this.edgeSpeed * dt;
      let stride = Math.min(this.route.length-this.along,Math.sqrt(Math.max(0,planarSpeed**2-this.edgeSpeed**2))*dt);
      let f = this.route.glideFrame(this.along+stride);
      // On rejoining from a traverse the boots can be well outside the centre
      // of a bend. Its outer edge travels an extra radius × angle per step.
      if(Math.abs(this.offset)>2 && stride>.0001){
        const extra=-this.offset*angleBetween(here.angle,f.angle);
        if(extra>stride*.02){
          stride*=stride/(stride+extra);
          f=this.route.glideFrame(this.along+stride);
        }
      }
      this.along+=stride;
      const decay=Math.exp(-distance/13);this.branchShiftX*=decay;this.branchShiftZ*=decay;
      this.x = f.x - f.dz*this.offset+this.branchShiftX; this.z = f.z + f.dx*this.offset+this.branchShiftZ; this.planIndex = f.index;
      const look = this.route.frame(Math.min(this.route.length,this.along+Math.max(5,planarSpeed*.80)));
      this.guideHeading=f.angle;
      const anticipateLimit=this.automatic.active?.48:.76;
      const anticipate = clamp(angleBetween(f.angle,look.angle)*planarSpeed*.093,-anticipateLimit,anticipateLimit);
      this.guideLean = approach(this.guideLean,clamp(anticipate+guidedArc,-.80,.80),5.8,dt);
      if (Math.hypot(this.x-oldX,this.z-oldZ)>.0001) this.travelHeading = Math.atan2(this.x-oldX,-(this.z-oldZ));
    } else {
      const gravityYaw = clamp(-G*crossGrade*normal/Math.max(3.1,planarSpeed),-.7,.7) *
        (.22 + .47*this.skid) * smooth(planarSpeed,.10,3);
      const snowReaction = this.cutSide*this.skid*(2.45+.17*oldSpeed)*
        Math.cos(Math.min(1.45,Math.abs(this.slipAngle)))/Math.max(2.1,planarSpeed);
      // Step turns can pivot from a standstill. At speed the sidecut and
      // loading take over so a held edge traces an arc across the fall line.
      const stepTurn = this.steer*1.62*(1-smooth(planarSpeed,3,11))*(1-this.brake*.55);
      const yawRate = airborne ? 0 : stepTurn + curvature*planarSpeed + gravityYaw +
        clamp(snowReaction,-.91,.91)*smooth(planarSpeed,.22,1.45);
      this.travelHeading += yawRate*dt;
      this.x += Math.sin(oldDirection+yawRate*dt*.5)*distance;
      this.z -= Math.cos(oldDirection+yawRate*dt*.5)*distance;
      const b=this.data.bounds;
      this.x=clamp(this.x,b.minX+8,b.maxX-8);this.z=clamp(this.z,b.minZ+8,b.maxZ-8);
      this.freeAge+=dt;
      if(this.freeAge>.16){const q=this.route.closest(this.x,this.z);this.along=q.along;this.planIndex=this.route.at(q.along).index;this.freeAge=0;}
    }
    if ((!assisted || Math.abs(this.offset)>9 || baseRange<110) && this.airHeight<1.4) {
      const hit=this.data.obstacles?.contact(this.x,this.z);
      if(hit){
        if(hit.kind==='tree'&&this.elapsed-this.lastTreeHit>.20){
          this.lastTreeHit=this.elapsed;this.feedback.tree++;
        }
        this.x=hit.x;this.z=hit.z;this.speed*=.39;this.edgeSpeed=0;this.impact=Math.max(this.impact,.56);
        if(assisted){const f=this.route.glideFrame(this.along);this.offset=-(this.x-f.x)*f.dz+(this.z-f.z)*f.dx;}
        else {const inward=Math.min(0,fx*hit.nx+fz*hit.nz);this.travelHeading=Math.atan2(fx-1.28*inward*hit.nx,-(fz-1.28*inward*hit.nz));}
      }
    }

    const desiredSlip = this.cutSide*this.skid*(board ? 1.22 : 1.10) + this.edge*.036;
    this.heading = mixAngle(this.heading, this.travelHeading+desiredSlip, 1-Math.exp(-dt*(airborne?3:9.3)));
    this.slipAngle = angleBetween(this.travelHeading,this.heading);
    this.curve = approach(this.curve,clamp(angleBetween(oldDirection,this.travelHeading)/dt,-2.5,2.5),7,dt);
    this.turn = this.curve;
    this.ground = this.data.height(this.x,this.z);
    this.verticalAlong = distance>.001 ? clamp((this.ground-oldGround)/dt,-29,16) : 0;
    this.slope = approach(this.slope,theta*180/Math.PI,6,dt);
    this.roll = approach(this.roll,Math.atan(crossGrade),6,dt);
    this.bump = approach(this.bump,clamp((grade-this.lastGrade)*oldSpeed,-1,1),14,dt);
    this.terrainFlex = approach(this.terrainFlex,Math.abs(this.bump)+Math.max(0,this.groundLoad)*.27,7,dt);
    this.lastGrade = grade;
    if (airborne) {
      this.airTime += dt;
      this.y += this.upSpeed*dt - G*dt*dt*.5;
      this.upSpeed -= G*dt;
      this.airHeight = Math.max(0,this.y-this.ground);
      if (this.airHeight<=.002) {
        const hitSpeed = Math.max(0,this.verticalAlong-this.upSpeed);
        this.airborne=false;this.airHeight=0;this.upSpeed=0;this.y=this.ground;this.contactTime=0;
        if(hitSpeed>1.25)this.feedback.landing++;
        this.impact=clamp((hitSpeed-.55)/3.7,.25,1.35);this.jumpCooldown=.25;
        this.speed*=1-Math.min(.10,hitSpeed*.009);
      }
    } else {
      this.flightCos = Math.cos(theta);
      this.contactTime += dt;
      this.y = this.ground; this.airHeight = 0;
      if(contact && this.contactTime>.14 && this.speed>5.8 && this.jumpCooldown===0){
        const noseRise=contact.rise;
        const release=!pipe && contact.load < -1.3 && noseRise>1.07 && this.verticalAlong>-.25;
        const nearLip=pipe && surface.ramp>.8 && Math.abs(surface.across)>10.72 &&
          Math.abs(surface.across)<11.05 && noseRise>3.2 && this.verticalAlong>2.8;
        const lip=nearLip && Math.abs(this.data.snowTerrain.sample(this.x,this.z).across)>Math.abs(surface.across);
        if(release||lip){
          this.airborne=true;this.airTime=0;this.airHeight=.004;this.y+=.004;
          this.upSpeed=clamp(noseRise*(lip?.83:.53),.52,lip?9:2.75);
          this.flightCos=Math.cos(theta);
          this.launch=lip?.50:.19;
        }
      }
    }
    this.air = this.airborne ? clamp(this.airHeight/.72 + smooth(this.airTime,0,.14)*.22,0,1) : 0;
    const weight = (load*.68 + Math.abs(this.curve)*this.speed/G*.43 + this.skid*.26) * smooth(this.speed,.3,7);
    this.pressure = approach(this.pressure,this.airborne?0:clamp(weight + this.landing*.49,0,1.32),8,dt);
    const scrape = Math.abs(Math.sin(this.slipAngle)) * this.speed;
    this.spray = this.airborne ? 0 : clamp(.035 + this.pressure*.30 + scrape*.072 + this.impact*.44,0,1.4) * smooth(this.speed,.55,5);
    this.maxSpeed = Math.max(this.maxSpeed,this.speed);
    const travelled=Math.hypot(this.x-oldX,this.z-oldZ,this.ground-oldGround);
    this.travel += travelled;
    this.surface();
    const currentPiste=this.trail ? this.pisteName(pisteVisitKey(this.trail),this.trail.id) : null;
    this.splits.add(currentPiste || null,travelled,dt);
    const piste=this.pisteContact, rawTrail=piste.trail;
    if(rawTrail&&this.route.finishKind!=='lift-link'&&!this.airborne&&this.speed>1.2&&piste.distance<(rawTrail.width||36)*.48){
      const a=rawTrail.points[piste.index],b=rawTrail.points[piste.index+1];
      const dx=this.x-oldX,dz=this.z-oldZ,metres=Math.hypot(dx,dz);
      const segmentLength=Math.hypot(b[0]-a[0],b[1]-a[1]);
      const alignment=Math.abs(dx*(b[0]-a[0])+dz*(b[1]-a[1]));
      if(metres>0&&alignment>.68*metres*segmentLength){
        const trail=this.data.snowSection?.(rawTrail,piste.index)||rawTrail;
        const key=pisteVisitKey(trail),visitId=rawTrail.id+'/'+key;
        if(key){
          const visit=this.pisteVisits.get(visitId)||{key,id:rawTrail.id,metres:0};
          visit.metres+=metres;this.pisteVisits.set(visitId,visit);
        }
      }
    }
    // Depth is measured vertically below the local snow surface. Leave rockered
    // tips exposed on the groomer and let a loaded edge cut into the softer verge.
    const softness = smooth(this.snowSoftness, .14, .92);
    const loading = clamp(this.pressure*.65 + this.skid*.18 + this.impact*.40, 0, 1.2);
    const depth = (.005 + .023*softness + (.012+.050*softness)*loading) *
      (board ? .87 : 1) * (this.dimensions?.scale ?? 1);
    const sinkTarget = this.airborne ? 0 : depth+(contact?.sink??0);
    this.snowSink = approach(this.snowSink, sinkTarget, this.airborne ? 30 : sinkTarget>this.snowSink ? 16 : 8, dt);
    const stopped=!this.airborne&&this.speed<.65;
    const canRecover=!this.onTrail&&!this.airborne&&!input.boost&&this.speed<10/3.6;
    this.offPisteRest=canRecover?this.offPisteRest+dt:0;
    this.recoveryReady=this.offPisteRest>=3-1e-8;

    const stoppedAtForecourt=stopped&&this.travel>25&&baseRange<=92&&atWanlongForecourt(this.data,this.route,this.x,this.z);
    this.runoutRest=stoppedAtForecourt?this.runoutRest+dt:0;
    const reachedEnd=assisted?this.route.length-this.along<=.32&&baseRange<56:remaining<45&&baseRange<=18.4;
    const atBase=reachedEnd||this.runoutRest>1.2;
    if(atBase&&!this.airborne){
      this.splits.finish();
      this.mode='finished';this.speed=0;this.airborne=false;this.air=this.airHeight=0;this.y=this.ground;this.cancelJump();
      this.edge=this.edgeRate=this.edgeSpeed=this.steer=this.brake=this.boost=this.trim=0;
      this.pressure=this.skid=this.curve=this.spray=this.push=this.bankSwap=this.press=0;
      this.launch=this.landing=this.impact=this.bump=this.terrainFlex=this.slipAngle=0;
    }
  }
}
