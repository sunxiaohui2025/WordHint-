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
    chrome.storage.local.get(['whitelist','wordbook'], r =>
      sendResponse({ whitelist: r.whitelist||[], wordbook: r.wordbook||[] }));
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
  console.log('[WordHint v5.0] Preloading 8 libraries...');
  await preload();
  console.log('[WordHint] Ready');
});
