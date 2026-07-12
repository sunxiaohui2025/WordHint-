// WordHint Background v5.0 — Checkbox Library System
// 8 deduplicated word libraries + wordbook-driven filter
// word_dict.json: in-memory Chinese dictionary (no LLM for known words)

// ─── LLM Configuration ───
// 从 config.js 导入配置（需先从 config.template.js 复制并填写）
import { LLM_CONFIG } from './config.js';

function getApiUrl() {
  return `${LLM_CONFIG.BASE_URL}/${LLM_CONFIG.MODEL}/v1/chat/completions`;
}

function buildRequestBody(messages, maxTokens = null) {
  return {
    model: LLM_CONFIG.MODEL,
    messages: messages,
    temperature: LLM_CONFIG.TEMPERATURE,
    max_tokens: maxTokens || LLM_CONFIG.MAX_TOKENS,
    chat_template_kwargs: { enable_thinking: LLM_CONFIG.ENABLE_THINKING }
  };
}

function buildHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${LLM_CONFIG.API_KEY}`
  };
}

const LIBRARIES = [
  'compulsory', 'gaokao_diff', 'cet4_diff', 'cet6_diff',
  'postgrad_diff', 'ielts_diff', 'toefl_diff', 'gre_diff'
];

let librarySets = {};    // libName → Set<word>
let wordToLib = null;    // word → libName (reverse index)
let chineseDict = null;  // word → Chinese meaning
let preloaded = false;

const STORAGE_SCHEMA_VERSION = 1;
const SYNC_META_KEY = 'wordhintBackupMeta';
const SYNC_CHUNK_PREFIX = 'wordhintBackupChunk_';
const SYNC_CHUNK_SIZE = 7000;
let dataMutationQueue = Promise.resolve();

function normalizeWhitelist(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(w => typeof w === 'string').map(w => w.trim().toLowerCase()).filter(Boolean))];
}

function normalizeWordbook(value) {
  if (!Array.isArray(value)) return [];
  const entries = new Map();
  for (const item of value) {
    if (!item || typeof item.word !== 'string' || !item.word.trim()) continue;
    const word = item.word.trim();
    entries.set(word.toLowerCase(), {
      word,
      meaning: typeof item.meaning === 'string' ? item.meaning : '',
      sentence: typeof item.sentence === 'string' ? item.sentence : '',
      time: typeof item.time === 'string' ? item.time : new Date().toISOString()
    });
  }
  return [...entries.values()];
}

async function readSavedData() {
  const data = await chrome.storage.local.get(['whitelist', 'wordbook']);
  return { whitelist: normalizeWhitelist(data.whitelist), wordbook: normalizeWordbook(data.wordbook) };
}

function queueDataMutation(mutator) {
  const operation = dataMutationQueue.then(async () => {
    const current = await readSavedData();
    const next = await mutator(current) || current;
    next.whitelist = normalizeWhitelist(next.whitelist);
    next.wordbook = normalizeWordbook(next.wordbook);
    await chrome.storage.local.set({ ...next, schemaVersion: STORAGE_SCHEMA_VERSION });
    try { await writeSyncBackup(); } catch (error) { console.warn('[WordHint] Sync backup unavailable:', error.message); }
    return next;
  });
  dataMutationQueue = operation.catch(error => console.error('[WordHint] Data mutation failed:', error));
  return operation;
}

async function writeSyncBackup() {
  const saved = await readSavedData();
  const payload = JSON.stringify({ schemaVersion: STORAGE_SCHEMA_VERSION, ...saved });
  const chunks = [];
  for (let i = 0; i < payload.length; i += SYNC_CHUNK_SIZE) chunks.push(payload.slice(i, i + SYNC_CHUNK_SIZE));
  const old = await chrome.storage.sync.get(SYNC_META_KEY);
  const oldCount = Number(old[SYNC_META_KEY]?.chunkCount) || 0;
  const values = {
    [SYNC_META_KEY]: { schemaVersion: STORAGE_SCHEMA_VERSION, chunkCount: chunks.length, updatedAt: new Date().toISOString() }
  };
  chunks.forEach((chunk, index) => { values[SYNC_CHUNK_PREFIX + index] = chunk; });
  await chrome.storage.sync.set(values);
  if (oldCount > chunks.length) {
    await chrome.storage.sync.remove(Array.from({ length: oldCount - chunks.length }, (_, i) => SYNC_CHUNK_PREFIX + (i + chunks.length)));
  }
}

async function readSyncBackup() {
  const metaResult = await chrome.storage.sync.get(SYNC_META_KEY);
  const meta = metaResult[SYNC_META_KEY];
  if (!meta?.chunkCount) return null;
  const keys = Array.from({ length: meta.chunkCount }, (_, i) => SYNC_CHUNK_PREFIX + i);
  const stored = await chrome.storage.sync.get(keys);
  if (keys.some(key => typeof stored[key] !== 'string')) return null;
  const parsed = JSON.parse(keys.map(key => stored[key]).join(''));
  return { whitelist: normalizeWhitelist(parsed.whitelist), wordbook: normalizeWordbook(parsed.wordbook) };
}

async function initializeStorage() {
  const local = await chrome.storage.local.get(['schemaVersion', 'whitelist', 'wordbook']);
  const hasLocalLists = Array.isArray(local.whitelist) || Array.isArray(local.wordbook);
  let saved = { whitelist: normalizeWhitelist(local.whitelist), wordbook: normalizeWordbook(local.wordbook) };
  if (!hasLocalLists) {
    try { saved = await readSyncBackup() || saved; } catch (error) { console.warn('[WordHint] Sync restore skipped:', error.message); }
  }
  await chrome.storage.local.set({ ...saved, schemaVersion: STORAGE_SCHEMA_VERSION });
  if (hasLocalLists || saved.whitelist.length || saved.wordbook.length) {
    try { await writeSyncBackup(); } catch (error) { console.warn('[WordHint] Initial sync backup skipped:', error.message); }
  }
}

async function preload() {
  if (preloaded) return;
  try {
    // Load Chinese dictionary
    const dictResp = await fetch(chrome.runtime.getURL('data/word_dict.json'));
    chineseDict = await dictResp.json();
    console.log(`[WordHint] Dict loaded: ${Object.keys(chineseDict).length} entries`);

    // Load word→library reverse index
    const idxResp = await fetch(chrome.runtime.getURL('data/word_library.json'));
    wordToLib = await idxResp.json();
    console.log(`[WordHint] Reverse index: ${Object.keys(wordToLib).length} words`);

    // Load each library into a Set
    for (const lib of LIBRARIES) {
      const resp = await fetch(chrome.runtime.getURL(`data/${lib}.json`));
      const words = await resp.json();
      librarySets[lib] = new Set(words.map(w => w.toLowerCase().trim()));
    }
    preloaded = true;
    console.log('[WordHint] All 8 libraries preloaded');
  } catch (e) {
    console.error('[WordHint] Preload failed:', e);
  }
}

// ─── Acronym Filter ───
const SKIP_ACRONYMS = new Set([
  'ceo','cfo','cto','cio','coo','cmo','vp','hr','pr','it',
  'api','sdk','ui','ux','db','os','cpu','gpu','ram','ssd','hdd',
  'ai','ml','dl','nlp','cv','llm','rag',
  'html','css','js','ts','xml','json','yaml','csv','sql','http','https','ftp','ssh','url',
  'pdf','jpg','png','gif','svg','mp3','mp4','avi','zip','tar','exe',
  'nasa','nato','unesco','fbi','cia','nsa','who','imf','wto',
  'usa','uk','eu','un','cn','jp','de','fr','ru','in','br',
  'etc','ie','eg','vs','mr','mrs','ms','dr','prof','jr','sr',
  'am','pm','ad','bc','ce','bce','st','nd','rd','th',
  'inc','ltd','llc','corp','co','dept','ok','okay','hi','hey','yo',
  'btc','eth','nft','defi','dao','dapp','cctv','cnn','bbc','nyt','wsj',
  'tbd','tba','eta','faq','asap','fyi','imo','tbh','phd','md','ba','bs','ma','ms','mba','jd',
]);

function isSkipAcronym(word) {
  if (SKIP_ACRONYMS.has(word.toLowerCase())) return true;
  if (/^[A-Z]{2,6}$/.test(word)) return true;
  if (/^[A-Z][a-z]+[A-Z0-9]/.test(word) && word.length <= 12) return true;
  return false;
}

// ─── NEW: Checkbox-based Filter ───
// Priority:
//   0. Skip acronyms
//   1. Wordbook → force translate (use dict if available, else mark for LLM)
//   2. Whitelist → skip
//   3. Selected library match → translate (from dict)
//   4. Else → skip
async function applyFilter(words, selectedLibs, wordbookWords, whitelistWords) {
  if (!preloaded) await preload();

  const selectedSet = new Set(selectedLibs);
  const wordbookSet = new Set(wordbookWords.map(w => w.toLowerCase()));
  const whitelistSet = new Set(whitelistWords.map(w => w.toLowerCase()));

  const results = {
    translate: [],       // { word, reason: 'wordbook'|'library', meaning: string|null }
    skip: 0,
    acronymSkipped: 0
  };

  for (const word of words) {
    const lower = word.toLowerCase();

    // Priority 0: acronym
    if (isSkipAcronym(word)) { results.acronymSkipped++; continue; }

    // Priority 1: wordbook → always translate
    if (wordbookSet.has(lower)) {
      results.translate.push({
        word,
        reason: 'wordbook',
        meaning: chineseDict?.[lower] || null
      });
      continue;
    }

    // Priority 2: whitelist → skip
    if (whitelistSet.has(lower)) { results.skip++; continue; }

    // Priority 3: selected library match
    const lib = wordToLib?.[lower];
    if (lib && selectedSet.has(lib)) {
      results.translate.push({
        word,
        reason: 'library',
        meaning: chineseDict?.[lower] || null
      });
      continue;
    }

    // Priority 4: default skip
    results.skip++;
  }

  return results;
}

// ─── LLM API (fallback: wordbook words NOT in dict) ───
async function fetchMeanings(sentence, words) {
  if (!words || words.length === 0) return [];
  const wordList = words.map(w => typeof w === 'string' ? w : w.word).join(', ');
  const body = buildRequestBody([{
    role: 'system',
    content: '你是英语词汇助手。根据句子上下文，为给定的英文难词给出它在该句中的中文含义。只输出 JSON 数组，格式 [{"word":"","meaning":""}]，meaning 为简短中文，不要解释。'
  }, { role: 'user', content: `句子：${sentence}\n难词：${wordList}` }]);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(getApiUrl(), {
      method: 'POST', headers: buildHeaders(),
      body: JSON.stringify(body), signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`API: ${resp.status}`);
    const data = await resp.json();
    const content = (data.choices?.[0]?.message?.content || '').replace(/```json\s*/g,'').replace(/```\s*/g,'');
    return JSON.parse(content);
  } catch (e) { console.error('[WordHint] LLM failed:', e); throw e; }
}

// ─── Selection Translation ───
async function translateSelection(text) {
  if (!text?.trim()) throw new Error('Empty');
  const isWord = /^[a-zA-Z]+$/.test(text.trim()) && text.trim().split(/\s+/).length === 1;

  // Fast path: single word already in local dictionary → return instantly, skip LLM
  if (isWord) {
    if (!preloaded) await preload();
    const hit = chineseDict?.[text.trim().toLowerCase()];
    if (hit) return { meaning: hit, detail: '', fromDict: true };
  }

  const body = buildRequestBody([{
    role: 'system',
    content: isWord
      ? '英语词典助手。给出中文释义，格式：{"meaning":"简短释义","detail":"详细解释"}。只输出 JSON。'
      : '英语翻译助手。翻译成通顺中文。格式：{"meaning":"译文","detail":"逐词解释"}。只输出 JSON。'
  }, { role: 'user', content: text }], LLM_CONFIG.MAX_TOKENS_SELECTION);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(getApiUrl(), {
      method: 'POST', headers: buildHeaders(),
      body: JSON.stringify(body), signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`API: ${resp.status}`);
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    const cleaned = content.replace(/```json\s*/g,'').replace(/```\s*/g,'').trim();
    try {
      return JSON.parse(cleaned);
    } catch (parseErr) {
      console.warn('[WordHint] JSON parse fallback, raw:', cleaned.substring(0, 200));
      // fallback: extract meaning/detail via regex
      const meaningMatch = cleaned.match(/"meaning"\s*:\s*"([^"]*)"/);
      const detailMatch = cleaned.match(/"detail"\s*:\s*"([^"]*)"/);
      return {
        meaning: meaningMatch ? meaningMatch[1] : cleaned.substring(0, 100),
        detail: detailMatch ? detailMatch[1] : ''
      };
    }
  } catch (e) { console.error('[WordHint] Translate selection failed:', e); throw e; }
}

// ─── Message Router ───
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'FILTER_WORDS') {
    handleFilterWords(request, sendResponse); return true;
  } else if (request.type === 'FETCH_MEANINGS') {
    fetchMeanings(request.sentence, request.words)
      .then(m => sendResponse({ success: true, meanings: m }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  } else if (request.type === 'TRANSLATE_SELECTION') {
    translateSelection(request.text)
      .then(r => sendResponse({ success: true, ...r }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  } else if (request.type === 'GET_SAVED_DATA') {
    readSavedData().then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true;
  } else if (request.type === 'ADD_TO_WHITELIST') {
    let added = false;
    queueDataMutation(data => {
      const word = String(request.word || '').trim().toLowerCase();
      if (!word) return data;
      added = !data.whitelist.includes(word);
      data.whitelist.push(word);
      data.wordbook = data.wordbook.filter(item => item.word.toLowerCase() !== word);
      return data;
    }).then(data => sendResponse({ success: true, added, ...data })).catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  } else if (request.type === 'ADD_TO_WORDBOOK') {
    let added = false;
    queueDataMutation(data => {
      const word = String(request.word || '').trim();
      if (!word) return data;
      const lower = word.toLowerCase();
      added = !data.wordbook.some(item => item.word.toLowerCase() === lower);
      data.whitelist = data.whitelist.filter(item => item !== lower);
      data.wordbook = data.wordbook.filter(item => item.word.toLowerCase() !== lower);
      data.wordbook.push({ word, meaning: request.meaning || '', sentence: request.sentence || '', time: new Date().toISOString() });
      return data;
    }).then(data => sendResponse({ success: true, added, ...data })).catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  } else if (request.type === 'DELETE_SAVED_ITEM') {
    queueDataMutation(data => {
      const word = String(request.word || '').toLowerCase();
      if (request.list === 'whitelist') data.whitelist = data.whitelist.filter(item => item !== word);
      if (request.list === 'wordbook') data.wordbook = data.wordbook.filter(item => item.word.toLowerCase() !== word);
      return data;
    }).then(data => sendResponse({ success: true, ...data })).catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  } else if (request.type === 'IMPORT_SAVED_DATA') {
    queueDataMutation(data => {
      const incoming = { whitelist: normalizeWhitelist(request.data?.whitelist), wordbook: normalizeWordbook(request.data?.wordbook) };
      const merged = request.mode === 'replace' ? incoming : {
        whitelist: [...data.whitelist, ...incoming.whitelist],
        wordbook: [...data.wordbook, ...incoming.wordbook]
      };
      const known = new Set(normalizeWhitelist(merged.whitelist));
      merged.wordbook = normalizeWordbook(merged.wordbook).filter(item => !known.has(item.word.toLowerCase()));
      return merged;
    }).then(data => sendResponse({ success: true, ...data })).catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }
});

async function handleFilterWords(request, sendResponse) {
  try {
    const { words, selectedLibs, wordbookWords, whitelistWords } = request;
    const result = await applyFilter(words, selectedLibs||[], wordbookWords||[], whitelistWords||[]);
    sendResponse({ success: true, translate: result.translate, skipped: result.skip, acronymSkipped: result.acronymSkipped });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

chrome.runtime.onInstalled.addListener(async () => {
  await initializeStorage();
  console.log('[WordHint v5.0] Preloading 8 libraries...');
  await preload();
  console.log('[WordHint] Ready');
});

chrome.runtime.onStartup.addListener(() => initializeStorage());
