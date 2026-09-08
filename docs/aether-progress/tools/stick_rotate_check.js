// sculpture-stick がオブジェクトの向き（group.quaternion）を動かせるかを確認する。
//
// 2026-09-07: 遊泳が group.rotation.x/z を毎フレーム上書きして回転操作が死んだ。
// 向きは HUD 目盛り（#hud-ticks = pitch、#hud-ticks-x = yaw）の --tick-grow に出る。
//
// 使い方: node stick_rotate_check.js [URL]
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os');
const path = require('path');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

const l1 = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - (b[i] ?? 0)), 0);

const readTicks = () => {
  const grows = (sel) =>
    [...document.querySelectorAll(`${sel} .hud-tick-mark`)].map((el) =>
      Number.parseFloat(el.style.getPropertyValue('--tick-grow') || '0'),
    );
  return { pitch: grows('#hud-ticks'), yaw: grows('#hud-ticks-x') };
};

(async () => {
  const url = process.argv[2] || 'http://localhost:5173/?style=vita';
  const b = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 900, height: 900 });
  const errs = [];
  p.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !t.includes('404')) errs.push(t);
  });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));

  const stick = await p.$('#sculpture-stick');
  if (!stick) {
    console.error('FAIL: #sculpture-stick が無い');
    await b.close();
    process.exit(1);
  }
  const box = await stick.boundingBox();
  if (!box) {
    console.error('FAIL: stick の bbox が取れない');
    await b.close();
    process.exit(1);
  }

  const beforeIdle = await p.evaluate(readTicks);
  await new Promise((r) => setTimeout(r, 1200));
  const afterIdle = await p.evaluate(readTicks);
  const idlePitch = l1(beforeIdle.pitch, afterIdle.pitch);
  const idleYaw = l1(beforeIdle.yaw, afterIdle.yaw);

  const cx = box.x + box.width * 0.5;
  const cy = box.y + box.height * 0.5;
  const travel = Math.min(box.width, box.height) * 0.4;

  await p.mouse.move(cx, cy);
  await p.mouse.down();
  await p.mouse.move(cx + travel, cy, { steps: 8 });
  await new Promise((r) => setTimeout(r, 1100));
  const yawHold = await p.evaluate(readTicks);
  const stickYaw = await p.evaluate(() => ({
    on: document.querySelector('#sculpture-stick')?.classList.contains('is-active'),
    x: document.querySelector('#sculpture-stick')?.style.getPropertyValue('--stick-x') || '',
    y: document.querySelector('#sculpture-stick')?.style.getPropertyValue('--stick-y') || '',
  }));
  await p.mouse.up();
  await new Promise((r) => setTimeout(r, 200));

  await p.mouse.move(cx, cy);
  await p.mouse.down();
  await p.mouse.move(cx, cy + travel, { steps: 8 });
  await new Promise((r) => setTimeout(r, 1100));
  const pitchHold = await p.evaluate(readTicks);
  const stickPitch = await p.evaluate(() => ({
    on: document.querySelector('#sculpture-stick')?.classList.contains('is-active'),
    y: document.querySelector('#sculpture-stick')?.style.getPropertyValue('--stick-y') || '',
  }));
  await p.mouse.up();

  const yawDelta = l1(afterIdle.yaw, yawHold.yaw);
  const pitchDelta = l1(yawHold.pitch, pitchHold.pitch);

  console.log(
    `idle pitch=${idlePitch.toFixed(4)} yaw=${idleYaw.toFixed(4)}  ` +
      `hold yaw=${yawDelta.toFixed(4)} pitch=${pitchDelta.toFixed(4)}  ` +
      `stickYaw=${stickYaw.on}/${stickYaw.x} stickPitch=${stickPitch.on}/${stickPitch.y}`,
  );
  if (errs.length) {
    console.log('errors:', errs.slice(0, 6).join(' | '));
  }

  const okIdle = idlePitch < 0.12 && idleYaw < 0.12;
  const okYaw = yawDelta > 0.12 && Number.parseFloat(stickYaw.x) > 4;
  const okPitch = pitchDelta > 0.12 && Number.parseFloat(stickPitch.y) > 4;
  if (okIdle && okYaw && okPitch) {
    console.log('PASS: スティックで yaw/pitch が動き、保持なしでは group 向きが漂わない');
    await b.close();
    process.exit(0);
  }
  console.error(
    `FAIL: idle=${okIdle ? 'ok' : 'drift'} yaw=${okYaw ? 'ok' : 'no-rotate'} pitch=${okPitch ? 'ok' : 'no-rotate'}`,
  );
  await b.close();
  process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
