(function(){
const OCR_ANGLES=[0,-20,20,-40,40];
const MAX_DIM=1600;
const THRESHOLD=175;
let workerPromise=null;
let activeProgress=null;

function normalizeText(value){
  return(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/0/g,"o").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim()
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
function tokenWindows(tokens,minSize,maxSize){
  var result=[];
  for(var size=minSize;size<=maxSize;size++){
    for(var i=0;i+size<=tokens.length;i++)result.push(tokens.slice(i,i+size).join(" "))
  }
  return result
}
function scoreTitle(name,text){
  var expected=normalizeText(name);
  var expectedWords=expected.split(" ").filter(Boolean);
  var lines=String(text||"").split(/\n+/).map(normalizeText).filter(Boolean);
  var allTokens=normalizeText(text).split(" ").filter(Boolean);
  var bestLine=0;

  lines.forEach(function(line){
    var tokens=line.split(" ");
    var windows=tokenWindows(tokens,Math.max(1,expectedWords.length-1),expectedWords.length+2);
    windows.forEach(function(candidate){bestLine=Math.max(bestLine,similarity(expected,candidate))})
  });

  var wordScores=expectedWords.map(function(word){
    var best=0;
    allTokens.forEach(function(token){
      if(token.length>=Math.max(2,word.length-4))best=Math.max(best,similarity(word,token))
    });
    return best
  });
  var coverage=0;
  if(wordScores.length){
    var min=Math.min.apply(null,wordScores);
    var avg=wordScores.reduce(function(a,b){return a+b},0)/wordScores.length;
    if(min>=0.42)coverage=avg*(wordScores.length>1?0.94:1)
  }
  return Math.max(bestLine,coverage)
}
function detectCardsFromText(text){
  var detected=[];
  Object.keys(window.CARD_REGISTRY).forEach(function(id){
    var card=window.CARD_REGISTRY[id];
    var score=scoreTitle(card.name,text);
    if(score>=0.60)detected.push({id:id,name:card.name,score:score})
  });
  detected.sort(function(a,b){return b.score-a.score});
  return detected
}
function suppressPrefixConflicts(items){
  return items.filter(function(item){
    var shortName=normalizeText(item.name);
    return !items.some(function(other){
      if(other.id===item.id)return false;
      var longName=normalizeText(other.name);
      return longName.length>shortName.length &&
        longName.indexOf(shortName)===0 &&
        other.score>=0.72 &&
        other.votes>=item.votes+1
    })
  })
}
async function canvasFromSource(source){
  var sourceCanvas=document.createElement("canvas");
  var w,h,draw;
  if(source instanceof HTMLCanvasElement){
    w=source.width;h=source.height;draw=function(ctx){ctx.drawImage(source,0,0)}
  }else if(source instanceof HTMLImageElement){
    w=source.naturalWidth||source.width;h=source.naturalHeight||source.height;draw=function(ctx){ctx.drawImage(source,0,0,w,h)}
  }else if(source instanceof Blob){
    var url=URL.createObjectURL(source);
    var img=await new Promise(function(resolve,reject){
      var el=new Image();
      el.onload=function(){resolve(el)};
      el.onerror=function(){reject(new Error("Fotografii se nepodařilo načíst."))};
      el.src=url
    });
    URL.revokeObjectURL(url);
    w=img.naturalWidth;h=img.naturalHeight;draw=function(ctx){ctx.drawImage(img,0,0,w,h)}
  }else{
    throw new Error("Nepodporovaný obrazový vstup.")
  }

  var scale=Math.min(1,MAX_DIM/Math.max(w,h));
  sourceCanvas.width=Math.max(1,Math.round(w*scale));
  sourceCanvas.height=Math.max(1,Math.round(h*scale));
  var ctx=sourceCanvas.getContext("2d",{alpha:false});
  ctx.fillStyle="#fff";ctx.fillRect(0,0,sourceCanvas.width,sourceCanvas.height);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
  if(scale===1)draw(ctx);
  else{
    if(source instanceof HTMLCanvasElement)ctx.drawImage(source,0,0,sourceCanvas.width,sourceCanvas.height);
    else if(source instanceof HTMLImageElement)ctx.drawImage(source,0,0,sourceCanvas.width,sourceCanvas.height);
    else{
      var u=URL.createObjectURL(source);
      var im=await new Promise(function(resolve,reject){var e=new Image();e.onload=function(){resolve(e)};e.onerror=reject;e.src=u});
      URL.revokeObjectURL(u);
      ctx.drawImage(im,0,0,sourceCanvas.width,sourceCanvas.height)
    }
  }
  return sourceCanvas
}
function rotateAndThreshold(base,degrees){
  var rad=degrees*Math.PI/180,cos=Math.abs(Math.cos(rad)),sin=Math.abs(Math.sin(rad));
  var w=Math.ceil(base.width*cos+base.height*sin),h=Math.ceil(base.width*sin+base.height*cos);
  var rotated=document.createElement("canvas");
  rotated.width=w;rotated.height=h;
  var ctx=rotated.getContext("2d",{alpha:false});
  ctx.fillStyle="#fff";ctx.fillRect(0,0,w,h);
  ctx.translate(w/2,h/2);ctx.rotate(rad);
  ctx.drawImage(base,-base.width/2,-base.height/2);
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
      var keep=gray[p]>165&&local<155&&(gray[p]-local)>20;
      var v=keep?0:255;
      var di=p*4;
      d[di]=d[di+1]=d[di+2]=v;d[di+3]=255
    }
  }
  ctx.putImageData(image,0,0);
  return rotated
}
async function getWorker(){
  if(!window.Tesseract)throw new Error("OCR knihovna se nenačetla. Obnov stránku a zkontroluj připojení.");
  if(!workerPromise){
    workerPromise=(async function(){
      var worker=await window.Tesseract.createWorker("ces",1,{logger:function(m){if(activeProgress)activeProgress(m)}});
      await worker.setParameters({
        tessedit_pageseg_mode:window.Tesseract.PSM?window.Tesseract.PSM.SPARSE_TEXT:"11",
        preserve_interword_spaces:"1",
        user_defined_dpi:"180"
      });
      return worker
    })()
  }
  return workerPromise
}
async function recognize(source,progressCallback){
  var base=await canvasFromSource(source);
  var worker=await getWorker();
  var aggregate={};

  for(var i=0;i<OCR_ANGLES.length;i++){
    var angle=OCR_ANGLES[i];
    activeProgress=function(message){
      if(!progressCallback)return;
      var p=typeof message.progress==="number"?message.progress:0;
      progressCallback({status:"OCR "+(i+1)+"/"+OCR_ANGLES.length+" · "+angle+"° · "+(message.status||""),progress:(i+p)/OCR_ANGLES.length})
    };
    var prepared=rotateAndThreshold(base,angle);
    var result=await worker.recognize(prepared);
    detectCardsFromText(result.data&&result.data.text?result.data.text:"").forEach(function(hit){
      var item=aggregate[hit.id]||{id:hit.id,name:hit.name,score:0,votes:0};
      item.score=Math.max(item.score,hit.score);
      if(hit.score>=0.60)item.votes++;
      aggregate[hit.id]=item
    })
  }
  activeProgress=null;

  var items=Object.values(aggregate).map(function(item){
    item.score=Math.min(1,item.score+Math.max(0,item.votes-1)*0.035);
    return item
  }).filter(function(item){
    return item.score>=0.68||item.votes>=2
  });
  items=suppressPrefixConflicts(items);
  items.sort(function(a,b){return b.score-a.score||b.votes-a.votes});
  return items.slice(0,12)
}
async function startCamera(video){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error("Tento prohlížeč nepodporuje přímý přístup ke kameře.");
  var stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}}});
  video.srcObject=stream;await video.play();return stream
}
function stopCamera(video){
  var stream=video.srcObject;if(stream)stream.getTracks().forEach(function(track){track.stop()});video.srcObject=null
}
function capture(video,canvas){
  var width=video.videoWidth||1280,height=video.videoHeight||720;
  canvas.width=width;canvas.height=height;
  canvas.getContext("2d",{alpha:false}).drawImage(video,0,0,width,height);
  return canvas
}
function findBest(text){
  var best=null;
  Object.keys(window.CARD_REGISTRY).forEach(function(id){
    var card=window.CARD_REGISTRY[id],score=similarity(text,card.name);
    if(!best||score>best.score)best={id:id,name:card.name,score:score}
  });
  return best
}
window.CardScanner={normalizeText:normalizeText,similarity:similarity,startCamera:startCamera,stopCamera:stopCamera,capture:capture,recognize:recognize,findBest:findBest,scoreTitle:scoreTitle}
})();