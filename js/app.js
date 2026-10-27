var cursedHoardItems=false;
var cursedHoardSuits=false;
var playerCount=4;

(function(){
var camera=document.getElementById("camera");
var overlay=document.getElementById("detectionOverlay");
var cameraPlaceholder=document.getElementById("cameraPlaceholder");
var startButton=document.getElementById("startCamera");
var stopButton=document.getElementById("stopCamera");
var upload=document.getElementById("imageUpload");
var status=document.getElementById("ocrStatus");
var detections=document.getElementById("detections");
var handCards=document.getElementById("handCards");
var scoreNode=document.getElementById("score");
var handCount=document.getElementById("handCount");
var handLimit=document.getElementById("handLimit");
var manualSearch=document.getElementById("manualSearch");
var manualResults=document.getElementById("manualResults");
var manualStatus=document.getElementById("manualStatus");
var actionDialog=document.getElementById("actionDialog");
var actionTitle=document.getElementById("actionTitle");
var actionBody=document.getElementById("actionBody");
var saveAction=document.getElementById("saveAction");

var manualMatches=[];
var currentActionCardId=null;
var lastDetections=[];
var liveSession=null;
var liveRunning=false;
var suppressedUntil={};
var lastLiveSnapshot={detections:[],candidates:[]};

var suitNames={land:"Země",flood:"Potopa",weather:"Počasí",flame:"Oheň",army:"Armáda",wizard:"Čaroděj",leader:"Vůdce",beast:"Tvor",weapon:"Zbraň",artifact:"Artefakt",wild:"Divoká"};

function escapeHtml(value){
  return String(value==null?"":value)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#039;")
}
function registryCard(id){return window.CARD_REGISTRY[id]}
function isBaseId(id){return /^FR(?:0[1-9]|[1-4][0-9]|5[0-4])$/.test(id)}
function baseIds(){return Object.keys(window.CARD_REGISTRY).filter(isBaseId).sort()}
function setStatus(text,type,progress){
  status.className="status"+(type?" "+type:"");
  var html=escapeHtml(text||"");
  if(typeof progress==="number"){
    var pct=Math.max(0,Math.min(100,Math.round(progress*100)));
    html+='<div class="progressTrack"><span style="width:'+pct+'%"></span></div>'
  }
  status.innerHTML=html
}

function addCard(id,source){
  if(!isBaseId(id))return false;
  if(hand.getCardById(id))return false;
  var card=deck.getCardById(id);
  if(!card)return false;
  if(!hand.addCard(card)){
    if(source!=="live")manualStatus.textContent="Tuto kartu teď nelze přidat – zkontroluj limit ruky a pravidlo Nekromanta.";
    return false
  }
  render();
  return true
}
function removeCard(id){
  hand.deleteCardById(id);
  if(liveRunning)suppressedUntil[id]=Date.now()+8000;
  render()
}
function isSuppressed(id){
  return suppressedUntil[id]&&suppressedUntil[id]>Date.now()
}
function autoAddConfirmed(items){
  var added=[];
  items.forEach(function(item){
    if(!item.confirmed||!item.id||hand.getCardById(item.id)||isSuppressed(item.id))return;
    if(addCard(item.id,"live"))added.push(item.name)
  });
  return added
}

function actionDescription(card){
  if(!card)return "";
  if(card.card&&card.card.action&&!card.actionData)return "Pro přesné skóre je potřeba nastavit efekt této karty.";
  if(!card.actionData||!card.actionData.length)return "";
  var targetId=card.actionData[0],target=registryCard(targetId),targetName=target?target.name:targetId;
  if(card.id==="FR49"&&card.actionData[1])return "Mění "+targetName+" na barvu "+(suitNames[String(card.actionData[1]).toLowerCase()]||card.actionData[1])+".";
  if(card.id==="FR09")return "Odstraňuje postih kartě "+targetName+".";
  if(card.id==="FR53")return "Kopíruje "+targetName+".";
  if(card.id==="FR51"||card.id==="FR52")return "Napodobuje "+targetName+".";
  return targetName
}
function ruleHtml(id){
  var item=registryCard(id);
  if(!item)return "";
  var parts=[];
  if(item.bonus)parts.push("<b>BONUS:</b> "+item.bonus);
  if(item.penalty)parts.push("<b>POSTIH:</b> "+item.penalty);
  return parts.join("<br>")
}

function render(){
  var total=hand.score(discard);
  scoreNode.textContent=total;
  handCount.textContent=hand.size();
  handLimit.textContent=hand.limit();

  if(!hand.size()){
    handCards.innerHTML='<div class="emptyState">Zatím tu nejsou žádné karty.</div>';
    return
  }

  var html="";
  hand.cards().forEach(function(card){
    var reg=registryCard(card.id)||{name:card.name};
    var state=actionDescription(card);
    html+='<article class="handCard'+(card.blanked?" blanked":"")+'">';
    html+='<div class="handMain">';
    html+='<div class="strength">'+escapeHtml(card.strength)+'</div>';
    html+='<div><div class="cardName">'+escapeHtml(reg.name)+'</div>';
    html+='<div class="cardMeta">'+escapeHtml(card.id)+' · '+escapeHtml(suitNames[card.suit]||card.suit);
    if(card.blanked)html+=' · VYMAZÁNA';
    if(card.penaltyCleared)html+=' · postih odstraněn';
    html+='</div></div>';
    html+='<div class="points">'+escapeHtml(card.points())+'</div>';
    html+='</div>';
    if(state)html+='<div class="actionState'+((card.card&&card.card.action&&!card.actionData)?" actionNeeded":"")+'">'+escapeHtml(state)+'</div>';
    html+='<div class="cardControls">';
    if(card.card&&card.card.action){
      html+='<button data-action="'+escapeHtml(card.id)+'">Nastavit efekt</button>';
      if(card.actionData)html+='<button data-clear-action="'+escapeHtml(card.id)+'">Zrušit efekt</button>'
    }
    html+='<button data-remove="'+escapeHtml(card.id)+'" class="danger ghost">Odebrat</button>';
    html+='</div>';
    var rules=ruleHtml(card.id);
    if(rules)html+='<div class="cardRule">'+rules+'</div>';
    html+='</article>'
  });
  handCards.innerHTML=html;

  handCards.querySelectorAll("[data-remove]").forEach(function(el){
    el.addEventListener("click",function(){removeCard(el.getAttribute("data-remove"))})
  });
  handCards.querySelectorAll("[data-action]").forEach(function(el){
    el.addEventListener("click",function(){openAction(el.getAttribute("data-action"))})
  });
  handCards.querySelectorAll("[data-clear-action]").forEach(function(el){
    el.addEventListener("click",function(){hand.undoCardAction(el.getAttribute("data-clear-action"));render()})
  })
}

function optionHtml(id){
  var reg=registryCard(id);
  return '<option value="'+escapeHtml(id)+'">'+escapeHtml(reg?reg.name:id)+'</option>'
}
function openAction(id){
  var card=hand.getCardById(id);
  if(!card)return;
  currentActionCardId=id;
  var reg=registryCard(id);
  actionTitle.textContent=reg?reg.name:id;
  var body="";

  if(id==="FR09"){
    var targets=hand.cards().filter(function(c){return c.id!==id&&(c.suit==="flood"||c.suit==="flame")});
    body='<label for="actionTarget">Které Potopě nebo Ohni má Ostrov odstranit postih?</label>';
    body+='<select id="actionTarget">'+targets.map(function(c){return optionHtml(c.id)}).join("")+'</select>';
    if(!targets.length)body+='<p>V ruce není vhodná cílová karta.</p>';
    saveAction.disabled=!targets.length
  }else if(id==="FR49"){
    var bookTargets=hand.cards().filter(function(c){return c.id!==id});
    body='<label for="actionTarget">Které kartě změnit barvu?</label>';
    body+='<select id="actionTarget">'+bookTargets.map(function(c){return optionHtml(c.id)}).join("")+'</select>';
    body+='<label for="actionSuit">Nová barva</label><select id="actionSuit">';
    Object.keys(suitNames).forEach(function(suit){body+='<option value="'+suit+'">'+escapeHtml(suitNames[suit])+'</option>'});
    body+='</select>';
    saveAction.disabled=!bookTargets.length
  }else if(id==="FR51"||id==="FR52"){
    var allowed=id==="FR51"?["artifact","leader","wizard","weapon","beast"]:["army","land","weather","flood","flame"];
    var copyTargets=baseIds().filter(function(targetId){
      if(targetId===id)return false;
      var c=deck.getCardById(targetId);
      return c&&allowed.indexOf(c.suit)>=0
    });
    body='<label for="actionTarget">Kterou kartu má napodobovat?</label>';
    body+='<select id="actionTarget">'+copyTargets.map(optionHtml).join("")+'</select>';
    saveAction.disabled=!copyTargets.length
  }else if(id==="FR53"){
    var doppelTargets=hand.cards().filter(function(c){return c.id!==id});
    body='<label for="actionTarget">Kterou kartu v ruce má Dvojník kopírovat?</label>';
    body+='<select id="actionTarget">'+doppelTargets.map(function(c){return optionHtml(c.id)}).join("")+'</select>';
    saveAction.disabled=!doppelTargets.length
  }else{
    body="<p>Tato karta nevyžaduje konfiguraci.</p>";
    saveAction.disabled=true
  }
  actionBody.innerHTML=body;
  actionDialog.showModal()
}
saveAction.addEventListener("click",function(){
  if(!currentActionCardId)return;
  var actionCard=hand.getCardById(currentActionCardId);
  var target=document.getElementById("actionTarget");
  if(!actionCard||!target||!target.value)return;
  if(currentActionCardId==="FR49"){
    var suit=document.getElementById("actionSuit");
    actionCard.actionData=[target.value,suit.value]
  }else{
    actionCard.actionData=[target.value]
  }
  currentActionCardId=null;
  setTimeout(render,0)
});

function prepareOverlay(){
  var rect=overlay.getBoundingClientRect();
  var dpr=Math.min(window.devicePixelRatio||1,2);
  var w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
  if(overlay.width!==w||overlay.height!==h){
    overlay.width=w;overlay.height=h
  }
  var ctx=overlay.getContext("2d");
  ctx.setTransform(dpr,0,0,dpr,0,0);
  return{ctx:ctx,width:rect.width,height:rect.height,dpr:dpr}
}
function mapBoxToOverlay(box,width,height){
  var vw=camera.videoWidth||1,vh=camera.videoHeight||1;
  var scale=Math.max(width/vw,height/vh);
  var renderedW=vw*scale,renderedH=vh*scale;
  var ox=(width-renderedW)/2,oy=(height-renderedH)/2;
  return{
    x:ox+box.x0*vw*scale,
    y:oy+box.y0*vh*scale,
    w:(box.x1-box.x0)*vw*scale,
    h:(box.y1-box.y0)*vh*scale
  }
}
function drawLabel(ctx,box,text,confirmed){
  var pad=4;
  ctx.font="700 13px system-ui,-apple-system,sans-serif";
  var tw=ctx.measureText(text).width;
  var labelY=Math.max(2,box.y-22);
  ctx.fillStyle=confirmed?"rgba(20,115,67,.92)":"rgba(173,118,23,.92)";
  ctx.fillRect(box.x,labelY,tw+pad*2,20);
  ctx.fillStyle="#fff";
  ctx.fillText(text,box.x+pad,labelY+14)
}
function drawOverlay(confirmed,candidates){
  var surface=prepareOverlay(),ctx=surface.ctx,w=surface.width,h=surface.height;
  ctx.clearRect(0,0,w,h);
  confirmed.forEach(function(item){
    if(!item.bbox)return;
    var b=mapBoxToOverlay(item.bbox,w,h);
    ctx.lineWidth=item.confirmed?3:2;
    ctx.strokeStyle=item.confirmed?"rgba(79,220,137,.98)":"rgba(240,190,75,.95)";
    ctx.strokeRect(b.x,b.y,b.w,b.h);
    var pct=Math.round((item.bestScore||item.score||0)*100);
    drawLabel(ctx,b,item.name+" "+pct+"%",item.confirmed)
  });
  (candidates||[]).forEach(function(item){
    if(!item.bbox)return;
    var b=mapBoxToOverlay(item.bbox,w,h);
    ctx.lineWidth=1.5;
    ctx.setLineDash([5,4]);
    ctx.strokeStyle="rgba(240,190,75,.72)";
    ctx.strokeRect(b.x,b.y,b.w,b.h);
    ctx.setLineDash([]);
    var raw=(item.rawText||item.suggestedName||"?").trim();
    if(raw.length>24)raw=raw.slice(0,23)+"…";
    drawLabel(ctx,b,"? "+raw,false)
  })
}
function clearOverlay(){
  var surface=prepareOverlay();
  surface.ctx.clearRect(0,0,surface.width,surface.height)
}
function renderLiveSummary(snapshot){
  var list=(snapshot.detections||[]).slice(0,10);
  if(!list.length){
    detections.innerHTML='<div class="emptyState compact">Čekám na titulky karet…</div>';
    return
  }
  detections.innerHTML=list.map(function(item){
    var state=item.confirmed?"potvrzeno":"ověřuji";
    var inHand=hand.getCardById(item.id)?" · v ruce":"";
    return '<div class="detectCard liveDetect '+(item.confirmed?"confirmed":"candidate")+'"><strong>'+escapeHtml(item.name)+'</strong><small>'+Math.round((item.bestScore||item.score)*100)+'% · '+state+inHand+'</small></div>'
  }).join("")
}

function startLive(){
  if(liveSession)liveSession.stop();
  liveRunning=true;
  liveSession=CardScanner.createLiveScanner(camera,{
    onStatus:function(info){
      if(info.state==="loading")setStatus(info.message||"Načítám OCR…");
      else setStatus(info.message||"Živý scanner běží.","ok")
    },
    onUpdate:function(snapshot){
      lastLiveSnapshot=snapshot;
      lastDetections=snapshot.detections||[];
      var added=autoAddConfirmed(lastDetections);
      drawOverlay(lastDetections,snapshot.candidates||[]);
      renderLiveSummary(snapshot);
      var confirmed=lastDetections.filter(function(d){return d.confirmed}).length;
      var extra=added.length?(" · přidáno: "+added.join(", ")):"";
      setStatus("Živě: "+lastDetections.length+" titulů, "+confirmed+" potvrzených · OCR "+snapshot.processingMs+" ms / celkem "+snapshot.elapsedMs+" ms"+extra,"ok")
    },
    onError:function(e){
      setStatus(e.message||String(e),"error")
    }
  })
}
function stopLive(){
  liveRunning=false;
  if(liveSession){liveSession.stop();liveSession=null}
  clearOverlay()
}

startButton.addEventListener("click",async function(){
  try{
    setStatus("Spouštím kameru…");
    await CardScanner.startCamera(camera);
    cameraPlaceholder.style.display="none";
    startButton.disabled=true;
    stopButton.disabled=false;
    startLive()
  }catch(e){
    setStatus(e.message||String(e),"error")
  }
});
stopButton.addEventListener("click",function(){
  stopLive();
  CardScanner.stopCamera(camera);
  cameraPlaceholder.style.display="";
  startButton.disabled=false;
  stopButton.disabled=true;
  detections.innerHTML="";
  setStatus("Živý scanner zastaven.")
});
window.addEventListener("resize",function(){
  if(liveRunning)drawOverlay(lastLiveSnapshot.detections||[],lastLiveSnapshot.candidates||[])
});

async function recognizePhoto(source){
  detections.innerHTML="";
  lastDetections=[];
  try{
    setStatus("Analyzuji titulky na fotografii…","",0);
    var found=await CardScanner.recognize(source,function(message){
      setStatus(message.status||"OCR","",typeof message.progress==="number"?message.progress:undefined)
    });
    lastDetections=found;
    var added=autoAddConfirmed(found);
    renderPhotoDetections(found);
    if(found.length){
      setStatus("Fotografie: "+found.length+" rozpoznaných titulů"+(added.length?" · automaticky přidáno "+added.length:""),"ok")
    }else{
      setStatus("Na fotografii jsem nenašel dostatečně jistý titul.","error")
    }
  }catch(e){
    setStatus(e.message||String(e),"error")
  }
}
upload.addEventListener("change",async function(){
  var file=upload.files&&upload.files[0];
  if(file)await recognizePhoto(file)
});
function renderPhotoDetections(items){
  if(!items.length){detections.innerHTML="";return}
  detections.innerHTML=items.map(function(item){
    var state=hand.getCardById(item.id)?"v ruce":(item.confirmed?"potvrzeno":"nejisté");
    return '<div class="detectCard liveDetect '+(item.confirmed?"confirmed":"candidate")+'"><strong>'+escapeHtml(item.name)+'</strong><small>'+Math.round((item.bestScore||item.score)*100)+'% · '+state+'</small></div>'
  }).join("")
}

function renderManualResults(){
  var q=CardScanner.normalizeText(manualSearch.value);
  manualMatches=baseIds().map(function(id){
    var card=registryCard(id);
    var normalized=CardScanner.normalizeText(card.name);
    var score=q?CardScanner.similarity(q,card.name):1;
    var contains=q&&normalized.indexOf(q)>=0;
    return{id:id,name:card.name,strength:deck.getCardById(id).strength,score:contains?1:score}
  }).filter(function(item){return !q||item.score>=.42})
    .sort(function(a,b){return b.score-a.score||a.name.localeCompare(b.name,"cs")});

  if(!manualMatches.length){
    manualResults.innerHTML='<div class="emptyState">Žádná odpovídající karta.</div>';
    return
  }
  manualResults.innerHTML=manualMatches.map(function(item){
    return '<button type="button" class="manualResult" data-manual-id="'+item.id+'"><span>'+escapeHtml(item.name)+'</span><small>'+item.strength+'</small></button>'
  }).join("");

  manualResults.querySelectorAll("[data-manual-id]").forEach(function(el){
    el.addEventListener("click",function(){
      var id=el.getAttribute("data-manual-id");
      manualStatus.textContent="";
      if(addCard(id,"manual")){
        manualStatus.textContent="Přidána: "+registryCard(id).name;
        manualSearch.value="";
        renderManualResults()
      }
    })
  })
}
manualSearch.addEventListener("input",renderManualResults);
manualSearch.addEventListener("focus",renderManualResults);
manualSearch.addEventListener("keydown",function(e){
  if(e.key==="Enter"){
    e.preventDefault();
    document.getElementById("manualAdd").click()
  }
});
document.getElementById("manualAdd").addEventListener("click",function(){
  manualStatus.textContent="";
  if(!manualMatches.length){
    manualStatus.textContent="Nejdřív vyber nebo vyhledej kartu.";
    return
  }
  var id=manualMatches[0].id;
  if(addCard(id,"manual")){
    manualStatus.textContent="Přidána: "+registryCard(id).name;
    manualSearch.value="";
    renderManualResults()
  }
});
document.getElementById("resetHand").addEventListener("click",function(){
  if(liveRunning){
    (lastDetections||[]).forEach(function(item){
      if(item.id)suppressedUntil[item.id]=Date.now()+5000
    })
  }
  hand.clear();
  manualStatus.textContent="";
  render();
  renderManualResults();
  if(!liveRunning)detections.innerHTML=""
});

if("serviceWorker"in navigator){
  window.addEventListener("load",function(){
    navigator.serviceWorker.register("./service-worker.js").catch(function(){})
  })
}
render();
renderManualResults()
})();