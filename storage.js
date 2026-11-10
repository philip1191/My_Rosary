/* Stable database schema. UI/cache releases must never change this name. */
export const DB_NAME = 'rosary-personal-book-v1';
export const DECADES = Array.from({length:20},(_,i)=>String(i));
export const blankState = () => ({schema:1,revision:0,records:{},prayers:[],decades:Object.fromEntries(DECADES.map(id=>[id,{scripture:'',prayers:[],art:null}]))});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const str=x=>typeof x==='string'&&x.length<=1000000;
const idOK=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(x);
function check(ok,message){if(!ok)throw new Error('형식 오류: '+message);}
export function validateState(s){
 check(object(s)&&s.schema===1&&Number.isSafeInteger(s.revision)&&s.revision>=0,'지원하지 않는 데이터 버전');
 check(object(s.records)&&Array.isArray(s.prayers)&&object(s.decades),'필수 항목 누락');
 check(s.prayers.length<=10000&&Object.keys(s.records).length<=100000,'항목 수 초과');
 const ids=new Set();
 for(const p of s.prayers){check(object(p)&&idOK(p.id)&&!ids.has(p.id)&&str(p.title)&&p.title.trim()&&str(p.body)&&p.body.trim(),'기도문');ids.add(p.id);}
 for(const [date,r] of Object.entries(s.records)){
  check(/^\d{4}-\d{2}-\d{2}$/.test(date)&&!isNaN(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date,'날짜');
  check(object(r)&&Number.isSafeInteger(r.count)&&r.count>=0&&r.count<=999999&&str(r.intention)&&str(r.memo)&&(r.mystery===undefined||(Number.isInteger(r.mystery)&&r.mystery>=0&&r.mystery<4))&&(r.mysteries===undefined||(Array.isArray(r.mysteries)&&r.mysteries.length===4&&r.mysteries.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=999999)&&r.mysteries.reduce((a,b)=>a+b,0)===r.count)),'달력 기록');
 }
 check(Object.keys(s.decades).length===20,'20단 구성');
 for(const id of DECADES){const d=s.decades[id];check(object(d)&&str(d.scripture)&&(d.scriptureTitle===undefined||str(d.scriptureTitle))&&(d.scriptures===undefined||(Array.isArray(d.scriptures)&&d.scriptures.length<=500&&d.scriptures.every(x=>object(x)&&idOK(x.id)&&str(x.title)&&x.title.trim()&&str(x.body)&&x.body.trim())&&new Set(d.scriptures.map(x=>x.id)).size===d.scriptures.length))&&(d.sectionOrder===undefined||(['art','prayers'].includes(d.sectionOrder)))&&Array.isArray(d.prayers)&&d.prayers.every(x=>ids.has(x))&&new Set(d.prayers).size===d.prayers.length&&(d.art===null||idOK(d.art)),'단별 데이터');}
 return s;
}
export async function hashBlob(blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function decodeImage(blob){
 const url=URL.createObjectURL(blob);try{const img=new Image();img.src=url;await img.decode();check(img.naturalWidth>0&&img.naturalHeight>0,'이미지를 해석할 수 없습니다');return img;}finally{URL.revokeObjectURL(url);}
}
export async function prepareImage(file){
 check(file instanceof Blob&&file.size>0,'비어 있는 사진');
 check(file.size<=50*1024*1024,'사진은 50MB 이하로 선택해 주세요');
 const img=await decodeImage(file);const w=img.naturalWidth,h=img.naturalHeight;
 check(w*h<=80000000,'사진 해상도가 너무 큽니다. 갤러리에서 크기를 줄여 주세요');
 if(Math.max(w,h)<=1600&&file.size<=1024*1024&&['image/jpeg','image/png','image/webp'].includes(file.type))return new Blob([file],{type:file.type});
 const ratio=Math.min(1,1600/Math.max(w,h));const c=document.createElement('canvas');c.width=Math.round(w*ratio);c.height=Math.round(h*ratio);
 const ctx=c.getContext('2d');check(ctx,'이미지 변환을 시작할 수 없습니다');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);
 const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.86));check(blob&&blob.size,'사진 압축 실패');return blob;
}
export function explainError(e){
 const reasons={QuotaExceededError:'기기 저장 공간이 부족합니다. 다른 파일을 정리하거나 더 작은 사진을 선택해 주세요. 기존 기도 데이터는 지우지 마세요.',SecurityError:'이 브라우저에서 저장소 접근이 차단되었습니다. 일반 Chrome 창의 HTTPS 주소에서 열어 주세요.',InvalidStateError:'저장소 연결이 닫혔습니다. 입력 내용을 복사해 두고 앱을 다시 열어 주세요.',VersionError:'더 최신 앱에서 만든 데이터입니다. 앱을 업데이트해 주세요.',AbortError:'저장이 중단되었습니다. 기존 데이터를 유지하며 다시 시도할 수 있습니다.',UnknownError:'기기 저장소 오류입니다. 저장 공간과 브라우저 상태를 확인해 주세요.'};
 return (reasons[e?.name]||e?.message||'알 수 없는 저장 오류')+(e?.name&&e.name!=='Error'?` (${e.name})`:'');
}
export class PrayerStore {
 constructor(name=DB_NAME){this.name=name;this.db=null;this.queue=Promise.resolve();}
 async open(){
  if(this.db)return this;
  this.db=await new Promise((resolve,reject)=>{const q=indexedDB.open(this.name,1);let blocked=false;
   q.onupgradeneeded=()=>{const db=q.result;for(const name of ['state','assets'])if(!db.objectStoreNames.contains(name))db.createObjectStore(name);};
   q.onblocked=()=>{blocked=true;reject(new Error('다른 창에서 앱을 닫은 뒤 다시 시도해 주세요. 데이터는 삭제하지 않습니다.'));};
   q.onerror=()=>reject(q.error);q.onsuccess=()=>{if(blocked){q.result.close();return;}resolve(q.result);};
  });
  this.db.onversionchange=()=>{this.db.close();this.db=null;};return this;
 }
 close(){this.db?.close();this.db=null;}
 async transaction(stores,mode,work){
  await this.open();return new Promise((resolve,reject)=>{
   let tx,result,customError;try{tx=this.db.transaction(stores,mode,mode==='readwrite'?{durability:'strict'}:undefined);}catch(e){reject(e);return;}
   const fail=e=>{customError=e;try{tx.abort();}catch{reject(e);}};
   tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(customError||tx.error||new DOMException('저장이 중단되었습니다','AbortError'));tx.onerror=()=>{};
   try{work(tx,x=>{result=x;},fail);}catch(e){fail(e);}
  });
 }
 async readState(){const state=await this.transaction(['state'],'readonly',(tx,set)=>{const q=tx.objectStore('state').get('current');q.onsuccess=()=>set(q.result||blankState());});return validateState(state);}
 async getAsset(id){return this.transaction(['assets'],'readonly',(tx,set)=>{const q=tx.objectStore('assets').get(id);q.onsuccess=()=>set(q.result);});}
 exclusive(fn){const run=()=>navigator.locks?navigator.locks.request(this.name,fn):fn();const p=this.queue.then(run);this.queue=p.catch(()=>{});return p;}
 async commit(change){
  const saved=await this.transaction(['state'],'readwrite',(tx,set,fail)=>{
   const store=tx.objectStore('state'),q=store.get('current');q.onsuccess=()=>{try{
    const before=q.result||blankState(),next=structuredClone(before);change(next);next.revision=before.revision+1;validateState(next);
    store.put(before,'previous');store.put(next,'current');const verify=store.get('current');verify.onsuccess=()=>{if(!same(next,verify.result))fail(new Error('저장 검증 실패'));else set(next);};
   }catch(e){fail(e);}};
  });
  // A second transaction proves a committed read, not merely a successful put request.
  const actual=await this.readState();
  if(actual.revision===saved.revision&&!same(actual,saved))throw new Error('저장 후 재조회 결과가 다릅니다. 이전 버전은 보존되어 있습니다.');
  if(actual.revision<saved.revision)throw new Error('저장 후 재조회 검증에 실패했습니다.');
  return actual;
 }
 mutate(change){return this.exclusive(()=>this.commit(change));}
 async writeAsset(asset){
  await this.transaction(['assets'],'readwrite',tx=>tx.objectStore('assets').put(asset,asset.id));
  const stored=await this.getAsset(asset.id);
  check(stored?.blob instanceof Blob&&stored.blob.size===asset.blob.size&&await hashBlob(stored.blob)===asset.hash,'성화 저장 후 파일 내용 검증 실패');
  await decodeImage(stored.blob);return stored;
 }
 async saveArt(decade,file){
  check(DECADES.includes(String(decade)),'신비 번호');
  // Decode/compress/hash BEFORE opening any IndexedDB write transaction.
  const blob=await prepareImage(file),asset={id:crypto.randomUUID(),blob,hash:await hashBlob(blob)};
  const estimate=await navigator.storage?.estimate?.();
  if(estimate?.quota&&estimate.quota-estimate.usage<blob.size*1.1)throw new DOMException('저장 공간 부족','QuotaExceededError');
  return this.exclusive(async()=>{await this.writeAsset(asset);return this.commit(s=>{s.decades[decade].art=asset.id;});});
 }
 async backup(){return this.exclusive(async()=>{
  const s=await this.readState(),assets=[];
  for(const id of new Set(Object.values(s.decades).map(d=>d.art).filter(Boolean))){const a=await this.getAsset(id);check(a?.blob instanceof Blob,'누락된 성화');check(await hashBlob(a.blob)===a.hash,'손상된 성화');const data=await new Promise((resolve,reject)=>{const f=new FileReader();f.onerror=()=>reject(f.error);f.onload=()=>resolve(f.result.split(',')[1]);f.readAsDataURL(a.blob);});assets.push({id,type:a.blob.type,hash:a.hash,data});}
  return {format:'rosary-personal-book',version:1,createdAt:new Date().toISOString(),state:s,assets};
 });}
 async restore(prepared){return this.exclusive(async()=>{
  // New asset keys avoid overwriting any existing image, even for imported key collisions.
  const next=structuredClone(prepared.state),mapping=new Map();
  for(const a of prepared.assets){const newId=crypto.randomUUID();await this.writeAsset({...a,id:newId});mapping.set(a.id,newId);}
  for(const d of Object.values(next.decades))if(d.art)d.art=mapping.get(d.art);
  return this.commit(s=>{s.records=next.records;s.prayers=next.prayers;s.decades=next.decades;});
 });}
 // Explicit maintenance only removes unreachable staged/old blobs. Preserve the prior snapshot too.
 async compact(){return this.exclusive(()=>this.transaction(['state','assets'],'readwrite',(tx,set)=>{
  const q=tx.objectStore('state').getAll();q.onsuccess=()=>{const keep=new Set(q.result.flatMap(s=>Object.values(s.decades).map(d=>d.art).filter(Boolean)));const c=tx.objectStore('assets').openCursor();c.onsuccess=()=>{const cur=c.result;if(cur){if(!keep.has(cur.key))cur.delete();cur.continue();}};};
 }));}
}
export async function parseBackup(text){
 let b;try{b=JSON.parse(text);}catch{throw new Error('JSON 파일을 읽을 수 없습니다.');}
 check(object(b)&&b.format==='rosary-personal-book'&&b.version===1&&Array.isArray(b.assets),'이 앱에서 만든 백업이 아닙니다');validateState(b.state);
 check(b.assets.length<=20,'성화 개수');const ids=new Set(),assets=[];
 for(const a of b.assets){
  check(object(a)&&idOK(a.id)&&!ids.has(a.id)&&['image/jpeg','image/png','image/webp'].includes(a.type)&&typeof a.data==='string'&&a.data.length<=12000000&&/^[A-Za-z0-9+/]*={0,2}$/.test(a.data)&&/^[a-f0-9]{64}$/.test(a.hash),'성화 형식');
  ids.add(a.id);let bytes;try{bytes=Uint8Array.from(atob(a.data),c=>c.charCodeAt(0));}catch{throw new Error('성화 인코딩 오류');}
  const blob=new Blob([bytes],{type:a.type});check(blob.size&&await hashBlob(blob)===a.hash,'성화 내용 또는 체크섬 오류');await decodeImage(blob);assets.push({id:a.id,hash:a.hash,blob});
 }
 const used=new Set(Object.values(b.state.decades).map(d=>d.art).filter(Boolean));check([...used].every(id=>ids.has(id))&&used.size===ids.size,'성화 참조 누락 또는 불필요한 성화');
 return {state:b.state,assets};
}
