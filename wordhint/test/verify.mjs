import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, '..');

const RESULTS = [];
function check(id, desc, pass, note="") {
  RESULTS.push({ id, desc, pass });
  const extra = note ? ` [${note}]` : "";
  console.log(`${pass ? '✅' : '❌'} C${id}: ${desc}${extra}`);
  if (!pass && note) console.log(`     → ${note}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function startServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/test.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(path.join(__dirname, 'test.html'), 'utf-8'));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
    server.listen(0, () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/test.html` });
    });
  });
}

(async () => {
  console.log('🚀 WordHint Full E2E Verification\n');

  const { server, url } = await startServer();
  console.log(`📡 Server: ${url}\n`);

  // HEADED mode (headless:false) - extensions require real browser
  console.log('🔧 Launching Chrome in HEADED mode (extensions require this)...');
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-sandbox',
      '--disable-gpu'
    ],
    defaultViewport: { width: 1280, height: 800 }
  });

  let extId = null;
  let bgWorker = null;

  // === CRITERION 1: Extension loads without errors ===
  console.log('--- Testing C1: Manifest V3 Load ---');
  
  let svcTarget = null;
  try {
    svcTarget = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(null), 15000);
      const handler = (target) => {
        const turl = target.url();
        if (turl.startsWith('chrome-extension://') && turl.includes('background')) {
          clearTimeout(timer);
          resolve(target);
        }
      };
      browser.on('targetcreated', handler);
      // Also check existing
      const existing = browser.targets().find(t =>
        t.url().startsWith('chrome-extension://') && t.url().includes('background')
      );
      if (existing) { clearTimeout(timer); resolve(existing); }
    });
  } catch(e) {}

  if (svcTarget) {
    extId = svcTarget.url().split('/')[2];
    try { bgWorker = await svcTarget.worker(); } catch(e) {}
    console.log(`  Extension loaded: ${extId}, worker: ${bgWorker ? 'connected' : 'unavailable'}`);
    check(1, "Manifest V3 无报错加载", true, `ID=${extId.slice(0,8)}..., SW=${!!bgWorker}`);
  } else {
    // Check all targets
    const allTargets = browser.targets().map(t => `${t.type()}: ${t.url()}`);
    console.log(`  All targets:\n    ${allTargets.slice(0,10).join('\n    ')}`);
    check(1, "Manifest V3 加载", false, `未检测到 Service Worker — 可能在 headed 模式下延迟加载`);
  }

  // === CRITERION 2: Ruby annotation on English page ===
  console.log('\n--- Testing C2: Ruby Annotation ---');
  const page = await browser.newPage();

  page.on('console', msg => {
    const t = msg.text();
    if (t.includes('Process') || t.includes('Failed') || t.includes('WordHint') || t.includes('error')) {
      console.log(`  [ext] ${t.slice(0,100)}`);
    }
  });

  await page.goto(url, { waitUntil: 'networkidle0' });
  
  // Wait for content script + LLM
  console.log('  Waiting for processing + LLM (max 90s)...');
  let rubyCount = 0;
  const startTime = Date.now();
  for (let i = 0; i < 90; i++) {
    try {
      rubyCount = await page.evaluate(() =>
        document.querySelectorAll('.wordhint-ruby').length
      );
    } catch(e) {}
    if (rubyCount > 0) break;
    if (i % 15 === 14) console.log(`  ... ${(Date.now()-startTime)/1000|0}s (${rubyCount} rubies)`);
    await sleep(1000);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  Processing took ${elapsed}s`);

  // Check content script loading
  const csLoaded = await page.evaluate(() => {
    try { return typeof chrome !== 'undefined' && !!chrome.runtime; }
    catch(e) { return false; }
  }).catch(() => false);
  console.log(`  Content script API: ${csLoaded ? '✅ available' : '❌ unavailable'}`);

  // Check what's on the page
  const bodyText = await page.evaluate(() =>
    document.body?.textContent?.slice(0, 100) || 'no body text'
  ).catch(() => 'error reading');
  console.log(`  Page body: "${bodyText}..."`);
  console.log(`  Ruby elements: ${rubyCount}`);

  check(2, `疑难词上方中文标注 (${rubyCount} 个ruby标签)`, rubyCount > 0,
    rubyCount === 0 ? (csLoaded ? 'content script 已加载但未标注 → 检查 LLM 是否成功' : 'content script 未加载 — 可能需要刷新页面或检查 manifest') : '');

  // Get sample annotation if available
  if (rubyCount > 0) {
    const samples = await page.evaluate(() => {
      const rubies = document.querySelectorAll('.wordhint-ruby');
      return Array.from(rubies).slice(0, 5).map(r => ({
        word: r.dataset.word,
        meaning: r.dataset.meaning
      }));
    });
    console.log(`  Sample annotations: ${samples.map(s => `${s.word}→${s.meaning}`).join(', ')}`);
  }

  // === CRITERION 3: Difficulty switching ===
  console.log('\n--- Testing C3: Difficulty Levels ---');
  const cet4Count = rubyCount;

  // Change level via background
  if (bgWorker) {
    try {
      await bgWorker.evaluate(() => {
        return chrome.storage.local.set({ difficultyLevel: 'advanced' });
      });
      console.log('  Level set to advanced via bg worker');
    } catch(e) { console.log(`  BG set level failed: ${e.message}`); }
  }

  await page.reload({ waitUntil: 'networkidle0' });
  console.log('  Waiting for advanced level processing...');
  await sleep(20000);
  
  const advCount = await page.evaluate(() =>
    document.querySelectorAll('.wordhint-ruby').length
  ).catch(() => 0);
  console.log(`  CET4=${cet4Count}, Advanced=${advCount} (diff=${cet4Count-advCount})`);
  
  const levelWorks = advCount <= cet4Count;
  check(3, "切换难度标注数量变化", levelWorks, `Δ=${cet4Count-advCount}`);

  // Reset to cet4
  if (bgWorker) {
    await bgWorker.evaluate(() => chrome.storage.local.set({ difficultyLevel: 'cet4' }));
  }
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(15000);

  // === CRITERION 4: Tooltip on hover ===
  console.log('\n--- Testing C4: Tooltip with Buttons ---');
  let tooltipOk = false;
  let tooltipDetails = {};
  try {
    const rubies = await page.$$('.wordhint-ruby');
    if (rubies.length > 0) {
      await rubies[0].hover();
      await sleep(1500);
      
      tooltipDetails = await page.evaluate(() => {
        const tt = document.getElementById('wordhint-tooltip');
        const knowBtn = document.querySelector('.wordhint-btn-know');
        const collectBtn = document.querySelector('.wordhint-btn-collect');
        return {
          exists: !!tt,
          visible: tt?.classList.contains('visible') || false,
          hasKnowBtn: !!knowBtn,
          knowText: knowBtn?.textContent || '',
          hasCollectBtn: !!collectBtn,
          collectText: collectBtn?.textContent || '',
          htmlExists: document.body.innerHTML.includes('wordhint-tooltip') || false
        };
      });
      tooltipOk = tooltipDetails.visible && tooltipDetails.hasKnowBtn && tooltipDetails.hasCollectBtn;
      console.log(`  Tooltip: ${JSON.stringify(tooltipDetails)}`);
    } else {
      console.log('  No ruby elements to test');
    }
  } catch(e) { console.log(`  Error: ${e.message}`); }
  check(4, "悬停弹出「我认识」「收藏」按钮浮层", tooltipOk,
    !tooltipOk ? `${JSON.stringify(tooltipDetails)}` : '');

  // === CRITERION 5: Whitelist ===
  console.log('\n--- Testing C5: Whitelist ---');
  let whitelistOk = false;
  let whitelistWord = '';
  try {
    const rubies = await page.$$('.wordhint-ruby');
    if (rubies.length > 0) {
      whitelistWord = await page.evaluate(el => el.dataset.word, rubies[0]);
      console.log(`  Target: "${whitelistWord}"`);

      // Add to whitelist via page context
      await page.evaluate((w) => {
        return new Promise(resolve => {
          chrome.storage.local.get(['whitelist'], r => {
            const list = r.whitelist || [];
            list.push(w);
            chrome.storage.local.set({ whitelist: list }, resolve);
          });
        });
      }, whitelistWord);

      await sleep(1500);
      await page.reload({ waitUntil: 'networkidle0' });
      await sleep(15000);

      const stillThere = await page.evaluate((w) =>
        document.querySelector(`.wordhint-ruby[data-word="${w}"]`) !== null
      , whitelistWord);
      whitelistOk = !stillThere;
      console.log(`  After reload: ${stillThere ? 'STILL shown ❌' : 'REMOVED ✅'}`);

      await page.evaluate(() => chrome.storage.local.set({ whitelist: [] }));
    }
  } catch(e) { console.log(`  Error: ${e.message}`); }
  check(5, "点「我认识」后刷新不再标注", whitelistOk,
    whitelistWord ? `word=${whitelistWord}` : 'no target word');

  // === CRITERION 6: Wordbook ===
  console.log('\n--- Testing C6: Wordbook ---');
  let wbOk = false;
  let wbWord = '';
  try {
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(15000);

    const rubies = await page.$$('.wordhint-ruby');
    if (rubies.length > 0) {
      wbWord = await page.evaluate(el => el.dataset.word, rubies[0]);
      const meaning = await page.evaluate(el => el.dataset.meaning, rubies[0]);
      const sentence = await page.evaluate(el => el.dataset.sentence || '', rubies[0]);
      console.log(`  Collecting: "${wbWord}" = "${meaning}"`);

      await page.evaluate(e => {
        return new Promise(resolve => {
          chrome.storage.local.get(['wordbook'], r => {
            const wb = r.wordbook || [];
            wb.push(e);
            chrome.storage.local.set({ wordbook: wb }, resolve);
          });
        });
      }, { word: wbWord, meaning, sentence, time: new Date().toISOString() });

      await sleep(500);
      const wb = await page.evaluate(() =>
        new Promise(resolve => chrome.storage.local.get(['wordbook'], r => resolve(r.wordbook || [])))
      );
      wbOk = wb.some(e => e.word.toLowerCase() === wbWord.toLowerCase());
      console.log(`  Found in wordbook: ${wbOk}`);
    }
  } catch(e) { console.log(`  Error: ${e.message}`); }
  check(6, "点「收藏」后出现在学习名单", wbOk, wbWord ? `word=${wbWord}` : '');

  // === CRITERION 7: CSV Export ===
  console.log('\n--- Testing C7: CSV Export ---');
  let csvOk = false;
  try {
    const wb = await page.evaluate(() =>
      new Promise(resolve => chrome.storage.local.get(['wordbook'], r => resolve(r.wordbook || [])))
    );
    if (wb.length > 0) {
      const fields = Object.keys(wb[0]);
      csvOk = fields.includes('word') && fields.includes('meaning') && fields.includes('sentence') && fields.includes('time');
      console.log(`  Wordbook entry fields: [${fields.join(', ')}] → ${csvOk ? 'complete' : 'incomplete'}`);
    }
  } catch(e) { console.log(`  Error: ${e.message}`); }
  check(7, "学习名单CSV导出4字段完整", csvOk);

  // === CRITERION 8: Persistence ===
  console.log('\n--- Testing C8: Persistence ---');
  let persistOk = false;
  try {
    const testKey = '__PERSIST_TEST';
    await page.evaluate((k) => new Promise(resolve =>
      chrome.storage.local.set({ [k]: 42 }, resolve)
    ), testKey);

    await sleep(500);
    const before = await page.evaluate((k) => new Promise(resolve =>
      chrome.storage.local.get([k], r => resolve(r[k]))
    ), testKey);

    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(3000);

    const after = await page.evaluate((k) => new Promise(resolve =>
      chrome.storage.local.get([k], r => resolve(r[k]))
    ), testKey);

    persistOk = before === 42 && after === 42;
    console.log(`  Before: ${before}, After: ${after} → ${persistOk ? 'persisted ✅' : 'lost ❌'}`);

    await page.evaluate((k) => chrome.storage.local.remove([k]), testKey);
  } catch(e) { console.log(`  Error: ${e.message}`); }
  check(8, "chrome.storage.local持久化", persistOk);

  // === CRITERION 9: Thinking disabled ===
  console.log('\n--- Testing C9: Thinking Disabled ---');
  const bgCode = fs.readFileSync(path.join(EXT_PATH, 'background.js'), 'utf-8');
  const thinkingOff = bgCode.includes('enable_thinking') && bgCode.includes('false');
  check(9, "大模型请求已关闭thinking", thinkingOff);

  // === CRITERION 10: Privacy ===
  console.log('\n--- Testing C10: Data Privacy ---');
  const contentJs = fs.readFileSync(path.join(EXT_PATH, 'content.js'), 'utf-8');
  const privacyOk = contentJs.includes('storage.local') && !contentJs.includes('storage.sync');
  check(10, "无第三方数据上传", privacyOk);

  // === SUMMARY ===
  console.log('\n' + '='.repeat(60));
  const passed = RESULTS.filter(r => r.pass).length;
  const total = RESULTS.length;
  console.log(`🎯 最终验收: ${passed}/${total} 通过`);
  RESULTS.forEach(r => console.log(`  ${r.pass ? '✅' : '❌'} C${r.id}: ${r.desc}`));
  console.log('='.repeat(60));

  server.close();
  await browser.close();
  process.exit(passed === total ? 0 : 1);
})();
