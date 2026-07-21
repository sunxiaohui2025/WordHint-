// WordHint Content Script v5.0 — Checkbox Library + Progressive Render
(function() {
  'use strict';

  const CONFIG = {
    selectedLibs: ['cet6_diff', 'ielts_diff', 'toefl_diff', 'gre_diff'],
    enabled: true,
    batchSize: 20,
    annotationFontSize: 11,
    annotateChunkSize: 30,
    skipTags: new Set(['SCRIPT','STYLE','NOSCRIPT','IFRAME','OBJECT','EMBED','CANVAS','SVG','INPUT','TEXTAREA','CODE','PRE','KBD','VAR','SAMP'])
  };

  let whitelist = new Set();
  let wordbook = [];
  let annotatedWords = new Map();
  let meaningCache = new Map();
  let isProcessing = false;
  let tooltipElement = null;
  let styleElement = null;
  let selectPopup = null;
  let isTranslating = false;
  let annotationQueue = null;
  let annotationRunning = false;
  let mutationObserver = null;
  let processScheduled = false;

  async function init() {
    await loadSettings();
    await loadSavedData();
    injectDynamicStyles();
    setupSelectionTranslate();
    chrome.runtime.onMessage.addListener(handleMessage);
    if (CONFIG.enabled) {
      await processPage();
      // 页面完全加载后再跑一次，捕获首屏之后才注入的正文（懒加载/SPA）
      if (document.readyState !== 'complete') {
        window.addEventListener('load', () => scheduleProcess(800), { once: true });
      } else {
        scheduleProcess(800);
      }
    }
    // 监听后续 DOM 变化，SPA 路由切换/异步渲染时自动补翻译
    observeMutations();
  }

  // 防抖调度整页处理：多次触发只在末尾执行一次
  function scheduleProcess(delay = 400) {
    if (!CONFIG.enabled) return;
    if (processScheduled) return;
    processScheduled = true;
    setTimeout(() => { processScheduled = false; processPage(); }, delay);
  }

  // 观察新增文本节点；忽略本插件自身产生的 DOM 变化，避免死循环
  function observeMutations() {
    if (mutationObserver) return;
    mutationObserver = new MutationObserver((mutations) => {
      if (!CONFIG.enabled || isProcessing) return;
      for (const mu of mutations) {
        for (const n of mu.addedNodes) {
          if (n.nodeType !== 1 && n.nodeType !== 3) continue;
          // 跳过插件自己插入的节点（ruby / tooltip / 选词弹窗 / 已含注音的 span）
          if (n.nodeType === 1) {
            if (n.id && String(n.id).startsWith('wordhint')) continue;
            if (n.classList && (n.classList.contains('wordhint-ruby') || n.classList.contains('wordhint-tooltip') || n.classList.contains('wordhint-select-translate'))) continue;
            if (n.querySelector && n.querySelector('.wordhint-ruby')) continue;
            if (n.closest && n.closest('.wordhint-ruby,#wordhint-tooltip,#wordhint-select-translate')) continue;
          }
          const txt = n.textContent || '';
          if (txt.trim() && /[a-zA-Z]{3,}/.test(txt)) { scheduleProcess(600); return; }
        }
      }
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  async function loadSettings() {
    return new Promise(resolve => {
      chrome.storage.local.get(['selectedLibs','enabled','fontSize'], (r) => {
        if (r.selectedLibs && r.selectedLibs.length>0) CONFIG.selectedLibs = r.selectedLibs;
        if (r.enabled !== undefined) CONFIG.enabled = r.enabled;
        if (r.fontSize) CONFIG.annotationFontSize = r.fontSize;
        resolve();
      });
    });
  }

  async function loadSavedData() {
    return new Promise(resolve => {
      chrome.storage.local.get(['whitelist','wordbook'], (r) => {
        whitelist = new Set((r.whitelist||[]).map(w=>w.toLowerCase()));
        wordbook = r.wordbook||[];
        resolve();
      });
    });
  }

  function injectDynamicStyles() {
    if(styleElement) styleElement.remove();
    styleElement = document.createElement('style');
    styleElement.id = 'wordhint-dynamic';
    const fs = CONFIG.annotationFontSize;
    // 注音需要在原文上方占用空间，但不宜撑得过大。
    // 仅预留刚好放下注音文字的空间（注音字号 * 行高系数 + 少量间距）。
    const extra = Math.round(fs * 1.1) + 2;
    styleElement.textContent = `
      .wordhint-rt{display:ruby-text!important;ruby-position:over!important;font-size:${fs}px!important;line-height:1.1!important}
      /* 含 ruby 的行元素：适度扩大行高，刚好容纳注音，避免行距过大 */
      :is(p,div,article,section,li,td,th,dd,dt,blockquote,h1,h2,h3,h4,h5,h6,span,a,label):has(.wordhint-ruby){line-height:calc(1.15em + ${extra}px)!important}
      /* 关键：解除 ruby 所在祖先容器的高度/溢出限制，避免注音被父级固定高度的 div 裁剪而看不见 */
      :has(.wordhint-ruby){overflow:visible!important;max-height:none!important}
    `;
    document.head.appendChild(styleElement);
  }

  function handleMessage(request, sender, sendResponse) {
    if(request.type==='REFRESH_PAGE'){
      removeAnnotations();
      if(request.selectedLibs) CONFIG.selectedLibs = request.selectedLibs;
      CONFIG.enabled = request.enabled;
      if(request.fontSize) CONFIG.annotationFontSize = request.fontSize;
      injectDynamicStyles();
      if (!CONFIG.enabled) { sendResponse({success:true}); return true; }
      loadSavedData().then(()=>processPage().then(()=>sendResponse({success:true})));
      return true;
    } else if(request.type==='GET_STATE'){
      sendResponse({difficultyLevel:'v5',enabled:CONFIG.enabled,annotatedCount:annotatedWords.size});
      return true;
    } else if(request.type==='ADD_TO_WHITELIST'){addToWhitelist(request.word).then(result=>sendResponse(result||{success:false}));return true;}
    else if(request.type==='ADD_TO_WORDBOOK'){addToWordbook(request.word,request.meaning,request.sentence).then(result=>sendResponse(result||{success:false}));return true;}
  }

  // 向 background 发送消息，带重试：MV3 service worker 冷启动时首条消息可能
  // 因 "Could not establish connection" 而失败，页面首次加载的自动翻译因此丢失。
  async function sendMessageWithRetry(msg, retries = 5, delay = 200) {
    for (let i = 0; i < retries; i++) {
      try {
        const r = await chrome.runtime.sendMessage(msg);
        if (r !== undefined) return r;
      } catch (e) {
        if (i === retries - 1) throw e;
      }
      await new Promise(res => setTimeout(res, delay * (i + 1)));
    }
    return undefined;
  }

  async function processPage() {
    if(isProcessing) return;
    isProcessing = true;
    const t0 = performance.now();
    try {
      const wordData = extractWordsFromPage();
      if(!wordData.length){isProcessing=false;return;}
      const uniqueWords = [...new Set(wordData.map(w=>w.word.toLowerCase()))];
      const result = await sendMessageWithRetry({
        type:'FILTER_WORDS',
        words:uniqueWords,
        selectedLibs:CONFIG.selectedLibs,
        wordbookWords:wordbook.map(e=>e.word),
        whitelistWords:[...whitelist]
      });
      if(!result||!result.success){console.error('[WordHint] Filter failed:',result&&result.error);isProcessing=false;return;}
      const translateItems = result.translate||[];
      console.log(`[WordHint] Filter: ${translateItems.length} translate, ${result.skipped} skip, ${result.acronymSkipped||0} acronym`);
      let llmWords=[];
      for(const item of translateItems){
        const lower=item.word.toLowerCase();
        if(meaningCache.has(lower)) continue;
        if(item.meaning){meaningCache.set(lower,item.meaning);}else{llmWords.push(item.word);}
      }
      // Phase 1: annotate dict-covered words immediately
      if(!annotationRunning) buildAndStartAnnotation(wordData);
      // Phase 2: LLM fallback
      if(llmWords.length>0){
        console.log(`[WordHint] LLM fallback: ${llmWords.length} words`);
        fetchLLMFallback(wordData,llmWords).then(newM=>{
          if(newM.length>0){
            for(const item of newM) meaningCache.set(item.word.toLowerCase(),item.meaning);
            buildAndStartAnnotation(wordData);
          }
        });
      }
      console.log(`[WordHint] Phase1 done in ${(performance.now()-t0).toFixed(0)}ms`);
    } catch(e){console.error('[WordHint] Error:',e);}
    finally{isProcessing=false;}
  }

  async function fetchLLMFallback(wordData,llmWords){
    const sm=new Map();
    for(const wd of wordData){
      const lower=wd.word.toLowerCase();
      if(llmWords.includes(lower)){
        const k=wd.sentence; if(!sm.has(k)) sm.set(k,[]);
        const a=sm.get(k); if(!a.includes(lower)) a.push(lower);
      }
    }
    const all=[];
    for(const [s,words] of sm){
      for(let j=0;j<words.length;j+=CONFIG.batchSize){
        const batch=words.slice(j,j+CONFIG.batchSize);
        try{
          const resp=await chrome.runtime.sendMessage({type:'FETCH_MEANINGS',sentence:s,words:batch});
          if(resp.success&&resp.meanings) all.push(...resp.meanings);
        }catch(e){}
      }
    }
    return all;
  }

  function buildAndStartAnnotation(wordData){
    const nodeToWords=new Map();
    for(const wd of wordData){
      const lower=wd.word.toLowerCase();
      const meaning=meaningCache.get(lower);
      if(!meaning) continue;
      if(whitelist.has(lower)) continue;
      if(!nodeToWords.has(wd.textNode)) nodeToWords.set(wd.textNode,[]);
      nodeToWords.get(wd.textNode).push({original:wd.word,meaning,sentence:wd.sentence});
    }
    annotationQueue=[...nodeToWords.entries()];
    setupTooltips();
    if(!annotationRunning) scheduleAnnotationChunk();
  }

  function scheduleAnnotationChunk(){
    annotationRunning=true;
    (window.requestIdleCallback||(fn=>setTimeout(fn,0)))(processAnnotationChunk,{timeout:50});
  }

  function processAnnotationChunk(deadline){
    if(!annotationQueue||!annotationQueue.length){annotationRunning=false;return;}
    const hasTime=deadline?()=>deadline.timeRemaining()>1:()=>true;
    let cnt=0;
    while(cnt<CONFIG.annotateChunkSize&&annotationQueue.length&&hasTime()){
      const [tn,words]=annotationQueue.shift();
      annotateTextNode(tn,words); cnt++;
    }
    annotationQueue.length?scheduleAnnotationChunk():annotationRunning=false;
  }

  function isChineseDominant(text){
    const cjk=(text.match(/[一-鿿]/g)||[]).length;
    const lat=(text.match(/[a-zA-Z]/g)||[]).length;
    return (cjk+lat)>0&&cjk>lat;
  }

  function extractWordsFromPage(){
    const wbSet=new Set(wordbook.map(w=>w.word.toLowerCase()));
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{
      acceptNode:function(node){
        let p=node.parentElement;
        while(p){
          if(CONFIG.skipTags.has(p.tagName)) return NodeFilter.FILTER_REJECT;
          if(p.classList&&(p.classList.contains('wordhint-ruby')||p.classList.contains('wordhint-tooltip')||p.classList.contains('wordhint-select-translate'))) return NodeFilter.FILTER_REJECT;
          if(p.id&&String(p.id).startsWith('wordhint')) return NodeFilter.FILTER_REJECT;
          p=p.parentElement;
        }
        const t=node.textContent.trim();
        if(!t.length) return NodeFilter.FILTER_REJECT;
        if(isChineseDominant(t)){
          const toks=tokenizeEnglishWords(t).map(w=>w.toLowerCase());
          return toks.some(w=>wbSet.has(w))?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const wd=[]; const seen=new Set(); let node;
    while((node=walker.nextNode())){
      if(seen.has(node)) continue; seen.add(node);
      const text=node.textContent, isC=isChineseDominant(text);
      for(const w of tokenizeEnglishWords(text)){
        if(w.length<3) continue;
        if(isC&&!wbSet.has(w.toLowerCase())) continue;
        wd.push({word:w,sentence:extractSentence(text,w),textNode:node});
      }
    }
    return wd;
  }

  function tokenizeEnglishWords(text){
    const m=[]; const re=/\b[a-zA-Z]{2,}\b/g; let x;
    while((x=re.exec(text))!==null) m.push(x[0]);
    return m;
  }

  function extractSentence(text,word){
    const ss=text.split(/(?<=[.!?])\s+/);
    for(const s of ss) if(s.toLowerCase().includes(word.toLowerCase())) return s.trim().substring(0,200);
    const i=text.toLowerCase().indexOf(word.toLowerCase());
    if(i>=0){const st=Math.max(0,i-80);return text.substring(st,Math.min(text.length,i+word.length+80)).trim();}
    return text.substring(0,200);
  }

  function escapeHtml(t){const m={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'};return t.replace(/[&<>"]/g,c=>m[c]||c);}

  function annotateTextNode(textNode,words){
    if(!textNode.parentNode) return;
    const original = textNode.textContent;
    // 建立 词(小写) -> {meaning, sentence} 映射；同词以首个为准
    const wmap = new Map();
    for(const {original:w, meaning, sentence} of words){
      const lw = (w||'').toLowerCase();
      if(!lw) continue;
      if(!wmap.has(lw)) wmap.set(lw, {meaning, sentence});
    }
    if(wmap.size===0) return;
    // 合并成单个正则，长词优先，只在【原始文本】上做一次扫描——
    // 绝不对已插入的 <ruby> 标签/属性再次匹配，避免属性值内被注入导致 "> 泄漏。
    const keys=[...wmap.keys()].sort((a,b)=>b.length-a.length)
      .map(k=>k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
    const re=new RegExp(`\\b(${keys.join('|')})\\b`,'gi');
    const done=new Set();
    let out='', last=0, changed=false, m;
    while((m=re.exec(original))!==null){
      const matched=m[0];
      const lw=matched.toLowerCase();
      const info=wmap.get(lw);
      if(!info || done.has(lw)) continue; // 仅标注每个词的首次出现，其余保留为纯文本
      done.add(lw);
      out+=escapeHtml(original.slice(last,m.index));
      const sM=escapeHtml(info.meaning||''), sS=escapeHtml(info.sentence||'');
      out+=`<ruby class="wordhint-ruby" data-word="${lw}" data-meaning="${sM}" data-sentence="${sS}">${escapeHtml(matched)}<rt class="wordhint-rt">${sM}</rt></ruby>`;
      last=m.index+matched.length;
      changed=true;
      annotatedWords.set(lw,{meaning:info.meaning,sentence:info.sentence});
    }
    if(!changed) return;
    out+=escapeHtml(original.slice(last));
    const span=document.createElement('span'); span.innerHTML=out;
    if(textNode.parentNode) textNode.parentNode.replaceChild(span,textNode);
  }

  function setupTooltips(){
    if(tooltipElement) return;
    const o={capture:true};
    document.removeEventListener('mouseover',handleRubyHover,true);
    document.removeEventListener('click',handleRubyClick,true);
    document.removeEventListener('mouseout',handleRubyOut,true);
    document.addEventListener('mouseover',handleRubyHover,o);
    document.addEventListener('click',handleRubyClick,o);
    document.addEventListener('mouseout',handleRubyOut,o);
  }

  function createTooltip(){
    if(tooltipElement) return tooltipElement;
    tooltipElement=document.createElement('div');
    tooltipElement.id='wordhint-tooltip';
    tooltipElement.className='wordhint-tooltip';
    tooltipElement.innerHTML='<div class="wordhint-tooltip-content"><div class="wordhint-tooltip-word"></div><div class="wordhint-tooltip-meaning"></div><div class="wordhint-tooltip-sentence"></div><div class="wordhint-tooltip-actions"><button class="wordhint-btn wordhint-btn-know">✅ 我认识</button><button class="wordhint-btn wordhint-btn-collect">⭐ 加入学习名单</button></div></div>';
    document.body.appendChild(tooltipElement);
    tooltipElement.addEventListener('mouseenter',()=>{if(tooltipElement._hideTimeout){clearTimeout(tooltipElement._hideTimeout);tooltipElement._hideTimeout=null;}});
    tooltipElement.addEventListener('mouseleave',()=>hideTooltip());
    tooltipElement.querySelector('.wordhint-btn-know').addEventListener('click',async(e)=>{
      e.stopPropagation();
      const btn=e.currentTarget,w=tooltipElement.dataset.currentWord;
      if(!w||btn.disabled) return;
      btn.disabled=true;
      const result=await addToWhitelist(w);
      if(result?.success) await showAddFeedback(btn,result.added?'熟词本 +1':'已在熟词本');
      btn.disabled=false;
      hideTooltip();
    });
    tooltipElement.querySelector('.wordhint-btn-collect').addEventListener('click',async(e)=>{
      e.stopPropagation();
      const btn=e.currentTarget,w=tooltipElement.dataset.currentWord,m=tooltipElement.dataset.currentMeaning,s=tooltipElement.dataset.currentSentence;
      if(!w||btn.disabled) return;
      btn.disabled=true;
      const result=await addToWordbook(w,m,s);
      if(result?.success) await showAddFeedback(btn,result.added?'学习名单 +1':'已在学习名单');
      btn.disabled=false;
      hideTooltip();
    });
    return tooltipElement;
  }

  function showTooltip(el){
    const tt=createTooltip();
    tt.dataset.currentWord=el.dataset.word;tt.dataset.currentMeaning=el.dataset.meaning;tt.dataset.currentSentence=el.dataset.sentence||'';
    tt.querySelector('.wordhint-tooltip-word').textContent=el.textContent.trim();
    tt.querySelector('.wordhint-tooltip-meaning').textContent='释义：'+el.dataset.meaning;
    tt.querySelector('.wordhint-tooltip-sentence').textContent=el.dataset.sentence?'句子：'+el.dataset.sentence:'';
    const r=el.getBoundingClientRect();let l=r.left+window.scrollX,t=r.bottom+window.scrollY+5;
    if(l+280>window.innerWidth+window.scrollX) l=window.innerWidth+window.scrollX-290;
    if(t+160>window.innerHeight+window.scrollY) t=r.top+window.scrollY-165;
    tt.style.left=l+'px';tt.style.top=t+'px';tt.classList.add('visible');
  }

  function hideTooltip(){if(tooltipElement)tooltipElement.classList.remove('visible');}

  function handleRubyHover(e){const r=e.target.closest('.wordhint-ruby');if(r)showTooltip(r);}
  function handleRubyClick(e){const r=e.target.closest('.wordhint-ruby');if(r){showTooltip(r);e.preventDefault();}}
  function handleRubyOut(e){const r=e.target.closest('.wordhint-ruby');if(r){if(tooltipElement._hideTimeout)clearTimeout(tooltipElement._hideTimeout);tooltipElement._hideTimeout=setTimeout(()=>{if(tooltipElement&&!tooltipElement.matches(':hover'))hideTooltip();},200);}}

  function showAddFeedback(anchor,label='+1'){
    if(tooltipElement?._hideTimeout){clearTimeout(tooltipElement._hideTimeout);tooltipElement._hideTimeout=null;}
    const node=document.createElement('div');
    node.className='wordhint-add-feedback';
    node.textContent=label;
    document.body.appendChild(node);
    const r=anchor.getBoundingClientRect();
    const left=Math.min(window.innerWidth-18,Math.max(12,r.left+r.width/2));
    const top=Math.max(12,r.top-8);
    node.style.left=left+'px';
    node.style.top=top+'px';
    return new Promise(resolve=>{
      node.addEventListener('animationend',()=>{node.remove();resolve();},{once:true});
      setTimeout(()=>{if(node.isConnected)node.remove();resolve();},950);
    });
  }

  // ==== SELECTION TRANSLATE ====
  function setupSelectionTranslate(){document.addEventListener('mouseup',handleSelectionMouseUp);}
  async function handleSelectionMouseUp(e){
    if(e.target.closest('.wordhint-ruby,.wordhint-tooltip,.wordhint-select-translate,input,textarea,[contenteditable]')) return;
    if(e.button!==0) return;
    setTimeout(async()=>{
      const sel=window.getSelection();
      if(!sel||sel.isCollapsed) return;
      const t=sel.toString().trim();
      if(!t||t.length<2||t.length>500||!/[a-zA-Z]/.test(t)) return;
      await showSelectTranslationPopup(e,t);
    },10);
  }

  function createSelectPopup(){
    if(selectPopup){hideSelectPopup();selectPopup.remove();}
    selectPopup=document.createElement('div');
    selectPopup.id='wordhint-select-translate';selectPopup.className='wordhint-select-translate';
    selectPopup.innerHTML='<div class="wordhint-select-header"><span class="wordhint-select-title">📖 WordHint 划词翻译</span><button class="wordhint-select-close">✕</button></div><div class="wordhint-select-body"><div class="wordhint-select-original"></div><div class="wordhint-select-meaning"></div><div class="wordhint-select-detail"></div><div class="wordhint-select-loading" style="display:none"><div class="spinner-sm"></div><span>翻译中...</span></div></div><div class="wordhint-select-actions"><button class="wordhint-btn wordhint-btn-collect">⭐ 加入学习名单</button></div>';
    document.body.appendChild(selectPopup);
    selectPopup.querySelector('.wordhint-select-close').addEventListener('click',hideSelectPopup);
    selectPopup.querySelector('.wordhint-btn-collect').addEventListener('click',async(e)=>{
      const btn=e.currentTarget;
      const w=selectPopup.dataset.selectedText||'',m=selectPopup.dataset.translationMeaning||'',d=selectPopup.dataset.translationDetail||'';
      if(!w||btn.disabled) return;
      btn.disabled=true;
      const result=await addToWordbook(w,m,d);
      if(result?.success) await showAddFeedback(btn,result.added?'学习名单 +1':'已在学习名单');
      btn.disabled=false;
      hideSelectPopup();
    });
    return selectPopup;
  }

  async function showSelectTranslationPopup(e,text){
    if(isTranslating) return; isTranslating=true;
    const p=createSelectPopup(); p.dataset.selectedText=text;
    let l=e.clientX+window.scrollX,t=e.clientY+window.scrollY+15;
    if(l+320>window.innerWidth+window.scrollX) l=window.innerWidth+window.scrollX-330;
    if(t+200>window.innerHeight+window.scrollY) t=e.clientY+window.scrollY-215;
    p.style.left=l+'px';p.style.top=t+'px';p.classList.add('visible');
    p.querySelector('.wordhint-select-original').textContent=text;
    p.querySelector('.wordhint-select-meaning').textContent='';
    p.querySelector('.wordhint-select-detail').textContent='';
    p.querySelector('.wordhint-select-loading').style.display='flex';
    // yield to browser so popup renders before API call
    await new Promise(r=>requestAnimationFrame(r));
    try{
      const r=await chrome.runtime.sendMessage({type:'TRANSLATE_SELECTION',text});
      p.querySelector('.wordhint-select-loading').style.display='none';
      if(r.success){
        p.querySelector('.wordhint-select-meaning').textContent=r.meaning||'';
        p.querySelector('.wordhint-select-detail').textContent=r.detail||'';
        p.dataset.translationMeaning=r.meaning||'';p.dataset.translationDetail=r.detail||'';
      }else{p.querySelector('.wordhint-select-meaning').textContent='翻译失败: '+(r.error||'未知错误');}
    }catch(err){p.querySelector('.wordhint-select-loading').style.display='none';p.querySelector('.wordhint-select-meaning').textContent='翻译超时，请重试';}
    finally{isTranslating=false;}
  }

  function hideSelectPopup(){if(selectPopup)selectPopup.classList.remove('visible');}
  document.addEventListener('mousedown',(e)=>{if(selectPopup&&selectPopup.classList.contains('visible')&&!selectPopup.contains(e.target))hideSelectPopup();},true);

  // ---- Whitelist & Wordbook ----
  async function addToWhitelist(word){
    const lower=word.toLowerCase();
    const result=await chrome.runtime.sendMessage({type:'ADD_TO_WHITELIST',word:lower});
    if(!result?.success) return result;
    whitelist=new Set(result.whitelist); wordbook=result.wordbook;
    document.querySelectorAll(`.wordhint-ruby[data-word="${lower}"]`).forEach(el=>{const t=document.createTextNode(el.childNodes[0]?.textContent||lower);el.parentNode?.replaceChild(t,el);});
    annotatedWords.delete(lower);
    chrome.runtime.sendMessage({type:'WHITELIST_UPDATED',word:lower});
    return result;
  }

  async function addToWordbook(word,meaning,sentence){
    const result=await chrome.runtime.sendMessage({type:'ADD_TO_WORDBOOK',word,meaning,sentence});
    if(!result?.success) return result;
    whitelist=new Set(result.whitelist); wordbook=result.wordbook;
    const entry=wordbook.find(item=>item.word.toLowerCase()===word.toLowerCase());
    chrome.runtime.sendMessage({type:'WORDBOOK_UPDATED',entry});
    return result;
  }

  function removeAnnotations(){
    annotationQueue=null;
    annotationRunning=false;
    document.querySelectorAll('.wordhint-ruby').forEach(r=>{const t=document.createTextNode(r.childNodes[0]?.textContent||'');if(r.parentNode)r.parentNode.replaceChild(t,r);});
    annotatedWords.clear();
    meaningCache.clear();
  }

  console.log('[WordHint] v5.0 (checkbox libraries) loaded');
  async function safeInit(){try{await init();console.log('[WordHint] Init OK');}catch(e){console.error('[WordHint] Init failed:',e);}}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',safeInit); else safeInit();
})();
