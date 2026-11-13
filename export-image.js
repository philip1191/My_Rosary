// Prayer-record image export. Reads registered artwork without changing prayer data.
// Saved layouts are keyed by mystery and artwork asset IDs, so replacing one painting
// restores only that painting's default cover framing.
export const EXPORT_IMAGE_PREFS_KEY='my-rosary-image-export-v1';
const W=1080,H=1360;
const FRAMES=[{x:50,y:205,w:300,h:390},{x:390,y:205,w:300,h:390},{x:730,y:205,w:300,h:390},{x:220,y:635,w:300,h:390},{x:560,y:635,w:300,h:390}];
const INITIAL=()=>({zoom:1,dx:0,dy:0});
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function savedPrefs(){try{const s=JSON.parse(localStorage.getItem(EXPORT_IMAGE_PREFS_KEY)||'null');return s&&typeof s==='object'&&!Array.isArray(s)?s:{}}catch{return {}}}
function imageFromURL(src){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('이미지를 읽을 수 없습니다.'));im.src=src;});}
function filenameDate(date){return /^\d{4}-\d{2}-\d{2}$/.test(date)?date:'기도기록';}
function wrapLines(ctx,text,maxWidth,maxLines=3){
 const lines=[];let row='';
 for(const ch of Array.from(text)){
  if(ch==='\n'){lines.push(row);row='';if(lines.length>=maxLines)break;continue;}
  if(ctx.measureText(row+ch).width>maxWidth&&row){lines.push(row);row=ch;if(lines.length>=maxLines)break;}
  else row+=ch;
 }
 if(lines.length<maxLines&&row)lines.push(row);
 return lines;
}
export function createPrayerImageExporter({getAsset,logoSource}){
 const dialog=document.querySelector('#prayerImageExportDialog');
 const canvas=document.querySelector('#prayerImageCanvas');
 const ctx=canvas.getContext('2d');
 const status=document.querySelector('#prayerImageStatus');
 const messageInput=document.querySelector('#prayerImageMessage');
 const zoomInput=document.querySelector('#prayerImageZoom');
 const saveArt=document.querySelector('#prayerImageSaveArt');
 const saveMessage=document.querySelector('#prayerImageSaveMessage');
 const artLabel=document.querySelector('#prayerImageSelectedArt');
 const drawArea=document.querySelector('#prayerImagePreviewArea');
 let session=null,selectedFrame=0,pointers=new Map(),gesture=null;
 let imageURLs=[];
 function resetAssets(){imageURLs.forEach(url=>URL.revokeObjectURL(url));imageURLs=[];}
 function say(text){status.textContent=text||'';}
 function paint(exporting=false){
  if(!session)return;
  const {group,count,images,transforms,logo,message}=session;
  ctx.clearRect(0,0,W,H);ctx.fillStyle='#F6F1E9';ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#423A34';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font='700 70px system-ui, "Noto Sans KR", sans-serif';
  ctx.fillText(`${group.name} ${count}단`,W/2,118,W-96);
  FRAMES.forEach((frame,i)=>{
   const img=images[i],t=transforms[i];
   ctx.save();ctx.beginPath();ctx.rect(frame.x,frame.y,frame.w,frame.h);ctx.clip();
   ctx.fillStyle='#E8DFD3';ctx.fillRect(frame.x,frame.y,frame.w,frame.h);
   if(img){
    const base=Math.max(frame.w/img.naturalWidth,frame.h/img.naturalHeight);
    const width=img.naturalWidth*base*t.zoom,height=img.naturalHeight*base*t.zoom;
    const left=frame.x+(frame.w-width)/2+t.dx*frame.w;
    const top=frame.y+(frame.h-height)/2+t.dy*frame.h;
    ctx.drawImage(img,left,top,width,height);
   }else{
    ctx.fillStyle='#978775';ctx.textAlign='center';ctx.font='500 31px system-ui, sans-serif';
    ctx.fillText('성화 미등록',frame.x+frame.w/2,frame.y+frame.h/2);
   }
   ctx.restore();
   ctx.strokeStyle='#C8BCAA';ctx.lineWidth=3;ctx.strokeRect(frame.x,frame.y,frame.w,frame.h);
   if(!exporting&&selectedFrame===i){ctx.strokeStyle='#2D8265';ctx.lineWidth=7;ctx.strokeRect(frame.x+4,frame.y+4,frame.w-8,frame.h-8);}
  });
  const text=message.trim();
  ctx.font='500 36px system-ui, "Noto Sans KR", sans-serif';
  const lines=text?wrapLines(ctx,text,770,3):[];
  const widest=lines.length?Math.max(...lines.map(line=>ctx.measureText(line).width)):0;
  const logoSide=92,spacing=text?24:0,groupWidth=logoSide+spacing+widest;
  const xStart=(W-groupWidth)/2;
  const logoTop=1130;
  if(logo){const ratio=Math.min(logoSide/logo.naturalWidth,logoSide/logo.naturalHeight);const iw=logo.naturalWidth*ratio,ih=logo.naturalHeight*ratio;ctx.drawImage(logo,xStart+(logoSide-iw)/2,logoTop+(logoSide-ih)/2,iw,ih);}
  else{ctx.fillStyle='#A28E74';ctx.font='40px system-ui';ctx.textAlign='center';ctx.fillText('✝',xStart+logoSide/2,logoTop+logoSide/2);}
  if(lines.length){ctx.fillStyle='#55493E';ctx.textAlign='left';ctx.textBaseline='middle';const lineH=45,totalH=lines.length*lineH;const textY=logoTop+logoSide/2-totalH/2+lineH/2;lines.forEach((line,i)=>ctx.fillText(line,xStart+logoSide+spacing,textY+i*lineH));}
 }
 function commitSettings(){
  if(!session)return;
  if(!saveArt.checked&&!saveMessage.checked)return;
  const settings=savedPrefs();
  if(saveArt.checked){
   if(!settings.art||typeof settings.art!=='object')settings.art={};
   settings.art[session.groupIndex]={ids:session.ids.slice(),transforms:session.transforms.map(t=>({...t}))};
  }
  if(saveMessage.checked)settings.message=session.message;
  try{localStorage.setItem(EXPORT_IMAGE_PREFS_KEY,JSON.stringify(settings));}
  catch(e){say('설정 저장에 실패했습니다. 기기 저장 공간을 확인해 주세요.');}
 }
 function updateSelection(){artLabel.textContent=`${selectedFrame+1}단 성화${session.images[selectedFrame]?'':' (미등록)'}`;zoomInput.value=String(session.transforms[selectedFrame].zoom);paint();}
 async function open({date,groupIndex,count,group,artIds}){
  if(dialog.open)dialog.close();
  resetAssets();say('성화를 불러오는 중…');
  selectedFrame=0;pointers.clear();gesture=null;
  const pref=savedPrefs(),groupPref=pref.art?.[groupIndex];
  const storedTransforms=groupPref?.transforms;
  const transforms=artIds.map((id,i)=>{
   const ok=id&&groupPref?.ids?.[i]===id&&storedTransforms?.[i];
   const p=ok?storedTransforms[i]:null;
   return p&&Number.isFinite(p.zoom)&&Number.isFinite(p.dx)&&Number.isFinite(p.dy)?{zoom:clamp(p.zoom,.35,4),dx:clamp(p.dx,-3,3),dy:clamp(p.dy,-3,3)}:INITIAL();
  });
  session={date,groupIndex,count,group,ids:artIds.slice(),images:Array(5).fill(null),transforms,logo:null,message:typeof pref.message==='string'?pref.message.slice(0,60):''};
  messageInput.value=session.message;
  saveArt.checked=true;saveMessage.checked=true;
  document.querySelector('#prayerImageExportHeading').textContent=`${group.name} ${count}단 내보내기`;
  dialog.showModal();updateSelection();
  const currentSession=session;
  try{
   const images=await Promise.all(artIds.map(async(id,i)=>{
    if(!id)return null;
    const asset=await getAsset(id);
    if(!asset?.blob)throw new Error(`${i+1}단 성화를 저장소에서 읽지 못했습니다.`);
    const url=URL.createObjectURL(asset.blob);imageURLs.push(url);
    return imageFromURL(url);
   }));
   const logoSrc=logoSource();
   let logo=null;
   try{logo=await imageFromURL(logoSrc);}catch{logo=await imageFromURL(new URL('./default-header-logo.png',import.meta.url).href);}
   if(currentSession!==session)return;
   session.images=images;session.logo=logo;paint();say('그림을 터치해 선택한 뒤 끌어서 이동하거나 두 손가락으로 확대·축소하세요.');
  }catch(e){say(`성화를 불러오지 못했습니다: ${e.message}`);}
 }
 function canvasPoint(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*W/r.width,y:(e.clientY-r.top)*H/r.height};}
 function frameAt(p){return FRAMES.findIndex(f=>p.x>=f.x&&p.x<=f.x+f.w&&p.y>=f.y&&p.y<=f.y+f.h);}
 canvas.addEventListener('pointerdown',e=>{
  if(!session)return;
  const point=canvasPoint(e);const hit=frameAt(point);
  if(hit<0)return;
  if(pointers.size===0){selectedFrame=hit;updateSelection();}
  else if(hit!==selectedFrame)return;
  pointers.set(e.pointerId,point);canvas.setPointerCapture(e.pointerId);
  if(pointers.size===2){const p=[...pointers.values()];gesture={distance:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),zoom:session.transforms[selectedFrame].zoom};}
  e.preventDefault();
 });
 canvas.addEventListener('pointermove',e=>{
  if(!session||!pointers.has(e.pointerId))return;
  const old=pointers.get(e.pointerId),point=canvasPoint(e),t=session.transforms[selectedFrame],f=FRAMES[selectedFrame];
  pointers.set(e.pointerId,point);
  if(pointers.size>=2){
   const p=[...pointers.values()];
   if(!gesture)gesture={distance:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),zoom:t.zoom};
   const distance=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
   if(gesture.distance>0)t.zoom=clamp(gesture.zoom*distance/gesture.distance,.35,4);
   zoomInput.value=String(t.zoom);
  }else{
   t.dx=clamp(t.dx+(point.x-old.x)/f.w,-3,3);
   t.dy=clamp(t.dy+(point.y-old.y)/f.h,-3,3);
  }
  paint();e.preventDefault();
 });
 const end=e=>{pointers.delete(e.pointerId);if(pointers.size<2)gesture=null;};
 canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
 zoomInput.addEventListener('input',()=>{if(!session)return;session.transforms[selectedFrame].zoom=Number(zoomInput.value);paint();});
 document.querySelector('#prayerImageResetArt').addEventListener('click',()=>{if(!session)return;session.transforms[selectedFrame]=INITIAL();updateSelection();});
 messageInput.addEventListener('input',()=>{if(!session)return;session.message=messageInput.value;paint();});
 async function makeBlob(){
  if(!session)throw new Error('내보낼 기록이 없습니다.');
  if(session.ids.some((id,i)=>id&&!session.images[i]))throw new Error('성화를 모두 불러온 뒤 다시 시도해 주세요.');
  paint(true);
  try{return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('이미지 생성에 실패했습니다.')),'image/png'));}
  finally{paint();}
 }
 function fileName(){return `${session.group.name.replace(/\s+/g,'_')}_${session.count}단_${filenameDate(session.date)}.png`;}
 async function download(){
  const b=await makeBlob();commitSettings();
  const url=URL.createObjectURL(b),a=document.createElement('a');a.href=url;a.download=fileName();document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  say('PNG 이미지를 내려받았습니다.');
 }
 async function share(){
  const blob=await makeBlob();commitSettings();
  const file=new File([blob],fileName(),{type:'image/png'});
  if(navigator.share&&navigator.canShare?.({files:[file]})){
   try{await navigator.share({files:[file]});say('공유 화면을 열었습니다.');}
   catch(e){if(e.name!=='AbortError')throw e;}
  }else say('이 브라우저에서는 이미지 파일 공유를 지원하지 않습니다. 내려받기를 이용해 주세요.');
 }
 document.querySelector('#prayerImageDownload').addEventListener('click',async()=>{try{await download()}catch(e){say(e.message)}});
 document.querySelector('#prayerImageShare').addEventListener('click',async()=>{try{await share()}catch(e){say(`공유 실패: ${e.message}`)}});
 document.querySelector('#prayerImageClose').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('close',()=>{commitSettings();session=null;resetAssets();pointers.clear();gesture=null;say('');});
 return {open};
}
