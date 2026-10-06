// Headless Chromium frame driver.
//   node render.js frames <start> <end> <outdir>     -> PNG per frame (frame index = round(t*60))
//   node render.js stills <outdir> t1 t2 ...          -> PNG at given times
//   node render.js events <out.json>                  -> export the sound-event timeline
const path = require('path'), fs = require('fs');
const mode = process.argv[2];
if (mode === 'events') {
  const TL = require('./timeline.js');
  fs.writeFileSync(process.argv[3], JSON.stringify({ fps: TL.FPS, dur: TL.DUR, chords: TL.CHORDS, events: TL.EVENTS }, null, 1));
  console.log('events', TL.EVENTS.length); process.exit(0);
}
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--disable-gpu-vsync', '--force-color-profile=srgb', '--disable-lcd-text'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  page.on('pageerror', (e) => { console.error('PAGE ERROR', e.message); process.exit(1); });
  page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto('file://' + path.resolve(__dirname, 'index.html'));
  await page.waitForFunction('window.READY === true', null, { timeout: 30000 });
  const write = async (t, file) => { const b64 = await page.evaluate((t) => window.frameData(t), t); fs.writeFileSync(file, Buffer.from(b64, 'base64')); };
  if (mode === 'frames') {
    const [s, e, dir] = [+process.argv[3], +process.argv[4], process.argv[5]];
    fs.mkdirSync(dir, { recursive: true });
    const t0 = Date.now();
    for (let f = s; f < e; f++) {
      await write(f / 60, path.join(dir, `f${String(f).padStart(5, '0')}.png`));
      if ((f - s) % 60 === 0) console.log(`frame ${f} ${((Date.now() - t0) / (f - s + 1)).toFixed(0)} ms/f`);
    }
  } else if (mode === 'stills') {
    const dir = process.argv[3]; fs.mkdirSync(dir, { recursive: true });
    for (const ts of process.argv.slice(4)) await write(+ts, path.join(dir, `s_${(+ts).toFixed(2)}.png`));
  }
  await browser.close();
})();
