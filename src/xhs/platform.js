export const isMiniTool = true;
export const motionSupported = false;
export const shareAvailable = () => false;
export const fullscreen = () => Promise.resolve(false);
export const shareRoute = () => Promise.resolve('unavailable');
export function downloadPhoto() {}

// Touch is the input method in the tool. The native sensor reports angular
// velocity, whereas the browser steering model needs an absolute tilt.
export class TiltSteering {
  enabled = false;
  value = 0;
  calibrate() {}
  disable() {}
  enable() { return Promise.resolve(false); }
}

const memory = new Map();
const writable = new Set();
const writes = new Map();
let version, onStorageIssue;

const sdk = () => window.xhs?.miniTool;
const launchInfo = () => window.xhs?.launchOptions?.miniToolEnv;
const allows = (minimum, ...methods) => version >= minimum &&
  methods.every(name => typeof sdk()?.[name] === 'function');
function deadline(task, timeout = 1500) {
  let timer;
  const result = Promise.race([task, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Container response timed out')), timeout);
  })]);
  return result.then(value=>{clearTimeout(timer);return value;},error=>{clearTimeout(timer);throw error;});
}
function clientVersion(build) {
  return /^[1-9]\d{6,}$/.test(String(build)) && Number.isSafeInteger(Number(build))
    ? Math.floor(Number(build) / 1000) : null;
}
function placeControls(info) {
  if (!info) return;
  const {safeArea, menuButtons, gestureArea, windowWidth, windowHeight} = info;
  const visible = rect => rect?.width > 0 && rect.height > 0;
  const buttons = visible(menuButtons?.capsule) ? [menuButtons.capsule]
    : [menuButtons?.back, menuButtons?.me, menuButtons?.share].filter(visible);
  const bottomOfButtons = buttons.reduce((bottom, rect) => Math.max(bottom, rect.bottom || 0), 0);
  const edges = {
    top: Math.max(safeArea?.top || 0, bottomOfButtons + (buttons.length ? 8 : 0)),
    right: safeArea && Number.isFinite(windowWidth) ? windowWidth - safeArea.right : 0,
    bottom: safeArea && Number.isFinite(windowHeight) ? windowHeight - safeArea.bottom : 0,
    left: Math.max(safeArea?.left || 0, visible(gestureArea) ? gestureArea.right : 0)
  };
  for (const [edge, pixels] of Object.entries(edges)) {
    if (Number.isFinite(pixels))
      document.documentElement.style.setProperty('--tool-safe-'+edge, Math.max(0,pixels)+'px');
  }
}

export async function initializePlatform(keys, storageIssue) {
  onStorageIssue = storageIssue;
  placeControls(launchInfo()?.windowInfo);
  version = clientVersion(launchInfo()?.buildVersion);
  if (version === null && typeof sdk()?.getLaunchOptions === 'function') {
    try {
      const {miniToolEnv} = await deadline(sdk().getLaunchOptions(), 650);
      version = clientVersion(miniToolEnv?.buildVersion);
      placeControls(miniToolEnv?.windowInfo);
    } catch {}
  }
  if (allows(9490, 'getWindowInfo')) {
    let debounce, request = 0;
    const update = async () => {
      const attempt = ++request;
      try {
        const info = await deadline(sdk().getWindowInfo());
        if (attempt === request) placeControls(info);
      } catch {}
    };
    requestAnimationFrame(update);
    window.addEventListener('resize', () => {
      clearTimeout(debounce);
      debounce = setTimeout(update, 130);
    });
  }

  if (!allows(9460, 'getStorage', 'setStorage')) return;
  await Promise.all(keys.map(async key => {
    try {
      const result = await deadline(sdk().getStorage({key}), 850);
      if (result.data !== null && typeof result.data !== 'string') throw new Error('Invalid cache response');
      if (result.data !== null) memory.set(key, JSON.parse(result.data));
      writable.add(key);
    } catch { storageIssue('read'); }
  }));
}

export const read = (key, fallback) => memory.has(key) ? memory.get(key) ?? fallback : fallback;
export function store(key, value) {
  memory.set(key, value);
  if (!writable.has(key)) { onStorageIssue('write'); return; }
  const data = JSON.stringify(value);
  // Keep writes ordered, including a late reply to an earlier write.
  const task = (writes.get(key) || Promise.resolve()).then(async () => {
    const result = await sdk().setStorage({key, data});
    if (result?.errMsg !== 'setStorage:ok') throw new Error('Cache write unconfirmed');
  });
  const settled = task.catch(() => {});
  writes.set(key, settled);
  deadline(task).catch(() => onStorageIssue('write'));
  settled.then(() => { if (writes.get(key) === settled) writes.delete(key); });
}

export const albumAvailable = () => allows(9420, 'saveImageToPhotosAlbum');
export function photoData(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
export async function saveToAlbum(data, bytes) {
  if (!albumAvailable()) return false;
  let filePath = data;
  if (bytes > 320000 && typeof sdk().writeTempFile === 'function') {
    const result = await deadline(sdk().writeTempFile({data}), 6000);
    if (!result?.filePath) return false;
    filePath = result.filePath;
  }
  const result = await deadline(sdk().saveImageToPhotosAlbum({filePath}), 30000);
  return result?.errMsg === 'saveImageToPhotosAlbum:ok';
}

const dataScripts = new Map();
export function loadData(name) {
  if (dataScripts.has(name)) return dataScripts.get(name);
  if (!['mountain','horizon'].includes(name)) return Promise.reject(new Error('未知地形资源'));
  const task = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const finish = (value) => {
      clearTimeout(timer);
      script.remove();
      if (value) resolve(value); else reject(new Error('雪场数据加载失败'));
    };
    const timer = setTimeout(() => finish(null), 12000);
    script.onload = () => {
      const value = window.ridgelineTerrain?.[name];
      if (value) delete window.ridgelineTerrain[name];
      finish(value);
    };
    script.onerror = () => finish(null);
    script.src = './assets/geo/'+name+'-data.js';
    document.head.append(script);
  }).catch(error => { dataScripts.delete(name); throw error; });
  dataScripts.set(name, task);
  return task;
}

export function loadForestImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}
