// Local-only rosary notification preferences. No audio assets or network calls.
const KEY='rosary-bead-alerts-v1';
const DEFAULT={vibration:true,sound:false,soundType:'water'};
function load(){try{const value=JSON.parse(localStorage.getItem(KEY)||'{}');return {...DEFAULT,...value}}catch{return {...DEFAULT}}}
let prefs=load();
let audioContext=null;
function audio(){const C=window.AudioContext||window.webkitAudioContext;if(!C)return null;try{audioContext??=new C();if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});return audioContext}catch{return null}}
function tone(ctx,{frequency,start,duration,volume,kind='sine',endFrequency}){
 const oscillator=ctx.createOscillator(),gain=ctx.createGain();oscillator.type=kind;oscillator.frequency.setValueAtTime(frequency,start);
 if(endFrequency)oscillator.frequency.exponentialRampToValueAtTime(endFrequency,start+duration);
 gain.gain.setValueAtTime(0.0001,start);gain.gain.exponentialRampToValueAtTime(volume,start+0.008);gain.gain.exponentialRampToValueAtTime(0.0001,start+duration);
 oscillator.connect(gain);gain.connect(ctx.destination);oscillator.start(start);oscillator.stop(start+duration+0.015);
}
function playSound(){const ctx=audio();if(!ctx)return;const t=ctx.currentTime+0.01;
 try{if(prefs.soundType==='bell'){
   tone(ctx,{frequency:1174.66,start:t,duration:0.65,volume:0.055});
   tone(ctx,{frequency:1761.99,start:t,duration:0.48,volume:0.018});
 }else{
   tone(ctx,{frequency:1040,start:t,duration:0.19,volume:0.07,endFrequency:560});
   tone(ctx,{frequency:1480,start:t+0.055,duration:0.13,volume:0.028,endFrequency:800});
 }}catch{/* Unsupported audio must never interrupt prayer navigation. */}}
export function notifyGloryBead(){if(prefs.vibration&&typeof navigator.vibrate==='function'){try{navigator.vibrate(80)}catch{}}
 if(prefs.sound)playSound();}
function save(){try{localStorage.setItem(KEY,JSON.stringify(prefs))}catch{}}
function init(){const vibration=document.getElementById('rosaryVibration'),sound=document.getElementById('rosarySound'),kind=document.getElementById('rosarySoundType'),group=document.getElementById('rosarySoundOptions');if(!vibration||!sound||!kind||!group)return;
 const refresh=()=>{vibration.checked=prefs.vibration;sound.checked=prefs.sound;kind.value=prefs.soundType;group.hidden=!prefs.sound};refresh();
 vibration.addEventListener('change',()=>{prefs.vibration=vibration.checked;save()});
 sound.addEventListener('change',()=>{prefs.sound=sound.checked;save();refresh();if(prefs.sound)playSound()});
 kind.addEventListener('change',()=>{prefs.soundType=kind.value;save();if(prefs.sound)playSound()});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
