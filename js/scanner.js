(function(){
const LIVE_ANGLES=[0,-22,22];
const STATIC_ANGLES=[0,-22,22,-36,36];
const LIVE_TILE_MAX_DIM=1250;
const STATIC_TILE_MAX_DIM=1550;
const TRACK_TTL_MS=8500;
const TRACK_RESET_MS=15000;
const ALPHABET="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÁČĎÉĚÍŇÓŘŠŤÚŮÝŽáčďéěíňóřšťúůýž ";

let workerPromise=null;
let activeProgress=null;

function normalizeText(value){
  return(value||"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/0/g,"o")
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ")
    .trim()
}
function levenshtein(a,b){
  if(a===b)return 0;
  if(!a.length)return b.length;
  if(!b.length)return a.length;
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
  if(!a||!b)return 0;
  if(a===b)return 1;
  return 1-levenshtein(a,b)/Math.max(a.length,b.length)
}
function tokenWindows(tokens,minSize,maxSize){
  var result=[];
  for(var size=minSize;size<=maxSize;size++){
    for(var i=0;i+size<=tokens.length;i++)result.push(tokens.slice(i,i+size).join(" "))
  }
  return result
}
function scoreTitle(name,text){
  var expected=normalizeText(name);
  var words=expected.split(" ").filter(Boolean);
  var tokens=normalizeText(text).split(" ").filter(Boolean);
  if(!tokens.length)return 0;
  var best=0;
  tokenWindows(tokens,Math.max(1,words.length-1),words.length+2).forEach(function(candidate){
    best=Math.max(best,similarity(expected,candidate))
  });
  if(words.length>1){
    var wordScores=words.map(function(word){
      var wordBest=0;
      tokens.forEach(function(token){
        if(token.length>=Math.max(2,word.length-4))wordBest=Math.max(wordBest,similarity(word,token))
      });
      return wordBest
    });
    var min=Math.min.apply(null,wordScores);
    var avg=wordScores.reduce(function(a,b){return a+b},0)/wordScores.length;
    if(min>=0.46)best=Math.max(best,avg*0.94)
  }
  return best
}
function bestCardMatch(text){
  var ranked=Object.keys(window.CARD_REGISTRY).map(function(id){
    return{id:id,name:window.CARD_REGISTRY[id].name,score:scoreTitle(window.CARD_REGISTRY[id].name,text)}
  }).sort(function(a,b){return b.score-a.score});
  var best=ranked[0],second=ranked[1]||{score:0};
  if(!best)return null;
  var margin=best.score-second.score;
  var accepted=best.score>=0.60&&(margin>=0.045||best.score>=0.82);
  return{id:best.id,name:best.name,score:best.score,margin:margin,accepted:accepted}
}

async function getWorker(){
  if(!window.Tesseract)throw new Error("OCR knihovna se nenačetla. Obnov stránku a zkontroluj připojení.");
  if(!workerPromise){
    workerPromise=(async function(){
      var worker=await window.Tesseract.createWorker("ces",1,{
        logger:function(message){if(activeProgress)activeProgress(message)}
      });
      await worker.setParameters({
        tessedit_pageseg_mode:window.Tesseract.PSM?window.Tesseract.PSM.SPARSE_TEXT:"11",
        preserve_interword_spaces:"1",
        user_defined_dpi:"180",
        tessedit_char_whitelist:ALPHABET
      });
      return worker
    })()
  }
  return workerPromise
}

function sourceDimensions(source){
  if(source instanceof HTMLVideoElement)return{width:source.videoWidth,height:source.videoHeight};
  if(source instanceof HTMLCanvasElement)return{width:source.width,height:source.height};
  if(source instanceof HTMLImageElement)return{width:source.naturalWidth||source.width,height:source.naturalHeight||source.height};
  return null
}
async function imageFromBlob(blob){
  var url=URL.createObjectURL(blob);
  try{
    return await new Promise(function(resolve,reject){
      var img=new Image();
      img.onload=function(){resolve(img)};
      img.onerror=function(){reject(new Error("Fotografii se nepodařilo načíst."))};
      img.src=url
    })
  }finally{
    setTimeout(function(){URL.revokeObjectURL(url)},0)
  }
}
async function canvasFromSource(source,maxDim,tile){
  var actual=source;
  if(source instanceof Blob)actual=await imageFromBlob(source);
  var dim=sourceDimensions(actual);
  if(!dim||!dim.width||!dim.height)throw new Error("Obrazový vstup zatím nemá platnou velikost.");

  tile=tile||{x:0,y:0,w:1,h:1,id:"full"};
  var sx=Math.max(0,Math.round(tile.x*dim.width));
  var sy=Math.max(0,Math.round(tile.y*dim.height));
  var sw=Math.min(dim.width-sx,Math.max(1,Math.round(tile.w*dim.width)));
  var sh=Math.min(dim.height-sy,Math.max(1,Math.round(tile.h*dim.height)));

  var scale=Math.min(2.6,maxDim/Math.max(sw,sh));
  var canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(sw*scale));
  canvas.height=Math.max(1,Math.round(sh*scale));
  var ctx=canvas.getContext("2d",{alpha:false,willReadFrequently:true});
  ctx.fillStyle="#fff";
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality="high";
  ctx.drawImage(actual,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
  return{
    canvas:canvas,
    sourceWidth:dim.width,
    sourceHeight:dim.height,
    tile:tile
  }
}
function tilesForSource(source){
  var dim=sourceDimensions(source);
  if(!dim&&source instanceof Blob)return null;
  if(!dim)return[{x:0,y:0,w:1,h:1,id:"full"}];

  // Portrait photos are split horizontally; landscape video vertically.
  // The 20% overlap prevents a title from being cut at a tile boundary.
  if(dim.height>=dim.width){
    return[
      {x:0,y:0,w:1,h:.46,id:"top"},
      {x:0,y:.27,w:1,h:.46,id:"middle"},
      {x:0,y:.54,w:1,h:.46,id:"bottom"}
    ]
  }
  return[
    {x:0,y:0,w:.46,h:1,id:"left"},
    {x:.27,y:0,w:.46,h:1,id:"middle"},
    {x:.54,y:0,w:.46,h:1,id:"right"}
  ]
}
/*
 * Title-only mask.
 * The card title is light lettering on a dark banner. The rules are the inverse:
 * dark lettering on a light panel. We therefore retain only bright pixels that
 * have a sufficiently dark local horizontal/vertical neighbourhood.
 */
function rotateAndTitleMask(base,degrees,tile){
  var bw=base.width,bh=base.height;
  var rad=degrees*Math.PI/180,cos=Math.abs(Math.cos(rad)),sin=Math.abs(Math.sin(rad));
  var w=Math.ceil(bw*cos+bh*sin),h=Math.ceil(bw*sin+bh*cos);
  var canvas=document.createElement("canvas");
  canvas.width=w;canvas.height=h;
  var ctx=canvas.getContext("2d",{alpha:false,willReadFrequently:true});
  ctx.fillStyle="#fff";ctx.fillRect(0,0,w,h);
  ctx.translate(w/2,h/2);
  ctx.rotate(rad);
  ctx.drawImage(base,-bw/2,-bh/2);
  ctx.setTransform(1,0,0,1,0,0);

  var image=ctx.getImageData(0,0,w,h),d=image.data;
  var gray=new Uint8Array(w*h);
  for(var i=0,p=0;i<d.length;i+=4,p++){
    gray[p]=Math.round(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])
  }

  var radius=5;
  for(var y=0;y<h;y++){
    for(var x=0;x<w;x++){
      var p=y*w+x;
      var xl=Math.max(0,x-radius),xr=Math.min(w-1,x+radius);
      var yu=Math.max(0,y-radius),yd=Math.min(h-1,y+radius);
      var local=(gray[y*w+xl]+gray[y*w+xr]+gray[yu*w+x]+gray[yd*w+x])/4;
      var brightOnDark=gray[p]>162&&local<158&&(gray[p]-local)>18;
      var v=brightOnDark?0:255;
      var di=p*4;
      d[di]=d[di+1]=d[di+2]=v;
      d[di+3]=255
    }
  }
  ctx.putImageData(image,0,0);
  return{canvas:canvas,angle:degrees,baseWidth:bw,baseHeight:bh,width:w,height:h,tile:tile||{x:0,y:0,w:1,h:1}}
}

function linesFromBlocks(blocks){
  var lines=[];
  (blocks||[]).forEach(function(block){
    (block.paragraphs||[]).forEach(function(paragraph){
      (paragraph.lines||[]).forEach(function(line){
        if(line&&line.text&&line.bbox)lines.push({
          text:line.text,
          confidence:Number(line.confidence)||0,
          bbox:line.bbox
        })
      })
    })
  });
  return lines
}
function linesFromTsv(tsv){
  if(!tsv)return[];
  var grouped={};
  String(tsv).split(/\r?\n/).slice(1).forEach(function(row){
    if(!row.trim())return;
    var cols=row.split("\t");
    if(cols.length<12)return;
    var level=Number(cols[0]),text=cols.slice(11).join("\t").trim();
    if(level!==5||!text)return;
    var key=[cols[1],cols[2],cols[3],cols[4]].join(":");
    var left=Number(cols[6]),top=Number(cols[7]),width=Number(cols[8]),height=Number(cols[9]),conf=Number(cols[10]);
    var g=grouped[key]||(grouped[key]={words:[],x0:left,y0:top,x1:left+width,y1:top+height,confidence:0,count:0});
    g.words.push(text);
    g.x0=Math.min(g.x0,left);g.y0=Math.min(g.y0,top);g.x1=Math.max(g.x1,left+width);g.y1=Math.max(g.y1,top+height);
    if(conf>=0){g.confidence+=conf;g.count++}
  });
  return Object.values(grouped).map(function(g){
    return{text:g.words.join(" "),confidence:g.count?g.confidence/g.count:0,bbox:{x0:g.x0,y0:g.y0,x1:g.x1,y1:g.y1}}
  })
}
function extractLines(data){
  var blockLines=linesFromBlocks(data&&data.blocks);
  return blockLines.length?blockLines:linesFromTsv(data&&data.tsv)
}
function inverseRotatePoint(x,y,meta){
  var rad=meta.angle*Math.PI/180,c=Math.cos(rad),s=Math.sin(rad);
  var rx=x-meta.width/2,ry=y-meta.height/2;
  return{
    x:c*rx+s*ry+meta.baseWidth/2,
    y:-s*rx+c*ry+meta.baseHeight/2
  }
}
function bboxToNormalized(bbox,meta){
  var points=[
    inverseRotatePoint(bbox.x0,bbox.y0,meta),
    inverseRotatePoint(bbox.x1,bbox.y0,meta),
    inverseRotatePoint(bbox.x1,bbox.y1,meta),
    inverseRotatePoint(bbox.x0,bbox.y1,meta)
  ];
  var xs=points.map(function(p){return p.x}),ys=points.map(function(p){return p.y});
  var tx0=Math.max(0,Math.min.apply(null,xs))/meta.baseWidth;
  var tx1=Math.min(meta.baseWidth,Math.max.apply(null,xs))/meta.baseWidth;
  var ty0=Math.max(0,Math.min.apply(null,ys))/meta.baseHeight;
  var ty1=Math.min(meta.baseHeight,Math.max.apply(null,ys))/meta.baseHeight;
  var tile=meta.tile||{x:0,y:0,w:1,h:1};
  return{
    x0:tile.x+tx0*tile.w,
    y0:tile.y+ty0*tile.h,
    x1:tile.x+tx1*tile.w,
    y1:tile.y+ty1*tile.h
  }
}
function lineLooksLikeTitle(line,meta){
  var n=normalizeText(line.text);
  if(n.length<3||!/[a-z]/.test(n))return false;
  var w=line.bbox.x1-line.bbox.x0,h=line.bbox.y1-line.bbox.y0;
  if(w<20||h<6)return false;
  if(w/h<1.15)return false;
  if(h>meta.height*0.14)return false;
  return true
}
function detectFromOcr(data,meta){
  var matched=[];
  var candidates=[];
  extractLines(data).forEach(function(line){
    if(!lineLooksLikeTitle(line,meta))return;
    var match=bestCardMatch(line.text);
    if(!match||match.score<0.42)return;
    var bbox=bboxToNormalized(line.bbox,meta);
    var common={
      rawText:String(line.text||"").trim(),
      confidence:line.confidence,
      score:match.score,
      bbox:bbox,
      angle:meta.angle
    };
    if(match.accepted){
      matched.push(Object.assign(common,{id:match.id,name:match.name,margin:match.margin}))
    }else{
      candidates.push(Object.assign(common,{id:null,name:null,suggestedId:match.id,suggestedName:match.name,margin:match.margin}))
    }
  });

  // The same OCR pass can fragment one title. Keep only the strongest box per card.
  var byId={};
  matched.forEach(function(item){
    if(!byId[item.id]||item.score>byId[item.id].score)byId[item.id]=item
  });
  return{matched:Object.values(byId),candidates:candidates.sort(function(a,b){return b.score-a.score}).slice(0,8)}
}
async function recognizePass(source,task,maxDim,progressCallback){
  var baseInfo=await canvasFromSource(source,maxDim,task.tile);
  var meta=rotateAndTitleMask(baseInfo.canvas,task.angle,task.tile);
  var worker=await getWorker();
  activeProgress=progressCallback||null;
  try{
    var result=await worker.recognize(meta.canvas,{},{
      text:true,
      blocks:true,
      tsv:true
    });
    var detected=detectFromOcr(result.data,meta);
    detected.matched.forEach(function(item){item.tileId=task.tile.id});
    detected.candidates.forEach(function(item){item.tileId=task.tile.id});
    return detected
  }finally{
    activeProgress=null
  }
}
function tasksForSource(source,angles){
  var tiles=tilesForSource(source)||[
    {x:0,y:0,w:1,h:.46,id:"top"},
    {x:0,y:.27,w:1,h:.46,id:"middle"},
    {x:0,y:.54,w:1,h:.46,id:"bottom"}
  ];
  var tasks=[];
  angles.forEach(function(angle){
    tiles.forEach(function(tile){tasks.push({tile:tile,angle:angle})})
  });
  return tasks
}
function mergeTracks(tracks,detections,now){
  detections.forEach(function(d){
    var old=tracks[d.id];
    var hits=1;
    if(old&&now-old.lastSeen<TRACK_RESET_MS)hits=Math.min(20,old.hits+1);
    var bestScore=Math.max(d.score,old?old.bestScore||0:0);
    tracks[d.id]={
      id:d.id,
      name:d.name,
      rawText:d.rawText,
      score:d.score,
      bestScore:bestScore,
      confidence:d.confidence,
      bbox:d.bbox,
      angle:d.angle,
      hits:hits,
      lastSeen:now,
      confirmed:(old&&old.confirmed)||d.score>=0.88||(hits>=2&&bestScore>=0.70)
    }
  });
  Object.keys(tracks).forEach(function(id){
    if(now-tracks[id].lastSeen>TRACK_TTL_MS)delete tracks[id]
  })
}
function visibleTracks(tracks,now){
  return Object.values(tracks)
    .filter(function(t){return now-t.lastSeen<=TRACK_TTL_MS})
    .sort(function(a,b){return Number(b.confirmed)-Number(a.confirmed)||b.bestScore-a.bestScore})
}

function createLiveScanner(video,handlers){
  handlers=handlers||{};
  var running=true;
  var tracks={};
  var taskIndex=0;
  var passNumber=0;
  var tasks=[];

  async function loop(){
    try{
      if(handlers.onStatus)handlers.onStatus({state:"loading",message:"Načítám OCR model…"});
      await getWorker();
      if(handlers.onStatus)handlers.onStatus({state:"running",message:"Živý scanner běží."})
    }catch(e){
      running=false;
      if(handlers.onError)handlers.onError(e);
      return
    }

    while(running){
      if(!video.videoWidth||video.readyState<2){
        await new Promise(function(resolve){setTimeout(resolve,120)});
        continue
      }
      if(!tasks.length||taskIndex>=tasks.length){
        tasks=tasksForSource(video,LIVE_ANGLES);
        taskIndex=0
      }
      var task=tasks[taskIndex++];
      var started=performance.now();
      try{
        var pass=await recognizePass(video,task,LIVE_TILE_MAX_DIM,null);
        if(!running)break;
        var now=Date.now();
        mergeTracks(tracks,pass.matched,now);
        passNumber++;
        if(handlers.onUpdate)handlers.onUpdate({
          detections:visibleTracks(tracks,now),
          candidates:pass.candidates,
          angle:task.angle,
          tileId:task.tile.id,
          pass:passNumber,
          elapsedMs:Math.round(performance.now()-started)
        })
      }catch(e){
        if(handlers.onError)handlers.onError(e)
      }
      if(running)await new Promise(function(resolve){setTimeout(resolve,50)})
    }
  }
  loop();

  return{
    stop:function(){running=false},
    isRunning:function(){return running}
  }
}

async function recognize(source,progressCallback){
  var actual=source;
  if(source instanceof Blob)actual=await imageFromBlob(source);
  var tasks=tasksForSource(actual,STATIC_ANGLES);
  var tracks={};

  for(var i=0;i<tasks.length;i++){
    var task=tasks[i];
    var pass=await recognizePass(actual,task,STATIC_TILE_MAX_DIM,function(message){
      if(!progressCallback)return;
      var p=typeof message.progress==="number"?message.progress:0;
      progressCallback({
        status:"OCR "+(i+1)+"/"+tasks.length+" · "+task.tile.id+" · "+task.angle+"°",
        progress:(i+p)/tasks.length
      })
    });
    mergeTracks(tracks,pass.matched,Date.now())
  }

  var result=visibleTracks(tracks,Date.now());
  result.forEach(function(item){
    if(!item.confirmed&&item.bestScore>=0.82)item.confirmed=true
  });
  return result
}
async function startCamera(video){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error("Tento prohlížeč nepodporuje přímý přístup ke kameře.");
  var stream=await navigator.mediaDevices.getUserMedia({
    audio:false,
    video:{
      facingMode:{ideal:"environment"},
      width:{ideal:1920},
      height:{ideal:1080}
    }
  });
  video.srcObject=stream;
  await video.play();
  return stream
}
function stopCamera(video){
  var stream=video.srcObject;
  if(stream)stream.getTracks().forEach(function(track){track.stop()});
  video.srcObject=null
}
function findBest(text){
  var best=null;
  Object.keys(window.CARD_REGISTRY).forEach(function(id){
    var card=window.CARD_REGISTRY[id],score=similarity(text,card.name);
    if(!best||score>best.score)best={id:id,name:card.name,score:score}
  });
  return best
}

window.CardScanner={
  normalizeText:normalizeText,
  similarity:similarity,
  scoreTitle:scoreTitle,
  bestCardMatch:bestCardMatch,
  startCamera:startCamera,
  stopCamera:stopCamera,
  createLiveScanner:createLiveScanner,
  recognize:recognize,
  findBest:findBest
}
})();