// Local-only rosary notification preferences. Sound assets are bundled with the app.
const KEY='rosary-bead-alerts-v1';
const DEFAULT={vibration:true,sound:false,soundType:'water'};
function load(){try{const value=JSON.parse(localStorage.getItem(KEY)||'{}');return {...DEFAULT,...value}}catch{return {...DEFAULT}}}
let prefs=load();
const sources={water:new URL('./Rain drop.mp3',import.meta.url).href,bell:new URL('./Bell.mp3',import.meta.url).href};
const players={};
function playSound(){
 try{
  const type=prefs.soundType==='bell'?'bell':'water';
  const player=players[type]??(players[type]=new Audio(sources[type]));
  player.pause();player.currentTime=0;
  const result=player.play();if(result&&typeof result.catch==='function')result.catch(()=>{});
 }catch{/* Audio failure must not interrupt prayer navigation. */}
}
export function notifyGloryBead(){
 if(prefs.vibration&&typeof navigator.vibrate==='function'){try{navigator.vibrate(80)}catch{}}
 if(prefs.sound)playSound();
}
function save(){try{localStorage.setItem(KEY,JSON.stringify(prefs))}catch{}}
function init(){
 const vibration=document.getElementById('rosaryVibration'),sound=document.getElementById('rosarySound'),kind=document.getElementById('rosarySoundType'),group=document.getElementById('rosarySoundOptions');
 if(!vibration||!sound||!kind||!group)return;
 const refresh=()=>{vibration.checked=prefs.vibration;sound.checked=prefs.sound;kind.value=prefs.soundType;group.hidden=!prefs.sound};refresh();
 vibration.addEventListener('change',()=>{prefs.vibration=vibration.checked;save()});
 sound.addEventListener('change',()=>{prefs.sound=sound.checked;save();refresh();if(prefs.sound)playSound()});
 kind.addEventListener('change',()=>{prefs.soundType=kind.value;save();if(prefs.sound)playSound()});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
