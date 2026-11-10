import {PrayerStore,blankState,parseBackup,explainError} from './storage.js';
import {MYSTERIES,START_PRAYERS,DECADE_PRAYERS} from './mysteries.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localDate=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const store=new PrayerStore();let state=blankState(),tab='calendar',selected=localDate(),month=new Date(new Date().getFullYear(),new Date().getMonth(),1),decade=0,artURL=null,renderToken=0,manage=false;
// Wake lock is transient and never stored in the prayer database.
let wakeLock=null,wakeRequest=0,lightboxDecade=0,lightboxURL=null,lightboxSequence=0,lightboxTouch=null;
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
const notify=s=>{$('#status').textContent=s;};
function error(e){$('#error').textContent=explainError(e);$('#error').hidden=false;notify('저장되지 않은 내용이 있는지 확인해 주세요');}
function clearError(){$('#error').hidden=true;}
function action(fn){return async e=>{try{await fn(e);}catch(err){error(err);}};}
function track(task){const sequence=++saveSequence;saveCount++;notify('저장 중…');const p=task.then(s=>{if(s)state=s;if(sequence===saveSequence){unsaved=false;notify('저장 · 다시 읽기 확인 완료');}return s;}).catch(e=>{if(sequence===saveSequence)unsaved=true;error(e);throw e;}).finally(()=>{saveCount--;});pending=p;return p;}
async function flush(){await pending;if(unsaved)throw new Error('저장하지 못한 내용이 있습니다. 현재 화면에서 다시 저장해 주세요.');}
async function changeTab(next){await flush();tab=next;manage=false;render();syncWakeLock();}
$$('[data-tab]').forEach(b=>b.onclick=action(()=>changeTab(b.dataset.tab)));
$('#openHelp').addEventListener('click',()=>$('#helpDialog').showModal());
$('#closeHelp').addEventListener('click',()=>$('#helpDialog').close());
$('#helpDialog').addEventListener('click',e=>{if(e.target===$('#helpDialog'))$('#helpDialog').close();});
window.addEventListener('beforeunload',e=>{if(saveCount||unsaved){e.preventDefault();e.returnValue='';}});
function render(){
 renderToken++;if(artURL){URL.revokeObjectURL(artURL);artURL=null;}$('#main').setAttribute('aria-busy','false');
 $$('[data-tab]').forEach(b=>{if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
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
function rosaryHTML(start){return `<button class="rosary" data-rosary="${start?'start':'decade'}" aria-label="${start?'시작 묵주':'일반 묵주'}"><span class="beads"></span><span class="prayer-name"></span></button>`;}
function bindRosaries(){
 $$('.rosary').forEach(b=>{const start=b.dataset.rosary==='start',names=start?START_PRAYERS:DECADE_PRAYERS;let index=0,down=null,suppress=false;
  const paint=()=>{b.querySelector('.beads').innerHTML=names.map((name,i)=>`<i class="bead ${name!=='성모송'?'big':''} ${start&&i===0?'cross-bead':''} ${i===index?'current':i<index?'done':''}">${start&&i===0?'✝︎':''}</i>`).join('');b.querySelector('.prayer-name').textContent=start&&index===0?'성호경 · 사도신경':names[index];b.setAttribute('aria-label',`${start?'시작 묵주':'일반 묵주'} ${index+1}/${names.length} ${names[index]}. 좌우로 밀어 기도 이동`);};
  const step=n=>{const previous=index;index=Math.max(0,Math.min(names.length-1,index+n));paint();if(n>0&&previous<names.length-1&&index===names.length-1&&typeof navigator.vibrate==='function'){try{navigator.vibrate(80);}catch(_){/* Unsupported or blocked vibration must not interrupt prayer navigation. */}}};
  b.onpointerdown=e=>{down={y:e.clientY,x:e.clientX,id:e.pointerId};suppress=false;b.setPointerCapture(e.pointerId);};
  b.onpointerup=e=>{if(!down)return;const dy=e.clientY-down.y,dx=e.clientX-down.x;if(Math.abs(dx)>24&&Math.abs(dx)>=Math.abs(dy)){step(dx<0?1:-1);suppress=true;}down=null;};b.onpointercancel=()=>{down=null;suppress=true;};
  b.onclick=e=>e.preventDefault();b.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();step(e.key==='ArrowLeft'?-1:1);}};paint();
 });
}
async function moveDecade(id){await flush();decade=(id+20)%20;manage=false;render();}
function renderMystery(){
 const group=Math.floor(decade/5),num=decade%5,m=MYSTERIES[group],d=state.decades[decade];
 $('#main').innerHTML=`<div class="mystery-tabs" aria-label="신비 선택">${MYSTERIES.map((m,i)=>`<button data-mystery="${i}" class="${i===group?'active':''}" aria-pressed="${i===group}">${m.name}</button>`).join('')}</div><div class="decade-nav"><button id="prevDecade">‹ 이전</button><div class="decade-numbers" aria-label="단 선택">${Array.from({length:5},(_,i)=>`<button data-decade="${group*5+i}" class="${i===num?'active':''}" aria-label="${i+1}단" aria-pressed="${i===num}">${i+1}</button>`).join('')}</div><button id="nextDecade">다음 ›</button></div><div class="mystery-top"><div class="mystery-title"><p class="kicker">${m.name} · ${num+1}단</p><h2>${m.titles[num]}</h2></div></div><div class="book-layout book-layout-custom"><div id="scriptureArea" class="scripture-top"><button id="toggleScripture" class="manage-button" aria-expanded="false">말씀</button><div id="scriptureContents" hidden></div></div><div class="book-sections"><figure class="art-card"><button id="artDisplay" class="art-display" aria-label="${d.art?'성화 확대':'성화 추가'}"><span class="art-placeholder"><span class="art-cross">✝︎</span>${d.art?'성화를 불러오는 중…':'이 신비에 담을 성화<br>＋ 성화 추가'}</span></button><div class="art-actions"><button id="changeArt">${d.art?'성화 변경':'사진 선택'}</button>${d.art?'<button class="danger quiet" id="deleteArt">삭제</button>':''}</div></figure><div class="rosaries rosaries-between">${num===0?rosaryHTML(true):''}${rosaryHTML(false)}</div><div class="reading-column"><div id="assignedList" aria-label="이 단의 기도문"></div><button id="managePrayers" class="manage-button" aria-expanded="${manage}">기도문 추가•관리</button><div id="manageArea" ${manage?'':'hidden'}></div></div></div></div>`;
 $$('[data-mystery]').forEach(b=>b.onclick=action(()=>moveDecade(Number(b.dataset.mystery)*5)));$$('[data-decade]').forEach(b=>b.onclick=action(()=>moveDecade(Number(b.dataset.decade))));$('#prevDecade').onclick=action(()=>moveDecade(decade-1));$('#nextDecade').onclick=action(()=>moveDecade(decade+1));bindRosaries();
 $('#changeArt').onclick=chooseImage;$('#artDisplay').onclick=()=>{if(artURL){lightboxDecade=decade;$('#lightbox').showModal();showLightboxArt(decade);syncWakeLock();}else if(!d.art)chooseImage();};
 if(d.art){loadArt(d.art,renderToken).catch(error);$('#deleteArt').onclick=action(async()=>{if(confirm('이 단의 성화를 삭제할까요?')){const id=decade;await track(store.mutate(s=>{s.decades[id].art=null;}));render();}});}
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
 const items=scripturesFor(state.decades[decade]);
 container.innerHTML=`<div class="scripture-toolbar"><button id="addScripture" class="primary">＋ 말씀 추가</button></div><div id="scriptureList" class="scripture-list">${items.map(p=>`<article class="scripture-entry prayer-sortable" data-scripture-id="${esc(p.id)}"><details class="prayer-fold" ${p.id===openId?'open':''}><summary class="prayer-fold-title">${esc(p.title)}<span class="fold-chevron" aria-hidden="true">⌄</span></summary><div class="prose">${esc(p.body)}</div></details><div class="actions"><button data-edit-scripture="${esc(p.id)}">수정</button><button data-delete-scripture="${esc(p.id)}" class="danger quiet">삭제</button></div></article>`).join('')}</div>${items.length>1?'<p class="drag-hint">말씀을 길게 눌러 위아래로 옮기세요.</p>':''}`;
 $('#addScripture').onclick=()=>editScripture();
 container.querySelectorAll('[data-edit-scripture]').forEach(b=>b.onclick=()=>editScripture(b.dataset.editScripture));
 container.querySelectorAll('[data-delete-scripture]').forEach(b=>b.onclick=action(async()=>{if(!confirm('이 말씀을 삭제할까요?'))return;const id=b.dataset.deleteScripture,target=decade;await track(store.mutate(s=>{const d=s.decades[target];d.scriptures=editableScriptures(d).filter(x=>x.id!==id);}));renderScriptures();}));
 bindScriptureDrag($('#scriptureList'));
}
function editScripture(id=null){
 const target=decade,old=scripturesFor(state.decades[target]).find(x=>x.id===id)||{title:'',body:''};
 openEditor(id?'말씀 수정':'말씀 추가',`<label class="field">제목<input id="scriptureTitle" required value="${esc(old.title)}"></label><label class="field">본문<textarea id="scriptureInput" required>${esc(old.body)}</textarea></label>`,async()=>{
 const title=$('#scriptureTitle').value.trim(),body=$('#scriptureInput').value.trim();if(!title||!body)throw new Error('제목과 본문을 입력해 주세요.');
 const newId=id||crypto.randomUUID();await track(store.mutate(s=>{const items=editableScriptures(s.decades[target]);const found=items.find(x=>x.id===newId);if(found){found.title=title;found.body=body;}else items.push({id:newId,title,body});}));renderScriptures(newId);
 });
}
function bindScriptureDrag(list){
 let timer=null,active=null,start=null,lastY=0,raf=null,blockClick=false;
 const reorder=y=>{if(!active)return;const other=[...list.children].filter(x=>x!==active);const next=other.find(x=>{const r=x.getBoundingClientRect();return y<r.top+r.height/2;});if(next)list.insertBefore(active,next);else list.append(active);};
 const tick=()=>{if(!active)return;if(lastY<80)window.scrollBy(0,-8);else if(lastY>innerHeight-80)window.scrollBy(0,8);reorder(lastY);raf=requestAnimationFrame(tick);};
 const begin=(row,y)=>{active=row;lastY=y;blockClick=true;row.classList.add('dragging');raf=requestAnimationFrame(tick);};
 const finish=async(cancel=false)=>{clearTimeout(timer);timer=null;start=null;if(raf)cancelAnimationFrame(raf);raf=null;if(!active)return;active.classList.remove('dragging');active=null;if(cancel){renderScriptures();return;}const ids=[...list.children].map(x=>x.dataset.scriptureId),target=decade;try{await track(store.mutate(s=>{const d=s.decades[target],items=editableScriptures(d),byId=new Map(items.map(x=>[x.id,x]));d.scriptures=ids.map(id=>byId.get(id)).filter(Boolean);}));}catch{renderScriptures();}};
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
function chooseImage(){$('#imageInput').dataset.decade=String(decade);$('#imageInput').value='';$('#imageInput').click();}
$('#imageInput').onchange=action(async e=>{const f=e.target.files[0];if(!f)return;const id=Number(e.target.dataset.decade);clearError();await track(store.saveArt(id,f));store.compact().catch(error);if(tab==='mysteries'&&decade===id)render();notify('성화 저장 · 파일 내용 및 표시 검증 완료');});
async function loadArt(id,token){const a=await store.getAsset(id);if(!a?.blob)throw new Error('저장된 성화를 읽지 못했습니다. 백업 파일을 확인해 주세요.');if(token!==renderToken)return;artURL=URL.createObjectURL(a.blob);const img=document.createElement('img');img.alt=`${MYSTERIES[Math.floor(decade/5)].name} ${decade%5+1}단 성화`;img.src=artURL;img.onerror=()=>error(new Error('저장된 성화를 화면에 표시하지 못했습니다.'));$('#artDisplay').replaceChildren(img);}
function prayerAccordion(p,assigned=false){return `<article class="${assigned?'assigned-prayer':'panel prayer-card'} prayer-sortable" data-prayer="${esc(p.id)}"><details class="prayer-fold"><summary class="prayer-fold-title">${esc(p.title)}<span class="fold-chevron" aria-hidden="true">⌄</span></summary><div class="prose">${esc(p.body)}</div></details>${assigned?'':`<div class="actions"><button data-edit-prayer="${esc(p.id)}">수정</button><button data-delete-prayer="${esc(p.id)}" class="danger quiet">삭제</button></div>`}</article>`;}
function renderAssigned(){const list=$('#assignedList');list.innerHTML=state.decades[decade].prayers.map(id=>{const p=state.prayers.find(p=>p.id===id);return p?prayerAccordion(p,true):'';}).join('');bindDrag(list,'assigned');}
function scopeHTML(){return '<fieldset style="border:0;padding:0;margin:0"><legend class="muted" style="font-size:11px;margin-top:12px">적용 범위</legend><div class="scope"><label><input type="radio" name="scope" value="all" checked> 전체 20단에 적용</label><label><input type="radio" name="scope" value="one"> 이 단에만 적용</label></div></fieldset>';}
function assign(s,id,all,target){for(const [key,d] of Object.entries(s.decades))if(all||Number(key)===target)if(!d.prayers.includes(id))d.prayers.push(id);}
function renderManage(){
 const area=$('#manageArea');area.innerHTML=`<div class="manage-panel"><label class="field">기존 기도문<select id="prayerChoice"><option value="">기도문 선택</option>${state.prayers.map(p=>`<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select></label>${scopeHTML()}<div class="actions"><button id="attachPrayer" class="primary">선택한 기도문 추가</button><button id="newAssigned">새 기도문 입력</button></div><p class="drag-hint">기도문을 길게 눌러 위아래로 옮기세요. 현재 단에만 저장됩니다.</p>${state.decades[decade].prayers.map(id=>{const p=state.prayers.find(p=>p.id===id);return `<div class="manage-row"><span>${esc(p.title)}</span><div class="actions"><button data-remove="${id}" data-scope="one">이 단에서 제거</button><button data-remove="${id}" data-scope="all">20단에서 제거</button></div></div>`;}).join('')}</div>`;
 $('#attachPrayer').onclick=action(async()=>{const id=$('#prayerChoice').value;if(!id)throw new Error('추가할 기도문을 선택해 주세요.');const all=$('#manageArea input[name=scope]:checked').value==='all',target=decade;await track(store.mutate(s=>assign(s,id,all,target)));renderAssigned();renderManage();});
 $('#newAssigned').onclick=()=>editPrayer(null,true);
 $$('[data-remove]').forEach(b=>b.onclick=action(async()=>{const id=b.dataset.remove,all=b.dataset.scope==='all',target=decade;if(all&&!confirm('전체 20단에서 이 기도문을 제거할까요? 원본은 기도문 탭에 남습니다.'))return;await track(store.mutate(s=>{for(const [key,d] of Object.entries(s.decades))if(all||Number(key)===target)d.prayers=d.prayers.filter(x=>x!==id);}));renderAssigned();renderManage();}));
}
function bindDrag(list,mode='assigned'){
 let timer=null,drag=null,start=null,raf=null,lastY=0,moved=false;
 const stopScroll=()=>{if(raf)cancelAnimationFrame(raf);raf=null;};
 const reorder=y=>{if(!drag)return;const others=[...list.children].filter(x=>x!==drag);const next=others.find(x=>{const r=x.getBoundingClientRect();return y<r.top+r.height/2;});if(next)list.insertBefore(drag,next);else list.append(drag);};
 const scroll=()=>{if(!drag)return;const margin=80;if(lastY<margin)window.scrollBy(0,-8);else if(lastY>innerHeight-margin)window.scrollBy(0,8);reorder(lastY);raf=requestAnimationFrame(scroll);};
 const begin=(row,y)=>{drag=row;lastY=y;moved=true;row.classList.add('dragging');notify('위아래로 옮긴 뒤 손을 떼세요');raf=requestAnimationFrame(scroll);};
 const finish=async(cancel=false)=>{clearTimeout(timer);timer=null;start=null;stopScroll();if(!drag)return;drag.classList.remove('dragging');drag=null;
  if(cancel){if(mode==='assigned')renderAssigned();else renderPrayers();notify('이동 취소');return;}
  const ids=[...list.children].map(x=>x.dataset.prayer),target=decade;
  try{await track(store.mutate(s=>{if(mode==='library'){const byId=new Map(s.prayers.map(p=>[p.id,p]));s.prayers=ids.map(id=>byId.get(id)).filter(Boolean);}else{const current=s.decades[target].prayers;s.decades[target].prayers=[...ids.filter(id=>current.includes(id)),...current.filter(id=>!ids.includes(id))];}}));}catch{if(mode==='assigned')renderAssigned();else renderPrayers();}
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
 bindDrag($('.prayer-library'),'library');$('#newPrayer').onclick=()=>editPrayer();$$('[data-edit-prayer]').forEach(b=>b.onclick=()=>editPrayer(b.dataset.editPrayer));$$('[data-delete-prayer]').forEach(b=>b.onclick=action(async()=>{const id=b.dataset.deletePrayer;if(!confirm('기도문 원본을 삭제할까요? 배정된 모든 단에서도 제거됩니다.'))return;await track(store.mutate(s=>{s.prayers=s.prayers.filter(p=>p.id!==id);Object.values(s.decades).forEach(d=>d.prayers=d.prayers.filter(x=>x!==id));}));renderPrayers();}));
}
function openEditor(title,body,save){$('#editorTitle').textContent=title;$('#editorBody').innerHTML=body;editorAction=save;$('#editor').showModal();}
function closeEditor(){if(!$('#saveEditor').disabled)$('#editor').close();}
$('#closeEditor').onclick=closeEditor;$('#cancelEditor').onclick=closeEditor;
$('#editor').addEventListener('cancel',e=>{if($('#saveEditor').disabled)e.preventDefault();});
$('#editorForm').onsubmit=async e=>{e.preventDefault();$('#saveEditor').disabled=true;clearError();try{await editorAction();$('#editor').close();}catch(err){error(err);let message=$('#editorError');if(!message){message=document.createElement('p');message.id='editorError';message.className='notice error';message.setAttribute('role','alert');$('#editorBody').append(message);}message.textContent=explainError(err);}finally{$('#saveEditor').disabled=false;}};
function editPrayer(id=null,attach=false){
 const p=state.prayers.find(p=>p.id===id)||{title:'',body:''},target=decade;
 openEditor(id?'기도문 수정':'새 기도문',`<label class="field">제목<input id="prayerTitle" required value="${esc(p.title)}"></label><label class="field">본문<textarea id="prayerBody" required>${esc(p.body)}</textarea></label>${attach?scopeHTML():''}`,async()=>{const title=$('#prayerTitle').value.trim(),body=$('#prayerBody').value.trim();if(!title||!body)throw new Error('제목과 본문을 입력해 주세요.');const pid=id||crypto.randomUUID(),all=attach&&$('#editor input[name=scope]:checked').value==='all';await track(store.mutate(s=>{const found=s.prayers.find(p=>p.id===pid);if(found){found.title=title;found.body=body;}else s.prayers.push({id:pid,title,body});if(attach)assign(s,pid,all,target);}));if(tab==='prayers')renderPrayers();else{renderAssigned();renderManage();}});
}
async function showLightboxArt(id){
 const seq=++lightboxSequence,entry=state.decades[id];
 const previous=lightboxURL;
 // Every decade is navigable, including decades without an uploaded image.
 lightboxDecade=id;
 resetArtZoom();
 $('#lightboxPosition').textContent=`${MYSTERIES[Math.floor(id/5)].name} · ${id%5+1}단`;
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
  $('#largeArt').alt=`${MYSTERIES[Math.floor(id/5)].name} ${id%5+1}단 성화`;
  $('#largeArt').hidden=false;
 }catch(e){if(seq===lightboxSequence)error(e);}
}
function advanceArt(step){showLightboxArt((lightboxDecade+step+20)%20);}
// Image gestures: pinch to zoom, drag while zoomed, swipe between artworks at 1x.
let artScale=1,artX=0,artY=0,pinchStart=null,dragStart=null,lastArtTap=0;
const largeArt=$('#largeArt');
function renderArtZoom(){largeArt.style.transform=`translate(${artX}px, ${artY}px) scale(${artScale})`;largeArt.classList.toggle('zoomed',artScale>1.01);}
function resetArtZoom(){artScale=1;artX=0;artY=0;pinchStart=null;dragStart=null;lightboxTouch=null;renderArtZoom();}
function touchDistance(a,b){return Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);}
function touchMid(a,b){return {x:(a.clientX+b.clientX)/2,y:(a.clientY+b.clientY)/2};}
$('#lightbox').addEventListener('touchstart',e=>{
 if(e.target.closest('button'))return;
 if(e.touches.length===2){
  const mid=touchMid(e.touches[0],e.touches[1]);
  pinchStart={distance:touchDistance(e.touches[0],e.touches[1]),scale:artScale,x:artX,y:artY,mid};
  lightboxTouch=null;dragStart=null;
 }else if(e.touches.length===1){
  const t=e.touches[0];lightboxTouch={x:t.clientX,y:t.clientY};
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
 if(!pinchStart&&artScale<=1.01&&lightboxTouch&&e.changedTouches.length===1){
  const dx=e.changedTouches[0].clientX-lightboxTouch.x,dy=e.changedTouches[0].clientY-lightboxTouch.y;
  if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.2){advanceArt(dx<0?1:-1);lastArtTap=0;}
  else if(Math.abs(dx)<18&&Math.abs(dy)<18){
   const now=Date.now();if(now-lastArtTap<330){artScale=2.5;artX=0;artY=0;renderArtZoom();lastArtTap=0;}else lastArtTap=now;
  }
 }
 pinchStart=null;dragStart=null;lightboxTouch=null;
},{passive:true});
$('#lightbox').addEventListener('touchcancel',()=>{pinchStart=null;dragStart=null;lightboxTouch=null;});
$('#lightbox').addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){e.preventDefault();advanceArt(-1);}if(e.key==='ArrowRight'){e.preventDefault();advanceArt(1);}});
$('#closeLightbox').onclick=()=>$('#lightbox').close();
$('#lightbox').addEventListener('close',()=>{const target=lightboxDecade;lightboxSequence++;$('#largeArt').removeAttribute('src');if(lightboxURL)URL.revokeObjectURL(lightboxURL);lightboxURL=null;resetArtZoom();lastArtTap=0;if(tab==='mysteries'&&decade!==target){decade=target;manage=false;render();window.scrollTo(0,0);}syncWakeLock();});
$('#lightbox').addEventListener('cancel',()=>{lightboxTouch=null;});
$('#lightbox').addEventListener('click',e=>{if(e.target===$('#lightbox'))$('#lightbox').close();});
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
$('#export').onclick=action(async()=>{await flush();const b=await store.backup();download(new Blob([JSON.stringify(b)],{type:'application/json'}),`묵주기도_백업_${localDate()}.json`);notify('성화가 포함된 백업 파일을 내보냈습니다');});
$('#import').onclick=()=>{$('#backupInput').value='';$('#backupInput').click();};
$('#backupInput').onchange=action(async e=>{const file=e.target.files[0];if(!file)return;await flush();if(file.size>180*1024*1024)throw new Error('백업 파일이 180MB를 초과합니다.');notify('백업 파일과 성화 내용을 검사하는 중…');const prepared=await parseBackup(await file.text());const s=prepared.state;if(!confirm(`파일 검사 완료\n기록 ${Object.keys(s.records).length}개 · 기도문 ${s.prayers.length}개 · 성화 ${prepared.assets.length}개\n\n현재 데이터를 이 백업 내용으로 덮어쓸까요? 현재 데이터가 필요하면 먼저 백업하세요.`)){notify('복원을 취소했습니다');return;}await track(store.restore(prepared));store.compact().catch(error);clearError();render();notify('백업 복원 · 재조회 검증 완료');});
async function storageInfo(){const e=await navigator.storage?.estimate?.(),p=await navigator.storage?.persisted?.();$('#storageInfo').textContent=`저장 보호 ${p?'허용됨':'미허용'}${e?.quota?` · 사용량 ${(e.usage/1024/1024).toFixed(1)}MB / 약 ${(e.quota/1024/1024).toFixed(0)}MB`:''}`;}
$('#persist').onclick=action(async()=>{const p=await navigator.storage?.persist?.();notify(p?'브라우저의 자동 정리로부터 저장소가 보호됩니다':'브라우저가 보호 요청을 허용하지 않았습니다. 백업 파일을 정기적으로 보관해 주세요.');await storageInfo();});
$('#dataTools').addEventListener('toggle',()=>{if($('#dataTools').open)storageInfo().catch(error);});
function connection(){$('#connection').textContent=navigator.onLine?'기기 안에 보관':'오프라인';}addEventListener('online',connection);addEventListener('offline',connection);connection();
let registration;
async function setupPWA(){if(!('serviceWorker' in navigator))return;registration=await navigator.serviceWorker.getRegistration('./');if(!registration||registration.scope!==new URL('./',location.href).href)registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
 const show=w=>{waitingWorker=w;$('#update').hidden=false;};if(registration.waiting)show(registration.waiting);
 registration.addEventListener('updatefound',()=>{const w=registration.installing;w.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller)show(w);});});
 if(navigator.onLine)registration.update().catch(()=>{});
}
$('#applyUpdate').onclick=action(async()=>{await flush();if($('#editor').open)throw new Error('열려 있는 입력창을 저장하거나 닫은 뒤 업데이트해 주세요.');if(waitingWorker)waitingWorker.postMessage({type:'SKIP_WAITING'});});
let reloading=false;navigator.serviceWorker?.addEventListener('controllerchange',()=>{if(waitingWorker&&!reloading){reloading=true;location.reload();}});
$('#checkUpdate').onclick=action(async()=>{if(!navigator.onLine)throw new Error('업데이트 확인에는 인터넷 연결이 필요합니다.');if(!registration)await setupPWA();await registration?.update();notify(registration?.waiting?'새 버전이 준비되었습니다':'업데이트 확인을 요청했습니다');});
addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvent=e;$('#install').hidden=false;});$('#install').onclick=action(async()=>{await installEvent?.prompt();installEvent=null;$('#install').hidden=true;});
// Reload fresh state on return from another tab without replacing active text fields.
addEventListener('focus',()=>{if(!saveCount&&!unsaved&&!$('#editor').open&&!(tab==='calendar'&&document.activeElement?.closest('#recordForm'))){store.readState().then(s=>{if(s.revision!==state.revision){state=s;render();}}).catch(error);}});
try{await store.open();state=await store.readState();render();notify('기록을 불러왔습니다');setupPWA().catch(e=>{notify('오프라인 준비 실패 · 연결 상태를 확인해 주세요');error(e);});}catch(e){error(e);$('#main').innerHTML='<section class="panel"><h2>저장소를 열지 못했습니다</h2><p class="muted">위의 오류를 확인하고 일반 Chrome 창에서 다시 열어 주세요. 기존 데이터는 삭제하지 않습니다.</p><button onclick="location.reload()">다시 시도</button></section>';}
