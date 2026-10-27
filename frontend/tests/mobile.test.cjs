const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright-core');
const root='/ui';
const ids=['FR28','FR01','FR03','FR04','FR20','FR21','FR49','FR53'];
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const actual=pathname==='/'?path.join(root,'index.html'):path.join(root,decodeURIComponent(pathname));
  if(!actual.startsWith(root+'/')){res.writeHead(403);return res.end()}
  fs.readFile(actual,(err,data)=>{res.writeHead(err?404:200,{'Content-Type':types[path.extname(actual)]||'application/octet-stream'});res.end(err?'Not found':data)})
});
function mockCamera(denied=false){
  window.__cameraRequests=0;
  window.__streams=[];
  const media={getUserMedia:async function(constraints){
    window.__cameraRequests++;window.__cameraConstraints=constraints;
    if(denied)throw new DOMException('Permission denied','NotAllowedError');
    const canvas=document.createElement('canvas');canvas.width=720;canvas.height=1280;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#77614b';ctx.fillRect(0,0,720,1280);
    const colors=['#71473c','#48635b','#494e72','#6b5945','#5b4767','#405765','#6b453c','#565939'];
    for(let i=0;i<8;i++){
      const x=22+(i%4)*174,y=340+Math.floor(i/4)*245;
      ctx.fillStyle=colors[i];ctx.fillRect(x,y,155,218);ctx.strokeStyle='#e2ba79';ctx.lineWidth=3;ctx.strokeRect(x,y,155,218);
      ctx.fillStyle='#d0ad77';ctx.fillRect(x+12,y+40,131,100);ctx.fillStyle='#342a30';ctx.fillRect(x+17,y+45,121,90);
      ctx.fillStyle='#e3d2ad';ctx.font='15px serif';ctx.fillText('Tajuplné říše',x+14,y+25);ctx.font='11px sans-serif';ctx.fillText('Naskenovaná karta',x+13,y+166)
    }
    const stream=canvas.captureStream(8);window.__streams.push(stream);return stream
  }};
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:media});
  const toBlob=HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){window.__lastEncoding={width:this.width,height:this.height,type,quality};return toBlob.call(this,callback,type,quality)};
  const draw=CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage=function(...args){if(args[0] instanceof HTMLVideoElement)window.__videoCrop={args:args.slice(1),width:args[0].videoWidth,height:args[0].videoHeight};return draw.apply(this,args)};
}
async function api(context,selected,failHealthOnce=false){
  let active=0,maximum=0,requests=0,healthRequests=0;
  await context.route('**/api/v1/health',route=>{healthRequests++;return failHealthOnce&&healthRequests===1?route.fulfill({status:503,json:{detail:'Starting'}}):route.fulfill({json:{ok:true,ocr:'PaddleOCR',lang:'cs'}})});
  await context.route('**/api/v1/scan*',async route=>{
    active++;maximum=Math.max(maximum,active);requests++;
    await new Promise(resolve=>setTimeout(resolve,75));
    const cards=selected.map((id,i)=>({id,name:id,accepted:true,ocrText:id,matchConfidence:1,combinedConfidence:.98,ocrConfidence:.99,titleConfidence:.85,box:{x0:.03+(i%4)*.24,y0:.12+Math.floor(i/4)*.4,x1:.22+(i%4)*.24,y1:.24+Math.floor(i/4)*.4}}));
    try{await route.fulfill({json:{processingMs:75,cards,candidates:[]}})}finally{active--}
  });
  return ()=>({maximum,requests,healthRequests})
}
async function layout(page,width,height){
  await page.setViewportSize({width,height});
  await page.waitForTimeout(60);
  const metrics=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,bodyHeight:document.body.scrollHeight,camera:document.getElementById('cameraFrame').getBoundingClientRect().toJSON(),header:document.querySelector('.topbar').getBoundingClientRect().toJSON(),cards:Array.from(document.querySelectorAll('.cardSnap')).map(el=>el.getBoundingClientRect().toJSON())}));
  assert.ok(metrics.scrollWidth<=width+1,JSON.stringify(metrics));assert.ok(metrics.scrollHeight<=height+1,JSON.stringify(metrics));assert.ok(metrics.bodyHeight<=height+1,JSON.stringify(metrics));
  assert.ok(metrics.camera.height<=height/3+1,JSON.stringify(metrics));assert.ok(metrics.camera.bottom<=height+1,JSON.stringify(metrics));
  for(const card of metrics.cards){assert.ok(card.top>=metrics.header.bottom-1);assert.ok(card.bottom<=metrics.camera.top+1);assert.ok(card.width>0&&card.height>0)}
  return metrics
}
(async()=>{
  await new Promise(resolve=>server.listen(8193,'0.0.0.0',resolve));
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium-browser',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--renderer-process-limit=2','--num-raster-threads=1','--host-resolver-rules=MAP scanner.invalid 127.0.0.1']});
  const failures=[];
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
    await context.addInitScript(mockCamera,false);const stats=await api(context,ids,true);const page=await context.newPage();page.on('pageerror',error=>failures.push(error.message));
    await page.goto('http://localhost:8193/');
    await page.waitForFunction(()=>document.getElementById('handCount').textContent==='8');
    assert.equal(await page.evaluate(()=>window.__cameraRequests),1,'camera must start without clicking');
    assert.equal(await page.evaluate(()=>window.__cameraConstraints.audio),false);
    assert.equal(await page.locator('.cardSnap').count(),8,'Nekromant must permit the eighth card');
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.cardSnap img')].filter(img=>img.src.startsWith('data:image/jpeg')&&img.naturalWidth>0).length),8);
    assert.equal(await page.locator('#score').textContent(),String(await page.evaluate(()=>hand.score(discard))));
    const crop=await page.evaluate(()=>window.__videoCrop);assert.ok(crop.args[1]>0);assert.ok(crop.args[3]<crop.height,'scan must crop to visible camera panel');
    assert.equal(stats().maximum,1,'OCR requests must remain serial');
    assert.ok(stats().healthRequests>=2,'scanner must recover when the server is still starting');
    for(const [w,h] of [[390,844],[375,667],[320,568],[844,390],[360,640]])await layout(page,w,h);
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(180);
    await page.screenshot({path:'/ui-artifacts/mobile-scanned.png'});
    await page.locator('[data-card-id="FR49"]').click();
    await page.locator('#actionTarget').selectOption('FR04');await page.locator('#actionSuit').selectOption('flood');await page.locator('#saveAction').click();
    await page.waitForFunction(()=>hand.getCardById('FR49').actionData&&hand.getCardById('FR49').actionData[1]==='flood');
    await page.locator('[data-card-id="FR01"]').click();await page.locator('#removeCard').click();
    await page.waitForTimeout(400);assert.equal(await page.locator('#handCount').textContent(),'7','removed card must stay suppressed');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
    assert.equal(await page.evaluate(()=>window.__streams[0].getTracks().every(track=>track.readyState==='ended')),true);
    await context.close();

    const plain=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});await plain.addInitScript(mockCamera,false);await api(plain,ids.slice(0,7));
    const photo=await plain.newPage();photo.on('pageerror',error=>failures.push(error.message));await photo.goto('http://scanner.invalid:8193/');
    await photo.waitForSelector('.cameraFrame.photoMode');assert.equal(await photo.evaluate(()=>window.isSecureContext),false);assert.equal(await photo.evaluate(()=>window.__cameraRequests),0);
    assert.match(await photo.locator('#cameraHint').textContent(),/HTTPS/);
    await layout(photo,390,844);await photo.screenshot({path:'/ui-artifacts/mobile-http.png'});
    const image=await photo.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=1536;canvas.height=2048;const ctx=canvas.getContext('2d');ctx.fillStyle='#695641';ctx.fillRect(0,0,1536,2048);return canvas.toDataURL('image/png').split(',')[1]});
    await photo.locator('#imageUpload').setInputFiles({name:'phone-camera.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
    await photo.waitForFunction(()=>document.getElementById('handCount').textContent==='7');assert.equal(await photo.locator('.cardSnap').count(),7);
    assert.deepEqual(await photo.evaluate(()=>window.__lastEncoding),{width:960,height:1280,type:'image/jpeg',quality:.9},'native photos must use the measured JPEG settings');
    await plain.close();

    const denied=await browser.newContext({viewport:{width:390,height:844}});await denied.addInitScript(mockCamera,true);await api(denied,[]);
    const blocked=await denied.newPage();blocked.on('pageerror',error=>failures.push(error.message));await blocked.goto('http://localhost:8193/');await blocked.waitForSelector('.cameraFrame.photoMode');
    assert.match(await blocked.locator('#cameraHint').textContent(),/nastavení prohlížeče/);assert.equal(await blocked.evaluate(()=>window.__cameraRequests),1);
    await denied.close();assert.deepEqual(failures,[]);
    console.log('PASS: automatic camera, health recovery, HTTP photo fallback, permission denial, snapshots, eight cards, scoring, effects, removal cooldown, serial requests, visible-frame crop, five viewport sizes.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1;server.close()});
