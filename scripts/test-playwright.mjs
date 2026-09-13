import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  
  page.on('console', msg => console.log(`[browser] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.log(`[browser pageerror] ${err.message}`));
  
  await page.setContent(`<!DOCTYPE html><html><body><div id="player"></div></body></html>`);
  await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-player@4.2.14/dist/iife/spine-player.js' });
  
  await page.evaluate(`
    window.__captureError = null;
    window.__ready = false;
    new spine.SpinePlayer('player', {
      skeleton: 'https://spine-link.vercel.app/api/github-asset?path=library/s300015-2026-07-27T09-55-56-118Z/s300015/s300015.json',
      atlas: 'https://spine-link.vercel.app/api/github-asset?path=library/s300015-2026-07-27T09-55-56-118Z/s300015/s300015.atlas',
      animation: 'Animation_1_Loop',
      showLoading: false,
      success: function(player) {
        console.log("SUCCESS CALLBACK FIRED!");
        window.__ready = true;
      },
      error: function(player, msg) {
        console.log("ERROR CALLBACK FIRED: " + msg);
        window.__captureError = msg;
      }
    });
  `);
  
  await new Promise(r => setTimeout(r, 5000));
  await browser.close();
})();
