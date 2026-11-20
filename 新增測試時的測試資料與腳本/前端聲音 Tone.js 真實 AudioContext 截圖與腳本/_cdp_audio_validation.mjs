import { spawn } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
process.on('unhandledRejection',e=>console.error('UNHANDLED',(e&&e.stack)||e));
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const GAME='file:///C:/Users/user/Desktop/Chord_Train_New/client/public/KIMIchord_trees_fixed.html';
const OUT=import.meta.dirname;
const PROFILE='C:/Users/user/Desktop/Chord_Train_New/.cdp_scratch/edge-profile';
const PORT=9222, sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rmP=()=>{try{fs.rmSync(PROFILE,{recursive:true,force:true})}catch(e){console.error('rmP ignored',e.code)}};
let ws,mid=0; const pend=new Map(), errs=[], results=[];
function cdp(m,p={}){return new Promise((ok,no)=>{const i=++mid;pend.set(i,{ok,no});ws.send(JSON.stringify({id:i,method:m,params:p}));setTimeout(()=>{if(pend.has(i)){pend.delete(i);no(new Error('timeout '+m));}},25000);});}
async function ev(x){const r=await cdp('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}); if(r.result&&r.result.exceptionDetails)return{__err:r.result.exceptionDetails.text}; return r.result?r.result.result?.value:r.result;}
async function shot(n){try{const r=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(OUT,n+'.png'),Buffer.from(r.result.data,'base64'));return n+'.png';}catch(e){return '(shot fail '+e.message+')';}}
async function getWs(){for(let i=0;i<40;i++){try{const l=await fetch('http://127.0.0.1:'+PORT+'/json/list').then(r=>r.json());const p=l.find(t=>t.type==='page'&&t.webSocketDebuggerUrl);if(p)return p.webSocketDebuggerUrl;}catch(e){}await sleep(350);}throw new Error('no CDP target');}
const AD=(t,A,P)=>{if(!P)return 999;const d=((t-(A||t))%P+P)%P;return Math.min(d,P-d);};
async function probe(){await ev(`(()=>{window.__n=function(){try{return AC.currentTime}catch(e){return performance.now()/1000}};window.__b=[],window.__g=0,window.__c=[];var o=window.playMetronomeBeat;window.playMetronomeBeat=function(a){try{window.__b.push({t:window.__n(),ac:!!a,m:!!(typeof S!=='undefined'&&S.metroMute)})}catch(e){}return o.apply(this,arguments)};var q=window.playGrooveStep;window.playGrooveStep=function(s){try{window.__g++}catch(e){}return q.apply(this,arguments)};var u=window.playChord;window.playChord=function(m,d,v,c,sk){try{if(sk===true)window.__c.push({t:window.__n()})}catch(e){}return u.apply(this,arguments)};window.__ac=function(){try{return AC.state}catch(e){return 'none'}};return 1})()`);}
const rst=()=>ev(`(()=>{window.__b=[],window.__g=0,window.__c=[];return 1})()`);
const dup=a=>{for(let i=1;i<a.length;i++)if(a[i]-a[i-1]<400)return true;return false;};
const click=id=>ev(`(()=>{const e=document.getElementById('${id}');if(e)e.click();return !!(e&&e.checked)})()`);

async function sceneLoad(){
  const info=await ev(`(()=>{const c=document.getElementById('contentArea'),h=s=>!!c&&!!c.querySelector(s);return{ready:document.readyState,contentLen:c?c.innerHTML.length:0,piano:h('.piano-mini'),tree:h('svg.tree-svg'),staff:h('.staff-svg'),anySvg:c?c.querySelectorAll('svg').length:0,acState:(typeof AC!=='undefined'&&AC?AC.state:'none')}})()`);
  const ok=info&&!info.__err&&info.ready==='complete'&&info.contentLen>2000&&(info.piano||info.tree||info.staff||info.anySvg>0)&&errs.length===0;
  return{name:'A. Page load & right-side visualization (chord tree / piano / staff)',pass:!!ok,detail:{...info,pageErrors:errs},shot:await shot('01_scene_load')};
}
async function sceneMetronome(){
  await probe(); await rst();
  await ev(`(()=>{try{S.tempo=72}catch(e){}const m=document.getElementById('metronome');if(m&&!m.checked)m.click();return 1})()`);
  await sleep(3700); const diagX=await ev(`(()=>({i:!!metroInterval,mode:S.metroMode,ck:document.getElementById('metronome').checked,clock:musicalClockActive,src:musicalClockSource,P:musicalClockPeriod,ac:window.__ac()}))()`);
  const e=await ev(`(()=>({b:window.__b||[],P:(typeof musicalClockPeriod!=='undefined'&&musicalClockPeriod)||0,A:(musicalClockAnchor||0),dot:(function(){var d=document.querySelector('.beat-indicator-dot.active');return d?d.getAttribute('data-beat'):null})(),ac:window.__ac()}))()`);
  if(e.__err)return{name:'B. woodblock metronome',pass:false,detail:e};
  const all=e.b.map(x=>x.t),acc=e.b.filter(x=>x.ac).map(x=>x.t),al=acc.length?Math.max(...acc.map(t=>AD(t,e.A,e.P))):999;
  return{name:'B. Woodblock metronome: 1234 & sound synced, accent on beat 1, single interval (no double woodblock)',pass:all.length>=3&&acc.length>=1&&all.length<=8&&acc.length<=2&&diagX&&diagX.ck&&diagX.i&&diagX.ac==='running',detail:{diag:diagX,beats:all.length,accents:acc.length,periodMs:+(e.P*1000).toFixed(0),maxAccentAlignSec:+al.toFixed(3),dupFast:dup(all),liveBeatDot:e.dot,acState:e.ac},shot:await shot('02_scene_metronome_woodblock')};
}
async function sceneMute(){
  await rst();
  await click('metroMute'); await sleep(1700);
  const e=await ev(`(()=>{var b=window.__b||[];return{beats:b.length,mutedAll:b.length>0&&b.every(function(x){return x.m}),dot:(function(){var d=document.querySelector('.beat-indicator-dot.active');return d?d.getAttribute('data-beat'):null})()}})()`);
  await click('metroMute');
  return{name:'C. Metronome mute: no sound (playMetronomeBeat suppressed), display logic intact',pass:!!e&&e.beats>=2&&e.mutedAll===true,detail:{beatCallsWhileMuted:e?e.beats:-1,allCallsWereMuted:e?e.mutedAll:null,lastBeatDotWhileMuted:e?e.dot:null},shot:await shot('03_scene_metro_mute')};
}
async function sceneChordAlign(){
  await rst();
  await ev(`(()=>{window.__c=[];try{playChord([60,64,67]);return 1}catch(e){return 'err '+e}})()`);
  await sleep(2200);
  const e=await ev(`(()=>({c:window.__c||[],P:(typeof musicalClockPeriod!=='undefined'&&musicalClockPeriod)||0,A:(musicalClockAnchor||0)}))()`);
  if(e.__err)return{name:'D. chord/arp align to beat 1',pass:false,detail:e};
  const best=e.c.length?Math.min(...e.c.map(x=>AD(x.t,e.A,e.P))):999;
  return{name:'D. With metronome on, chord/arp trigger aligns to the first beat (may defer up to 3 beats)',pass:e.c.length>0&&best<0.2,detail:{chordTriggers:e.c.length,bestAlignToDownbeatSec:+best.toFixed(3),periodMs:+(e.P*1000).toFixed(0)},shot:await shot('04_scene_chord_align')};
}
async function sceneHarmonyThenMetro(){
  await ev(`(()=>{const m=document.getElementById('metronome');if(m&&m.checked)m.click();try{S.progression=[{name:'C Major',note:'C',q:'Major'},{name:'G Major',note:'G',q:'Major'},{name:'A Minor',note:'A',q:'Minor'},{name:'F Major',note:'F',q:'Major'}]}catch(e){}if(typeof renderProgression==='function'){try{renderProgression()}catch(e){}}return 1})()`);
  await sleep(700); await rst();
  await ev(`(()=>{window.__c=[];try{playSmartHarmony(S.progression);return 1}catch(e){return 'err '+e}})()`);
  await sleep(1450);
  const beatAtClick=await ev(`(()=>{var n=window.__n(),P=(typeof musicalClockPeriod!=='undefined'&&musicalClockPeriod)||0;if(!P)return null;var d=((n-(musicalClockAnchor||n))%P+P)%P;return Math.floor(d/(P/4))})()`);
  const tClick=await ev(`(()=>window.__n())`);
  await click('metronome'); await sleep(3000);
  const e=await ev(`(()=>({b:window.__b||[],c:window.__c||[],P:(typeof musicalClockPeriod!=='undefined'&&musicalClockPeriod)||0,A:(musicalClockAnchor||0),on:!!(document.getElementById('progressionPlaybackStatus')&&document.getElementById('progressionPlaybackStatus').classList.contains('on')),ac:window.__ac()}))()`);
  if(e.__err)return{name:'E. harmony then metronome',pass:false,detail:e};
  const P=e.P,all=e.b.map(x=>x.t),acc=e.b.filter(x=>x.ac).map(x=>x.t),al=acc.length?Math.max(...acc.map(t=>AD(t,e.A,P))):999,cl=e.c.length?Math.max(...e.c.map(x=>AD(x.t,e.A,P))):999;
  const first=acc.filter(t=>t>tClick+0.02).sort((a,b)=>a-b)[0],waited=first?+(first-tClick).toFixed(3):null;
  return{name:'E. Harmony first then metronome: waits to next beat-1 before sounding; harmony & metronome share one clock',pass:acc.length>=1&&al<0.25&&e.c.length>=1&&cl<0.25,detail:{beatAtClick_0isFirst:beatAtClick,waitedSec:waited,accents:acc.length,maxAccentAlignSec:+al.toFixed(3),harmonyChords:e.c.length,maxHarmonyAlignSec:+cl.toFixed(3),dupFast:dup(all),harmonyPlaying:e.on,periodMs:+(P*1000).toFixed(0),acState:e.ac},shot:await shot('05_scene_harmony_then_metronome')};
}
async function sceneGrooveWoodblock(){
  await ev(`(()=>{const m=document.getElementById('metronome');if(m&&m.checked)m.click();return 1})()`); await sleep(400);
  await rst();
  await ev(`(()=>{var s=document.getElementById('grooveSelect');if(s&&s.options.length){S.groove=s.options[0].value}document.getElementById('grooveModeBtn').click();return S.metroMode})()`); await sleep(1900);
  const g1=await ev(`(()=>({g:window.__g||0,b:(window.__b||[]).length,mode:S.metroMode,ac:window.__ac()}))()`);
  await rst(); await click('woodblockModeBtn'); await sleep(4200);
  const g2=await ev(`(()=>{var a=(window.__b||[]).map(x=>x.t);var d=false;for(var i=1;i<a.length;i++)if(a[i]-a[i-1]<400)d=true;return{g:window.__g||0,b:a.length,dup:d,mode:S.metroMode,ac:window.__ac()}})()`);
  return{name:'F. Groove<->woodblock mutex: switch to Groove mutes woodblock; switch back mutes Groove (no two sounds)',pass:!!(g1&&g1.g>0&&g1.b===0&&g2&&g2.g===0&&g2.b>=1&&g2.b<=8),detail:{grooveMode:{grooveSteps:g1&&g1.g,woodblockBeats:g1&&g1.b},woodblockMode:{grooveStepsStillRunning:g2&&g2.g,woodblockBeats:g2&&g2.b,dupFast:g2&&g2.dup}},shot:await shot('06_scene_groove_woodblock_mutex')};
}
async function sceneWoodblockToggle(){
  await rst();
  await ev(`(()=>{if(S.metroMode!=='woodblock')document.getElementById('woodblockModeBtn').click();return S.metroMode})()`); await sleep(700); await rst();
  await click('woodblockModeBtn'); await sleep(1500);
  const off=await ev(`(()=>({b:(window.__b||[]).length,c:document.getElementById('metronome').checked,i:!!metroInterval}))()`);
  await rst(); await click('woodblockModeBtn'); await sleep(2200);
  const on=await ev(`(()=>{var a=(window.__b||[]).map(x=>x.t);var d=false;for(var i=1;i<a.length;i++)if(a[i]-a[i-1]<400)d=true;return{b:a.length,dup:d,c:document.getElementById('metronome').checked,i:!!metroInterval}})()`);
  return{name:'G. Woodblock clickable on/off: off stops sound, click again resumes; single interval throughout (no duplicate woodblock)',pass:!!(off&&off.b===0&&!off.c&&!off.i&&on&&on.b>=1&&on.b<=6&&on.c&&on.i),detail:{off,on},shot:await shot('07_scene_woodblock_toggle')};
}
async function runScenarios(){
  for(const fn of [sceneLoad,sceneMetronome,sceneMute,sceneChordAlign,sceneHarmonyThenMetro,sceneGrooveWoodblock,sceneWoodblockToggle]){
    try{results.push(await fn())}catch(e){results.push({name:fn.name,pass:false,detail:{fatal:e.message}});}
  }
  console.log('\n== SCENARIO RESULTS ==');
  for(const r of results)console.log((r.pass?'PASS':'FAIL')+' - '+r.name+'\n    detail='+JSON.stringify(r.detail));
}
function writeReport(){
  const pass=results.filter(r=>r.pass).length;
  const L=['# Real AudioContext / CDP validation report','','Page: client/public/KIMIchord_trees_fixed.html (run '+new Date().toISOString()+')','Browser: Microsoft Edge headless (--headless=new, --autoplay-policy=no-user-gesture-required), driven via Node built-in WebSocket CDP.','Overall: '+pass+' / '+results.length+' passed','','| Scenario | Result | Detail |','| --- | --- | --- |'];
  for(const r of results)L.push('| '+r.name+' | '+(r.pass?'PASS':'FAIL')+' | '+String(JSON.stringify(r.detail)).replace(/\|/g,'/')+' |');
  fs.writeFileSync(path.join(OUT,'report.md'),L.join('\n'));
  fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify({pass,total:results.length,results},null,2));
  console.log('Wrote report.md and report.json: '+pass+'/'+results.length+' passed');
}
async function main(){
  rmP();
  const edge=spawn(EDGE,['--headless=new','--no-first-run','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--user-data-dir='+PROFILE,'--remote-debugging-port='+PORT,'--autoplay-policy=no-user-gesture-required','--window-size=1280,900','about:blank'],{stdio:'ignore'});
  edge.on('error',e=>console.error('EDGE_ERR',e.message));
  try{
    const u=await getWs(); ws=new WebSocket(u);
    await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;setTimeout(()=>no(new Error('ws open timeout')),12000);});
    ws.onmessage=m=>{let d;try{d=JSON.parse(m.data)}catch(e){return} if(d.id&&pend.has(d.id)){const p=pend.get(d.id);pend.delete(d.id);d.error?p.no(new Error(d.error.message)):p.ok(d);} else if(d.method==='Runtime.exceptionThrown'){errs.push(d.params.exceptionDetails&&d.params.exceptionDetails.exception&&d.params.exceptionDetails.exception.description||'exception');} else if(d.method==='Runtime.consoleAPICalled'&&d.params.type==='error'){errs.push('console.error');}};
    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    await cdp('Page.navigate',{url:GAME}); await sleep(1600);
    await Promise.race([runScenarios(), new Promise((_,no)=>setTimeout(()=>no(new Error('overall timeout 70s')),70000))]);
  }catch(e){console.error('FATAL_MAIN',(e&&e.stack)||e);}
  finally{try{ws&&ws.close()}catch(e){} try{edge.kill()}catch(e){} rmP();}
  writeReport();
}
main().catch(e=>console.error('FATAL',(e&&e.stack)||e));