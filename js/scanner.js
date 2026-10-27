(function(){
const API_BASE=((window.APP_CONFIG&&window.APP_CONFIG.scannerApiBase)||"").replace(/\/$/,"");
const SCAN_URL=API_BASE+"/api/v1/scan";
const HEALTH_URL=API_BASE+"/api/v1/health";
const FRAME_MAX_DIM=1280;
const JPEG_QUALITY=.90;
const FRAME_DELAY_MS=120;
const TRACK_TTL_MS=5000;
const TRACK_RESET_MS=9000;

function normalizeText(value){
  return(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/0/g,"o").replace(/1/g,"l").replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ").trim()
}
function levenshtein(a,b){
  if(a===b)return 0;if(!a.length)return b.length;if(!b.length)return a.length;
  var prev=new Array(b.length+1),cur=new Array(b.length+1);
  for(var j=0;j<=b.length;j++)prev[j]=j;
  for(var i=1;i<=a.length;i++){
    cur[0]=i;
    for(var k=1;k<=b.length;k++){
      var cost=a.charCodeAt(i-1)===b.charCodeAt(k-1)?0:1;
      cur[k]=Math.min(cur[k-1]+1,prev[k]+1,prev[k-1]+cost)
    }
    var tmp=prev;prev=cur;cur=tmp
  }
  return prev[b.length]
}
function similarity(a,b){
  a=normalizeText(a);b=normalizeText(b);
  if(!a||!b)return 0;if(a===b)return 1;
  return 1-levenshtein(a,b)/Math.max(a.length,b.length)
}
function findBest(text){
  var best=null;
  Object.keys(window.CARD_REGISTRY).forEach(function(id){
    var card=window.CARD_REGISTRY[id],score=similarity(text,card.name);
    if(!best||score>best.score)best={id:id,name:card.name,score:score}
  });
  return best
}
async function startCamera(video){
  if(!window.isSecureContext)throw new Error("Živá kamera vyžaduje HTTPS.");
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error("Živý náhled není v tomto prohlížeči dostupný.");
  video.muted=true;video.playsInline=true;
  var stream=await navigator.mediaDevices.getUserMedia({
    audio:false,
    video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}}
  });
  try{video.srcObject=stream;await video.play();return stream}
  catch(error){stream.getTracks().forEach(function(track){track.stop()});video.srcObject=null;throw error}
}
function stopCamera(video){
  var stream=video.srcObject;if(stream)stream.getTracks().forEach(function(track){track.stop()});video.srcObject=null
}
function sourceCanvas(source){
  if(source instanceof HTMLCanvasElement)return source;
  if(source instanceof HTMLImageElement){
    if(!source.naturalWidth||!source.naturalHeight)throw new Error("Fotografie ještě není načtená.");
    var imageScale=Math.min(1,FRAME_MAX_DIM/Math.max(source.naturalWidth,source.naturalHeight));
    var photoCanvas=document.createElement("canvas");
    photoCanvas.width=Math.max(1,Math.round(source.naturalWidth*imageScale));
    photoCanvas.height=Math.max(1,Math.round(source.naturalHeight*imageScale));
    photoCanvas.getContext("2d",{alpha:false}).drawImage(source,0,0,photoCanvas.width,photoCanvas.height);
    return photoCanvas
  }
  if(source instanceof HTMLVideoElement){
    if(!source.videoWidth||!source.videoHeight)throw new Error("Kamera ještě nemá obraz.");
    // Analyze exactly the center-cropped area visible in the camera panel.
    var rect=source.getBoundingClientRect();
    var viewWidth=rect.width||source.videoWidth,viewHeight=rect.height||source.videoHeight;
    var cover=Math.max(viewWidth/source.videoWidth,viewHeight/source.videoHeight);
    var cropWidth=viewWidth/cover,cropHeight=viewHeight/cover;
    var sx=(source.videoWidth-cropWidth)/2,sy=(source.videoHeight-cropHeight)/2;
    var scale=Math.min(1,FRAME_MAX_DIM/Math.max(cropWidth,cropHeight));
    var canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.round(cropWidth*scale));
    canvas.height=Math.max(1,Math.round(cropHeight*scale));
    canvas.getContext("2d",{alpha:false}).drawImage(source,sx,sy,cropWidth,cropHeight,0,0,canvas.width,canvas.height);
    return canvas
  }
  throw new Error("Nepodporovaný obrazový zdroj.")
}
function canvasToBlob(canvas){
  return new Promise(function(resolve,reject){
    canvas.toBlob(function(blob){
      if(blob)resolve(blob);else reject(new Error("Nepodařilo se vytvořit JPEG snímek."));
    },"image/jpeg",JPEG_QUALITY)
  })
}
async function blobFromSource(source){
  if(source instanceof Blob)return source;
  return canvasToBlob(sourceCanvas(source))
}
async function checkHealth(signal){
  var response=await fetch(HEALTH_URL,{method:"GET",cache:"no-store",signal:signal});
  if(!response.ok)throw new Error("OCR server není dostupný ("+response.status+").");
  return response.json()
}
async function scanBlob(blob,signal,debug,source,captureId){
  var params=new URLSearchParams({source:source||"live"});
  if(debug)params.set("debug","true");
  if(captureId)params.set("capture_id",captureId);
  var url=SCAN_URL+"?"+params.toString();
  var response=await fetch(url,{
    method:"POST",
    headers:{"Content-Type":blob.type||"image/jpeg","Cache-Control":"no-store"},
    body:blob,cache:"no-store",signal:signal
  });
  if(!response.ok){
    var detail="";
    try{detail=(await response.json()).detail||""}catch(e){}
    throw new Error("OCR server vrátil "+response.status+(detail?": "+detail:""));
  }
  return response.json()
}
function toDetection(item){
  return{
    id:item.id,name:item.name,rawText:item.ocrText||"",
    score:Number(item.matchConfidence)||0,
    bestScore:Number(item.combinedConfidence)||Number(item.matchConfidence)||0,
    ocrConfidence:Number(item.ocrConfidence)||0,
    titleConfidence:Number(item.titleConfidence)||0,
    bbox:item.box||null,confirmed:false,accepted:item.accepted!==false
  }
}
function toCandidate(item){
  return{
    id:null,name:null,suggestedId:item.id,suggestedName:item.name,rawText:item.ocrText||"",
    score:Number(item.matchConfidence)||0,
    bestScore:Number(item.combinedConfidence)||Number(item.matchConfidence)||0,
    bbox:item.box||null,confirmed:false
  }
}
function mergeTracks(tracks,items,now){
  items.forEach(function(item){
    var current=tracks[item.id],hits=1;
    if(current&&now-current.lastSeen<TRACK_RESET_MS)hits=Math.min(20,current.hits+1);
    var best=Math.max(item.bestScore,current?current.bestScore||0:0);
    var confirmed=(current&&current.confirmed)||best>=.94||(hits>=2&&best>=.76);
    tracks[item.id]=Object.assign({},item,{hits:hits,bestScore:best,confirmed:confirmed,lastSeen:now})
  });
  Object.keys(tracks).forEach(function(id){if(now-tracks[id].lastSeen>TRACK_TTL_MS)delete tracks[id]})
}
function visibleTracks(tracks,now){
  return Object.values(tracks).filter(function(item){return now-item.lastSeen<=TRACK_TTL_MS})
    .sort(function(a,b){return Number(b.confirmed)-Number(a.confirmed)||b.bestScore-a.bestScore})
}
function createLiveScanner(video,handlers){
  handlers=handlers||{};
  var running=true,controller=new AbortController(),tracks={},pass=0;

  async function loop(){
    while(running){
    try{
      if(handlers.onStatus)handlers.onStatus({state:"loading",message:"Připojuji OCR server…"});
      var health=await checkHealth(controller.signal);
      if(handlers.onStatus)handlers.onStatus({state:"running",message:"OCR server: "+(health.ocr||"online")+" · "+(health.lang||"cs")});
      break
    }catch(e){
      if(!running||e.name==="AbortError")return;
      if(handlers.onError)handlers.onError(e);
      await new Promise(function(resolve){setTimeout(resolve,900)})
    }
    }

    while(running){
      if(!video.videoWidth||video.readyState<2){
        await new Promise(function(resolve){setTimeout(resolve,120)});continue
      }
      var started=performance.now();
      try{
        var capturedAt=Date.now();
        var frame=sourceCanvas(video);
        var blob=await canvasToBlob(frame);
        var result=await scanBlob(blob,controller.signal,false);
        if(!running)break;
        var now=Date.now();
        mergeTracks(tracks,(result.cards||[]).map(toDetection),now);
        pass++;
        if(handlers.onUpdate)handlers.onUpdate({
          frame:frame,observedAt:now,capturedAt:capturedAt,capture:result.capture,
          detections:visibleTracks(tracks,now),
          candidates:(result.candidates||[]).map(toCandidate).slice(0,8),
          pass:pass,processingMs:Number(result.processingMs)||0,
          elapsedMs:Math.round(performance.now()-started)
        })
      }catch(e){
        if(!running||e.name==="AbortError")break;
        if(handlers.onError)handlers.onError(e);
        await new Promise(function(resolve){setTimeout(resolve,900)})
      }
      if(running)await new Promise(function(resolve){setTimeout(resolve,FRAME_DELAY_MS)})
    }
  }
  loop();
  return{stop:function(){running=false;controller.abort()},isRunning:function(){return running}}
}
async function archivePhoto(file){
  var type=file.type||(/\.hei[cf]$/i.test(file.name||"")?"image/heic":"image/jpeg");
  var response=await fetch(API_BASE+"/api/v1/captures",{method:"POST",headers:{"Content-Type":type},body:file,cache:"no-store"});
  var result=await response.json();
  if(!response.ok)throw new Error("Fotografii se nepodařilo uložit.");
  return result
}
async function recognize(source,progressCallback,captureId){
  if(progressCallback)progressCallback({status:"Odesílám fotografii na OCR server…",progress:.2});
  var blob=await blobFromSource(source);
  var result=await scanBlob(blob,undefined,false,"photo",captureId);
  if(progressCallback)progressCallback({status:"Zpracováno serverem za "+result.processingMs+" ms",progress:1,capture:result.capture});
  return(result.cards||[]).map(function(item){var d=toDetection(item);d.confirmed=true;return d})
}

window.CardScanner={
  normalizeText:normalizeText,similarity:similarity,findBest:findBest,
  startCamera:startCamera,stopCamera:stopCamera,
  createLiveScanner:createLiveScanner,recognize:recognize,archivePhoto:archivePhoto,checkHealth:checkHealth
}
})();