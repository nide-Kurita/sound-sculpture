// LIVE の動き（worklist [P0]）を**再生中に実測**する。
//
// なぜ要るか: ユーザー指摘は2つに分かれる。
//   A 数分の曲だと単調で飽きる
//   B 激しい／波形が分厚い曲では LIVE の動きがほとんど見て取れない
// どちらも「係数を上げる」で潰そうとして過去に何度も外している。**先に切り分ける**ために、
// 打点イベントの量（kick/snare/hat/gesture）と、**画面上で実際に動いた量**
// （変形メッシュ頂点の移動量 world 単位/秒）を**同じフレームで**記録する。
//
// 見たいのは主に飽和率:
//   イベントが天井（clamp01）に張り付いていると、密な曲では「常に最大 = 動かない」になる。
//   satRatio が 1 に近い＝そのチャンネルは**曲のあいだ中ずっと最大**＝変化が見えない。
//
// 読むのは `window.__live`（main.ts の liveDebug。`?surface=dev` が要る）。
// フレーム単位の集計を `take()` で回収するので、ポーリング間隔で取りこぼさない。
//
// 出力: stdout の要約と <outDir>/<曲>.json（5 秒ごとの時系列）
//
// 使い方: node live_motion_probe.js <outDir> [秒数|0=最後まで] [曲名の一部...]
//   node live_motion_probe.js /tmp/live 0                  # 既定の3曲を最後まで
//   node live_motion_probe.js /tmp/live 120 Fury           # Fury を 120 秒だけ（反復用）
//
// **前半／後半の比較（A）は 0（最後まで）でないと意味が無い。**
// 飽和率（B）は 90〜120 秒で十分出る。
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL = `http://localhost:${process.env.PORT || 5173}/?style=vita&surface=dev`;

// B（分厚い）／中間／A の対照（まばらな曲）
const DEFAULT_SONGS = ['Fury', 'ロビンソン', "I'm Yours"];
const STEP = 5;

const runOne = async (b, hint, outDir, maxSeconds) => {
  const p = await b.newPage();
  await p.setViewport({ width: 640, height: 640 });
  const errs = [];
  p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await p.bringToFront();
  await new Promise((r) => setTimeout(r, 6000));
  await p.evaluate(() => document.querySelector('#start-dev-audio')?.click());
  await new Promise((r) => setTimeout(r, 800));
  const picked = await p.evaluate((h) => {
    const sel = document.querySelector('#dev-audio-track');
    if (!sel) return null;
    const norm = (s) => s.normalize('NFC');
    const opt = [...sel.options].find((o) => norm(o.textContent).includes(norm(h)));
    if (!opt) return null;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.textContent;
  }, hint);
  if (!picked) { console.error(`[${hint}] 曲が見つからない`); await p.close(); return null; }
  await new Promise((r) => setTimeout(r, 6000));
  await p.evaluate(() => { if (window.__liveProbe) window.__liveProbe.on = true; });
  // 表示の平滑（[P1]）を環境変数で振れるようにする（dev パネル経由＝実機と同じ経路）
  if (process.env.SMOOTH !== undefined) {
    const got = await p.evaluate((v) => {
      const inputs = [...document.querySelectorAll('#smooth-sliders input[type=range]')];
      if (!inputs.length) return 'no-panel';
      inputs[0].value = String(v);
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      return inputs[0].value;
    }, Number(process.env.SMOOTH));
    console.log(`  変位の平滑 = ${got}`);
  }
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  for (let t = 0; t < 20; t += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await p.evaluate(() => (window.__maturity?.activeSeconds ?? 0) > 0.5)) break;
    if (t === 9) await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  }
  await p.evaluate(() => window.__live?.take());  // 立ち上がりぶんを捨てる

  const series = [];
  let t = 0, done = false;
  const limit = maxSeconds > 0 ? maxSeconds : 780;
  while (t < limit && !done) {
    await new Promise((r) => setTimeout(r, STEP * 1000));
    t += STEP;
    const d = await p.evaluate(() => {
      const s = window.__live?.take();
      return s ? { s, maturity: window.__maturity?.maturity ?? 0, completed: !!window.__maturity?.completed,
                   progress: window.__maturity?.progress ?? -1, axis: window.__mineralAxis?.axis ?? 0,
                   faces: window.__mineralAxis?.crystalFaces ?? 0 } : null;
    });
    if (!d || !d.s || d.s.frames === 0) continue;
    series.push({ t, ...d });
    done = d.completed;
    if (t % 30 === 0 || done) {
      const m = d.s.mean, sd = d.s.sd, sat = d.s.satRatio;
      console.log(`  [${picked.trim()}] t=${t}s fps=${(d.s.frames / d.s.seconds).toFixed(1)} ` +
        `動き core=${m.coreMotion.toFixed(4)} 膜=${m.membraneMotion.toFixed(4)} ` +
        `| thump=${m.thump.toFixed(2)}(sat ${(sat.thump * 100).toFixed(0)}%) ` +
        `chatter=${m.chatter.toFixed(2)}(sat ${(sat.chatter * 100).toFixed(0)}%) ` +
        `listen=${m.listen.toFixed(2)}(sat ${(sat.listen * 100).toFixed(0)}%) ` +
        `膜live=${m.membraneLive.toFixed(2)}(sat ${(sat.membraneLive * 100).toFixed(0)}%) ` +
        `| 粗さ ${m.coreRough.toFixed(3)}→表示 ${m.coreRoughDisplay.toFixed(3)} busy=${m.busy.toFixed(2)} 熟成=${d.maturity.toFixed(2)}` +
        `${done ? ' [完成]' : ''}`);
    }
  }
  fs.writeFileSync(path.join(outDir, `${hint.replace(/[^\w]/g, '_')}.json`),
    JSON.stringify({ song: picked.trim(), errors: errs, series }, null, 1));
  await p.close();

  // 前半／後半の比較（A: 数分で単調になるか）
  const half = Math.floor(series.length / 2);
  const avg = (rows, f) => rows.reduce((a, r) => a + f(r), 0) / Math.max(1, rows.length);
  const first = series.slice(0, half), second = series.slice(half);
  return {
    song: picked.trim(), seconds: series.length ? series[series.length - 1].t : 0, errors: errs.length,
    mean: {
      core: avg(series, (r) => r.s.mean.coreMotion),
      membrane: avg(series, (r) => r.s.mean.membraneMotion),
      corePeak: avg(series, (r) => r.s.mean.coreMotionPeak),
      membranePeak: avg(series, (r) => r.s.mean.membraneMotionPeak),
      coreSd: avg(series, (r) => r.s.sd.coreMotion),
      thump: avg(series, (r) => r.s.mean.thump),
      listen: avg(series, (r) => r.s.mean.listen),
      busy: avg(series, (r) => r.s.mean.busy),
      mLive: avg(series, (r) => r.s.mean.membraneLive),
      midFlash: avg(series, (r) => r.s.mean.midFlash),
      hat: avg(series, (r) => r.s.mean.hat),
      sparkle: avg(series, (r) => r.s.mean.sparkle),
      flash: avg(series, (r) => r.s.mean.flash),
      flashSd: avg(series, (r) => r.s.sd.flash),
    },
    couple: {
      core: avg(series, (r) => r.s.hitCoupling.core),
      membrane: avg(series, (r) => r.s.hitCoupling.membrane),
      hitRatio: avg(series, (r) => r.s.hitCoupling.hitRatio),
    },
    kind: {
      kickContract: avg(series, (r) => r.s.kindPerSec?.kickContract ?? 0),
      snareOut: avg(series, (r) => r.s.kindPerSec?.snareOut ?? 0),
      hatSparkle: avg(series, (r) => r.s.kindPerSec?.hatSparkle ?? 0),
      kickContractMean: avg(series, (r) => r.s.mean?.kickContract ?? 0),
    },
    swim: {
      amp: avg(series, (r) => r.s.mean?.swimAmp ?? 0),
      duck: avg(series, (r) => r.s.mean?.swimDuck ?? 0),
      field: avg(series, (r) => r.s.mean?.swimField ?? 0),
      ampSd: avg(series, (r) => r.s.sd?.swimAmp ?? 0),
    },
    sat: {
      thump: avg(series, (r) => r.s.satRatio.thump),
      ting: avg(series, (r) => r.s.satRatio.ting),
      chatter: avg(series, (r) => r.s.satRatio.chatter),
      sparkle: avg(series, (r) => r.s.satRatio.sparkle),
      listen: avg(series, (r) => r.s.satRatio.listen),
      mLive: avg(series, (r) => r.s.satRatio.membraneLive),
      mGlow: avg(series, (r) => r.s.satRatio.membraneGlow),
      flash: avg(series, (r) => r.s.satRatio.flash),
      midFlash: avg(series, (r) => r.s.satRatio.midFlash),
    },
    half: {
      coreFirst: avg(first, (r) => r.s.mean.coreMotion), coreSecond: avg(second, (r) => r.s.mean.coreMotion),
      sdFirst: avg(first, (r) => r.s.sd.coreMotion), sdSecond: avg(second, (r) => r.s.sd.coreMotion),
      memFirst: avg(first, (r) => r.s.mean.membraneMotion), memSecond: avg(second, (r) => r.s.mean.membraneMotion),
      idleFirst: avg(first, (r) => r.s.mean.idleAmp), idleSecond: avg(second, (r) => r.s.mean.idleAmp),
    },
  };
};

(async () => {
  const outDir = process.argv[2] || 'live';
  const maxSeconds = Number(process.argv[3] ?? 0) || 0;
  const songs = process.argv.length > 4 ? process.argv.slice(4) : DEFAULT_SONGS;
  fs.mkdirSync(outDir, { recursive: true });
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const rows = [];
  for (const hint of songs) {           // **逐次**（背景タブは rAF が止まる）
    const row = await runOne(b, hint, outDir, maxSeconds);
    if (row) rows.push(row);
  }
  await b.close();

  console.log('\n=== 動き（world 単位/秒。曲全体の平均）===');
  console.log('曲                        秒   core平均  core上位5%  膜平均  膜上位5%  揺れ幅(sd)  膜live busy err');
  for (const r of rows) {
    console.log(`${r.song.slice(0, 24).padEnd(24)} ${String(r.seconds).padStart(4)}  ` +
      `${r.mean.core.toFixed(3)}   ${r.mean.corePeak.toFixed(3)}     ${r.mean.membrane.toFixed(3)}  ` +
      `${r.mean.membranePeak.toFixed(3)}    ${r.mean.coreSd.toFixed(3)}` +
      `      ${r.mean.mLive.toFixed(2)}  ${r.mean.busy.toFixed(2)} ${r.errors}`);
  }
  console.log('\n=== 打点が目で分かるか（打点直後の動き ÷ 平常の動き。1.00 = 分からない）===');
  console.log('曲                        core   膜     打点フレーム率  中音フラッシュ平均(sd)  ハット  粒');
  for (const r of rows) {
    console.log(`${r.song.slice(0, 24).padEnd(24)} ${r.couple.core.toFixed(2)}   ${r.couple.membrane.toFixed(2)}` +
      `   ${(r.couple.hitRatio * 100).toFixed(0)}%          ${r.mean.flash.toFixed(3)}(${r.mean.flashSd.toFixed(3)})` +
      `          ${r.mean.hat.toFixed(3)}  ${r.mean.sparkle.toFixed(3)}`);
  }

  console.log('\n=== 段A2 種類の発火（回/秒。キック収縮・スネア外向き・ハット粒子）===');
  console.log('曲                        kick収縮/s  snare外/s  hat粒/s  kickContract平均');
  for (const r of rows) {
    console.log(`${r.song.slice(0, 24).padEnd(24)} ${r.kind.kickContract.toFixed(2).padStart(8)}  ` +
      `${r.kind.snareOut.toFixed(2).padStart(8)}  ${r.kind.hatSparkle.toFixed(2).padStart(7)}  ` +
      `${r.kind.kickContractMean.toFixed(3)}`);
  }

  console.log('\n=== 段A3 遊泳の地（表示専用。bleed なし）===');
  console.log('曲                        swimAmp   duck   field    ampSd');
  for (const r of rows) {
    const s = r.swim || { amp: 0, duck: 1, field: 0, ampSd: 0 };
    console.log(`${r.song.slice(0, 24).padEnd(24)} ${s.amp.toFixed(4)}  ${s.duck.toFixed(2)}  ` +
      `${s.field.toFixed(4)}  ${s.ampSd.toFixed(4)}`);
  }

  console.log('\n=== 飽和率（1.00 = 曲のあいだずっと天井＝変化が見えない）===');
  console.log('曲                        thump  ting  chatter sparkle listen 膜live 膜glow フラッシュ 膜模様');
  for (const r of rows) {
    const f = (v) => v.toFixed(2).padStart(5);
    console.log(`${r.song.slice(0, 24).padEnd(24)} ${f(r.sat.thump)} ${f(r.sat.ting)} ${f(r.sat.chatter)}` +
      ` ${f(r.sat.sparkle)} ${f(r.sat.listen)} ${f(r.sat.mLive)} ${f(r.sat.mGlow)} ${f(r.sat.flash)} ${f(r.sat.midFlash)}`);
  }
  console.log('\n=== 前半 / 後半（A: 数分で単調になるか）===');
  console.log('曲                        core動き前→後       揺れ幅前→後        膜動き前→後       待機ゆらぎ前→後');
  for (const r of rows) {
    const h = r.half;
    console.log(`${r.song.slice(0, 24).padEnd(24)} ${h.coreFirst.toFixed(4)}→${h.coreSecond.toFixed(4)}   ` +
      `${h.sdFirst.toFixed(4)}→${h.sdSecond.toFixed(4)}   ${h.memFirst.toFixed(4)}→${h.memSecond.toFixed(4)}   ` +
      `${h.idleFirst.toFixed(5)}→${h.idleSecond.toFixed(5)}`);
  }
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(rows, null, 1));
})();
