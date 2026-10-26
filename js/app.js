var cursedHoardItems=false;
var cursedHoardSuits=false;
var playerCount=4;

(function(){
var camera=document.getElementById("camera");
var canvas=document.getElementById("captureCanvas");
var cameraPlaceholder=document.getElementById("cameraPlaceholder");
var startButton=document.getElementById("startCamera");
var stopButton=document.getElementById("stopCamera");
var captureButton=document.getElementById("capture");
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
var manualMatches=[];
var actionDialog=document.getElementById("actionDialog");
var actionTitle=document.getElementById("actionTitle");
var actionBody=document.getElementById("actionBody");
var saveAction=document.getElementById("saveAction");
var currentActionCardId=null;
var lastDetections=[];

var suitNames={land:"Země",flood:"Potopa",weather:"Počasí",flame:"Oheň",army:"Armáda",wizard:"Čaroděj",leader:"Vůdce",beast:"Tvor",weapon:"Zbraň",artifact:"Artefakt",wild:"Divoká"};

function escapeHtml(value){return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}
function registryCard(id){return window.CARD_REGISTRY[id]}
function isBaseId(id){return /^FR(?:0[1-9]|[1-4][0-9]|5[0-4])$/.test(id)}
function baseIds(){return Object.keys(window.CARD_REGISTRY).filter(isBaseId).sort()}
function setStatus(text,type,progress){status.className="status"+(type?" "+type:"");var html=escapeHtml(text||"");if(typeof progress==="number"){var pct=Math.max(0,Math.min(100,Math.round(progress*100)));html+='<div class="progressTrack"><span style="width:'+pct+'%"></span></div>'}status.innerHTML=html}

function addCard(id){
  if(!isBaseId(id))return false;
  if(hand.getCardById(id)){manualStatus.textContent="Tuto kartu už v ruce máš.";return false}
  var card=deck.getCardById(id);
  if(!card)return false;
  if(!hand.addCard(card)){manualStatus.textContent="Tuto kartu teď nelze přidat – zkontroluj limit ruky a pravidlo Nekromanta.";return false}
  render();
  return true
}
function removeCard(id){hand.deleteCardById(id);render()}

function actionDescription(card){
  if(!card||!card.actionData||!card.actionData.length)return "";
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

  if(!hand.size()){handCards.innerHTML='<div class="emptyState">Zatím tu nejsou žádné karty.</div>';return}

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
    if(state)html+='<div class="actionState">'+escapeHtml(state)+'</div>';
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

  handCards.querySelectorAll("[data-remove]").forEach(function(el){el.addEventListener("click",function(){removeCard(el.getAttribute("data-remove"))})});
  handCards.querySelectorAll("[data-action]").forEach(function(el){el.addEventListener("click",function(){openAction(el.getAttribute("data-action"))})});
  handCards.querySelectorAll("[data-clear-action]").forEach(function(el){el.addEventListener("click",function(){hand.undoCardAction(el.getAttribute("data-clear-action"));render()})})
}

function optionHtml(id){var reg=registryCard(id);return '<option value="'+escapeHtml(id)+'">'+escapeHtml(reg?reg.name:id)+'</option>'}

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
    var copyTargets=baseIds().filter(function(targetId){if(targetId===id)return false;var c=deck.getCardById(targetId);return c&&allowed.indexOf(c.suit)>=0});
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
  }else actionCard.actionData=[target.value];
  currentActionCardId=null;
  setTimeout(render,0)
});

startButton.addEventListener("click",async function(){
  try{
    setStatus("Spouštím kameru…");
    await CardScanner.startCamera(camera);
    cameraPlaceholder.style.display="none";
    startButton.disabled=true;captureButton.disabled=false;stopButton.disabled=false;
    setStatus("Kamera běží. Srovnej karty do záběru.")
  }catch(e){setStatus(e.message||String(e),"error")}
});
stopButton.addEventListener("click",function(){
  CardScanner.stopCamera(camera);
  cameraPlaceholder.style.display="";
  startButton.disabled=false;captureButton.disabled=true;stopButton.disabled=true;
  setStatus("Kamera vypnutá.")
});

async function recognize(source){
  detections.innerHTML="";lastDetections=[];
  try{
    setStatus("Připravuji OCR…","",0);
    var found=await CardScanner.recognize(source,function(message){
      var label=message.status?message.status.replace(/_/g," "):"OCR";
      setStatus(label,"",typeof message.progress==="number"?message.progress:undefined)
    });
    lastDetections=found;
    renderDetections();
    if(found.length)setStatus("Rozpoznání dokončeno. Zkontroluj nalezené karty.","ok");
    else setStatus("Nenašel jsem žádný dostatečně jistý název. Zkus bližší nebo ostřejší snímek.","error")
  }catch(e){setStatus(e.message||String(e),"error")}
}
captureButton.addEventListener("click",async function(){await recognize(CardScanner.capture(camera,canvas))});
upload.addEventListener("change",async function(){var file=upload.files&&upload.files[0];if(file)await recognize(file)});

function renderDetections(){
  if(!lastDetections.length){detections.innerHTML="";return}
  var html=lastDetections.map(function(item,index){
    var pct=Math.round(item.score*100),checked=(item.score>=.73||item.votes>=2)&&index<8?" checked":"";
    var votes=item.votes?(" · "+item.votes+"×"):"";
    return '<div class="detectCard"><input type="checkbox" id="det-'+index+'" data-detected="'+item.id+'"'+checked+'><label for="det-'+index+'"><strong>'+escapeHtml(item.name)+'</strong><small>'+pct+'%'+votes+'</small></label></div>'
  }).join("");
  html+='<div class="detectActions"><button id="addDetected" class="primary">Přidat označené do ruky</button></div>';
  detections.innerHTML=html;
  document.getElementById("addDetected").addEventListener("click",function(){
    manualStatus.textContent="";
    var selected=Array.from(detections.querySelectorAll("[data-detected]:checked")).map(function(el){return el.getAttribute("data-detected")});
    var added=0;selected.forEach(function(id){if(addCard(id))added++});
    setStatus("Přidáno karet: "+added+".",added?"ok":"")
  })
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
      if(addCard(id)){
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
  if(!manualMatches.length){manualStatus.textContent="Nejdřív vyber nebo vyhledej kartu.";return}
  var id=manualMatches[0].id;
  if(addCard(id)){
    manualStatus.textContent="Přidána: "+registryCard(id).name;
    manualSearch.value="";
    renderManualResults()
  }
});
document.getElementById("resetHand").addEventListener("click",function(){hand.clear();lastDetections=[];detections.innerHTML="";manualStatus.textContent="";render();renderManualResults()});

if("serviceWorker"in navigator)window.addEventListener("load",function(){navigator.serviceWorker.register("./service-worker.js").catch(function(){})});
render();renderManualResults()
})();