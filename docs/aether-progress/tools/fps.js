const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os=require('os'),path=require('path');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
(async()=>{
  const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio']});
  for (const style of ['aether','vita']) {
    const p=await b.newPage(); await p.setViewport({width:900,height:900});
    await p.goto(`http://localhost:5173/?style=${style}`,{waitUntil:'networkidle2',timeout:60000});
    await new Promise(r=>setTimeout(r,6000));
    const fps = await p.evaluate(()=>new Promise(res=>{
      let n=0; const t0=performance.now();
      const tick=()=>{ n++; if(performance.now()-t0<5000) requestAnimationFrame(tick); else res(n/((performance.now()-t0)/1000)); };
      requestAnimationFrame(tick);
    }));
    console.log(`${style}: ${fps.toFixed(1)} fps (ヘッドレス／ソフトウェアレンダ)`);
    await p.close();
  }
  await b.close();
})();
