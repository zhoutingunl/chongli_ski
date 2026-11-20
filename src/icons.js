const paths={
  sound:'<path d="M3 9h4l5-4v14l-5-4H3zM16 9a4 4 0 0 1 0 6m2.6-9a8 8 0 0 1 0 12"/>',
  mute:'<path d="M3 9h4l5-4v14l-5-4H3zM16 9l5 6m0-6-5 6"/>',
  expand:'<path d="M4 9V4h5m6 0h5v5M4 15v5h5m11-5v5h-5"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 0 1 5 .8c0 2.1-2.4 2.3-2.4 4.2m0 2.5h.01"/>',
  map:'<path d="m3 5 6-2 6 3 6-2v15l-6 2-6-3-6 2zM9 3v15m6-12v15"/>',
  ski:'<g transform="rotate(21 12 12)"><rect x="5.9" y="1.8" width="3.4" height="20.4" rx="1.7"/><rect x="14.7" y="1.8" width="3.4" height="20.4" rx="1.7"/><path d="M6.2 11h2.7m6.2 0h2.6"/></g>',
  board:'<g transform="rotate(26 12 12)"><rect x="7.4" y="1.2" width="9.2" height="21.6" rx="4.6"/><path d="m9.8 8.8 3.7-1m-3.2 8.3 3.7 1"/></g>',
  mountain:'<path d="m2 19 7.1-12 4 6 2.7-4.5L22 19zm4.7-8.1 2.6 2.3 2.5-1.5"/>',
  pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0z"/><circle cx="12" cy="10" r="2.3"/>',
  play:'<path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>', back:'<path d="m14.8 5-7 7 7 7"/>',
  eye:'<path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.7"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2.3 2.3m11.4 11.4L20 20m0-16-2.3 2.3M6.3 17.7 4 20"/>',
  snow:'<path d="M12 2v20M3.4 7l17.2 10M3.4 17 20.6 7M9.5 3.8 12 6l2.5-2.2M4.7 9.6l3 .9-.6-3.1M4.7 14.3l3.1-.8-.7 3.2M9.5 20l2.5-2.2 2.5 2.2m4.9-5.7-3.1-.8.7 3.2m2.4-7.2-3.2 1 .7-3.1"/>',
  cloud:'<path d="M6.7 18a4.4 4.4 0 0 1-.5-8.7 6 6 0 0 1 11.4-1.1A5 5 0 1 1 18 18Z"/>',
  dusk:'<path d="M3 17h18M6 20h12M7.2 14.4a5 5 0 0 1 9.6 0M12 3v3m7 .5-2 2m-12-2 2 2M1 13l3 .6m19-.6-3 .6"/>',
  check:'<path d="m4.8 12.2 4.3 4.5L19.6 6.6"/>',lift:'<path d="m1 6 22-4m-11 2v4l2 2M6 10h12l2 4v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5zM4 16h16m-8-6v6"/>',
  camera:'<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="3.5"/>',
  rotate:'<g transform="rotate(-30 12 12)"><rect x="6" y="3" width="12" height="18" rx="2"/><path d="M10 17h4"/></g>',
  controls:'<path d="M7 8h10c2 0 3 1 4 6l.5 2.4c.5 2.7-1.9 3.3-3.5 1.6l-2-2H8l-2 2c-1.6 1.7-4 1.1-3.5-1.6L3 14c1-5 2-6 4-6Z"/><path d="M7.5 10v4m-2-2h4m6.5-1h.01m2 2h.01"/>',
  auto:'<path d="M20 4v6h-6M20 10a8 8 0 1 0 .2 5"/><circle cx="12" cy="12" r="2.2"/>',
  evening:'<path d="M2 17h20M6 20h12M8 14a4 4 0 1 1 8 0M12 3v2m-7 3 2 1m12-1-2 1"/>',
  twilight:'<path d="M2 15h20M5 19h2m3 0h3m3 0h3m-5-12h4m-2-2v4"/>',
  night:'<path d="M19.3 16.2A8.7 8.7 0 0 1 8.1 4.4 8.8 8.8 0 1 0 19.3 16.2Z"/><path d="m17 3 .5 1.6L19 5l-1.5.5L17 7l-.5-1.5L15 5l1.5-.4Z"/>',
  aurora:'<path d="m2 17 4-8 2 3 5-8-1 6 4-3-2 5 6-2 2-3M2 20l6-4 5 3 4-2 5 2"/>',
  dawn:'<path d="M3 17h18M7 15a5 5 0 0 1 10 0m-5-4V2m-3 3 3-3 3 3"/>',
  heavy:'<path d="M3 5h8M1 8h6m6-3 2 5m1-5-4 4m9 4-5 3m2-5 1 6M9 15l2 6m2-5-5 4"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  flag:'<path d="M5 22V3m0 1c5-3 9 3 15 0l-1 9c-5 3-10-3-14 0"/>',
  compass:'<circle cx="12" cy="12" r="9"/><path d="m15.7 8.3-2 5.4-5.4 2 2-5.4z"/>',
  hand:'<path d="M7.5 13V6a1.4 1.4 0 0 1 2.8 0v5-7a1.4 1.4 0 0 1 2.8 0v7-5a1.4 1.4 0 0 1 2.8 0v6-3a1.4 1.4 0 0 1 2.8 0v5c0 4-2.1 6.6-6 6.6-3.9 0-5-2.1-7.1-5L3.5 13c-1-1.5.7-3 2.1-1.8Z"/>',
  plus:'<path d="M5 12h14M12 5v14"/>', minus:'<path d="M5 12h14"/>', layers:'<path d="m2 8 10-5 10 5-10 5zm0 4 10 5 10-5M2 16l10 5 10-5"/>'
};
export const glyph=(k,size=22)=>'<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[k]||'')+'</svg>';
export const emblem='<svg viewBox="0 0 63 39" fill="none" aria-hidden="true"><path d="M2 33 18 12l8 10L38 4l23 29H2Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m12.5 19.3 5.7 3.8 3.2-6M29 17l5.1 3.5 5.1-7.4 6.1 7.3 2.8-2.5M6 33l14-4.5 8.5 2.1 10-5.7 17.1 8.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export const viewNames={follow:'追尾',first:'第一人称',tips:'雪板尖',low:'贴雪',top:'俯瞰',left:'左侧',right:'右侧',front:'正面',far:'远摄'};
export function viewPicture(key){
  const skier='<circle cx="60" cy="12" r="3.8" fill="currentColor" stroke="none"/><path d="m58 19-5 8 8 5-7 8m-3-13-5 8 7 4m4-18 8 5 6-4m-5 5 5 10M44 41c8 1 18 1 26-1" stroke-width="3.3"/>';
  let art='';
  if(key==='first')art='<path d="M28 16q32-10 64 0l-4 18q-7 5-18 2l-8-5-8 5q-12 3-21-1Z" stroke-width="2.5"/><path d="m32 27 10-4 8 4 10-8 10 7 10-5 9 6"/>';
  else if(key==='tips')art='<path d="M44 41q4-26 7-29 4-4 5 1l-2 28Zm23 0-2-28q1-5 5-1 4 3 8 29Z" stroke-width="2.5"/>';
  else if(key==='top')art='<path d="m31 43 27-15m-23 17 27-14" opacity=".5"/><g transform="rotate(-27 63 26)"><circle cx="62" cy="19" r="4" fill="currentColor"/><path d="M57 25q5 9 10-1m-14-8v15m18-17v16" stroke-width="4"/></g>';
  else if(key==='front')art='<circle cx="61" cy="15" r="5"/><path d="M56 13h9m-11 9 7 3 7-3m-13 0-6 9-4-5m22-4 7 9 4-6m-21 1-4 9 3 7m8-16 4 10-3 6m-17-15-5 14m34-15 4 14" stroke-width="3.5"/>';
  else{
    const tr=key==='far'?'translate(29 15) scale(.52)':key==='right'?'translate(120 0) scale(-1 1)':key==='low'?'translate(-1 -4) scale(1.09)':'';
    art='<path d="M12 43q42 2 96-8" opacity=".32"/><g transform="'+tr+'">'+skier+'</g>';
    if(key==='far')art+='<path d="M37 16v-6h8m30 0h8v6m0 17v6h-8m-30 0h-8v-6" opacity=".65"/>';
  }
  return '<svg viewBox="0 0 120 49" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+art+'</svg>';
}
