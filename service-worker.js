const CACHE="tajuplne-rise-remastered-v6";
const ASSETS=["./","./index.html","./css/app.css","./js/deck.js","./js/discard.js","./js/hand.js","./js/cards-cz.js","./js/config.js","./js/scanner.js","./js/app.js","./manifest.webmanifest","./icons/icon.svg"];

self.addEventListener("install",function(event){
  event.waitUntil(caches.open(CACHE).then(function(cache){return cache.addAll(ASSETS)}));
  self.skipWaiting()
});
self.addEventListener("activate",function(event){
  event.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(key){return key!==CACHE}).map(function(key){return caches.delete(key)}))
  }));
  self.clients.claim()
});
self.addEventListener("fetch",function(event){
  if(event.request.method!=="GET")return;
  var url=new URL(event.request.url);
  if(url.origin!==self.location.origin||url.pathname.startsWith("/api/"))return;

  event.respondWith(
    fetch(event.request).then(function(response){
      if(response&&response.status===200){
        var copy=response.clone();
        caches.open(CACHE).then(function(cache){cache.put(event.request,copy)})
      }
      return response
    }).catch(function(){return caches.match(event.request)})
  )
});