(function () {
'use strict';
const {FarmGame,CROPS,MAP,LOCATIONS,QUESTS,NPCS,PRODUCTS,ITEMS,RECIPES,BUILDINGS,HELPERS}=window.FarmCore;
const game=new FarmGame(), $=id=>document.getElementById(id), canvas=$('farm'), ctx=canvas.getContext('2d');
const tools=['hoe','seed','water','harvest','axe','pickaxe'];
const hints={hoe:'锄头 · 在浅绿色田地上开垦土地',seed:'种子 · 在耕好的空地播种',water:'水壶 · 每天浇一次水，作物才会生长',harvest:'采收 · 收获带有金色光点的成熟作物',axe:'斧头 · 砍除树木，收集木材',pickaxe:'镐子 · 清除石块，收集石料'};
const colors={radish:'#e8bba8',carrot:'#dfa04d',berry:'#cd707a'};
const dirs={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
const keyDirs={ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down',ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right'};
const STORAGE='sand-garden-farm-v2',AUTO=STORAGE+'-auto';
let businessTab='ranch',menuOpen=null,started=false,tool='hoe',cropId='radish',paused=false,target=null,path=[],arrival=null,held=null,lastMove=0,lastFrame=0,clockElapsed=0,saveElapsed=0,nightNotice=0,toastTimer=0,renderErrors=0;
const motion=window.FarmMotion.create(game.state.player);
let paintElapsed=1000/60,renderDirty=true,lastDraw=0,frameCount=0,fps=0,fpsSamples=0,fpsElapsed=0,lastPerfLabel=0,drawMs=0;
const motionPreference=window.matchMedia?window.matchMedia('(prefers-reduced-motion: reduce)'):null;
const dialog=$('dialog');
function visualPlayer(now=performance.now()){motion.set(game.state.player,now);return motion.sample(now);}
function camera(now=performance.now()){const p=visualPlayer(now),cols=canvas.width/MAP.tile,rows=canvas.height/MAP.tile;return{x:Math.round(Math.max(0,Math.min(MAP.cols-cols,p.x-cols/2))*MAP.tile)/MAP.tile,y:Math.round(Math.max(0,Math.min(MAP.rows-rows,p.y-rows/2))*MAP.tile)/MAP.tile};}
function closePanel(){menuOpen=null;$('inGamePanel').hidden=true;document.body.classList.remove('menu-expanded');clockElapsed=0;canvas.focus({preventScroll:true});}
function openPanel(name){if(!started)return;if(menuOpen===name){closePanel();return;}stopMotion();menuOpen=name;for(const id of ['inventory','village','quests','business','system'])$(id+'Panel').hidden=id!==name;$('panelTitle').textContent=({inventory:'背包与种子',village:'村庄向导',quests:'村民委托',business:'生产经营',system:'存档与系统'})[name];$('inGamePanel').dataset.panel=name;if(name==='business'){businessNotice=null;renderBusiness();}$('inGamePanel').hidden=false;document.body.classList.add('menu-expanded');clockElapsed=0;update();}
$('closePanelBtn').onclick=closePanel;document.querySelectorAll('[data-panel]').forEach(b=>b.onclick=()=>openPanel(b.dataset.panel));
$('fullscreenBtn').onclick=async()=>{try{if(document.fullscreenElement){await document.exitFullscreen();}else if($('gameStage').requestFullscreen){await $('gameStage').requestFullscreen();}else notify('当前浏览器不支持全屏，请使用F11或浏览器全屏菜单。');}catch{notify('浏览器未允许全屏，可以使用F11。');}};
document.addEventListener('fullscreenchange',()=>{$('fullscreenBtn').textContent=document.fullscreenElement?'退出全屏':'全屏';});
function notify(text){if(!text)return;$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3500);}
function stopMotion(){held=null;path=[];arrival=null;}
function selectTool(value){if(!tools.includes(value))return;closePanel();tool=value;document.querySelectorAll('[data-tool]').forEach(b=>{const on=b.dataset.tool===tool;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});$('toolHint').textContent=hints[tool];canvas.focus({preventScroll:true});}
function selectSeed(id){if(!CROPS[id])return;cropId=id;closePanel();selectTool('seed');update();}
function frameResult(result,quiet=false){if(result&&(!quiet||!result.ok))notify(result.message);update();return result;}
function updateTargetInfo(){if(!target)return;const p=game.state.plots[target.x+','+target.y];if(!p)return;let message=p.crop?CROPS[p.crop.id].name+' · '+(p.crop.age>=CROPS[p.crop.id].days?'可以采收':p.crop.age+' / '+CROPS[p.crop.id].days+' 个生长日'):'已开垦的空地';message+=' · '+(p.watered?'土地湿润':'需要浇水');$('contextHint').textContent=message;}
function update(){
 motion.set(game.state.player,performance.now());renderDirty=true;
 const s=game.state,hour=Math.floor(s.minutes/60),minute=s.minutes%60;
 $('dayLabel').textContent='春 · 第 '+s.day+' 天';$('weatherLabel').textContent=s.weather==='rainy'?'雨天':'晴天';$('clockLabel').textContent=String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');
 $('moneyLabel').textContent=s.money.toLocaleString('zh-CN');$('energyBar').max=s.maxEnergy;$('energyBar').value=s.energy;$('energyLabel').textContent=s.energy+' / '+s.maxEnergy;$('positionLabel').textContent=s.player.x+', '+s.player.y;
 for(const id of Object.keys(CROPS)){const b=$('seed-'+id);if(b){b.querySelector('b').textContent=s.seeds[id];b.classList.toggle('active',id===cropId);b.setAttribute('aria-pressed',String(id===cropId));}}
 for(const id of Object.keys(ITEMS))$('bag-'+id).textContent=s.bag[id];
 $('bagCount').textContent=Object.values(s.bag).reduce((a,v)=>a+v,0)+' 件';$('woodLabel').textContent='木材 '+s.wood;$('stoneLabel').textContent='石料 '+s.stone;
 $('questCount').textContent=s.claimed.length+' / '+QUESTS.length;
 for(const q of QUESTS){const row=$('quest-'+q.id),status=game.questStatus(q.id),owner=NPCS[q.npc||'npc'];row.classList.toggle('done',status.claimed);row.querySelector('span').textContent=(status.claimed?'已领取奖励':status.locked?'完成前置委托后解锁':Math.min(q.target,status.progress)+' / '+q.target)+' · '+owner.name+' · '+q.reward+' G';}
 const near=game.nearby();$('contextHint').textContent=near?'附近：'+near.name+' · 按 E 或点击「交互」':path.length?'正在走过去…方向键可随时取消路线。':'点击远处行走；点击身边格子使用工具。';
 const mature=Object.values(s.plots).filter(p=>p.crop&&p.crop.age>=CROPS[p.crop.id].days).length;
 $('dailyHint').textContent=mature?'有 '+mature+' 块作物成熟了，拿起篮子去采收吧。':s.energy<15?'今天辛苦了，回小屋睡一觉，明天再继续。':s.weather==='rainy'?'今天下雨，田地已被雨水浇灌。去村庄拜访邻居吧。':'开垦 → 播种 → 浇水 → 回家睡觉';updateTargetInfo();
}
for(const [id,c] of Object.entries(CROPS)){
 const b=document.createElement('button');b.className='seed-choice';b.id='seed-'+id;b.setAttribute('aria-pressed',String(id===cropId));b.setAttribute('aria-label','选择'+c.name+'种子');b.innerHTML='<span class="crop-dot" style="--crop:'+colors[id]+'"></span><span>'+c.name+' <small>'+c.days+' 天</small></span><b>0</b>';b.onclick=()=>selectSeed(id);$('seedChoices').append(b);
 const item=document.createElement('div');item.className='inventory-item';item.innerHTML='<strong id="bag-'+id+'">0</strong><span>'+c.name+'</span>';$('inventory').append(item);
}
for(const [id,item]of Object.entries(PRODUCTS)){const card=prodNode('div','inventory-item prod-inventory-item');card.append(prodIcon(id));const count=prodNode('strong','',0);count.id='bag-'+id;card.append(count,prodNode('span','',item.name));$('inventory').append(card);}
for(const q of QUESTS){const item=document.createElement('div');item.id='quest-'+q.id;item.className='quest-item';item.textContent=q.name;item.append(document.createElement('span'));const go=document.createElement('button');go.textContent='前往'+NPCS[q.npc||'npc'].name;go.onclick=()=>{closePanel();const id=q.npc||'npc',l=LOCATIONS[NPCS[id].location];if(paused){notify('先继续游戏，再前往村民身边。');return;}planRoute(l.x,l.y,NPCS[id].location);};item.append(go);$('questList').append(item);}for(const [id,npc]of Object.entries(NPCS)){if(id==='npc')continue;const b=document.createElement('button');b.dataset.go=npc.location;b.textContent=npc.name;const small=document.createElement('small');small.textContent=npc.role;b.append(small);b.onclick=()=>{closePanel();if(paused){notify('先继续游戏，再前往村民身边。');return;}const l=LOCATIONS[npc.location];planRoute(l.x,l.y,npc.location);};$('destinationList').append(b);}
for(const id of ['ranch','workshop','guild']){const loc=LOCATIONS[id];if(!loc)continue;const b=document.createElement('button');b.dataset.go=id;b.textContent=loc.name;const small=document.createElement('small');small.textContent=id==='ranch'?'养殖与饲料':id==='workshop'?'加工成品':'雇佣帮手';b.append(small);b.onclick=()=>{closePanel();if(paused){notify('先继续游戏，再前往'+loc.name+'。');return;}planRoute(loc.x,loc.y,id);};$('destinationList').append(b);}
function setPaused(value){paused=!!value;stopMotion();clockElapsed=0;$('pauseBtn').textContent=paused?'继续':'暂停';$('pauseBtn').setAttribute('aria-pressed',String(paused));$('pauseOverlay').hidden=!paused;}
function showDialog(title,body,actions=[],eyebrow='田园手记'){
 closePanel();stopMotion();$('dialogTitle').textContent=title;$('dialogEyebrow').textContent=eyebrow;$('dialogBody').replaceChildren();
 if(typeof body==='string')$('dialogBody').innerHTML=body;else $('dialogBody').append(body);
 $('dialogActions').replaceChildren();for(const spec of actions){const b=document.createElement('button');b.textContent=spec.label;if(spec.primary)b.className='primary';if(spec.danger)b.classList.add('danger');b.onclick=spec.action;$('dialogActions').append(b);}
 if(!dialog.open)dialog.showModal();
}
function closeDialog(){dialog.close();clockElapsed=0;canvas.focus({preventScroll:true});}
$('closeDialog').onclick=closeDialog;dialog.addEventListener('cancel',()=>{stopMotion();clockElapsed=0;});
function save(auto=false){if(!started)return false;try{const record={format:'sand-garden-farm',version:2,savedAt:new Date().toISOString(),state:game.snapshot()};localStorage.setItem(auto?AUTO:STORAGE,JSON.stringify(record));if(!auto)notify('农场已保存到这个浏览器。');return true;}catch{if(!auto)notify('浏览器存储不可用，请用「导出存档」保存文件。');return false;}}
function decodeSave(text){const record=JSON.parse(text);return record&&record.format==='sand-garden-farm'?record.state:record;}
function restoreState(state){const check=new FarmGame();check.restore(state);game.restore(check.snapshot());beginFarm();stopMotion();setPaused(true);target=null;nightNotice=0;update();window.FarmRenderer.draw(ctx,game,{time:0,tool,cropId,target,camera:camera(),player:visualPlayer()});}
function confirmRestore(data){try{const check=new FarmGame();check.restore(data);showDialog('继续这座农场？','<p>读入后将替换当前进度。你也可以先取消，保存现在的农场。</p>',[{label:'取消',action:closeDialog},{label:'读取存档',primary:true,action:()=>{try{restoreState(data);closeDialog();notify('读档成功，点击「继续」开始新的一天。');}catch(e){notify(e.message);}}}]);}catch(e){notify(e.message||'存档格式不正确。');}}
function loadDialog(){
 let manual,auto;try{manual=localStorage.getItem(STORAGE);auto=localStorage.getItem(AUTO);}catch{notify('无法读取浏览器存储，请导入本地存档。');return;}
 if(!manual&&!auto){notify('还没有存档，先点「保存」或「导入存档」。');return;}
 const actions=[{label:'取消',action:closeDialog}];const choose=text=>{try{confirmRestore(decodeSave(text));}catch{notify('存档不是有效 JSON，原进度没有改变。');}};
 if(auto)actions.push({label:'读取自动存档',action:()=>choose(auto)});if(manual)actions.push({label:'读取手动存档',primary:true,action:()=>choose(manual)});
 showDialog('你的农场存档','<p>自动存档与手动存档分别保留。睡觉后及游玩过程中会自动保存，手动保存不会被覆盖。</p>',actions);
}
function interact(){
 if(!started||menuOpen)return;if(paused){notify('先点击「继续」，再和村庄互动。');return;}const result=game.interact();if(!result.ok){notify(result.message);return;}
 if(result.kind==='home')showDialog('今天就到这里吧','<p>睡一觉进入明天，体力会恢复。今天浇过水的作物将生长一天，没浇水的会等你，不会枯萎。</p>',[{label:'再逛一会儿',action:closeDialog},{label:'睡到明天',primary:true,action:()=>{const r=game.sleep();frameResult(r);if(r.ok){closeDialog();save(true);const sum=r.summary;showDialog('早安，第 '+game.state.day+' 天','<div class="summary-stats"><div><strong>'+sum.grown+'</strong><span>块作物生长</span></div><div><strong>'+game.state.energy+'</strong><span>体力恢复</span></div><div><strong>'+game.state.money+'</strong><span>现有金币</span></div></div><p class="summary-weather">今天是'+(game.state.weather==='rainy'?'雨天，雨水会替你照顾菜田。':'晴天，记得给作物浇水。')+'</p>',[{label:'开始新的一天',primary:true,action:closeDialog}],'小屋 / 新的一天');}}}],'小屋 / 结束一天');
 else if(result.kind==='shop')shopDialog();
 else if(result.kind==='bin'){const total=Object.entries(game.state.bag).reduce((a,[id,n])=>a+n*(ITEMS[id]?ITEMS[id].sellPrice:0),0);showDialog('把收获带去集市','<p>出货箱里的收成会立即结算。你现在的作物一共值 <strong>'+total+' G</strong>。</p>',[{label:'先留着',action:closeDialog},{label:'卖出全部收获',primary:true,action:()=>{const r=game.sellAll();frameResult(r);if(r.ok){closeDialog();save(true);}}}],'出货箱 / 收获的回报');}
 else if(result.kind==='npc')questDialog(result.npcId||'npc');
 else if(result.kind==='ranch')ranchDialog();
 else if(result.kind==='workshop')workshopDialog();
 else if(result.kind==='guild')guildDialog();
 else if(result.kind==='well'){showDialog('井边的清风','<p>坐下来休息一下，每天可在井边恢复一次体力。</p>',[{label:'继续散步',action:closeDialog},{label:'休息一会儿',primary:true,action:()=>{const r=game.rest?game.rest():game.restAtWell?game.restAtWell():{ok:false,message:'今天先回家休息吧。'};frameResult(r);if(r.ok)closeDialog();}}],'石井 / 小憩');}
 else notify(result.message);
}
function money(n){return Math.round(n).toLocaleString('zh-CN');}
function itemLabel(id){return (ITEMS[id]&&ITEMS[id].name)||id;}
function businessNav(id,label){const l=LOCATIONS[id];if(!l)return;closePanel();if(paused){notify('先继续游戏，再前往'+label+'。');return;}planRoute(l.x,l.y,id);}
function sceneAt(id){const s=game.state;return {ranch:s.livestock,workshop:s.industry,guild:s.helpers,money:s.money,bag:s.bag,day:s.day};}
function row(labelHtml,valueHtml,disabled){const r=document.createElement('div');r.className='shop-row';const l=document.createElement('div');l.innerHTML=labelHtml;r.append(l);if(valueHtml){const v=document.createElement('div');v.className='business-value';v.textContent=valueHtml;r.append(v);}return r;}
function button(text,handler,disabled,primary){const b=document.createElement('button');b.textContent=text;b.disabled=!!disabled;if(primary)b.className='primary';b.onclick=handler;return b;}
function costLine(cost){return Object.entries(cost).map(([k,v])=>((ITEMS[k]&&ITEMS[k].name)||(k==='wood'?'木材':k==='stone'?'石料':k))+' '+v).join(' · ');}
let businessNotice=null,ranchEvent=null;
const businessPages=[['ranch','牧场','照料与收获'],['workshop','加工','原料到成品'],['guild','帮手','农事好伙伴']];
function prodNode(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;}
function prodIcon(id){
 const paths={chicken:'<path fill="#f6edd3" d="M4 14h15v10H4zM16 8h8v12h-8z"/><path fill="#c26148" d="M17 5h3v4h-3zM21 5h3v4h-3z"/><path fill="#dba24e" d="M24 12h4v3h-4zM7 24h2v4H7zM15 24h2v4h-2z"/><path fill="#3d4939" d="M21 10h2v2h-2z"/>',cow:'<path fill="#eae5cd" d="M3 12h20v12H3zM20 7h9v14h-9z"/><path fill="#73583d" d="M5 13h6v7H5zM14 17h5v7h-5zM4 24h3v5H4zM18 24h3v5h-3z"/><path fill="#d4a58d" d="M22 16h8v6h-8z"/><path fill="#3d4939" d="M25 10h2v2h-2z"/>',coop:'<path fill="#bd8052" d="M3 13 16 3l13 10z"/><path fill="#e1c99b" d="M6 13h20v15H6z"/><path fill="#805b3a" d="M13 18h7v10h-7z"/>',workshop:'<path fill="#7c8b80" d="M5 13h23v15H5z"/><path fill="#aa764b" d="m3 13 13-9 14 9zM23 3h4v8h-4z"/><path fill="#f4ce7a" d="M8 17h5v5H8zM20 17h5v5h-5z"/>',waterer:'<path fill="#84b4b5" d="M5 14h16v13H5zM20 18l9-5v5l-9 6z"/><path fill="none" stroke="#527d81" stroke-width="3" d="M8 14V7h10v7"/>',harvester:'<path fill="#ba8d57" d="M5 16h23l-3 12H8z"/><path fill="none" stroke="#7b5b3b" stroke-width="3" d="M10 16V8h12v8"/><path fill="#d99051" d="M9 13h6v5H9z"/><path fill="#9bad64" d="M18 12h6v7h-6z"/>',feed:'<path fill="#dfc58d" d="M7 9h19v20H7z"/><path fill="#94734b" d="M9 4h15v6H9z"/><path fill="#7c9859" d="M15 14h3v11h-3zM10 14h5v4h-5zM18 12h5v5h-5z"/>',egg:'<path fill="#e8d5aa" d="M12 5h8v3h3v5h3v11h-3v4H9v-4H6V13h3V8h3z"/><path fill="#fff6dd" d="M11 12h4v9h-4z"/>',milk:'<path fill="#f2ecd9" d="M10 9h13v20H8V12h2z"/><path fill="#83a7a3" d="M11 4h10v6H11zM8 16h15v7H8z"/>',mayo:'<path fill="#c39859" d="M8 6h17v4H8z"/><path fill="#efe1a8" d="M8 11h17v18H8z"/><path fill="#88a46b" d="M9 17h15v7H9z"/>',cheese:'<path fill="#e2b65d" d="m5 13 20-8 3 9v13H5z"/><path fill="#bd9347" d="M5 14h23v3H5zM10 20h3v3h-3zM20 21h3v3h-3z"/>',jam:'<path fill="#896744" d="M7 5h19v5H7z"/><path fill="#b86763" d="M8 11h17v18H8z"/><path fill="#efd9a5" d="M9 17h15v7H9z"/>'};
 const n=prodNode('span','prod-thumb prod-icon-'+id);n.setAttribute('aria-hidden','true');n.innerHTML='<svg viewBox="0 0 32 32" shape-rendering="crispEdges">'+(paths[id]||paths.coop)+'</svg>';return n;
}
function renderBusiness(animate=true,focusKey=null){
 const s=game.state,host=$('businessBody');if(!host)return;const scroller=$('inGamePanel'),savedScroll=scroller.scrollTop||0;host.replaceChildren();host.className='business-panel';
 const headline=prodNode('div','business-overview');headline.append(prodNode('span','business-overview-title','田园经营手记'),prodNode('span','prod-wallet',s.money.toLocaleString('zh-CN')+' G'));host.append(headline);
 const tabs=prodNode('div','business-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','经营分类');
 const choose=(id)=>{businessTab=id;businessNotice=null;renderBusiness(true,'tab-'+id);};
 businessPages.forEach(([id,label,sub],index)=>{const b=prodNode('button','business-tab',label);b.id='business-tab-'+id;b.dataset.prodKey='tab-'+id;b.setAttribute('role','tab');b.setAttribute('aria-selected',String(id===businessTab));b.setAttribute('aria-controls','business-content');b.tabIndex=id===businessTab?0:-1;b.onclick=()=>choose(id);b.addEventListener('keydown',e=>{let next;if(e.key==='ArrowRight')next=(index+1)%3;else if(e.key==='ArrowLeft')next=(index+2)%3;else if(e.key==='Home')next=0;else if(e.key==='End')next=2;if(next!==undefined){e.preventDefault();choose(businessPages[next][0]);}});tabs.append(b);});host.append(tabs);
 const box=prodNode('div','business-body'+(animate?' is-entering':''));box.id='business-content';box.setAttribute('role','tabpanel');box.setAttribute('aria-labelledby','business-tab-'+businessTab);host.append(box);
 const destination=LOCATIONS[businessTab],near=game._near(businessTab),title=businessPages.find(p=>p[0]===businessTab);
 const heading=prodNode('div','business-head');heading.append(prodNode('h3','',title[1]+' · '+title[2]),prodNode('span','prod-tag '+(near?'ready':'wait'),near?'已在附近':'需要前往'));box.append(heading);
 if(businessNotice){const notice=prodNode('p','business-feedback '+(businessNotice.ok?'is-success':'is-error'),businessNotice.message);notice.setAttribute('role','status');box.append(notice);}
 if(!near)box.append(prodNode('p','business-hint is-warn','前往'+destination.name+'后即可操作；可以先查看库存和费用。'));
 const grid=prodNode('div','prod-grid is-detail');box.append(grid);
 const card=(icon,title,description,meta)=>{const c=prodNode('section','prod-card prod-detail');const top=prodNode('div','prod-card-heading'),body=prodNode('div','prod-body');body.append(prodNode('h4','prod-name',title),prodNode('p','prod-sub',description));top.append(prodIcon(icon),body);if(meta)top.append(prodNode('span','prod-tag '+(meta.ready?'ready':'wait'),meta.text));c.append(top);grid.append(c);return c;};
 const cost=(c,items)=>{const row=prodNode('div','prod-cost');items.forEach(([label,owned,needed])=>row.append(prodNode('span','prod-cost-item '+(owned<needed?'is-short':'is-ok'),label+' '+owned.toLocaleString('zh-CN')+' / '+needed)));c.append(row);};
 const action=(c,key,label,fn,reason='',primary=false)=>{const actions=prodNode('div','prod-card-actions'),b=prodNode('button',primary?'prod-primary':'prod-secondary',label);b.dataset.prodKey=key;b.disabled=!!reason;if(reason)b.title=reason;b.onclick=()=>{businessNotice=frameResult(fn());if(businessNotice&&businessNotice.ok&&(key==='feed-animals'||key==='animal-collect'))ranchEvent={kind:key==='feed-animals'?'feed':'collect',at:null};renderBusiness(false,key);};actions.append(b);if(reason)actions.append(prodNode('small','prod-action-reason',reason));c.append(actions);return b;};
 const reasonFor=(built,price,wood=0,stone=0)=>built?'设施已建成':!near?'先前往'+destination.name:s.money<price?'金币还差 '+(price-s.money)+' G':s.wood<wood?'木材还差 '+(wood-s.wood):s.stone<stone?'石料还差 '+(stone-s.stone):'';
 if(businessTab==='ranch'){
  const lv=s.livestock,need=lv.chickens+lv.cows*2,fed=lv.fedAtDay===s.day;
  const scene=prodNode('div','prod-ranch-scene');scene.setAttribute('aria-hidden','true');scene.append(prodNode('span','prod-scene-label',fed?'今天的照料已完成':'围栏旁，慢慢过一天'),prodIcon('chicken'),prodIcon('cow'),prodIcon('feed'));box.append(scene);
  [['coop','鸡舍','鸡群遮风避雨的小家'],['barn','牛棚','留一片草地，等牛群回家']].forEach(([id,name,desc])=>{const d=BUILDINGS[id],built=lv[id],c=card('coop',name,desc,{ready:built,text:built?'已建成':'待建造'});cost(c,[['金币',s.money,d.money],['木材',s.wood,d.wood],...(d.stone?[['石料',s.stone,d.stone]]:[])]);action(c,'build-'+id,built?'已建成':'建造'+name,()=>game.buildFacility(id),reasonFor(built,d.money,d.wood,d.stone));});
  [['chicken','鸡','coop',lv.chickens,6,80],['cow','奶牛','barn',lv.cows,3,220]].forEach(([id,name,facility,count,limit,price])=>{const c=card(id,name,'每天喂饱后，次日可收'+(id==='chicken'?'鸡蛋':'牛奶'),{ready:count>0,text:count+' / '+limit+(id==='chicken'?' 只':' 头')});c.append(prodNode('p','prod-price',price+' G / '+(id==='chicken'?'只':'头')));const reason=!near?'先前往牧场':!lv[facility]?'先建造'+BUILDINGS[facility].name:count>=limit?'圈舍已住满':s.money<price?'金币不足':'';action(c,'buy-'+id,'添置'+(id==='chicken'?'一只鸡':'一头牛'),()=>game.buyAnimal(id,1),reason);});
  const feed=card('feed','饲料与喂养','每只鸡 1 份、每头牛 2 份',{ready:fed,text:fed?'今日已喂':'今日待喂'});const days=need?Math.floor(lv.feed/need):0;feed.append(prodNode('p','prod-stock','库存 '+lv.feed+' 份'+(need?' · 够用 '+days+' 天':' · 先添置动物')));const gauge=prodNode('div','prod-gauge'+(lv.feed<need?' is-low':''));gauge.setAttribute('role','meter');gauge.setAttribute('aria-label','今日饲料储备');gauge.setAttribute('aria-valuemin','0');gauge.setAttribute('aria-valuemax',String(Math.max(1,need)));gauge.setAttribute('aria-valuenow',String(Math.min(lv.feed,Math.max(1,need))));const fill=prodNode('div','prod-gauge-fill');fill.style.width=(need?Math.min(100,lv.feed/need*100):0)+'%';gauge.append(fill);feed.append(gauge);
  action(feed,'feed-buy','补充 10 份 · 50 G',()=>game.buyFeed(10),!near?'先前往牧场':s.money<50?'金币不足':'');
  action(feed,'feed-animals',fed?'今天已喂饱':'喂饱动物 · '+need+' 份',()=>game.feedAnimals(),!near?'先前往牧场':!need?'还没有动物':fed?'明天再来照料':lv.feed<need?'还差 '+(need-lv.feed)+' 份饲料':'',true);
  const harvest=card('egg','蛋奶收获','收取后放入背包，可出售或加工',{ready:lv.eggsReady+lv.milkReady>0,text:lv.eggsReady+lv.milkReady>0?'可以收取':'静待明天'});harvest.append(prodNode('p','prod-stock','鸡蛋 '+lv.eggsReady+' 个 · 牛奶 '+lv.milkReady+' 瓶'));action(harvest,'animal-collect','收取全部蛋奶',()=>game.collectAnimalProducts(),!near?'先前往牧场':lv.eggsReady+lv.milkReady<=0?'喂养后睡一觉再来':'',true);
 }else if(businessTab==='workshop'){
  const ind=s.industry,c=card('workshop','加工坊','小批制作，让收成多一份价值',{ready:ind.built,text:ind.built?'可以生产':'待建造'}),d=BUILDINGS.workshop;
  cost(c,[['金币',s.money,d.money],['木材',s.wood,d.wood],['石料',s.stone,d.stone]]);action(c,'build-workshop',ind.built?'已建成':'建造加工坊',()=>game.buildFacility('workshop'),reasonFor(ind.built,d.money,d.wood,d.stone));
  Object.entries(RECIPES).forEach(([id,def])=>{const c=card(id,def.name,'制作 1 天 · 成品价值 '+ITEMS[id].sellPrice+' G');cost(c,Object.entries(def.ingredients).map(([id,qty])=>[itemLabel(id),s.bag[id]||0,qty]));const missing=Object.entries(def.ingredients).find(([id,n])=>(s.bag[id]||0)<n);const reason=!near?'先前往加工坊':!ind.built?'先建造加工坊':ind.jobs.length>=3?'队列已满（3 / 3）':missing?itemLabel(missing[0])+'不足':'';action(c,'craft-'+id,'开始制作 · 1 份',()=>game.craft(id,1),reason,true);});
  const queue=prodNode('section','business-section prod-queue');queue.append(prodNode('h3','','制作队列 · '+ind.jobs.length+' / 3'));if(!ind.jobs.length)queue.append(prodNode('p','prod-queue-empty','机器歇着，等一份新订单。'));ind.jobs.forEach(job=>{const ready=job.readyDay<=s.day,row=prodNode('div','prod-job '+(ready?'is-ready':'is-wait'));row.append(prodIcon(job.recipe),prodNode('span','prod-body',itemLabel(job.recipe)+' × '+job.qty),prodNode('span','prod-tag '+(ready?'ready':'wait'),ready?'制作完成':'第 '+job.readyDay+' 天完成'));queue.append(row);});const ready=ind.jobs.some(j=>j.readyDay<=s.day);action(queue,'craft-collect','取回全部成品',()=>game.collectCrafted(),!near?'先前往加工坊':!ready?'暂无完成的批次':'',true);box.append(queue);
 }else{
  Object.entries(HELPERS).forEach(([id,d])=>{const hired=s.helpers[id],c=card(id,d.name,id==='waterer'?'夜里照看需要浇水的作物':'夜里收下已经成熟的作物',{ready:hired,text:hired?'已签约':'可雇佣'});c.append(prodNode('p','prod-stock','至多 '+d.capacity+' 块 / 晚'));const fees=prodNode('div','prod-cost');fees.append(prodNode('span','prod-tag wage','有活才付 '+d.wage+' G / 晚'),prodNode('span','prod-cost-item','雇佣费 '+d.hirePrice+' G'));c.append(fees);action(c,'helper-'+id,hired?'结束合作':'雇佣'+d.name,()=>hired?game.fireHelper(id):game.hireHelper(id),!near?'先前往帮手驿站':!hired&&s.money<d.hirePrice?'金币不足':'',!hired);});
  box.append(prodNode('p','business-hint','睡觉时结算农活和工资；无工作或金币不足时不会扣钱，次日总结会说明。结束合作不退还雇佣费。'));
 }
 const foot=prodNode('div','business-actions');const jump=prodNode('button','prod-route',near?'返回农场':'前往'+destination.name);jump.dataset.prodKey='route';jump.onclick=()=>near?closePanel():businessNav(businessTab,destination.name);foot.append(jump,prodNode('small','','菜单打开时，田园时间暂停。'));box.append(foot);
 if(!animate)scroller.scrollTop=savedScroll;
 if(focusKey){const buttons=host.querySelectorAll('button');const target=Array.from(buttons).find(b=>b.dataset.prodKey===focusKey&&!b.disabled)||Array.from(buttons).find(b=>b.dataset.prodKey==='tab-'+businessTab);if(target)target.focus({preventScroll:true});}
}
function ranchDialog(){
 const lv=game.state.livestock,box=document.createElement('div');
 const p=document.createElement('p');p.textContent='牧场里有围栏、干草和动物。靠近时才能买动物、喂食与收蛋奶。';box.append(p);
 const info=document.createElement('p');info.className='muted';info.textContent='鸡 '+lv.chickens+'/6 · 牛 '+lv.cows+'/3 · 饲料 '+lv.feed+' · 待收鸡蛋 '+lv.eggsReady+' · 牛奶 '+lv.milkReady;box.append(info);
 showDialog('牧场',box,[{label:'打开经营面板',primary:true,action:()=>{closeDialog();openPanel('business');businessTab='ranch';renderBusiness();}},{label:'先忙别的',action:closeDialog}],'牧场 / 养殖与产出');
}
function workshopDialog(){
 const ind=game.state.industry,box=document.createElement('div');
 const p=document.createElement('p');p.textContent=ind.built?'机器转着，原料在这里变成卖得更贵的成品。':'这里还是一片空地，可以建一座加工坊。';box.append(p);
 const info=document.createElement('p');info.className='muted';info.textContent='队列 '+ind.jobs.length+'/3、已到期 '+ind.jobs.filter(j=>j.readyDay<=game.state.day).length+' 批';box.append(info);
 showDialog('加工坊',box,[{label:'打开加工面板',primary:true,action:()=>{closeDialog();openPanel('business');businessTab='workshop';renderBusiness();}},{label:'先忙别的',action:closeDialog}],'加工坊 / 原料变成品');
}
function guildDialog(){
 const h=game.state.helpers,box=document.createElement('div');
 const p=document.createElement('p');p.textContent='帮手们在这里等活。雇好之后，他们会在你睡觉时帮忙浇水和采收。';box.append(p);
 const info=document.createElement('p');info.className='muted';info.textContent='浇水帮手：'+(h.waterer?'已雇佣':'未雇佣')+' · 采收帮手：'+(h.harvester?'已雇佣':'未雇佣');box.append(info);
 showDialog('帮手驿站',box,[{label:'打开帮手面板',primary:true,action:()=>{closeDialog();openPanel('business');businessTab='guild';renderBusiness();}},{label:'先忙别的',action:closeDialog}],'帮手驿站 / 雇工与工资');
}
function shopDialog(){
 const box=document.createElement('div');const intro=document.createElement('p');intro.textContent='欢迎光临！萝卜适合起步，草莓需要更多耐心。你有 '+game.state.money+' G。';box.append(intro);
 for(const [id,c] of Object.entries(CROPS)){const row=document.createElement('div');row.className='shop-row';const label=document.createElement('div');label.textContent=c.name+'种子';const small=document.createElement('small');small.textContent=c.days+' 个生长日 · 收成价值 '+c.sellPrice+' G';label.append(small);const actions=document.createElement('div');actions.className='shop-buy-actions';for(const qty of [1,5]){const buy=document.createElement('button');buy.textContent='买 '+qty+' 份 · '+(c.seedPrice*qty)+' G';buy.disabled=game.state.money<c.seedPrice*qty;buy.onclick=()=>{const r=game.buy(id,qty);frameResult(r);if(r.ok)shopDialog();};actions.append(buy);}row.append(label,actions);box.append(row);}
 const row=document.createElement('div');row.className='shop-row';const label=document.createElement('div');label.innerHTML='升级水壶<small>十字范围浇水 · 160 G + 6 木材</small>';const buy=document.createElement('button');buy.textContent=game.state.wateringLevel?'已升级':'升级';buy.disabled=!!game.state.wateringLevel||game.state.money<160||game.state.wood<6;buy.onclick=()=>{const r=game.upgradeWatering();frameResult(r);if(r.ok)shopDialog();};row.append(label,buy);box.append(row);
 showDialog('阿禾的杂货铺',box,[{label:'下次再来',action:closeDialog}],'杂货铺 / 为明天做准备');
}
function questDialog(npcId='npc'){const npc=NPCS[npcId];if(!npc){notify('这位村民暂时不在。');return;}const box=document.createElement('div'),p=document.createElement('p');p.textContent=npc.greeting;box.append(p);for(const q of QUESTS.filter(q=>(q.npc||'npc')===npcId)){const status=game.questStatus(q.id),row=document.createElement('div');row.className='shop-row';const text=document.createElement('div');text.textContent=q.name;const small=document.createElement('small');small.textContent=q.description+' · '+Math.min(q.target,status.progress)+' / '+q.target+' · 奖励 '+q.reward+' G';if(status.locked)small.textContent='前置未完成 · '+small.textContent;text.append(small);const b=document.createElement('button');b.textContent=status.claimed?'已领取':q.delivery?'交付领取':'领取奖励';b.disabled=!status.ready;b.onclick=()=>{frameResult(game.claimQuest(q.id));questDialog(npcId);};row.append(text,b);box.append(row);}showDialog(npc.name+'的委托',box,[{label:'下次见',action:closeDialog}],npc.role+' / 交付材料将从背包扣除');}
function useAt(x,y){if(!started||paused||dialog.open||menuOpen){notify('先继续游戏，再使用工具。');return;}stopMotion();frameResult(game.use(tool,cropId,x,y));}
function move(direction){const d=dirs[direction];if(!started||!d||paused||dialog.open||menuOpen)return;const r=game.move(d[0],d[1]);update();return r;}
function planRoute(x,y,location=null){
 if(!started||paused||dialog.open||menuOpen)return;stopMotion();const p=game.state.player,key=(x,y)=>x+','+y;
 if(location&&Math.max(Math.abs(x-p.x),Math.abs(y-p.y))<=1){interact();return;}
 const goals=[];if(!location&&game.isWalkable(x,y))goals.push(key(x,y));else if(location){for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(game.isWalkable(x+dx,y+dy))goals.push(key(x+dx,y+dy));}else{for(let ring=1;ring<=Math.max(MAP.cols,MAP.rows)&&!goals.length;ring++)for(let dy=-ring;dy<=ring;dy++)for(let dx=-ring;dx<=ring;dx++)if(Math.max(Math.abs(dx),Math.abs(dy))===ring&&game.isWalkable(x+dx,y+dy))goals.push(key(x+dx,y+dy));}
 const queue=[{x:p.x,y:p.y}],seen=new Map([[key(p.x,p.y),null]]);let end=null;
 for(let i=0;i<queue.length;i++){const at=queue[i],k=key(at.x,at.y);if(goals.includes(k)){end=k;break;}for(const [dx,dy] of Object.values(dirs)){const nx=at.x+dx,ny=at.y+dy,nk=key(nx,ny);if(seen.has(nk)||!game.isWalkable(nx,ny))continue;seen.set(nk,k);queue.push({x:nx,y:ny});}}
 if(!end){notify('这里暂时走不到，试试换个落脚点。');return;}
 const steps=[];for(let k=end;seen.get(k)!==null;k=seen.get(k)){const [sx,sy]=k.split(',').map(Number);steps.unshift({x:sx,y:sy});}path=steps;arrival=location?()=>interact():null;update();if(!path.length&&arrival){const done=arrival;arrival=null;done();}
}
function coordinates(event){const r=canvas.getBoundingClientRect(),c=camera();return{x:Math.max(0,Math.min(MAP.cols-1,Math.floor(c.x+(event.clientX-r.left)/r.width*canvas.width/MAP.tile))),y:Math.max(0,Math.min(MAP.rows-1,Math.floor(c.y+(event.clientY-r.top)/r.height*canvas.height/MAP.tile)))};}
canvas.addEventListener('pointermove',e=>{target=coordinates(e);renderDirty=true;updateTargetInfo();});canvas.addEventListener('pointerleave',()=>{target=null;renderDirty=true;});canvas.addEventListener('pointerdown',e=>{if(e.button!==0||dialog.open)return;e.preventDefault();canvas.focus({preventScroll:true});const at=coordinates(e);target=at;if(!started)return;if(paused){notify('点击「继续」再进入农场。');return;}const loc=Object.entries(LOCATIONS).find(([,l])=>l.x===at.x&&l.y===at.y);const building=at.x>=3&&at.x<=8&&at.y>=3&&at.y<=6?'home':at.x>=20&&at.x<=26&&at.y>=3&&at.y<=6?'shop':null;if(loc||building){const id=building||loc[0],destination=LOCATIONS[id];planRoute(destination.x,destination.y,id);return;}const p=game.state.player;if(Math.max(Math.abs(at.x-p.x),Math.abs(at.y-p.y))<=1)useAt(at.x,at.y);else planRoute(at.x,at.y);});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>selectTool(b.dataset.tool));document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{const l=LOCATIONS[b.dataset.go];if(dialog.open)return;closePanel();if(paused){notify('先点击「继续」，再选择目的地。');return;}planRoute(l.x,l.y,b.dataset.go);});
for(const b of document.querySelectorAll('[data-move]')){b.addEventListener('pointerdown',e=>{e.preventDefault();const d=b.dataset.move;held=Object.keys(dirs).find(k=>dirs[k].join(',')===d);path=[];arrival=null;move(held);lastMove=performance.now();b.setPointerCapture(e.pointerId);});for(const evt of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(evt,()=>{held=null;});}
addEventListener('keydown',e=>{if(e.target.matches('input,textarea,select,[contenteditable=true]')||!started||dialog.open||e.ctrlKey||e.metaKey||e.altKey)return;if(e.key==='Escape'&&menuOpen){e.preventDefault();closePanel();return;}const pane=({Tab:'inventory',j:'quests',J:'quests',m:'village',M:'village',n:'business',N:'business'})[e.key];if(pane){e.preventDefault();if(!e.repeat)openPanel(pane);return;}if(menuOpen)return;const direction=keyDirs[e.key];if(direction){e.preventDefault();path=[];arrival=null;if(!e.repeat){held=direction;move(direction);lastMove=performance.now();}return;}if(e.repeat||e.ctrlKey||e.metaKey||e.altKey)return;if(e.code==='Space'&&!e.target.matches('button')){e.preventDefault();useAt();}else if(e.key.toLowerCase()==='e')interact();else if(e.key.toLowerCase()==='p')setPaused(!paused);else if(/^[1-6]$/.test(e.key))selectTool(tools[Number(e.key)-1]);});
addEventListener('keyup',e=>{if(keyDirs[e.key]===held)held=null;});addEventListener('blur',stopMotion);document.addEventListener('visibilitychange',()=>{stopMotion();clockElapsed=0;lastFrame=0;if(document.hidden)save(true);});
const TEST_BUILD=!!(window.__SAND_TEST__);
function grantKit(){
 const s=game.state;
 s.money=Math.max(s.money,999999);
 ['radish','carrot','berry'].forEach(id=>{s.seeds[id]=Math.max(s.seeds[id]||0,99);});
 ['radish','carrot','berry','egg','milk'].forEach(id=>{s.bag[id]=Math.max(s.bag[id]||0,99);});
 s.wood=Math.max(s.wood,999);s.stone=Math.max(s.stone,999);
 s.livestock.feed=Math.max(s.livestock.feed,300);
 s.livestock.coop=true;s.livestock.barn=true;s.industry.built=true;
 s.livestock.chickens=Math.max(s.livestock.chickens,4);s.livestock.cows=Math.max(s.livestock.cows,2);
 s.helpers.waterer=true;s.helpers.harvester=true;
 update();if(!$('businessPanel').hidden)renderBusiness();
 notify('测试补给已到账：金币 999999、种子 99、材料 999、饲料 300、设施已建、鸡 4 牛 2、帮手已雇。');
}
$('pauseBtn').onclick=()=>setPaused(!paused);$('useBtn').onclick=()=>useAt();$('interactBtn').onclick=interact;if(TEST_BUILD){const gb=$('grantBtn');if(gb){gb.hidden=false;gb.onclick=grantKit;}}
$('saveBtn').onclick=()=>save();$('loadBtn').onclick=loadDialog;
$('helpBtn').onclick=()=>showDialog('你的第一天','<p>这是一款原创的轻量农场游戏，从一小袋种子开始，慢慢经营自己的田园。</p><ol><li>向下进入浅绿色田地，用锄头开垦。</li><li>选种子、播种，再给每块作物浇水。</li><li>回小屋睡到明天。浇过水才生长，下雨自动浇田。</li><li>成熟后采收，带到出货箱出售，再去杂货铺买种子。</li><li>拜访五位村民，完成他们各自的委托。交付材料会从背包扣除。</li></ol><div class="help-grid"><strong>移动</strong><span>WASD / 方向键 / 点击远处</span><strong>工具</strong><span>1–6 选择，空格使用；点击身边格子也可使用</span><strong>交互</strong><span>E / 「交互」按钮，或点击村庄向导自动走过去</span><strong>暂停</strong><span>P；菜单打开时也会暂停时间</span></div><p class="muted">没浇水只会暂停生长，不会枯萎。晚间会提醒回家，不会扣掉你的收获。游戏进度只保存在你的设备，请定期导出农场存档。</p>',[{label:'去种第一块田',primary:true,action:closeDialog}]);
$('exportBtn').onclick=()=>{try{const blob=new Blob([JSON.stringify({format:'sand-garden-farm',version:2,savedAt:new Date().toISOString(),state:game.snapshot()},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='栖砂田园记-第'+game.state.day+'天.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);notify('已导出农场存档，可在另一台设备导入。');}catch{notify('导出失败，请尝试浏览器内保存。');}};
$('importBtn').onclick=()=>{$('importFile').value='';$('importFile').click();};$('importFile').onchange=async e=>{const file=e.target.files&&e.target.files[0];if(!file)return;try{if(file.size>1048576)throw Error('存档文件过大，请选择不超过 1 MiB 的农场 JSON 文件。');const text=await file.text();confirmRestore(decodeSave(text));}catch(err){notify(err.message||'存档读取失败，当前农场未改变。');}finally{e.target.value='';}};
function animate(now){
 const delta=lastFrame?Math.max(0,Math.min(250,now-lastFrame)):0;lastFrame=now;
 const active=started&&!document.hidden&&!dialog.open&&!paused&&!menuOpen;
 if(active){
  let advances=0;
  while((held||path.length)&&now-lastMove>=140&&advances++<3){
   lastMove+=140;
   if(held)move(held);
   else if(path.length){const next=path.shift(),p=game.state.player,r=game.move(next.x-p.x,next.y-p.y);if(!r.ok)stopMotion();update();if(!path.length&&arrival){const done=arrival;arrival=null;done();}}
   if(dialog.open||menuOpen)break;
  }
  if(!held&&!path.length)lastMove=now;
  clockElapsed+=delta;saveElapsed+=delta;
  while(clockElapsed>=1000){clockElapsed-=1000;game.advanceTime(2);update();if(game.state.minutes>=1320&&nightNotice!==game.state.day){nightNotice=game.state.day;notify('夜深了，回小屋休息吧。');}}
  if(saveElapsed>=30000){saveElapsed=0;save(true);}
 }else lastMove=now;
 if(active&&ranchEvent&&ranchEvent.at===null)ranchEvent.at=now;
 paintElapsed=Math.min(100,paintElapsed+delta);
 if(started&&!document.hidden&&(active||renderDirty)&&paintElapsed>=1000/60){
  paintElapsed%=1000/60;const began=performance.now();
  try{window.FarmRenderer.draw(ctx,game,{time:now,tool,cropId,target,camera:camera(now),player:visualPlayer(now),reducedMotion:!!(motionPreference&&motionPreference.matches),ranchEvent:ranchEvent&&ranchEvent.at!==null?ranchEvent:null});renderDirty=false;}catch(e){if(!renderErrors++)console.error('Farm rendering error:',e);}
  drawMs=drawMs?drawMs*.9+(performance.now()-began)*.1:performance.now()-began;frameCount++;fpsSamples++;
 }
 if(now-lastPerfLabel>=500){const span=now-lastPerfLabel;fps=started?fpsSamples*1000/span:0;fpsSamples=0;lastPerfLabel=now;const label=$('fpsLabel');if(label)label.textContent=fps?Math.round(fps)+' FPS':'— FPS';}
 requestAnimationFrame(animate);
}
update();selectTool('hoe');requestAnimationFrame(animate);
window.SAND_FARM={version:'2.3.1',state:()=>game.snapshot(),health:()=>({canvas:!!ctx,renderErrors,started,menu:menuOpen,camera:camera(),visualPlayer:visualPlayer(),performance:{fps:Math.round(fps),drawMs:Number(drawMs.toFixed(2)),frames:frameCount},day:game.state.day,plots:Object.keys(game.state.plots).length,paused}),game,selectTool,selectSeed,openPanel,closePanel,pause:setPaused,refresh:update,restore:restoreState,routeTo:id=>{const l=LOCATIONS[id];if(l)planRoute(l.x,l.y,id);}};
function beginFarm(){ranchEvent=null;if(TEST_BUILD)grantKit();motion.snap(game.state.player,performance.now());renderDirty=true;document.body.classList.add('playing');closePanel();started=true;$('welcomeScreen').hidden=true;$('farmLayout').hidden=false;lastFrame=0;clockElapsed=0;stopMotion();update();canvas.focus({preventScroll:true});}
function cover(){if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(()=>{});closePanel();document.body.classList.remove('playing');stopMotion();if(started)save(true);started=false;$('farmLayout').hidden=true;$('welcomeScreen').hidden=false;updateWelcome();}
function updateWelcome(){let hasSave=false;try{hasSave=!!(localStorage.getItem(AUTO)||localStorage.getItem(STORAGE));}catch{}$('continueFarmBtn').hidden=!hasSave;$('startFarmBtn').textContent=hasSave?'新的农场':'开始种田';$('welcomeSaveInfo').textContent=hasSave?'发现设备上的农场存档，可以继续之前的生活。':'带上六袋萝卜种子和两袋胡萝卜种子，从第一天出发。';}
$('startFarmBtn').onclick=()=>{let saved=false;try{saved=!!(localStorage.getItem(AUTO)||localStorage.getItem(STORAGE));}catch{}const launch=()=>{game.restore(new FarmGame().snapshot());beginFarm();setPaused(false);selectTool('hoe');notify('欢迎来到栖砂！向下走到田地，用锄头开垦第一块地。');};if(saved){showDialog('开启新的农场？','<p>新农场会从第一天开始，现有手动存档仍然保留；开始游玩后的自动存档会更新。你可以先导出现有进度。</p>',[{label:'取消',action:closeDialog},{label:'开始新的农场',primary:true,action:()=>{closeDialog();launch();}}]);}else launch();};
$('continueFarmBtn').onclick=()=>{let loaded=false;for(const key of [AUTO,STORAGE]){try{const raw=localStorage.getItem(key);if(!raw)continue;const data=decodeSave(raw),check=new FarmGame();check.restore(data);game.restore(check.snapshot());beginFarm();setPaused(false);notify('欢迎回来！今天也按自己的节奏慢慢来。');loaded=true;break;}catch{}}if(!loaded)notify('未找到可读取的农场存档，请尝试导入备份文件。');};
$('albumBtn').onclick=cover;updateWelcome();
})();