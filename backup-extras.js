// Full user-data backup extension. Version-1 prayer backups remain importable.
const APPEARANCE_KEY='rosary-appearance-v1';
const MUSIC_DB='rosary-prayer-music-v1';
const MAX_AUDIO_BYTES=500*1024*1024;
function req(q){return new Promise((resolve,reject)=>{q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})}
function open(name,version,upgrade){return new Promise((resolve,reject)=>{const q=indexedDB.open(name,version);q.onupgradeneeded=()=>upgrade?.(q.result);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);q.onblocked=()=>reject(new Error('다른 창에서 저장소를 사용하고 있습니다.'))})}
function readAll(db,store){if(!db.objectStoreNames.contains(store))return Promise.resolve([]);return req(db.transaction(store).objectStore(store).getAll())}
function toBase64(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(r.error);r.onload=()=>resolve(String(r.result).split(',')[1]);r.readAsDataURL(blob)})}
function fromBase64(data,type){if(typeof data!=='string'||!data.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw Error('파일 인코딩이 올바르지 않습니다.');const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));return new Blob([bytes],{type})}
async function digest(blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('')}
export async function collectExtras(){
 const appearance=JSON.parse(localStorage.getItem(APPEARANCE_KEY)||'null');
 const logoDB=await open('rosary-appearance-assets',1,db=>{if(!db.objectStoreNames.contains('images'))db.createObjectStore('images')});
 let logo=null;try{const b=await req(logoDB.transaction('images').objectStore('images').get('logo'));if(b){logo={type:b.type,data:await toBase64(b),hash:await digest(b)}}}finally{logoDB.close()}
 const db=await open(MUSIC_DB,1,db=>{if(!db.objectStoreNames.contains('lists'))db.createObjectStore('lists',{keyPath:'id'});if(!db.objectStoreNames.contains('tracks'))db.createObjectStore('tracks',{keyPath:'id'})});
 try{const lists=await readAll(db,'lists'),tracks=await readAll(db,'tracks');let total=0;const packed=[];
  for(const t of tracks){if(!(t.blob instanceof Blob))throw Error('음악 파일이 누락되었습니다: '+t.name);total+=t.blob.size;if(total>MAX_AUDIO_BYTES)throw Error('음악 파일이 500MB를 초과합니다. 파일을 줄인 뒤 백업해 주세요.');const {blob,...meta}=t;packed.push({...meta,file:{type:blob.type,data:await toBase64(blob),hash:await digest(blob)}})}
  return {appearance,logo,music:{lists,tracks:packed}};
 }finally{db.close()}
}
export async function validateExtras(extras){
 if(!extras||typeof extras!=='object')throw Error('추가 백업 데이터가 없습니다.');
 const {appearance,logo,music}=extras;
 if(appearance!==null&&(typeof appearance!=='object'||Array.isArray(appearance)))throw Error('꾸미기 설정이 잘못되었습니다.');
 let logoBlob=null;
 if(logo!==null){if(!logo||!['image/png','image/jpeg','image/webp'].includes(logo.type))throw Error('로고 형식 오류');logoBlob=fromBase64(logo.data,logo.type);if(logoBlob.size>15*1024*1024||await digest(logoBlob)!==logo.hash)throw Error('로고 데이터 손상')}
 if(!music||!Array.isArray(music.lists)||!Array.isArray(music.tracks))throw Error('음악 목록 형식 오류');
 const listIds=new Set();for(const l of music.lists){if(!l||typeof l.id!=='string'||typeof l.name!=='string'||listIds.has(l.id))throw Error('음악 목록 오류');listIds.add(l.id)}
 const trackIds=new Set(),tracks=[];let total=0;
 for(const t of music.tracks){if(!t||typeof t.id!=='string'||trackIds.has(t.id)||!listIds.has(t.listId)||typeof t.name!=='string'||!t.file||typeof t.file.type!=='string')throw Error('음악 정보 오류');trackIds.add(t.id);const blob=fromBase64(t.file.data,t.file.type);total+=blob.size;if(total>MAX_AUDIO_BYTES||await digest(blob)!==t.file.hash)throw Error('음악 파일 손상 또는 용량 초과');const {file,...meta}=t;tracks.push({...meta,blob})}
 return {appearance,logoBlob,lists:music.lists,tracks};
}
function replaceMusic(db,lists,tracks){return new Promise((resolve,reject)=>{const tx=db.transaction(['lists','tracks'],'readwrite');tx.objectStore('lists').clear();tx.objectStore('tracks').clear();for(const l of lists)tx.objectStore('lists').put(l);for(const t of tracks)tx.objectStore('tracks').put(t);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('음악 복원 실패'))})}
export async function restoreExtras(prepared){
 const db=await open(MUSIC_DB,1,d=>{if(!d.objectStoreNames.contains('lists'))d.createObjectStore('lists',{keyPath:'id'});if(!d.objectStoreNames.contains('tracks'))d.createObjectStore('tracks',{keyPath:'id'})});
 try{await replaceMusic(db,prepared.lists,prepared.tracks)}finally{db.close()}
 const logoDB=await open('rosary-appearance-assets',1,d=>{if(!d.objectStoreNames.contains('images'))d.createObjectStore('images')});
 try{await new Promise((resolve,reject)=>{const tx=logoDB.transaction('images','readwrite');if(prepared.logoBlob)tx.objectStore('images').put(prepared.logoBlob,'logo');else tx.objectStore('images').delete('logo');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}finally{logoDB.close()}
 if(prepared.appearance===null)localStorage.removeItem(APPEARANCE_KEY);else localStorage.setItem(APPEARANCE_KEY,JSON.stringify(prepared.appearance));
}
