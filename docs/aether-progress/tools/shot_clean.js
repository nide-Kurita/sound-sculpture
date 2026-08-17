// UI を隠して canvas だけを撮る（参考動画と同じ画角で比較するため）
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os=require('os'),path=require('path');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
(async()=>{
  const out=process.argv[2], url=process.argv[3], wait=Number(process.argv[4]||7000);
  const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--hide-scrollbars','--mute-audio']});
  const p=await b.newPage(); await p.setViewport({width:900,height:900});
  const errs=[]; p.on('console',m=>{const t=m.text(); if(m.type()==='error'&&!t.includes('404'))errs.push(t);});
  p.on('pageerror',e=>errs.push('pageerror: '+e.message));
  await p.goto(url,{waitUntil:'networkidle2',timeout:60000});
  await new Promise(r=>setTimeout(r,wait));
  await p.evaluate(()=>{
    const cs=[...document.querySelectorAll('canvas')];
    if(!cs.length) return;
    const c=cs.sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];
    const keep=new Set(); for(let e=c;e;e=e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach(e=>{ if(!keep.has(e)) e.style.visibility='hidden'; });
  });
  await new Promise(r=>setTimeout(r,400));
  await p.screenshot({path:out});
  console.log('saved',out, errs.length?'\nERRORS:\n'+errs.join('\n'):'| console errors: 0');
  await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
