var cursedHoardItems=false;
var cursedHoardSuits=false;
var playerCount=4;

(function(){
var camera=document.getElementById("camera");
var cameraFrame=document.getElementById("cameraFrame");
var overlay=document.getElementById("detectionOverlay");
var placeholder=document.getElementById("cameraPlaceholder");
var cameraTitle=document.getElementById("cameraTitle");
var cameraHint=document.getElementById("cameraHint");
var photoPreview=document.getElementById("photoPreview");
var upload=document.getElementById("imageUpload");
var status=document.getElementById("ocrStatus");
var handCards=document.getElementById("handCards");
var emptyHand=document.getElementById("emptyHand");
var actionDialog=document.getElementById("actionDialog");
var actionTitle=document.getElementById("actionTitle");
var actionBody=document.getElementById("actionBody");
var saveAction=document.getElementById("saveAction");
var currentActionCardId=null;
var liveSession=null,starting=false,photoBusy=false,generation=0;
var allowLive=window.isSecureContext&&navigator.mediaDevices&&navigator.mediaDevices.getUserMedia;
var snapshots={},suppressedUntil={},photoUrl=null;
var lastSnapshot={detections:[],candidates:[]};
var suitNames={land:"Země",flood:"Potopa",weather:"Počasí",flame:"Oheň",army:"Armáda",wizard:"Čaroděj",leader:"Vůdce",beast:"Tvor",weapon:"Zbraň",artifact:"Artefakt",wild:"Divoká"};

function escapeHtml(value){return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}
function registryCard(id){return window.CARD_REGISTRY[id]}
function baseIds(){return Object.keys(window.CARD_REGISTRY).filter(function(id){return /^FR(?:0[1-9]|[1-4][0-9]|5[0-4])$/.test(id)}).sort()}
function setStatus(text,type){status.className="cameraStatus"+(type?" "+type:"");status.textContent=text||""}
function actionDescription(card){
  if(card.card&&card.card.action&&!card.actionData)return "Vyžaduje nastavení efektu.";
  if(!card.actionData||!card.actionData.length)return "";
  var target=registryCard(card.actionData[0]);
  var name=target?target.name:card.actionData[0];
  if(card.id==="FR49")return "Mění "+name+" na barvu "+(suitNames[card.actionData[1]]||card.actionData[1])+".";
  if(card.id==="FR09")return "Odstraňuje postih kartě "+name+".";
  return "Napodobuje "+name+"."
}
function ruleHtml(id){
  var card=registryCard(id),parts=[];
  if(card&&card.bonus)parts.push("<b>BONUS:</b> "+card.bonus);
  if(card&&card.penalty)parts.push("<b>POSTIH:</b> "+card.penalty);
  return parts.join("<br><br>")
}
function layoutCards(){
  var count=hand.size(),wide=handCards.clientWidth>handCards.clientHeight*1.5;
  var columns=Math.max(1,count===1?1:(wide?Math.min(count,4):(count<=4?2:3)));
  handCards.classList.toggle("single",count===1);
  handCards.style.setProperty("--columns",columns);
  handCards.style.setProperty("--rows",Math.max(1,Math.ceil(count/columns)))
}
function render(){
  document.getElementById("score").textContent=hand.score(discard);
  document.getElementById("handCount").textContent=hand.size();
  document.getElementById("countLabel").textContent=hand.size()===1?"karta":(hand.size()>1&&hand.size()<5?"karty":"karet");
  emptyHand.hidden=hand.size()>0;
  Array.from(handCards.children).forEach(function(node){if(!hand.getCardById(node.dataset.cardId))node.remove()});
  hand.cards().forEach(function(card){
    var node=handCards.querySelector('[data-card-id="'+card.id+'"]');
    if(!node){
      node=document.createElement("button");node.type="button";node.dataset.cardId=card.id;node.className="cardSnap new";
      node.innerHTML='<img alt="" hidden><span class="snapPoints"></span><span class="snapCaption"><span class="snapName"></span><span class="snapState"></span></span>';
      node.addEventListener("animationend",function(){node.classList.remove("new")});
      handCards.appendChild(node)
    }
    var reg=registryCard(card.id),description=actionDescription(card);
    node.classList.toggle("blanked",!!card.blanked);
    node.classList.toggle("needsEffect",!!(card.card&&card.card.action&&!card.actionData));
    node.setAttribute("aria-label",reg.name+", "+card.points()+" bodů"+(description?". "+description:"")+". Podrobnosti karty.");
    node.querySelector(".snapName").textContent=reg.name;
    node.querySelector(".snapPoints").textContent=card.points();
    node.querySelector(".snapState").textContent=card.blanked?"Vymazaná":(node.classList.contains("needsEffect")?"Nastavit efekt":"");
    if(snapshots[card.id]){var img=node.querySelector("img");if(img.getAttribute("src")!==snapshots[card.id])img.src=snapshots[card.id];img.hidden=false}
  });
  layoutCards()
}
function captureSnap(source,box){
  if(!source||!box)return null;
  var width=source.naturalWidth||source.width,height=source.naturalHeight||source.height;
  var titleWidth=Math.max(1,(box.x1-box.x0)*width),titleHeight=Math.max(1,(box.y1-box.y0)*height);
  var x=Math.max(0,box.x0*width-titleWidth*.2),y=Math.max(0,box.y0*height-titleHeight*.4);
  var w=Math.min(width-x,titleWidth*1.4),h=Math.min(height-y,w*1.4);
  if(w<=0||h<=0)return null;
  var canvas=document.createElement("canvas");canvas.width=240;canvas.height=Math.max(1,Math.round(240*h/w));
  canvas.getContext("2d").drawImage(source,x,y,w,h,0,0,canvas.width,canvas.height);
  return canvas.toDataURL("image/jpeg",.82)
}
function addConfirmed(items,source,observedAt){
  var added=0;
  items.forEach(function(item){
    if(!item.confirmed||!registryCard(item.id)||hand.getCardById(item.id)||suppressedUntil[item.id]>Date.now())return;
    if(observedAt&&item.lastSeen!==observedAt)return;
    if(!hand.addCard(deck.getCardById(item.id)))return;
    snapshots[item.id]=captureSnap(source,item.bbox);added++
  });
  if(added)render();return added
}
handCards.addEventListener("click",function(event){var node=event.target.closest("[data-card-id]");if(node)openCard(node.dataset.cardId)});
document.getElementById("removeCard").addEventListener("click",function(){
  if(!currentActionCardId)return;
  suppressedUntil[currentActionCardId]=Date.now()+8000;hand.deleteCardById(currentActionCardId);delete snapshots[currentActionCardId];
  currentActionCardId=null;actionDialog.close();render()
});
document.getElementById("clearEffect").addEventListener("click",function(){if(currentActionCardId){hand.undoCardAction(currentActionCardId);render();actionDialog.close()}});
function optionHtml(id){
  var reg=registryCard(id);
  return '<option value="'+escapeHtml(id)+'">'+escapeHtml(reg?reg.name:id)+'</option>'
}
function openCard(id){
  var card=hand.getCardById(id);
  if(!card)return;
  currentActionCardId=id;
  var reg=registryCard(id);
  actionTitle.textContent=reg?reg.name:id;
  var body="";
  saveAction.hidden=!(card.card&&card.card.action);
  document.getElementById("clearEffect").hidden=!card.actionData;

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
    body="";
    saveAction.disabled=true
  }
  actionBody.innerHTML="<p>"+escapeHtml(actionDescription(card))+"</p>"+body+'<div class="cardRules">'+ruleHtml(id)+"</div>";
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

function clearOverlay(){var ctx=overlay.getContext("2d");ctx.clearRect(0,0,overlay.width,overlay.height)}
function drawOverlay(snapshot){
  var rect=overlay.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);
  overlay.width=Math.max(1,Math.round(rect.width*dpr));overlay.height=Math.max(1,Math.round(rect.height*dpr));
  var ctx=overlay.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,rect.width,rect.height);
  if(!snapshot.frame||Math.abs(snapshot.frame.width/snapshot.frame.height-rect.width/rect.height)>.06)return;
  (snapshot.detections||[]).concat(snapshot.candidates||[]).forEach(function(item){
    if(!item.bbox)return;
    var box=item.bbox;ctx.strokeStyle=item.confirmed?"#9be8ac":"#e5bd73";ctx.lineWidth=item.confirmed?2:1;
    ctx.setLineDash(item.id?[]:[4,4]);ctx.strokeRect(box.x0*rect.width,box.y0*rect.height,(box.x1-box.x0)*rect.width,(box.y1-box.y0)*rect.height)
  })
}
function stopPreview(){generation++;if(liveSession){liveSession.stop();liveSession=null}CardScanner.stopCamera(camera);clearOverlay()}
function photoMode(title,hint){
  cameraFrame.classList.add("photoMode");cameraFrame.setAttribute("role","button");cameraFrame.tabIndex=0;
  cameraFrame.setAttribute("aria-label","Vyfotit karty");
  cameraTitle.textContent=title||"Klepněte a vyfoťte karty";
  cameraHint.textContent=hint||"Otevře se fotoaparát telefonu.";
  placeholder.hidden=!!photoUrl;setStatus("")
}
async function startPreview(){
  if(starting||liveSession||photoBusy||document.hidden)return;
  if(!allowLive){photoMode("Klepněte a vyfoťte karty",window.isSecureContext?"Otevře se fotoaparát telefonu.":"Na této HTTP adrese lze fotit. Živý náhled vyžaduje HTTPS.");return}
  starting=true;var ticket=++generation;
  placeholder.hidden=false;cameraTitle.textContent="Povolte přístup ke kameře";cameraHint.textContent="Fotoaparát se spustí automaticky.";
  try{
    var stream=await CardScanner.startCamera(camera);
    if(ticket!==generation||photoBusy||document.hidden){CardScanner.stopCamera(camera);return}
    cameraFrame.classList.remove("photoMode");cameraFrame.removeAttribute("role");cameraFrame.removeAttribute("tabindex");
    placeholder.hidden=true;photoPreview.hidden=true;
    liveSession=CardScanner.createLiveScanner(camera,{
      onStatus:function(info){setStatus(info.state==="loading"?"Připojuji scanner…":"Namiřte na názvy karet")},
      onUpdate:function(snapshot){lastSnapshot=snapshot;var added=addConfirmed(snapshot.detections||[],snapshot.frame,snapshot.observedAt);drawOverlay(snapshot);setStatus(added?"Přidáno "+added+" · "+hand.size()+" karet v ruce":"Hledám další karty…",added?"ok":"")},
      onError:function(){setStatus("Scanner se znovu připojuje…","error")}
    });
    stream.getVideoTracks().forEach(function(track){track.addEventListener("ended",function(){if(ticket===generation){stopPreview();allowLive=false;photoMode("Fotoaparát se odpojil","Klepnutím můžete vyfotit další karty.")}})})
  }catch(error){
    allowLive=false;
    photoMode("Klepněte a vyfoťte karty",error.name==="NotAllowedError"?"Živou kameru povolte v nastavení prohlížeče. Focení je dostupné klepnutím.":"Živý náhled není dostupný. Klepnutím otevřete fotoaparát.")
  }finally{starting=false}
}
cameraFrame.addEventListener("click",function(){if(cameraFrame.classList.contains("photoMode")&&!photoBusy)upload.click()});
cameraFrame.addEventListener("keydown",function(event){if((event.key==="Enter"||event.key===" ")&&cameraFrame.classList.contains("photoMode")){event.preventDefault();if(!photoBusy)upload.click()}});
upload.addEventListener("change",async function(){
  var file=upload.files&&upload.files[0];upload.value="";if(!file||photoBusy)return;
  photoBusy=true;stopPreview();cameraFrame.setAttribute("aria-busy","true");
  try{
    if(photoUrl)URL.revokeObjectURL(photoUrl);photoUrl=URL.createObjectURL(file);
    photoPreview.src=photoUrl;await photoPreview.decode();photoPreview.hidden=false;placeholder.hidden=true;
    setStatus("Čtu názvy karet…");
    var found=await CardScanner.recognize(photoPreview);var added=addConfirmed(found,photoPreview);
    setStatus(added?"Přidáno "+added+" · Klepněte pro další fotku":(found.length?"Karty už jsou v ruce · Klepněte pro další fotku":"Názvy nejsou čitelné · Zkuste další fotku"),added?"ok":"");
    cameraFrame.classList.add("photoMode");cameraFrame.setAttribute("role","button");cameraFrame.tabIndex=0
  }catch(error){photoMode("Fotografii se nepodařilo načíst","Klepnutím zkuste vyfotit karty znovu.");setStatus(error.message||"Zkuste další fotografii.","error")}
  finally{photoBusy=false;cameraFrame.removeAttribute("aria-busy")}
});
document.addEventListener("visibilitychange",function(){if(document.hidden)stopPreview();else startPreview()});
window.addEventListener("pagehide",stopPreview);
window.addEventListener("pageshow",function(event){if(event.persisted)startPreview()});
window.addEventListener("resize",function(){layoutCards();clearOverlay()});
if("ResizeObserver"in window)new ResizeObserver(layoutCards).observe(handCards);
if("serviceWorker"in navigator&&window.isSecureContext)window.addEventListener("load",function(){navigator.serviceWorker.register("./service-worker.js").catch(function(){})});
render();startPreview()
})();
