// 検証用キャプチャ（dev パネルの「3方向を保存」）が、比較に使える画像を出すかを確かめる。
//
// なぜ要るか: この機能の目的は「曲どうしのシルエットを比べられる画像を作る」こと。
// 満たすべき条件は3つで、どれか1つでも崩れると 30 分かけた実機測定が無駄になる。
//   1. 3枚 保存されること（0° / 120° / 240°）
//   2. 全部 900x900 で、画角が同一であること
//   3. **押すたびに同じ絵になること**（＝カメラの漂いと彫刻の向きが打ち消せている）
//      ここが崩れていると、silhouette.js は形ではなくカメラ角度の差を測る。
//
// 使い方: node capture_check.js [URL] [待ちms]
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const { decode } = require('./png.js');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

(async () => {
  const url = process.argv[2] || 'http://localhost:5173/?style=vita&surface=dev';
  const wait = Number(process.argv[3] || 9000);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-check-'));
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1200, height: 800 });
  const errs = [];
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  const client = await p.createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: outDir });
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, wait));

  console.log('panel:', JSON.stringify(await p.evaluate(() => {
    const el = document.querySelector('#capture-panel');
    return { found: Boolean(el), hidden: el ? el.hidden : null, hasButton: Boolean(document.querySelector('#capture-verify')) };
  })));

  // 完成状態にしてから撮る（比較対象は完成形）
  await p.evaluate(() => {
    const btn = document.querySelector('#complete-sculpture');
    if (btn) { btn.disabled = false; btn.click(); }
  });
  await new Promise(r => setTimeout(r, 9000));

  const shoot = async (round) => {
    await p.evaluate(() => document.querySelector('#capture-verify')?.click());
    await new Promise(r => setTimeout(r, 2500));
    // 前ラウンドで r<n>_ を付けた分を拾わないこと（拾うと名前が二重になって壊れる）
    const files = fs.readdirSync(outDir).filter(f => f.endsWith('.png') && !/^r\d+_/u.test(f));
    const moved = [];
    for (const f of files) {
      const to = path.join(outDir, `r${round}_${f}`);
      fs.renameSync(path.join(outDir, f), to);
      moved.push(to);
    }
    return moved.sort();
  };

  const round1 = await shoot(1);
  console.log(`1回目: ${round1.length} 枚`);
  for (const f of round1) {
    const img = decode(f);
    console.log(`  ${path.basename(f)} — ${img.width}x${img.height}`);
  }

  // 彫刻をドラッグで回してからもう一度押す。向きが打ち消せていれば同じ絵に戻るはず。
  await p.mouse.move(600, 400);
  await p.mouse.down();
  for (let i = 1; i <= 8; i += 1) {
    await p.mouse.move(600 + i * 25, 400 + i * 8);
    await new Promise(r => setTimeout(r, 16));
  }
  await p.mouse.up();
  await new Promise(r => setTimeout(r, 1500));
  const round2 = await shoot(2);
  console.log(`2回目（間にドラッグで回した）: ${round2.length} 枚`);

  // 同じ yaw どうしを突き合わせる。完成後も呼吸で動くので完全一致にはならないが、
  // 「カメラ角度がずれた」レベルの差なら桁で分かる。
  const luma = (img, i) => 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
  const compare = (fa, fb) => {
    const a = decode(fa), bb = decode(fb);
    if (a.width !== bb.width || a.height !== bb.height) return 'サイズ不一致';
    let diffPx = 0, px = 0, maxD = 0;
    for (let i = 0; i < a.data.length; i += a.bpp) {
      px += 1;
      const d = Math.abs(luma(a, i) - luma(bb, i));
      if (d > 8) diffPx += 1;
      if (d > maxD) maxD = d;
    }
    return `差のある画素 ${((diffPx / px) * 100).toFixed(2)}% / 最大差 ${maxD.toFixed(0)}`;
  };
  for (let i = 0; i < Math.min(round1.length, round2.length); i += 1) {
    const yaw = path.basename(round1[i]).match(/yaw(\d+)/)?.[1] ?? '?';
    console.log(`  yaw${yaw}: ${compare(round1[i], round2[i])}`);
  }
  console.log('（呼吸で動くぶんの差は出る。カメラ角度がずれていれば数十%になる）');
  console.log('保存先:', outDir);
  console.log('console errors:', errs.length ? errs : 'none');
  await b.close();
})();
