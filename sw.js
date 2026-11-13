/* Increment CACHE_VERSION for EVERY release, including CSS-only changes. */
const CACHE_VERSION='rosary-book-shell-1.4.9-export-date-white-900';
const SCOPE=new URL(self.registration.scope).pathname;
const CACHE=CACHE_VERSION+'@'+SCOPE;
const FILES=['./','./index.html','./styles.css','./app.js','./music.js','./credits.js','./JOHN_MICHEL_CELLO-BACH_AVE_MARIA.ogg','./rosary-alerts.js','./Rain drop.mp3','./Bell.mp3','./settings.js','./backup-extras.js','./export-image.js','./storage.js','./mysteries.js','./manifest.webmanifest','./default-header-logo.png','./icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png'];
const URLS=new Set(FILES.map(p=>new URL(p,self.registration.scope).href));
self.addEventListener('install',e=>e.waitUntil((async()=>{
 // Precache all shell files before the new worker can become active.
 // Never cache an error page as a valid application file.
 const cache=await caches.open(CACHE);
 try{
  for(const path of FILES){
   const url=new URL(path,self.registration.scope);
   const response=await fetch(new Request(url,{cache:'reload'}));
   if(!response.ok||response.type==='opaque')throw new Error('App shell download failed: '+path);
   await cache.put(url,response);
  }
 }catch(err){await caches.delete(CACHE);throw err;}
})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('rosary-book-shell-')&&k.endsWith('@'+SCOPE)&&k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim();})()));
self.addEventListener('message',e=>{if(e.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const url=new URL(e.request.url);if(url.origin!==self.location.origin)return;
 // Serve a version-consistent app shell; updates install the whole next shell atomically.
 if(e.request.mode==='navigate'&&(url.pathname===SCOPE||url.pathname===SCOPE+'index.html')){e.respondWith(caches.open(CACHE).then(async c=>(await c.match(new URL('./index.html',self.registration.scope)))||fetch(e.request)));return;}
 if(URLS.has(url.href))e.respondWith(caches.open(CACHE).then(async c=>(await c.match(e.request))||fetch(e.request)));
});

// Client may query the active shell version without touching IndexedDB.
self.addEventListener('message',e=>{if(e.data?.type==='GET_VERSION')e.source?.postMessage({type:'SHELL_VERSION',version:CACHE_VERSION});});
