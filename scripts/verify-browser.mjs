#!/usr/bin/env node
// Optional local acceptance check. Uses a fresh Edge/Chrome profile and local HTTP only.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'.work','browser-acceptance');
fs.mkdirSync(output,{recursive:true});
const binaries=[process.env.FARM_BROWSER,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean);
const browser=binaries.find(p=>fs.existsSync(p));
if(!browser)throw Error('No browser found. Set FARM_BROWSER to an installed Edge or Chrome executable.');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'sand-farm-qa-'));
const report={passed:false,checks:[],errors:[],screenshots:[]};
let child,ws,server;
const log=fs.openSync(path.join(output,'browser.log'),'w');
const pending=new Map();let seq=0;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function rpc(method,params={}){const id=++seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},12000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await rpc('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;}
async function waitFor(expression,ms=12000){const start=Date.now();while(Date.now()-start<ms){if(await evaluate(expression))return;await delay(100);}throw Error('Condition timed out: '+expression);}
async function key(key,code=key){await rpc('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:key===' '?32:undefined});await rpc('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:key===' '?32:undefined});await delay(90);}
async function click(selector){const p=await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)throw Error("Missing control");e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');await rpc('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...p});await rpc('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...p});}
async function field(){const moves=await evaluate('(()=>{const g=SAND_FARM.game,p=g.state.player,q=[{x:p.x,y:p.y,m:[]}],seen=new Set([p.x+","+p.y]);for(let i=0;i<q.length;i++){const a=q[i];if(a.x===12&&a.y===9)return a.m;for(const [dx,dy,key] of [[0,1,"ArrowDown"],[0,-1,"ArrowUp"],[1,0,"ArrowRight"],[-1,0,"ArrowLeft"]]){const x=a.x+dx,y=a.y+dy,k=x+","+y;if(!seen.has(k)&&g.isWalkable(x,y)){seen.add(k);q.push({x,y,m:a.m.concat(key)});}}}throw Error("Field is unreachable")})()');for(const move of moves)await key(move);await key('ArrowDown');await waitFor('SAND_FARM.state().player.x===12&&SAND_FARM.state().player.y===10');}
async function sleep(){await key('m','KeyM');await click('[data-go="home"]');await waitFor('document.getElementById("dialog").open');assert.equal(await evaluate('document.getElementById("dialogTitle").textContent'),'今天就到这里吧');await click('#dialogActions .primary');await waitFor('document.getElementById("dialogTitle").textContent.startsWith("早安，第")');await click('#dialogActions .primary');await delay(80);}
async function screenshot(name){assert.equal(report.errors.length,0,'Fix browser errors before visual inspection');const image=await rpc('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(output,name),Buffer.from(image.data,'base64'));report.screenshots.push(name);}
try{
 server=http.createServer((req,res)=>{try{const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(root,'.'+(p==='/'?'/index.html':p));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);}catch{res.writeHead(400);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 child=spawn(browser,['--headless=new','--remote-debugging-port=0','--no-first-run','--no-default-browser-check','--user-data-dir='+profile,'--window-size=1440,1080','about:blank'],{stdio:['ignore',log,log]});
 let active;for(let i=0;i<60;i++){try{active=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(String.fromCharCode(10));break;}catch{}if(child.exitCode!==null)throw Error('Browser exited before debugging became available. See browser.log.');await delay(200);}
 if(!active)throw Error('Browser debugging unavailable. Run this check in a normal Windows terminal with browser process access.');
 const pages=await(await fetch('http://127.0.0.1:'+active[0]+'/json/list',{signal:AbortSignal.timeout(5000)})).json();const page=pages.find(p=>p.type==='page');assert.ok(page,'Missing isolated test tab');
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id){const item=pending.get(m.id);if(item){pending.delete(m.id);clearTimeout(item.timer);if(m.error)item.reject(Error(m.error.message));else item.resolve(m.result);}}if(m.method==='Runtime.exceptionThrown')report.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')report.errors.push(m.params.args.map(a=>a.value??a.description).join(' '));});
 await rpc('Runtime.enable');await rpc('Page.enable');await rpc('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});
 await rpc('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});await waitFor('!!window.SAND_FARM');await delay(300);
 assert.equal((await evaluate('SAND_FARM.health()')).renderErrors,0);report.checks.push('Game loaded without rendering exceptions');await waitFor('document.querySelector(".cover-art").complete&&document.querySelector(".cover-art").naturalWidth>0');await screenshot('welcome.png');await click('#startFarmBtn');await waitFor('SAND_FARM.health().started');await delay(180);await screenshot('desktop.png');const aspect=await evaluate('(()=>{const r=document.getElementById("farm").getBoundingClientRect();return r.width/r.height})()');assert.ok(Math.abs(aspect-16/9)<0.01,'Map canvas must keep 16:9 aspect ratio');
 await field();await key('1','Digit1');await key(' ','Space');await key('2','Digit2');await key(' ','Space');await key('3','Digit3');await key(' ','Space');assert.equal(await evaluate('SAND_FARM.state().plots["12,11"].watered'),true);report.checks.push('Real input: walk, till, sow and water');
 await sleep();assert.equal(await evaluate('SAND_FARM.state().day'),2);await field();await key('3','Digit3');await key(' ','Space');await sleep();assert.equal(await evaluate('SAND_FARM.state().plots["12,11"].crop.age'),2);
 await field();await key('4','Digit4');await key(' ','Space');assert.equal(await evaluate('SAND_FARM.state().bag.radish'),1);report.checks.push('Sleep, grow and harvest through actual UI');
 await key('m','KeyM');await click('[data-go="bin"]');await waitFor('document.getElementById("dialog").open');await click('#dialogActions .primary');assert.equal(await evaluate('SAND_FARM.state().money'),125);assert.equal(await evaluate('SAND_FARM.state().bag.radish'),0);report.checks.push('Navigate to shipping bin and sell harvest');
 await click('#pauseBtn');await click('[data-panel="system"]');await click('#saveBtn');const saved=await evaluate('SAND_FARM.state()');await click('#loadBtn');await click('#dialogActions .primary');await click('#dialogActions .primary');assert.deepEqual(await evaluate('SAND_FARM.state()'),saved);report.checks.push('Manual save and UI load restore exact progress');await click('#pauseBtn');
 for(const width of [320,390,820]){await rpc('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:true});await delay(150);assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),'Horizontal overflow at '+width);await evaluate('window.scrollTo(0,0)');await screenshot('mobile-'+width+'.png');}
 report.checks.push('Responsive layouts 320/390/820px do not overflow');assert.equal((await evaluate('SAND_FARM.health()')).renderErrors,0);assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.message;process.exitCode=1;}
finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Verification cleanup'));}ws?.close();if(child&&child.exitCode===null)child.kill();await new Promise(r=>server?server.close(r):r());fs.closeSync(log);if(child)await Promise.race([new Promise(r=>child.once('exit',r)),delay(2000)]);try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:200});}catch{console.log('Temporary browser profile retained: '+profile);}}
