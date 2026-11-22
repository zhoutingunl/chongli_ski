export {TiltSteering} from './tilt.js';

export const isMiniTool = false;
export const motionSupported = true;
export const shareAvailable = () => true;
export const videoSaveAvailable = () => true;
export const initializePlatform = () => undefined;

export function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

export function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch {}
}

export async function fullscreen() {
  if (document.fullscreenElement) { await document.exitFullscreen(); return true; }
  if (!document.documentElement.requestFullscreen) return false;
  await document.documentElement.requestFullscreen({navigationUI:'hide'});
  if (matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints > 0)
    window.screen.orientation?.lock?.('landscape').catch(()=>{});
  return true;
}

export async function shareRoute(title, text, route) {
  if (!route) return 'unavailable';
  const url = new URL(location.href);
  url.searchParams.set('run', route);
  if (navigator.share) {
    await navigator.share({title,text,url:url.toString()});
    return 'shared';
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url.toString());
    return 'copied';
  }
  const field = document.createElement('textarea');
  field.value = url.toString();document.body.append(field);field.select();
  try { return document.execCommand('copy') ? 'copied' : 'unavailable'; }
  finally { field.remove(); }
}

export async function saveGameVideo(blob,name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
  return null;
}

export async function loadData(name) {
  const response = await fetch(import.meta.env.BASE_URL+'assets/geo/'+name+'.json');
  if (!response.ok) throw new Error('雪场数据加载失败');
  return response.json();
}

export async function loadForestImage(url) {
  const response = await fetch(url);
  return response.ok ? createImageBitmap(await response.blob()) : null;
}

export const engagementAvailable = () => false;
export const authorFollow = async () => null;
export const followStatus = async () => null;
export const weeklyScores = async () => null;
export const submitWeeklyScore = async () => null;
export const cloudRead = async () => null;
export const cloudWrite = async () => null;
export function gameVibration(type){
  if(typeof navigator.vibrate==='function')navigator.vibrate({light:15,medium:28,heavy:42}[type]);
}
