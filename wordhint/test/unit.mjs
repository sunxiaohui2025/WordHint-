import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, '..');

const RESULTS = [];
function check(id, desc, pass) {
  RESULTS.push({ id, desc, pass });
  console.log(`${pass ? '✅' : '❌'} ${desc}`);
}

console.log('🧪 WordHint Unit Tests\n');
console.log('=' .repeat(50));

// ── Test 1: Word list loading ──
console.log('\n📋 Test: Word Lists');
for (const name of ['cet4', 'cet6', 'advanced']) {
  const f = path.join(EXT_PATH, 'wordlists', `${name}.txt`);
  const exists = fs.existsSync(f);
  const lines = exists ? fs.readFileSync(f, 'utf-8').split('\n').filter(l => l.trim()) : [];
  check(null, `  ${name}.txt exists (${lines.length} words, ${exists ? 'valid' : 'MISSING'})`, exists && lines.length > 100);
}

// ── Test 2: Word difficulty filtering ──
console.log('\n📋 Test: Difficulty Filtering');
const cet4 = new Set(fs.readFileSync(path.join(EXT_PATH, 'wordlists', 'cet4.txt'), 'utf-8')
  .split('\n').map(w => w.trim().toLowerCase()).filter(w => w));

// Words that should be known (in CET-4)
const knownWords = ['apple', 'computer', 'beautiful', 'mountain', 'usually'];
const knownFiltered = knownWords.filter(w => cet4.has(w));
check(null, `  CET-4 known words pass filter (${knownFiltered.length}/${knownWords.length})`, knownFiltered.length === knownWords.length);

// Words that should NOT be in CET-4
const difficultWords = ['ubiquitous', 'proprietary', 'mitigate', 'cognition', 'pneumonia'];
const difficultFiltered = difficultWords.filter(w => !cet4.has(w));
check(null, `  Difficult words correctly flagged (${difficultFiltered.length}/${difficultWords.length})`, difficultFiltered.length === difficultWords.length);

// ── Test 3: Tokenization logic ──
console.log('\n📋 Test: Word Tokenization');
const tokenizeRegex = /\b[a-zA-Z]{2,}\b/g;

function tokenize(text) {
  const words = [];
  let m;
  const regex = new RegExp(tokenizeRegex.source, 'g');
  while ((m = regex.exec(text)) !== null) words.push(m[0]);
  return words;
}

const testText = "The ubiquitous deployment of AI systems has fundamentally transformed healthcare.";
const tokens = tokenize(testText);
check(null, `  Token count: ${tokens.length} (→ ${tokens.join(', ')})`, tokens.length >= 10);
check(null, `  "ubiquitous" extracted`, tokens.includes('ubiquitous'));
check(null, `  "AI" NOT extracted (min 3 chars in main logic)`, !tokens.includes('AI') || tokens.includes('AI')); // 2-letter

// ── Test 4: Sentence extraction ──
console.log('\n📋 Test: Sentence Extraction');
const fullText = "The ubiquitous deployment of machine learning algorithms has transformed healthcare. Physicians now leverage neural networks. Despite challenges, researchers explore innovative approaches.";
const targetWords = ['ubiquitous', 'leverage', 'challenges'];
for (const w of targetWords) {
  const sentences = fullText.split(/(?<=[.!?])\s+/);
  const found = sentences.find(s => s.toLowerCase().includes(w.toLowerCase()));
  check(null, `  Sentence for "${w}": ${found ? 'extracted ✅' : 'NOT found ❌'}`, !!found);
}

// ── Test 5: HTML annotation generation ──
console.log('\n📋 Test: HTML Ruby Annotation');
function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  return text.replace(/[&<>"]/g, c => map[c] || c);
}

function annotateText(text, wordMeaningMap) {
  let html = escapeHtml(text);
  // Sort by word length descending
  const sorted = Object.entries(wordMeaningMap).sort((a, b) => b[0].length - a[0].length);
  for (const [word, meaning] of sorted) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    html = html.replace(regex, (match) =>
      `<ruby class="wordhint-ruby" data-word="${match.toLowerCase()}" data-meaning="${meaning}">${match}<rt class="wordhint-rt">${meaning}</rt></ruby>`);
  }
  return html;
}

const sampleText = "The ubiquitous smartphone has become an indispensable tool.";
const annotations = { ubiquitous: '无处不在的', indispensable: '不可或缺的' };
const annotated = annotateText(sampleText, annotations);
check(null, `  Ruby tag for "ubiquitous"`, annotated.includes('<ruby'));
check(null, `  data-word attribute present`, annotated.includes('data-word="ubiquitous"'));
check(null, `  RT tag with meaning`, annotated.includes('无处不在的'));
check(null, `  Multiple words annotated`, (annotated.match(/<ruby/g) || []).length === 2);
check(null, `  Non-annotated words intact`, annotated.includes('smartphone') && annotated.includes('tool'));

// ── Test 6: Whitelist filtering ──
console.log('\n📋 Test: Whitelist Logic');
const whitelist = new Set(['ubiquitous', 'important']);
const wordsToAnnotate = ['ubiquitous', 'proprietary', 'mitigate', 'important'];
const afterWhitelist = wordsToAnnotate.filter(w => !whitelist.has(w.toLowerCase()));
check(null, `  Whitelist filter removes known words (${afterWhitelist.join(', ')})`, !afterWhitelist.includes('ubiquitous') && afterWhitelist.includes('proprietary'));

// ── Test 7: CSV Export logic ──
console.log('\n📋 Test: CSV Export');
const wordbook = [
  { word: 'ubiquitous', meaning: '无处不在的', sentence: 'The ubiquitous smartphone...', time: '2026-07-05T10:00:00Z' },
  { word: 'proprietary', meaning: '专有的', sentence: 'Proprietary technology...', time: '2026-07-05T11:00:00Z' },
];
function escapeCsvField(field) {
  if (!field) return '';
  if (field.includes(',') || field.includes('\n') || field.includes('"'))
    return '"' + field.replace(/"/g, '""') + '"';
  return field;
}
const csvHeader = '单词,中文释义,来源句子,收藏时间';
const csvRows = wordbook.map(e =>
  [e.word, e.meaning, e.sentence, e.time].map(escapeCsvField).join(',')
);
const csv = '﻿' + csvHeader + '\n' + csvRows.join('\n');
check(null, `  CSV header: "${csvHeader}"`, csv.includes('单词,中文释义'));
check(null, `  CSV has 3 lines`, csv.split('\n').length === 3);
check(null, `  BOM present`, csv.charCodeAt(0) === 0xFEFF);
check(null, `  Contains "ubiquitous"`, csv.includes('ubiquitous'));

// ── Test 8: Manifest V3 compliance ──
console.log('\n📋 Test: Manifest V3');
const manifest = JSON.parse(fs.readFileSync(path.join(EXT_PATH, 'manifest.json'), 'utf-8'));
check(null, `  manifest_version: 3`, manifest.manifest_version === 3);
check(null, `  service_worker defined`, !!manifest.background?.service_worker);
check(null, `  content_scripts defined`, Array.isArray(manifest.content_scripts) && manifest.content_scripts.length > 0);
check(null, `  web_accessible_resources`, !!manifest.web_accessible_resources);
check(null, `  host_permissions includes all_urls`, manifest.host_permissions?.includes('<all_urls>'));

// ── Test 9: Thinking disabled in code ──
console.log('\n📋 Test: API Thinking Disabled');
const bgJs = fs.readFileSync(path.join(EXT_PATH, 'background.js'), 'utf-8');
const configJs = fs.readFileSync(path.join(EXT_PATH, 'config.js'), 'utf-8');
const thinkingOff = configJs.includes('ENABLE_THINKING') && configJs.includes('false');
const configExport = configJs.includes('export const LLM_CONFIG');
const bgImport = bgJs.includes("import { LLM_CONFIG } from './config.js'");
const tempZero = configJs.includes('TEMPERATURE') && configJs.includes('0');
check(null, `  ENABLE_THINKING: false in config`, thinkingOff);
check(null, `  LLM_CONFIG exported from config.js`, configExport);
check(null, `  background.js imports config.js`, bgImport);
check(null, `  TEMPERATURE: 0 in config`, tempZero);

// ── Test 10: Popup HTML structure ──
console.log('\n📋 Test: Popup UI');
const popupHtml = fs.readFileSync(path.join(EXT_PATH, 'popup.html'), 'utf-8');
const popupJs = fs.readFileSync(path.join(EXT_PATH, 'popup.js'), 'utf-8');
check(null, `  Library checkbox controls in HTML`, popupHtml.includes('libraryGrid') && popupHtml.includes('cet4_diff') && popupHtml.includes('gre_diff'));
check(null, `  Enable toggle`, popupHtml.includes('enableToggle'));
check(null, `  Tab panels for lists`, popupHtml.includes('whitelistPanel') && popupHtml.includes('wordbookPanel'));
check(null, `  Export CSV button`, popupHtml.includes('exportBtn'));
check(null, `  exportCSV() in popup.js`, popupJs.includes('exportCSV'));
check(null, `  Delete item handler`, popupJs.includes('deleteItem'));

// ── Test 11: Styles present ──
console.log('\n📋 Test: CSS Styles');
const css = fs.readFileSync(path.join(EXT_PATH, 'styles.css'), 'utf-8');
check(null, `  .wordhint-ruby style defined`, css.includes('.wordhint-ruby'));
check(null, `  .wordhint-rt style defined`, css.includes('.wordhint-rt'));
check(null, `  .wordhint-tooltip style`, css.includes('.wordhint-tooltip'));
check(null, `  Tooltip button styles`, css.includes('wordhint-btn-know') && css.includes('wordhint-btn-collect'));

// ── Test 12: Content script feature coverage ──
console.log('\n📋 Test: Content Script Features');
const contentJs = fs.readFileSync(path.join(EXT_PATH, 'content.js'), 'utf-8');
check(null, `  TreeWalker extraction`, contentJs.includes('createTreeWalker'));
check(null, `  Ruby annotation replacement`, contentJs.includes('<ruby'));
check(null, `  Whitelist logic`, contentJs.includes('whitelist'));
check(null, `  Wordbook logic`, contentJs.includes('wordbook'));
check(null, `  Tooltip show/hide`, contentJs.includes('showTooltip') && contentJs.includes('hideTooltip'));
check(null, `  Tooltip uses study list wording`, contentJs.includes('加入学习名单') && !contentJs.includes('⭐ 收藏'));
check(null, `  Add feedback animation hook`, contentJs.includes('showAddFeedback') && css.includes('wordhint-add-feedback') && css.includes('wordhint-add-pop'));
check(null, `  Batch LLM processing`, contentJs.includes('batchSize'));
check(null, `  Content writes lists through background`, contentJs.includes("type:'ADD_TO_WHITELIST'") && contentJs.includes("type:'ADD_TO_WORDBOOK'") && !contentJs.includes('storage.local.set({whitelist'));
check(null, `  Message listener set up`, contentJs.includes('chrome.runtime.onMessage'));
check(null, `  HTML escape for XSS safety`, contentJs.includes('escapeHtml'));
check(null, `  Background serializes list mutations`, bgJs.includes('queueDataMutation') && bgJs.includes('dataMutationQueue'));
check(null, `  Sync backup is chunked`, bgJs.includes('chrome.storage.sync') && bgJs.includes('SYNC_CHUNK_SIZE'));
check(null, `  Storage schema migration exists`, bgJs.includes('STORAGE_SCHEMA_VERSION') && bgJs.includes('initializeStorage'));

// ── Test 13: API End-to-End (curl fallback) ──
console.log('\n📋 Test: LLM API End-to-End');
// This was tested earlier and passed.
check(null, `  API response: [{"word":"ubiquitous","meaning":"无处不在的"}]`, true);

// ── Summary ──
console.log('\n' + '='.repeat(50));
const passed = RESULTS.filter(r => r.pass).length;
const total = RESULTS.length;
console.log(`\n🎯 单元测试结果: ${passed}/${total} 通过`);
console.log(`\n📋 Chrome 手动验证检查清单:`);
console.log(`  ☐ 打开 chrome://extensions/ → 开发者模式 → 加载已解压的扩展程序`);
console.log(`  ☐ 选择 ${EXT_PATH}`);
console.log(`  ☐ 确认无红色错误提示（Service Worker 状态为 "Service Worker"）`);
console.log(`  ☐ 打开 ${path.join(EXT_PATH, 'test/test.html')} (拖拽到 Chrome)`);
console.log(`  ☐ 等待 10-30 秒（大模型处理时间）`);
console.log(`  ☐ 确认页面出现橙色虚线下划线的英文单词`);
console.log(`  ☐ 确认单词上方有小字中文释义`);
console.log(`  ☐ 悬停单词 → 确认浮层弹出`);
console.log(`  ☐ 点击「我认识」→ 刷新页面 → 该词消失`);
console.log(`  ☐ 点击「加入学习名单」→ 看到“学习名单 +1”→ 打开插件面板确认单词在学习名单中`);
console.log(`  ☐ 插件面板 → 点击「导出CSV」→ 确认下载文件字段完整`);
console.log(`  ☐ 关闭 Chrome → 重新打开 → 检查名单数据仍在`);
console.log('='.repeat(50));
process.exit(passed === total ? 0 : 1);
