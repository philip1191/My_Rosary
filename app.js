import {collectExtras,validateExtras,restoreExtras} from './backup-extras.js';
import {PrayerStore,blankState,blankOpening,parseBackup,explainError} from './storage.js';
import {MYSTERIES,START_PRAYERS,DECADE_PRAYERS} from './mysteries.js';
import {notifyBeadChange} from './rosary-alerts.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localDate=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const store=new PrayerStore();let state=blankState(),tab='calendar',selected=localDate(),month=new Date(new Date().getFullYear(),new Date().getMonth(),1),decade=0,isOpening=true,artURL=null,renderToken=0,manage=false;
const activeKey=()=>isOpening?'opening':decade;
const pageData=(s,key=activeKey())=>key==='opening'?(s.opening||blankOpening()):s.decades[key];
const editablePage=(s,key)=>key==='opening'?(s.opening||(s.opening=blankOpening())):s.decades[key];
// Wake lock is transient and never stored in the prayer database.
let wakeLock=null,wakeRequest=0,lightboxDecade=0,lightboxIsOpening=false,lightboxURL=null,lightboxSequence=0,lightboxTouch=null;
// Both rosaries use the same transient bead index per page (no IndexedDB writes).
// The current page keeps its place when the artwork viewer opens or closes.
// Navigating to another page starts that page with its normal initial bead.
let rosaryProgress={};
const rosaryProgressKey=(opening,id)=>opening?'opening':`decade:${id}`;
const getRosaryProgress=(opening,id)=>{
 const n=rosaryProgress[rosaryProgressKey(opening,id)];
 return Number.isInteger(n)?n:0;
};
const setRosaryProgress=(opening,id,index)=>{rosaryProgress[rosaryProgressKey(opening,id)]=index;};
let syncMainRosaryDisplay=()=>{};
const AUTO_RECORD_KEY='my-rosary-auto-record-v1';
function autoRecordEnabled(){return localStorage.getItem(AUTO_RECORD_KEY)!=='off';}
async function completeMystery(id){
 const group=Math.floor(id/5);
 if(autoRecordEnabled()){
  const today=localDate();
  await track(store.mutate(s=>{
   const old=s.records[today]||{count:0,intention:'',memo:''};
   const counts=recordMysteries(old).slice();
   if(counts[group]>999994||old.count>999994)throw new Error('오늘 기도 기록이 최대 단수를 초과합니다.');
   counts[group]+=5;
   s.records[today]={...old,count:counts.reduce((a,b)=>a+b,0),mysteries:counts};
  }));
 }
 const dialog=$('#rosaryCompleteDialog');
 $('#rosaryCompleteTitle').textContent=`${MYSTERIES[group].name} 5단을 완료하셨습니다.`;
 dialog.dataset.completedDecade=String(id);
 dialog.showModal();
}
async function completeChoice(choice){
 const dialog=$('#rosaryCompleteDialog'),id=Number(dialog.dataset.completedDecade);
 dialog.close();
 const artworkOpen=$('#lightbox').open;
 // In artwork mode, Next Mystery must stay in the full-screen artwork viewer.
 // The other choices intentionally leave the viewer as before.
 if(choice==='next'&&artworkOpen){
  pendingRosaryLanding=null;
  rosaryProgress={};
  await showLightboxArt((id+1)%20);
  return;
 }
 if(artworkOpen){lightboxDecade=id;$('#lightbox').close();}
 pendingRosaryLanding=null;
 if(choice==='calendar'){await changeTab('calendar');return;}
 tab='mysteries';
 if(choice==='select'){await moveDecade(Math.floor(id/5)*5);window.scrollTo(0,0);return;}
 pendingRosaryLanding='start';
 // Keep the reader at the same scroll position after the completion dialog.
 // Previously an unconditional scrollTo(0,0) jumped to the top of the page.
 const readingScrollY=window.scrollY;
 await moveDecade((id+1)%20);
 window.scrollTo(0,readingScrollY);
}
$('#rosaryCompleteDialog').addEventListener('cancel',e=>e.preventDefault());
$$('[data-complete-choice]').forEach(b=>b.onclick=action(()=>completeChoice(b.dataset.completeChoice)));

function wantsWakeLock(){return document.visibilityState==='visible'&&(tab==='mysteries'||tab==='prayers'||$('#lightbox')?.open);}
async function syncWakeLock(){
 const request=++wakeRequest;
 if(!wantsWakeLock()){
  const old=wakeLock;wakeLock=null;
  if(old)try{await old.release();}catch(_){}
  return;
 }
 if(wakeLock||!navigator.wakeLock?.request)return;
 try{
  const lock=await navigator.wakeLock.request('screen');
  if(request!==wakeRequest||!wantsWakeLock())await lock.release();
  else{wakeLock=lock;lock.addEventListener('release',()=>{if(wakeLock===lock)wakeLock=null;});}
 }catch(_){/* Device, browser or power-saving mode may deny a wake lock. */}
}
document.addEventListener('visibilitychange',()=>{syncWakeLock();});
let pending=Promise.resolve(),unsaved=false,saveCount=0,saveSequence=0,editorAction=null,waitingWorker=null,installEvent=null;
function updateLifetimePrayerTotal(){
 const total=Object.values(state.records).reduce((sum,r)=>sum+(Number.isSafeInteger(r?.count)?r.count:0),0);
 const label=$('#lifetimePrayerTotal');if(label)label.textContent=`누적 기도: ${total.toLocaleString('ko-KR')}단`;
}
const notify=s=>{$('#status').textContent=s;};
function error(e){$('#error').textContent=explainError(e);$('#error').hidden=false;notify('저장되지 않은 내용이 있는지 확인해 주세요');}
function clearError(){$('#error').hidden=true;}
function action(fn){return async e=>{try{await fn(e);}catch(err){error(err);}};}
function track(task){const sequence=++saveSequence;saveCount++;notify('저장 중…');const p=task.then(s=>{if(s){state=s;updateLifetimePrayerTotal();}if(sequence===saveSequence){unsaved=false;notify('저장 · 다시 읽기 확인 완료');}return s;}).catch(e=>{if(sequence===saveSequence)unsaved=true;error(e);throw e;}).finally(()=>{saveCount--;});pending=p;return p;}
async function flush(){await pending;if(unsaved)throw new Error('저장하지 못한 내용이 있습니다. 현재 화면에서 다시 저장해 주세요.');}
async function changeTab(next){await flush();tab=next;manage=false;render();syncWakeLock();}
$$('[data-tab]').forEach(b=>b.onclick=action(()=>changeTab(b.dataset.tab)));
$('#openSettings').onclick=action(()=>changeTab('appearance'));
$('#settingsHelp').onclick=()=>$('#helpDialog').showModal();
$('#settingsInfo').onclick=()=>$('#appInfoDialog').showModal();
$('#closeAppInfo').onclick=()=>$('#appInfoDialog').close();
$('#appInfoDialog').onclick=e=>{if(e.target===$('#appInfoDialog'))$('#appInfoDialog').close();};

$('#closeHelp').addEventListener('click',()=>$('#helpDialog').close());
$('#helpDialog').addEventListener('click',e=>{if(e.target===$('#helpDialog'))$('#helpDialog').close();});
window.addEventListener('beforeunload',e=>{if(saveCount||unsaved){e.preventDefault();e.returnValue='';}});
function render(){
 updateLifetimePrayerTotal();
 renderToken++;if(artURL){URL.revokeObjectURL(artURL);artURL=null;}$('#main').setAttribute('aria-busy','false');
 $$('[data-tab]').forEach(b=>{if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 $('#openSettings').setAttribute('aria-pressed',String(tab==='appearance')); 
 $('#main').hidden=tab==='appearance';$('#appearancePage').hidden=tab!=='appearance';
 if(tab==='appearance'){window.dispatchEvent(new Event('rosary-appearance-open'));return;}
 if(tab==='calendar')renderCalendar();if(tab==='mysteries')renderMystery();if(tab==='prayers')renderPrayers();
}
function renderCalendar(){
 const year=month.getFullYear(),m=month.getMonth(),first=new Date(year,m,1).getDay(),days=new Date(year,m+1,0).getDate(),prefix=`${year}-${String(m+1).padStart(2,'0')}`;
 const records=Object.entries(state.records).filter(([d])=>d.startsWith(prefix)),total=records.reduce((n,[,r])=>n+r.count,0),prayed=records.filter(([,r])=>r.count>0).length;
 $('#main').innerHTML=`<div class="section-heading"><div><h2>${year}년 ${m+1}월</h2></div><div class="month-nav"><button id="prevMonth" aria-label="이전 달">‹</button><button id="today" style="font-size:12px">오늘</button><button id="nextMonth" aria-label="다음 달">›</button></div></div><div class="calendar-layout"><section class="panel calendar-panel" aria-label="월별 달력"><div class="weekdays">${['일','월','화','수','목','금','토'].map((v,i)=>`<span class="${i===0?'weekday-sun':''}">${v}</span>`).join('')}</div><div class="calendar-grid">${'<span></span>'.repeat(first)}${Array.from({length:days},(_,i)=>{const date=`${prefix}-${String(i+1).padStart(2,'0')}`,r=state.records[date];return `<button class="date ${date===selected?'selected':''} ${date===localDate()?'today':''}" data-date="${date}" aria-label="${m+1}월 ${i+1}일${r?`, ${r.count}단 기록`:''}" aria-pressed="${date===selected}"><span>${i+1}</span><span class="mark">${r?r.count?`${r.count}단`:'•':''}</span></button>`;}).join('')}</div><div class="calendar-foot"><div><strong>${prayed}</strong>기도한 날</div><div><strong>${total}</strong>이번 달 기도 단수</div></div></section><section class="panel" id="recordPanel"></section></div>`;
 $('#prevMonth').onclick=action(async()=>{await flush();month=new Date(year,m-1,1);renderCalendar();});$('#nextMonth').onclick=action(async()=>{await flush();month=new Date(year,m+1,1);renderCalendar();});$('#today').onclick=action(async()=>{await flush();selected=localDate();month=new Date(new Date().getFullYear(),new Date().getMonth(),1);renderCalendar();});
 $$('[data-date]').forEach(b=>b.onclick=action(async()=>{await flush();selected=b.dataset.date;renderCalendar();}));renderRecord();
}
function recordMysteries(r){if(Array.isArray(r.mysteries))return r.mysteries;const n=[0,0,0,0];if(Number.isInteger(r.mystery))n[r.mystery]=r.count;return n;}
function renderRecord(){
 const r=state.records[selected]||{count:0,intention:'',memo:''},counts=recordMysteries(r),d=new Date(selected+'T12:00:00');
 $('#recordPanel').innerHTML=`<div class="record-head"><h3>${d.getMonth()+1}월 ${d.getDate()}일 <small style="font:12px system-ui;color:var(--muted)">${['일','월','화','수','목','금','토'][d.getDay()]}요일</small></h3><span class="tag">기도 기록</span></div><form id="recordForm"><p class="muted">묵주기도 단수</p>${MYSTERIES.map((m,i)=>`<label class="field">${m.name}<input class="mystery-count" data-mystery-count="${i}" type="number" min="0" max="999999" step="1" inputmode="numeric" value="${counts[i]}" required></label>`).join('')}<p class="muted">합계 <strong id="recordTotal">${r.count}</strong>단</p><label class="field">기도 지향<textarea id="recordIntention" placeholder="마음에 품은 지향을 적어 주세요">${esc(r.intention)}</textarea></label><label class="field">묵상 · 개인 메모<textarea class="memo" id="recordMemo" placeholder="오늘의 기도를 남겨 보세요">${esc(r.memo)}</textarea></label><div class="record-actions"><button type="button" class="danger quiet" id="deleteRecord">기록 삭제</button><button type="submit">다시 저장</button></div></form>`;
 $('#recordForm').oninput=()=>{const values=$$('[data-mystery-count]').map(x=>x.valueAsNumber);$('#recordTotal').textContent=values.every(Number.isSafeInteger)?values.reduce((x,y)=>x+y,0):'—';saveRecord().catch(()=>{});};$('#recordForm').onsubmit=action(async e=>{e.preventDefault();await saveRecord();clearError();renderCalendar();});
 $('#deleteRecord').onclick=action(async()=>{if(!confirm('선택한 날짜의 기록을 삭제할까요?'))return;await track(store.mutate(s=>{delete s.records[selected];}));clearError();renderCalendar();});
}
async function saveRecord(){
 const mysteries=$$('[data-mystery-count]').map(x=>x.valueAsNumber),count=mysteries.reduce((x,y)=>x+y,0);
 if(mysteries.some(n=>!Number.isSafeInteger(n)||n<0||n>999999)||count>999999){saveSequence++;unsaved=true;notify('횟수는 0 이상의 정수이며 합계는 999999 이하여야 합니다');return;}
 const date=selected,r={count,mysteries,intention:$('#recordIntention').value,memo:$('#recordMemo').value};
 await track(store.mutate(s=>{if(!r.count&&!r.intention&&!r.memo)delete s.records[date];else s.records[date]=r;}));
 const b=$(`[data-date="${date}"]`);if(b){b.querySelector('.mark').textContent=state.records[date]?(count?`${count}단`:'•'):'';b.setAttribute('aria-label',`${Number(date.slice(5,7))}월 ${Number(date.slice(8))}일, ${count}단 기록`);}
 const records=Object.entries(state.records).filter(([d])=>d.startsWith(`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}`));const metrics=$$('.calendar-foot strong');if(metrics.length){metrics[0].textContent=records.filter(([,r])=>r.count>0).length;metrics[1].textContent=records.reduce((n,[,r])=>n+r.count,0);}
}
function rosaryHTML(start,finalDecade=false){return `<button class="rosary" data-final-decade="${finalDecade}" data-rosary="${start?'start':'decade'}" aria-label="${start?'시작 묵주':'일반 묵주'}"><span class="beads"></span><span class="prayer-name"></span></button>`;}
let pendingRosaryLanding=null;
function bindRosaries(){
 syncMainRosaryDisplay=()=>{};
 $$('.rosary').forEach(b=>{const start=b.dataset.rosary==='start',finalDecade=b.dataset.finalDecade==='true',names=start?START_PRAYERS:(finalDecade?[...DECADE_PRAYERS,'(성모찬송)성호경']:DECADE_PRAYERS),gloryIndex=start?START_PRAYERS.length-1:DECADE_PRAYERS.length-1;let index=pendingRosaryLanding===(start?'start':'decade')?0:(pendingRosaryLanding==='last'&&!start||pendingRosaryLanding==='last-start'&&start)?names.length-1:getRosaryProgress(start,decade),down=null,suppress=false;
  index=Math.max(0,Math.min(names.length-1,index));
  setRosaryProgress(start,decade,index);
  const paint=()=>{b.querySelector('.beads').innerHTML=names.map((name,i)=>`<i class="bead ${name!=='성모송'?'big':''} ${(start&&i===0)||(finalDecade&&i===names.length-1)?'cross-bead':''} ${i===index?'current':i<index?'done':''}">${(start&&i===0)||(finalDecade&&i===names.length-1)?'✝︎':''}</i>`).join('');b.querySelector('.prayer-name').textContent=start&&index===0?'성호경 · 사도신경':names[index];b.setAttribute('aria-label',`${start?'시작 묵주':'일반 묵주'} ${index+1}/${names.length} ${names[index]}. 좌우로 밀어 기도 이동`);};
  const step=n=>{
   if(index===0&&n<0){notifyBeadChange(false,false,-1);if(start){pendingRosaryLanding='last';moveDecade(decade-1).catch(error);}else if(decade%5===0){pendingRosaryLanding='last-start';moveOpening().catch(error);}else{pendingRosaryLanding='last';moveDecade(decade-1).catch(error);}return;}
   if(index===names.length-1&&n>0){notifyBeadChange(false,false,1);if(start){pendingRosaryLanding='decade';moveDecade(decade).catch(error);}else if(decade%5===4){completeMystery(decade).catch(error);}else{pendingRosaryLanding='decade';moveDecade(decade+1).catch(error);}return;}
   const previous=index;index=Math.max(0,Math.min(names.length-1,index+n));
   if(index!==previous){setRosaryProgress(start,decade,index);paint();notifyBeadChange(index===gloryIndex,finalDecade&&index===names.length-1,n);}
  };
  b.onpointerdown=e=>{down={y:e.clientY,x:e.clientX,id:e.pointerId};suppress=false;b.setPointerCapture(e.pointerId);};
  b.onpointerup=e=>{if(!down)return;const dy=e.clientY-down.y,dx=e.clientX-down.x;if(Math.abs(dx)>24&&Math.abs(dx)>=Math.abs(dy)){step(dx<0?1:-1);suppress=true;}down=null;};b.onpointercancel=()=>{down=null;suppress=true;};
  b.onclick=e=>e.preventDefault();b.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();step(e.key==='ArrowLeft'?-1:1);}};
  // When the expanded artwork rosary advances, update this already-mounted rosary too.
  syncMainRosaryDisplay=()=>{index=Math.max(0,Math.min(names.length-1,getRosaryProgress(start,decade)));paint();};
  paint();
 });
 pendingRosaryLanding=null;
}
async function moveDecade(id){await flush();const target=(id+20)%20;if(isOpening||decade!==target)rosaryProgress={};decade=target;isOpening=false;manage=false;render();}
async function moveOpening(group=Math.floor(decade/5)){await flush();const target=group*5;if(!isOpening||decade!==target)rosaryProgress={};decade=target;isOpening=true;manage=false;render();}
async function movePreviousPage(){if(isOpening)return moveDecade(decade-1);if(decade%5===0)return moveOpening();return moveDecade(decade-1);}
async function moveNextPage(){return isOpening?moveDecade(decade):moveDecade(decade+1);}
function renderMystery(){
 const group=Math.floor(decade/5),num=decade%5,m=MYSTERIES[group],d=pageData(state);
 $('#main').innerHTML=`<div class="mystery-tabs" aria-label="신비 선택">${MYSTERIES.map((m,i)=>`<button data-mystery="${i}" class="${i===group?'active':''}" aria-pressed="${i===group}">${m.name}</button>`).join('')}</div><div class="decade-nav"><button id="prevDecade">‹ 이전</button><div class="decade-numbers" aria-label="단 선택"><button data-opening="${group}" class="opening-stage ${isOpening?'active':''}" aria-label="시작기도" aria-pressed="${isOpening}">시작기도</button>${Array.from({length:5},(_,i)=>`<button data-decade="${group*5+i}" class="${!isOpening&&i===num?'active':''}" aria-label="${i+1}단" aria-pressed="${!isOpening&&i===num}">${i+1}</button>`).join('')}</div><button id="nextDecade">다음 ›</button></div><div class="mystery-top"><div class="mystery-title"><p class="kicker">${m.name} · ${isOpening?'시작기도':`${num+1}단`}</p><h2>${isOpening?'시작기도':m.titles[num]}</h2></div></div><div class="book-layout book-layout-custom"><div id="scriptureArea" class="scripture-top"><button id="toggleScripture" class="manage-button" aria-expanded="false">말씀</button><div id="scriptureContents" hidden></div></div><div class="book-sections"><figure class="art-card"><button id="artDisplay" class="art-display" aria-label="${d.art?'성화 확대':'성화 추가'}"><span class="art-placeholder"><span class="art-cross">✝︎</span>${d.art?'성화를 불러오는 중…':isOpening?'시작기도에 담을 성화<br>＋ 성화 추가':'이 신비에 담을 성화<br>＋ 성화 추가'}</span></button><div class="art-actions"><span class="art-swipe-hint">터치하면 확대 · 좌우로 밀면 이동</span><button id="changeArt">${d.art?'성화 변경':'사진 선택'}</button>${d.art?'<button class="danger quiet" id="deleteArt">삭제</button>':''}</div></figure><div class="rosaries rosaries-between">${isOpening?rosaryHTML(true):rosaryHTML(false,num===4)}</div><div class="reading-column"><div id="assignedList" aria-label="이 단의 기도문"></div><button id="managePrayers" class="manage-button" aria-expanded="${manage}">기도문 추가•관리</button><div id="manageArea" ${manage?'':'hidden'}></div></div></div></div>`;
 $$('[data-mystery]').forEach(b=>b.onclick=action(()=>moveOpening(Number(b.dataset.mystery))));$$('[data-opening]').forEach(b=>b.onclick=action(()=>moveOpening(Number(b.dataset.opening))));$$('[data-decade]').forEach(b=>b.onclick=action(()=>moveDecade(Number(b.dataset.decade))));$('#prevDecade').onclick=action(movePreviousPage);$('#nextDecade').onclick=action(moveNextPage);bindRosaries();
 $('#changeArt').onclick=chooseImage;
 const artButton=$('#artDisplay');let artGesture=null,artSwiped=false;
 artButton.addEventListener('pointerdown',e=>{if(e.isPrimary){artGesture={x:e.clientX,y:e.clientY};artSwiped=false;}});
 artButton.addEventListener('pointerup',e=>{if(!artGesture)return;const dx=e.clientX-artGesture.x,dy=e.clientY-artGesture.y;artGesture=null;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.25){artSwiped=true;pendingRosaryLanding=null;(dx<0?moveNextPage():movePreviousPage()).catch(error);}});
 artButton.addEventListener('pointercancel',()=>{artGesture=null;});
 artButton.onclick=()=>{if(artSwiped){artSwiped=false;return;}if(artURL){lightboxDecade=decade;lightboxIsOpening=isOpening;$('#lightbox').classList.remove('controls-hidden');$('#lightbox').showModal();showLightboxArt(decade,isOpening);syncWakeLock();}else if(!d.art)chooseImage();};
 if(d.art){loadArt(d.art,renderToken).catch(error);$('#deleteArt').onclick=action(async()=>{if(confirm('이 단의 성화를 삭제할까요?')){const id=activeKey();await track(store.mutate(s=>{editablePage(s,id).art=null;}));render();}});}
 $('#toggleScripture').onclick=()=>{const area=$('#scriptureContents');area.hidden=!area.hidden;$('#toggleScripture').setAttribute('aria-expanded',String(!area.hidden));};
 renderScriptures();
 $('#managePrayers').onclick=()=>{manage=!manage;$('#manageArea').hidden=!manage;$('#managePrayers').setAttribute('aria-expanded',String(manage));if(manage)renderManage();};renderAssigned();if(manage)renderManage();
}
// Legacy single scripture is displayed as the first entry until the first edit.
// Conversion happens inside the same IndexedDB transaction as the edit.
function scripturesFor(d){return Array.isArray(d.scriptures)?d.scriptures:(d.scripture?[{id:'legacy',title:d.scriptureTitle||'말씀',body:d.scripture}]:[]);}
function editableScriptures(d){if(!Array.isArray(d.scriptures))d.scriptures=scripturesFor(d).map(x=>({...x}));return d.scriptures;}
function renderScriptures(openId=null){
 const container=$('#scriptureContents');if(!container)return;
 const items=scripturesFor(pageData(state));
 container.innerHTML=`<div class="scripture-toolbar"><button id="addScripture" class="primary">＋ 말씀 추가</button></div><div id="scriptureList" class="scripture-list">${items.map(p=>`<article class="scripture-entry prayer-sortable" data-scripture-id="${esc(p.id)}"><details class="prayer-fold" ${p.id===openId?'open':''}><summary class="prayer-fold-title">${esc(p.title)}<span class="fold-chevron" aria-hidden="true">⌄</span></summary><div class="prose">${esc(p.body)}</div></details><div class="actions"><button data-edit-scripture="${esc(p.id)}">수정</button><button data-delete-scripture="${esc(p.id)}" class="danger quiet">삭제</button></div></article>`).join('')}</div>${items.length>1?'<p class="drag-hint">말씀을 길게 눌러 위아래로 옮기세요.</p>':''}`;
 $('#addScripture').onclick=()=>editScripture();
 container.querySelectorAll('[data-edit-scripture]').forEach(b=>b.onclick=()=>editScripture(b.dataset.editScripture));
 container.querySelectorAll('[data-delete-scripture]').forEach(b=>b.onclick=action(async()=>{if(!confirm('이 말씀을 삭제할까요?'))return;const id=b.dataset.deleteScripture,target=activeKey();await track(store.mutate(s=>{const d=editablePage(s,target);d.scriptures=editableScriptures(d).filter(x=>x.id!==id);}));renderScriptures();}));
 bindScriptureDrag($('#scriptureList'));
}
function editScripture(id=null){
 const target=activeKey(),old=scripturesFor(pageData(state,target)).find(x=>x.id===id)||{title:'',body:''};
 openEditor(id?'말씀 수정':'말씀 추가',`<label class="field">제목<input id="scriptureTitle" required value="${esc(old.title)}"></label><label class="field">본문<textarea id="scriptureInput" required>${esc(old.body)}</textarea></label>`,async()=>{
 const title=$('#scriptureTitle').value.trim(),body=$('#scriptureInput').value.trim();if(!title||!body)throw new Error('제목과 본문을 입력해 주세요.');
 const newId=id||crypto.randomUUID();await track(store.mutate(s=>{const items=editableScriptures(editablePage(s,target));const found=items.find(x=>x.id===newId);if(found){found.title=title;found.body=body;}else items.push({id:newId,title,body});}));renderScriptures(newId);
 });
}
function bindScriptureDrag(list){
 let timer=null,active=null,start=null,lastY=0,raf=null,blockClick=false;
 const reorder=y=>{if(!active)return;const other=[...list.children].filter(x=>x!==active);const next=other.find(x=>{const r=x.getBoundingClientRect();return y<r.top+r.height/2;});if(next)list.insertBefore(active,next);else list.append(active);};
 const tick=()=>{if(!active)return;if(lastY<80)window.scrollBy(0,-8);else if(lastY>innerHeight-80)window.scrollBy(0,8);reorder(lastY);raf=requestAnimationFrame(tick);};
 const begin=(row,y)=>{active=row;lastY=y;blockClick=true;row.classList.add('dragging');raf=requestAnimationFrame(tick);};
 const finish=async(cancel=false)=>{clearTimeout(timer);timer=null;start=null;if(raf)cancelAnimationFrame(raf);raf=null;if(!active)return;active.classList.remove('dragging');active=null;if(cancel){renderScriptures();return;}const ids=[...list.children].map(x=>x.dataset.scriptureId),target=activeKey();try{await track(store.mutate(s=>{const d=editablePage(s,target),items=editableScriptures(d),byId=new Map(items.map(x=>[x.id,x]));d.scriptures=ids.map(id=>byId.get(id)).filter(Boolean);}));}catch{renderScriptures();}};
 for(const row of list.children){
 row.addEventListener('contextmenu',e=>e.preventDefault());
 row.addEventListener('click',e=>{if(blockClick){e.preventDefault();e.stopPropagation();blockClick=false;}},true);
 row.addEventListener('touchstart',e=>{if(e.touches.length!==1||e.target.closest('.actions'))return;const t=e.touches[0];start={x:t.clientX,y:t.clientY};timer=setTimeout(()=>begin(row,t.clientY),500);},{passive:true});
 row.addEventListener('touchmove',e=>{if(e.touches.length!==1){finish(true);return;}const t=e.touches[0];if(active){e.preventDefault();lastY=t.clientY;reorder(lastY);}else if(start&&Math.hypot(t.clientX-start.x,t.clientY-start.y)>9){clearTimeout(timer);timer=null;start=null;}},{passive:false});
 row.addEventListener('touchend',()=>{finish();});row.addEventListener('touchcancel',()=>{finish(true);});
 row.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'||e.target.closest('.actions'))return;start={x:e.clientX,y:e.clientY};timer=setTimeout(()=>begin(row,e.clientY),500);});
 row.addEventListener('pointermove',e=>{if(e.pointerType==='touch')return;if(active){lastY=e.clientY;reorder(lastY);}else if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>9){clearTimeout(timer);timer=null;start=null;}});
 row.addEventListener('pointerup',e=>{if(e.pointerType!=='touch')finish();});row.addEventListener('pointercancel',e=>{if(e.pointerType!=='touch')finish(true);});
 }
}
function chooseImage(){$('#imageInput').dataset.page=String(activeKey());$('#imageInput').value='';$('#imageInput').click();}
$('#imageInput').onchange=action(async e=>{const f=e.target.files[0];if(!f)return;const key=e.target.dataset.page,id=key==='opening'?'opening':Number(key);clearError();await track(store.saveArt(id,f));store.compact().catch(error);if(tab==='mysteries'&&activeKey()===id)render();notify('성화 저장 · 파일 내용 및 표시 검증 완료');});
async function loadArt(id,token){const a=await store.getAsset(id);if(!a?.blob)throw new Error('저장된 성화를 읽지 못했습니다. 백업 파일을 확인해 주세요.');if(token!==renderToken)return;artURL=URL.createObjectURL(a.blob);const img=document.createElement('img');img.alt=isOpening?'시작기도 성화':`${MYSTERIES[Math.floor(decade/5)].name} ${decade%5+1}단 성화`;img.src=artURL;img.onerror=()=>error(new Error('저장된 성화를 화면에 표시하지 못했습니다.'));$('#artDisplay').replaceChildren(img);}
function prayerAccordion(p,assigned=false){return `<article class="${assigned?'assigned-prayer':'panel prayer-card'} prayer-sortable" data-prayer="${esc(p.id)}"><details class="prayer-fold"><summary class="prayer-fold-title">${esc(p.title)}<span class="fold-chevron" aria-hidden="true">⌄</span></summary><div class="prose">${esc(p.body)}</div></details>${assigned?'':`<div class="actions"><button data-edit-prayer="${esc(p.id)}">수정</button><button data-delete-prayer="${esc(p.id)}" class="danger quiet">삭제</button></div>`}</article>`;}
function renderAssigned(){const list=$('#assignedList');list.innerHTML=pageData(state).prayers.map(id=>{const p=state.prayers.find(p=>p.id===id);return p?prayerAccordion(p,true):'';}).join('');bindDrag(list,'assigned');}
function scopeHTML(){if(isOpening)return '<p class="muted">이 기도문은 네 신비의 공통 시작기도에만 배정됩니다.</p>';return '<fieldset style="border:0;padding:0;margin:0"><legend class="muted" style="font-size:11px;margin-top:12px">적용 범위</legend><div class="scope"><label><input type="radio" name="scope" value="all" checked> 20단에 적용</label><label><input type="radio" name="scope" value="same"> 이 단 전체에 적용</label><label><input type="radio" name="scope" value="one"> 이 단에만 적용</label></div></fieldset>';}
function assign(s,id,scope,target){
 if(target==='opening'){const opening=editablePage(s,'opening');if(!opening.prayers.includes(id))opening.prayers.push(id);return;}
 const current=Number(target);
 if(!Number.isInteger(current)||current<0||current>=20)throw new Error('기도문 배정 단 번호가 올바르지 않습니다.');
 if(!['all','same','one'].includes(scope))throw new Error('적용 범위를 선택해 주세요.');
 for(const [key,d] of Object.entries(s.decades)){
  const n=Number(key);
  if(scope==='all'||(scope==='same'&&n%5===current%5)||(scope==='one'&&n===current)){
   if(!d.prayers.includes(id))d.prayers.push(id);
  }
 }
}
function renderManage(){
 const area=$('#manageArea');area.innerHTML=`<div class="manage-panel"><label class="field">기존 기도문<select id="prayerChoice"><option value="">기도문 선택</option>${state.prayers.map(p=>`<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select></label>${scopeHTML()}<div class="actions"><button id="attachPrayer" class="primary">선택한 기도문 추가</button><button id="newAssigned">새 기도문 입력</button></div><p class="drag-hint">기도문을 길게 눌러 위아래로 옮기세요. ${isOpening?'네 신비의 시작기도에 공통 적용됩니다.':'선택한 적용 범위의 단에 배정됩니다.'}</p>${pageData(state).prayers.map(id=>{const p=state.prayers.find(p=>p.id===id);return `<div class="manage-row"><span>${esc(p.title)}</span><div class="actions"><button data-remove="${id}" data-scope="one">${isOpening?'시작기도에서 제거':'이 단에서 제거'}</button>${isOpening?'':`<button data-remove="${id}" data-scope="all">20단에서 제거</button>`}</div></div>`;}).join('')}</div>`;
 $('#attachPrayer').onclick=action(async()=>{const id=$('#prayerChoice').value;if(!id)throw new Error('추가할 기도문을 선택해 주세요.');const scope=isOpening?'one':$('#manageArea input[name=scope]:checked').value,target=activeKey();await track(store.mutate(s=>assign(s,id,scope,target)));renderAssigned();renderManage();});
 $('#newAssigned').onclick=()=>editPrayer(null,true);
 $$('[data-remove]').forEach(b=>b.onclick=action(async()=>{const id=b.dataset.remove,all=b.dataset.scope==='all',target=activeKey();if(all&&!confirm('전체 20단에서 이 기도문을 제거할까요? 원본은 기도문 탭에 남습니다.'))return;await track(store.mutate(s=>{if(target==='opening')editablePage(s,'opening').prayers=editablePage(s,'opening').prayers.filter(x=>x!==id);else for(const [key,d] of Object.entries(s.decades))if(all||Number(key)===target)d.prayers=d.prayers.filter(x=>x!==id);}));renderAssigned();renderManage();}));
}
function bindDrag(list,mode='assigned'){
 let timer=null,drag=null,start=null,raf=null,lastY=0,moved=false;
 const stopScroll=()=>{if(raf)cancelAnimationFrame(raf);raf=null;};
 const reorder=y=>{if(!drag)return;const others=[...list.children].filter(x=>x!==drag);const next=others.find(x=>{const r=x.getBoundingClientRect();return y<r.top+r.height/2;});if(next)list.insertBefore(drag,next);else list.append(drag);};
 const scroll=()=>{if(!drag)return;const margin=80;if(lastY<margin)window.scrollBy(0,-8);else if(lastY>innerHeight-margin)window.scrollBy(0,8);reorder(lastY);raf=requestAnimationFrame(scroll);};
 const begin=(row,y)=>{drag=row;lastY=y;moved=true;row.classList.add('dragging');notify('위아래로 옮긴 뒤 손을 떼세요');raf=requestAnimationFrame(scroll);};
 const finish=async(cancel=false)=>{clearTimeout(timer);timer=null;start=null;stopScroll();if(!drag)return;drag.classList.remove('dragging');drag=null;
  if(cancel){if(mode==='assigned')renderAssigned();else renderPrayers();notify('이동 취소');return;}
  const ids=[...list.children].map(x=>x.dataset.prayer),target=activeKey();
  try{await track(store.mutate(s=>{if(mode==='library'){const byId=new Map(s.prayers.map(p=>[p.id,p]));s.prayers=ids.map(id=>byId.get(id)).filter(Boolean);}else{const targetPage=editablePage(s,target),current=targetPage.prayers;targetPage.prayers=[...ids.filter(id=>current.includes(id)),...current.filter(id=>!ids.includes(id))];}}));}catch{if(mode==='assigned')renderAssigned();else renderPrayers();}
 };
 for(const row of list.children){
  row.addEventListener('contextmenu',e=>e.preventDefault());
  row.addEventListener('click',e=>{if(moved){e.preventDefault();e.stopPropagation();moved=false;}},true);
  row.addEventListener('touchstart',e=>{if(e.touches.length!==1||e.target.closest('.actions'))return;const t=e.touches[0];start={x:t.clientX,y:t.clientY};timer=setTimeout(()=>begin(row,t.clientY),500);},{passive:true});
  row.addEventListener('touchmove',e=>{if(e.touches.length!==1){finish(true);return;}const t=e.touches[0];if(drag){e.preventDefault();lastY=t.clientY;reorder(lastY);}else if(start&&Math.hypot(t.clientX-start.x,t.clientY-start.y)>9){clearTimeout(timer);timer=null;start=null;}},{passive:false});
  row.addEventListener('touchend',()=>{finish();});row.addEventListener('touchcancel',()=>finish(true));
  row.onpointerdown=e=>{if(e.pointerType==='touch'||e.button!==0||e.target.closest('.actions'))return;start={x:e.clientX,y:e.clientY};timer=setTimeout(()=>begin(row,e.clientY),500);};
  row.onpointermove=e=>{if(e.pointerType==='touch')return;if(drag){lastY=e.clientY;reorder(lastY);}else if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>9){clearTimeout(timer);start=null;}};
  row.onpointerup=e=>{if(e.pointerType!=='touch')finish();};row.onpointercancel=e=>{if(e.pointerType!=='touch')finish(true);};
 }
}
function renderPrayers(){
 $('#main').innerHTML=`<div class="section-heading"><div><h2>기도문</h2></div><button id="newPrayer" class="primary">＋ 기도문 추가</button></div><div class="prayer-library">${state.prayers.length?state.prayers.map(p=>prayerAccordion(p)).join(''):'<div class="empty-state"><span class="empty-icon">✝︎</span><h3>나만의 기도를 담아 보세요</h3><p>직접 등록한 기도문이 여기에 모입니다.</p></div>'}</div>`;
 bindDrag($('.prayer-library'),'library');$('#newPrayer').onclick=()=>editPrayer();$$('[data-edit-prayer]').forEach(b=>b.onclick=()=>editPrayer(b.dataset.editPrayer));$$('[data-delete-prayer]').forEach(b=>b.onclick=action(async()=>{const id=b.dataset.deletePrayer;if(!confirm('기도문 원본을 삭제할까요? 배정된 모든 단에서도 제거됩니다.'))return;await track(store.mutate(s=>{s.prayers=s.prayers.filter(p=>p.id!==id);Object.values(s.decades).forEach(d=>d.prayers=d.prayers.filter(x=>x!==id));if(s.opening)s.opening.prayers=s.opening.prayers.filter(x=>x!==id);}));renderPrayers();}));
}
function openEditor(title,body,save){$('#editorTitle').textContent=title;$('#editorBody').innerHTML=body;editorAction=save;$('#editor').showModal();}
function closeEditor(){if(!$('#saveEditor').disabled)$('#editor').close();}
$('#closeEditor').onclick=closeEditor;$('#cancelEditor').onclick=closeEditor;
$('#editor').addEventListener('cancel',e=>{if($('#saveEditor').disabled)e.preventDefault();});
$('#editorForm').onsubmit=async e=>{e.preventDefault();$('#saveEditor').disabled=true;clearError();try{await editorAction();$('#editor').close();}catch(err){error(err);let message=$('#editorError');if(!message){message=document.createElement('p');message.id='editorError';message.className='notice error';message.setAttribute('role','alert');$('#editorBody').append(message);}message.textContent=explainError(err);}finally{$('#saveEditor').disabled=false;}};
function editPrayer(id=null,attach=false){
 const p=state.prayers.find(p=>p.id===id)||{title:'',body:''},target=activeKey();
 openEditor(id?'기도문 수정':'새 기도문',`<label class="field">제목<input id="prayerTitle" required value="${esc(p.title)}"></label><label class="field">본문<textarea id="prayerBody" required>${esc(p.body)}</textarea></label>${attach?scopeHTML():''}`,async()=>{const title=$('#prayerTitle').value.trim(),body=$('#prayerBody').value.trim();if(!title||!body)throw new Error('제목과 본문을 입력해 주세요.');const pid=id||crypto.randomUUID(),scope=attach&&target!=='opening'?$('#editor input[name=scope]:checked').value:'one';await track(store.mutate(s=>{const found=s.prayers.find(p=>p.id===pid);if(found){found.title=title;found.body=body;}else s.prayers.push({id:pid,title,body});if(attach)assign(s,pid,scope,target);}));if(tab==='prayers')renderPrayers();else{renderAssigned();renderManage();}});
}
async function showLightboxArt(id,opening=false){
 const seq=++lightboxSequence,entry=pageData(state,opening?'opening':id);
 const previous=lightboxURL;
 // Every decade is navigable, including decades without an uploaded image.
 lightboxDecade=id;lightboxIsOpening=opening;
 renderArtRosaries();
 resetArtZoom();
 const mystery=MYSTERIES[Math.floor(id/5)];
 const position=$('#lightboxPosition');
 const heading=document.createElement('div');
 heading.className='lightbox-mystery-name';
 heading.textContent=`${mystery.name} · ${opening?'시작기도':`${id%5+1}단`}`;
 const subject=document.createElement('div');
 subject.className='lightbox-mystery-subject';
 subject.textContent=opening?'시작기도':mystery.titles[id%5];
 position.replaceChildren(heading,subject);
 $('#largeArt').hidden=true;
 $('#largeArt').removeAttribute('src');
 $('#lightboxEmpty').hidden=!!entry?.art;
 if(previous){URL.revokeObjectURL(previous);lightboxURL=null;}
 if(!entry?.art)return;
 try{
  const asset=await store.getAsset(entry.art);
  if(seq!==lightboxSequence||!$('#lightbox').open)return;
  if(!asset?.blob)throw new Error('성화 파일을 읽지 못했습니다.');
  const url=URL.createObjectURL(asset.blob);
  lightboxURL=url;
  $('#largeArt').src=url;
  $('#largeArt').alt=opening?'시작기도 성화':`${MYSTERIES[Math.floor(id/5)].name} ${id%5+1}단 성화`;
  $('#largeArt').hidden=false;
 }catch(e){if(seq===lightboxSequence)error(e);}
}
// Ask supported browsers to use a dark system bar while artwork is enlarged.
// Restore the current app theme on closing; unsupported browsers keep their own bars.
function artRosaryNames(start,id){return start?START_PRAYERS:(id%5===4?[...DECADE_PRAYERS,'(성모찬송)성호경']:DECADE_PRAYERS);}
function artRosaryIndex(start,id){const n=getRosaryProgress(start,id);return Math.max(0,Math.min(artRosaryNames(start,id).length-1,n));}
function renderArtRosaries(){
 const wrap=$('#artRosaries');if(!wrap)return;
 wrap.innerHTML=lightboxIsOpening?'<button type="button" class="art-rosary-bead" data-art-rosary="start" aria-label="시작 기도 구슬"></button>':'<button type="button" class="art-rosary-bead" data-art-rosary="decade" aria-label="단 기도 구슬"></button>'; 
 wrap.querySelectorAll('[data-art-rosary]').forEach(b=>{
  const start=b.dataset.artRosary==='start',names=artRosaryNames(start,lightboxDecade),i=artRosaryIndex(start,lightboxDecade),cross=(start&&i===0)||(!start&&lightboxDecade%5===4&&i===names.length-1);
  const name=start&&i===0?'성호경 · 사도신경':names[i];
  const hailMaryNumber=names[i]==='성모송'?(start?i-1:i):null;
  b.innerHTML=`<span class="art-rosary-arrow" aria-hidden="true">↑</span><span class="art-rosary-symbol ${cross?'art-rosary-cross':names[i]==='성모송'?'art-rosary-small':'art-rosary-large'}" aria-hidden="true">${cross?'✝':hailMaryNumber??''}</span><span class="art-rosary-prayer">${name}</span>`;
  b.setAttribute('aria-label',`${name}, ${i+1}/${names.length}. 위아래로 밀어 기도, 길게 눌러 위치 이동`);
 });
 if(!artBeadTouch)requestAnimationFrame(()=>{if($('#lightbox').open&&!artBeadTouch)applyArtRosaryPosition();});
}
function stepArtRosary(start,direction){
 const id=lightboxDecade,names=artRosaryNames(start,id),index=artRosaryIndex(start,id);
 if(direction>0&&index===names.length-1){notifyBeadChange(false,false,1);if(start)advanceArt(1);else if(id%5===4)completeMystery(id).catch(error);else advanceArt(1);return;}
 if(direction<0&&index===0){notifyBeadChange(false,false,-1);advanceArt(-1,'last');return;}
 const next=index+(direction>0?1:-1);
 setRosaryProgress(start,id,next);
 syncMainRosaryDisplay();
 notifyBeadChange(next===(start?START_PRAYERS.length-1:DECADE_PRAYERS.length-1),!start&&id%5===4&&next===names.length-1,direction);
 renderArtRosaries();
}
const artRosaryWrap=$('#artRosaries');
// The opening, ordinary and final-decade art rosaries share one saved position.
// Position is a viewport-relative ratio, so it also survives device rotation.
const ART_ROSARY_POSITION_KEY='my-rosary-art-rosary-position-v1';
function validArtRosaryPosition(p){return !!p&&typeof p==='object'&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;}
function readArtRosaryPosition(){
 try{const raw=localStorage.getItem(ART_ROSARY_POSITION_KEY);const p=raw?JSON.parse(raw):null;return validArtRosaryPosition(p)?p:null;}
 catch(_){return null;}
}
let artRosaryPosition=readArtRosaryPosition();
function artRosaryBounds(){
 const viewer=$('#lightbox');
 const xSpace=Math.max(0,viewer.clientWidth-artRosaryWrap.offsetWidth);
 const ySpace=Math.max(0,viewer.clientHeight-artRosaryWrap.offsetHeight);
 const xInset=Math.min(12,xSpace/2),yInset=Math.min(12,ySpace/2);
 return {minX:xInset,maxX:xSpace-xInset,minY:yInset,maxY:ySpace-yInset};
}
const clampArt=(n,lo,hi)=>Math.min(hi,Math.max(lo,n));
function setArtRosaryPixels(x,y){
 const b=artRosaryBounds();
 artRosaryWrap.style.left=`${clampArt(x,b.minX,b.maxX)}px`;
 artRosaryWrap.style.top=`${clampArt(y,b.minY,b.maxY)}px`;
 artRosaryWrap.style.right='auto';artRosaryWrap.style.bottom='auto';
}
function applyArtRosaryPosition(){
 if(!artRosaryPosition){artRosaryWrap.style.left='';artRosaryWrap.style.top='';artRosaryWrap.style.right='';artRosaryWrap.style.bottom='';return;}
 const b=artRosaryBounds();
 setArtRosaryPixels(b.minX+(b.maxX-b.minX)*artRosaryPosition.x,b.minY+(b.maxY-b.minY)*artRosaryPosition.y);
}
function saveArtRosaryPosition(){
 const b=artRosaryBounds(),rect=artRosaryWrap.getBoundingClientRect(),outer=$('#lightbox').getBoundingClientRect();
 const x=rect.left-outer.left,y=rect.top-outer.top;
 artRosaryPosition={x:b.maxX===b.minX?0:(clampArt(x,b.minX,b.maxX)-b.minX)/(b.maxX-b.minX),y:b.maxY===b.minY?0:(clampArt(y,b.minY,b.maxY)-b.minY)/(b.maxY-b.minY)};
 try{localStorage.setItem(ART_ROSARY_POSITION_KEY,JSON.stringify(artRosaryPosition));}
 catch(_){notify('가상 묵주 위치를 영구 저장하지 못했습니다. 브라우저 저장소를 확인해 주세요.');}
}
let artBeadTouch=null;
function stopArtRosaryHold(){if(artBeadTouch?.timer){clearTimeout(artBeadTouch.timer);artBeadTouch.timer=null;}}
artRosaryWrap.addEventListener('pointerdown',e=>{
 const button=e.target.closest('[data-art-rosary]');
 if(!button||e.isPrimary===false||(e.pointerType==='mouse'&&e.button!==0))return;
 stopArtRosaryHold();
 const touch={pointerId:e.pointerId,id:button.dataset.artRosary,x:e.clientX,y:e.clientY,dragging:false,timer:null,originX:0,originY:0};
 artBeadTouch=touch;
 touch.timer=setTimeout(()=>{
  if(artBeadTouch!==touch)return;
  const outer=$('#lightbox').getBoundingClientRect(),rect=artRosaryWrap.getBoundingClientRect();
  touch.originX=rect.left-outer.left;touch.originY=rect.top-outer.top;
  touch.dragging=true;touch.timer=null;
  artRosaryWrap.classList.add('is-positioning');
  setArtRosaryPixels(touch.originX,touch.originY);
  try{navigator.vibrate?.(25);}catch(_){}
 },600);
 try{artRosaryWrap.setPointerCapture(e.pointerId);}catch(_){}
 e.stopPropagation();
});
artRosaryWrap.addEventListener('pointermove',e=>{
 const t=artBeadTouch;if(!t||t.pointerId!==e.pointerId)return;
 const dx=e.clientX-t.x,dy=e.clientY-t.y;
 if(t.dragging){e.preventDefault();setArtRosaryPixels(t.originX+dx,t.originY+dy);}
 else if(Math.hypot(dx,dy)>10)stopArtRosaryHold();
 e.stopPropagation();
});
function finishArtRosaryPointer(e,cancel=false){
 const t=artBeadTouch;if(!t||t.pointerId!==e.pointerId)return;
 stopArtRosaryHold();artBeadTouch=null;
 artRosaryWrap.classList.remove('is-positioning');
 if(t.dragging){saveArtRosaryPosition();applyArtRosaryPosition();}
 else if(!cancel){const dx=e.clientX-t.x,dy=e.clientY-t.y;
  if(Math.abs(dy)>24&&Math.abs(dy)>Math.abs(dx))stepArtRosary(t.id==='start',dy<0?1:-1);
 }
 ignoreMouseClickUntil=Date.now()+650;
 try{if(artRosaryWrap.hasPointerCapture(e.pointerId))artRosaryWrap.releasePointerCapture(e.pointerId);}catch(_){}
 e.stopPropagation();
}
artRosaryWrap.addEventListener('pointerup',e=>finishArtRosaryPointer(e));
artRosaryWrap.addEventListener('pointercancel',e=>finishArtRosaryPointer(e,true));
artRosaryWrap.addEventListener('contextmenu',e=>e.preventDefault());
artRosaryWrap.addEventListener('click',e=>e.stopPropagation());
artRosaryWrap.addEventListener('keydown',e=>{const b=e.target.closest('[data-art-rosary]');if(!b)return;if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();stepArtRosary(b.dataset.artRosary==='start',e.key==='ArrowUp'?1:-1);}});
window.addEventListener('resize',()=>{if($('#lightbox').open&&!artBeadTouch)applyArtRosaryPosition();});
window.addEventListener('rosary-art-rosary-position-restored',()=>{artRosaryPosition=readArtRosaryPosition();if($('#lightbox').open)applyArtRosaryPosition();});
function advanceArt(step,landing='first'){
 let next,opening=false;
 if(lightboxIsOpening){next=step>0?lightboxDecade:(lightboxDecade+19)%20;}
 else if(step<0&&lightboxDecade%5===0){next=lightboxDecade;opening=true;}
 else next=(lightboxDecade+step+20)%20;
 rosaryProgress={};
 if(landing==='last')setRosaryProgress(opening,next,artRosaryNames(opening,next).length-1);
 showLightboxArt(next,opening);
}
// Image gestures: pinch to zoom, drag while zoomed, swipe between artworks at 1x.
let artScale=1,artX=0,artY=0,pinchStart=null,dragStart=null,lastArtTap=0;
let artTapTimer=null,ignoreMouseClickUntil=0,touchWasMulti=false;
function cancelArtTap(){if(artTapTimer!==null){clearTimeout(artTapTimer);artTapTimer=null;}}
function toggleArtControls(){const viewer=$('#lightbox');viewer.classList.toggle('controls-hidden');}
function registerArtTap(){
 const now=Date.now();
 if(now-lastArtTap<330){cancelArtTap();lastArtTap=0;artScale=artScale>1.01?1:2.5;artX=0;artY=0;renderArtZoom();}
 else{lastArtTap=now;cancelArtTap();artTapTimer=setTimeout(()=>{artTapTimer=null;lastArtTap=0;toggleArtControls();},335);}
}
const largeArt=$('#largeArt');
function renderArtZoom(){largeArt.style.transform=`translate(${artX}px, ${artY}px) scale(${artScale})`;largeArt.classList.toggle('zoomed',artScale>1.01);}
function resetArtZoom(){artScale=1;artX=0;artY=0;pinchStart=null;dragStart=null;lightboxTouch=null;renderArtZoom();}
function touchDistance(a,b){return Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);}
function touchMid(a,b){return {x:(a.clientX+b.clientX)/2,y:(a.clientY+b.clientY)/2};}
$('#lightbox').addEventListener('touchstart',e=>{
 if(e.target.closest('button'))return;
 if(e.touches.length===2){
  touchWasMulti=true;cancelArtTap();lastArtTap=0;
  const mid=touchMid(e.touches[0],e.touches[1]);
  pinchStart={distance:touchDistance(e.touches[0],e.touches[1]),scale:artScale,x:artX,y:artY,mid};
  lightboxTouch=null;dragStart=null;
 }else if(e.touches.length===1){
  touchWasMulti=false;const t=e.touches[0];lightboxTouch={x:t.clientX,y:t.clientY};
  dragStart={x:t.clientX,y:t.clientY,offsetX:artX,offsetY:artY};
 }
},{passive:true});
$('#lightbox').addEventListener('touchmove',e=>{
 if(e.target.closest('button'))return;
 if(e.touches.length===2&&pinchStart){
  e.preventDefault();const mid=touchMid(e.touches[0],e.touches[1]);
  artScale=Math.max(1,Math.min(5,pinchStart.scale*touchDistance(e.touches[0],e.touches[1])/Math.max(1,pinchStart.distance)));
  artX=pinchStart.x+mid.x-pinchStart.mid.x;artY=pinchStart.y+mid.y-pinchStart.mid.y;
  if(artScale===1){artX=0;artY=0;}renderArtZoom();
 }else if(e.touches.length===1&&artScale>1.01&&dragStart){
  e.preventDefault();artX=dragStart.offsetX+e.touches[0].clientX-dragStart.x;artY=dragStart.offsetY+e.touches[0].clientY-dragStart.y;renderArtZoom();
 }
},{passive:false});
$('#lightbox').addEventListener('touchend',e=>{
 if(e.touches.length>0){if(e.touches.length===1){const t=e.touches[0];dragStart={x:t.clientX,y:t.clientY,offsetX:artX,offsetY:artY};}return;}
 if(!pinchStart&&!touchWasMulti&&lightboxTouch&&e.changedTouches.length===1){
  const dx=e.changedTouches[0].clientX-lightboxTouch.x,dy=e.changedTouches[0].clientY-lightboxTouch.y;
  if(artScale<=1.01&&Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.2){cancelArtTap();advanceArt(dx<0?1:-1);lastArtTap=0;}
  else if(Math.abs(dx)<18&&Math.abs(dy)<18){registerArtTap();}
 }
 ignoreMouseClickUntil=Date.now()+650;pinchStart=null;dragStart=null;lightboxTouch=null;touchWasMulti=false;
},{passive:true});
$('#lightbox').addEventListener('touchcancel',()=>{pinchStart=null;dragStart=null;lightboxTouch=null;touchWasMulti=false;cancelArtTap();});
$('#lightbox').addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){e.preventDefault();advanceArt(-1);}if(e.key==='ArrowRight'){e.preventDefault();advanceArt(1);}});
$('#closeLightbox').onclick=()=>$('#lightbox').close();
$('#lightbox').addEventListener('close',()=>{const target=lightboxDecade,targetOpening=lightboxIsOpening;lightboxSequence++;$('#largeArt').removeAttribute('src');if(lightboxURL)URL.revokeObjectURL(lightboxURL);lightboxURL=null;resetArtZoom();cancelArtTap();lastArtTap=0;$('#lightbox').classList.remove('controls-hidden');stopArtRosaryHold();artBeadTouch=null;artRosaryWrap.classList.remove('is-positioning');if(tab==='mysteries'&&(decade!==target||isOpening!==targetOpening)){decade=target;isOpening=targetOpening;manage=false;render();window.scrollTo(0,0);}else if(tab==='mysteries'){syncMainRosaryDisplay();}syncWakeLock();});
$('#lightbox').addEventListener('cancel',()=>{lightboxTouch=null;});
$('#lightbox').addEventListener('click',e=>{if(e.target.closest('button'))return;if(Date.now()<ignoreMouseClickUntil)return;registerArtTap();});
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
$('#export').onclick=action(async()=>{await flush();notify('기도 자료·성화·꾸미기·음악을 백업하는 중…');const b=await store.backup();b.extras=await collectExtras();b.version=2;const blob=new Blob([JSON.stringify(b)],{type:'application/json'});download(blob,`묵주기도_전체백업_${localDate()}.json`);localStorage.setItem('rosary-last-backup-date',new Date().toISOString());showLastBackup();notify('음악 파일까지 포함한 전체 백업을 내보냈습니다. 다운로드한 파일을 안전한 곳에 보관하세요.');});
$('#import').onclick=()=>{$('#backupInput').value='';$('#backupInput').click();};
$('#backupInput').onchange=action(async e=>{const file=e.target.files[0];if(!file)return;await flush();if(file.size>750*1024*1024)throw new Error('백업 파일이 750MB를 초과합니다.');notify('백업 파일과 모든 첨부 자료를 검사하는 중…');const raw=JSON.parse(await file.text());if(!raw||![1,2].includes(raw.version))throw new Error('지원하지 않는 백업 버전입니다.');const prepared=await parseBackup(JSON.stringify({...raw,version:1}));const extras=raw.version===2?await validateExtras(raw.extras):null;const s=prepared.state;const info=extras?` · 음악 ${extras.tracks.length}곡 · 꾸미기 포함`:' · 구형 백업(음악·꾸미기 미포함)';if(!confirm(`파일 검사 완료\n기록 ${Object.keys(s.records).length}개 · 기도문 ${s.prayers.length}개 · 성화 ${prepared.assets.length}개${info}\n\n현재 데이터를 덮어쓸까요? 복원 전 현재 데이터를 반드시 백업하세요.`)){notify('복원을 취소했습니다');return;}await track(store.restore(prepared));if(extras)await restoreExtras(extras);store.compact().catch(error);clearError();render();notify(extras?'전체 백업 복원 완료. 꾸미기·음악 화면을 반영하려면 앱을 새로고침하세요.':'구형 백업 복원 완료. 기존 음악과 꾸미기는 유지됩니다.');});
function showLastBackup(){const el=$('#lastBackup');if(!el)return;const date=localStorage.getItem('rosary-last-backup-date');el.textContent=date?'마지막 백업 내보내기: '+new Date(date).toLocaleString('ko-KR'):'이 기기에서 백업한 기록이 없습니다.';}
showLastBackup();
async function storageInfo(){const e=await navigator.storage?.estimate?.(),p=await navigator.storage?.persisted?.();$('#storageInfo').textContent=`저장 보호 ${p?'허용됨':'미허용'}${e?.quota?` · 사용량 ${(e.usage/1024/1024).toFixed(1)}MB / 약 ${(e.quota/1024/1024).toFixed(0)}MB`:''}`;}
$('#persist').onclick=action(async()=>{const p=await navigator.storage?.persist?.();notify(p?'브라우저의 자동 정리로부터 저장소가 보호됩니다':'브라우저가 보호 요청을 허용하지 않았습니다. 백업 파일을 정기적으로 보관해 주세요.');await storageInfo();});
$('#dataTools').addEventListener('toggle',()=>{if($('#dataTools').open)storageInfo().catch(error);});
function connection(){$('#connection').textContent=navigator.onLine?'기기 안에 보관':'오프라인';}addEventListener('online',connection);addEventListener('offline',connection);connection();
let registration;
let updateCheckInProgress=false;
function offerUpdate(worker){
 if(!worker||worker.state!=='installed'||!navigator.serviceWorker.controller)return;
 waitingWorker=worker;
 $('#update').hidden=false;
 notify('새 버전이 준비되었습니다. 업데이트 적용을 눌러 주세요.');
}
function observeInstalling(worker){
 if(!worker)return;
 const check=()=>{if(worker.state==='installed')offerUpdate(worker);};
 worker.addEventListener('statechange',check);
 check();
}
async function checkPWAUpdate(manual=false){
 if(!('serviceWorker' in navigator)){
  if(manual)notify('이 브라우저는 오프라인 업데이트를 지원하지 않습니다.');
  return;
 }
 if(!navigator.onLine){if(manual)notify('오프라인입니다. 인터넷 연결 후 다시 확인해 주세요.');return;}
 if(updateCheckInProgress)return;
 updateCheckInProgress=true;
 if(manual)notify('새 버전을 확인하는 중…');
 try{
  // Registration.update() fetches sw.js; updateViaCache:none bypasses HTTP cache
  // for imported worker scripts as well. No site data is deleted.
  await registration.update();
  if(registration.waiting)offerUpdate(registration.waiting);
  else if(registration.installing){observeInstalling(registration.installing);if(manual)notify('새 버전 파일을 준비하는 중입니다. 완료되면 업데이트 버튼이 표시됩니다.');}
  else if(manual)notify('업데이트 확인 완료 · 새 버전이 없거나 이미 적용되었습니다.');
 }catch(e){if(manual)throw e;}
 finally{updateCheckInProgress=false;}
}
async function setupPWA(){
 if(!('serviceWorker' in navigator))return;
 // Re-register even if one already exists, so older registrations use the
 // same no-HTTP-cache policy for future worker updates.
 registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
 if(registration.waiting)offerUpdate(registration.waiting);
 observeInstalling(registration.installing);
 registration.addEventListener('updatefound',()=>observeInstalling(registration.installing));
 await checkPWAUpdate(false);
}
$('#applyUpdate').onclick=action(async()=>{
 await flush();
 if($('#editor').open)throw new Error('입력창을 저장하거나 닫은 뒤 업데이트해 주세요.');
 if(!waitingWorker){notify('준비된 업데이트가 없습니다. 업데이트 확인을 다시 눌러 주세요.');return;}
 $('#applyUpdate').disabled=true;
 notify('업데이트를 적용하는 중…');
 waitingWorker.postMessage({type:'SKIP_WAITING'});
 // If activation stalls, allow the user to retry rather than locking the UI.
 setTimeout(()=>{$('#applyUpdate').disabled=false;},12000);
});
let reloading=false;
navigator.serviceWorker?.addEventListener('controllerchange',()=>{
 if(waitingWorker&&!reloading){reloading=true;location.reload();}
});
$('#checkUpdate').onclick=action(async()=>{
 if(!registration)await setupPWA();
 await checkPWAUpdate(true);
});
addEventListener('online',()=>{if(registration)checkPWAUpdate(false).catch(()=>{});});
// Check again when the user returns after a release, without refreshing prayer data.
let lastPwaCheck=0;
addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='visible'&&registration&&Date.now()-lastPwaCheck>5*60*1000){
  lastPwaCheck=Date.now();checkPWAUpdate(false).catch(()=>{});
 }
});
addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvent=e;$('#install').hidden=false;});$('#install').onclick=action(async()=>{await installEvent?.prompt();installEvent=null;$('#install').hidden=true;});
// Reload fresh state on return from another tab without replacing active text fields.
addEventListener('focus',()=>{if(!saveCount&&!unsaved&&!$('#editor').open&&!(tab==='calendar'&&document.activeElement?.closest('#recordForm'))){store.readState().then(s=>{if(s.revision!==state.revision){state=s;render();}}).catch(error);}});
try{await store.open();state=await store.readState();render();notify('기록을 불러왔습니다');window.dispatchEvent(new Event('rosary-app-ready'));setupPWA().catch(e=>{notify('오프라인 준비 실패 · 연결 상태를 확인해 주세요');error(e);});}catch(e){error(e);$('#main').innerHTML='<section class="panel"><h2>저장소를 열지 못했습니다</h2><p class="muted">위의 오류를 확인하고 일반 Chrome 창에서 다시 열어 주세요. 기존 데이터는 삭제하지 않습니다.</p><button onclick="location.reload()">다시 시도</button></section>';}
