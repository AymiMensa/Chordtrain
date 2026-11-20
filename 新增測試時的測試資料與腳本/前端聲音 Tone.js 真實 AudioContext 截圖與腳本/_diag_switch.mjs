import { spawn } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const GAME='file:///C:/Users/user/Desktop/Chord_Train_New/client/public/KIMIchord_trees_fixed.html';
const PROFILE='C:/Users/user/Desktop/Chord_Train_New/.cdp_scratch/diag-profile';
const PORT=9224, sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rmP=()=>{try{fs.rmSync(PROFILE,{recursive:true,force:true})}catch(e){console.error('rmP',e.code)}};
let ws,mid=0; const pend=new Map();
function cdp(m,p={}){return new Promise((ok,no)=>{const i=++mid;pend.set(i,{ok,no});ws.send(JSON.stringify({id:i,method:m,params:p}));setTimeout(()=>{if(pend.has(i)){pend.delete(i);no(new Error('to '+m))}},25000);});}
async function ev(x){const r=await cdp('Runtime.evaluate',{expression:"(function(){var __r=("+x+");return (typeof __r==='function')?__r():__r;})()",returnByValue:true,awaitPromise:true}); if(r.result&&r.result.exceptionDetails)return{__err:r.result.exceptionDetails.text}; return r.result?r.result.result?.value:r.result;}
const click=id=>ev(`(()=>{var e=document.getElementById('${id}');if(e)e.click();return !!(e&&e.checked)})()`);
async function main(){
  rmP();
  const edge=spawn(EDGE,['--headless=new','--no-first-run','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--user-data-dir='+PROFILE,'--remote-debugging-port='+PORT,'--autoplay-policy=no-user-gesture-required','--window-size=1280,900','about:blank'],{stdio:'ignore'});
  try{
    let u; for(let i=0;i<40&&!u;i++){try{const l=await fetch('http://127.0.0.1:'+PORT+'/json/list').then(r=>r.json());u=(l.find(t=>t.type==='page'&&t.webSocketDebuggerUrl)||{}).webSocketDebuggerUrl;}catch(e){} if(!u)await sleep(300);} if(!u)throw new Error('no target');
    ws=new WebSocket(u); await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;setTimeout(()=>no(new Error('ws')),12000);});
    ws.onmessage=m=>{let d;try{d=JSON.parse(m.data)}catch(e){return} if(d.id&&pend.has(d.id)){const p=pend.get(d.id);pend.delete(d.id);d.error?p.no(new Error(d.error.message)):p.ok(d);}};
    await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Page.navigate',{url:GAME}); await sleep(1800);
    await ev(`(()=>{try{S.tempo=72}catch(e){}window.__n=function(){try{return AC.currentTime}catch(e){return performance.now()/1000}};window.__b=[];var o=window.playMetronomeBeat;window.playMetronomeBeat=function(a){try{window.__b.push({t:window.__n(),ac:!!a})}catch(e){}return o.apply(this,arguments)};window.__ac=function(){try{return AC.state}catch(e){return 'none'}};return 1})()`);
    // woodblock direct (baseline)
    await click('metronome'); await sleep(3600);
    const base=await ev(`(()=>({b:window.__b||[],i:!!metroInterval,bpm:(function(){try{return 60000/(60/Math.max(30,Number(S.tempo)||72))/1000}catch(e){return 0}})(),mode:S.metroMode}))`);
    console.log('BASELINE woodblock: beats='+base.b.length+' interval='+base.i);
    // switch groove -> woodblock
    await click('metronome'); // off
    await sleep(300);
    await ev(`(()=>{var s=document.getElementById('grooveSelect');if(s&&s.options.length){S.groove=s.options[0].value}document.getElementById('grooveModeBtn').click();return S.metroMode})()`); await sleep(1600);
    await ev(`(()=>{window.__b=[];return 1})()`);
    await click('woodblockModeBtn'); await sleep(4500);
    const sw=await ev(`(()=>{var b=(window.__b||[]).map(function(x){return Math.round(x.t*1000)});var gaps=[];for(var i=1;i<b.length;i++)gaps.push(b[i]-b[i-1]);window.__sw={raw:b,count:b.length,gaps:gaps,i:!!metroInterval};return window.__sw})()`);
    console.log('AFTER groove->woodblock: mode='+sw.mode+' intervals='+sw.i+' beats='+sw.count);
    console.log('rawBeatsMs='+JSON.stringify((sw.raw||[]).slice(0,40)));
    console.log('gapsMs='+JSON.stringify((sw.gaps||[]).slice(0,40)));
  }catch(e){console.error('DIAG_ERR',(e&&e.stack)||e);}
  finally{try{ws&&ws.close()}catch(e){} try{edge.kill()}catch(e){} rmP();}
}
main();