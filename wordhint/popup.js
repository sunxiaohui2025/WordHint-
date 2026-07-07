// WordHint Popup v5.0 — Checkbox Library System

document.addEventListener('DOMContentLoaded', function() {
  'use strict';

  const LIBRARIES = [
    'compulsory', 'gaokao_diff', 'cet4_diff', 'cet6_diff',
    'postgrad_diff', 'ielts_diff', 'toefl_diff', 'gre_diff'
  ];

  const enableToggle = document.getElementById('enableToggle');
  const libraryGrid = document.getElementById('libraryGrid');
  const fontSizeSlider = document.getElementById('fontSizeSlider');
  const fontSizeValue = document.getElementById('fontSizeValue');
  const whitelistItems = document.getElementById('whitelistItems');
  const wordbookItems = document.getElementById('wordbookItems');
  const exportBtn = document.getElementById('exportBtn');
  const annotatedCount = document.getElementById('annotatedCount');
  const processing = document.getElementById('processing');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const deselectAllBtn = document.getElementById('deselectAllBtn');
  const cet6PrefillBtn = document.getElementById('cet6PrefillBtn');

  let whitelist = [];
  let wordbook = [];
  let selectedLibs = ['cet6_diff', 'ielts_diff', 'toefl_diff', 'gre_diff']; // default
  let enabled = true;
  let fontSize = 12;

  async function init() {
    await loadSettings();
    await loadLists();
    render();
    await queryContentState();
  }

  async function loadSettings() {
    return new Promise(resolve => {
      chrome.storage.local.get(['selectedLibs', 'enabled', 'fontSize'], (result) => {
        if (result.selectedLibs && result.selectedLibs.length > 0) selectedLibs = result.selectedLibs;
        enabled = result.enabled !== undefined ? result.enabled : true;
        if (result.fontSize) fontSize = result.fontSize;
        resolve();
      });
    });
  }

  async function loadLists() {
    return new Promise(resolve => {
      chrome.storage.local.get(['whitelist', 'wordbook'], (result) => {
        whitelist = result.whitelist || [];
        wordbook = result.wordbook || [];
        resolve();
      });
    });
  }

  async function queryContentState() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        const response = await chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATE' });
        if (response) annotatedCount.textContent = response.annotatedCount || 0;
      }
    } catch (e) { annotatedCount.textContent = 'N/A'; }
  }

  function render() {
    enableToggle.checked = enabled;
    fontSizeSlider.value = fontSize;
    fontSizeValue.textContent = fontSize + 'px';

    document.querySelectorAll('.library-item input').forEach(cb => {
      cb.checked = selectedLibs.includes(cb.dataset.lib);
    });

    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector(`#${getActiveTab()}Panel`).classList.add('active');

    tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === getActiveTab()));

    renderWhitelist();
    renderWordbook();
    exportBtn.disabled = wordbook.length === 0;
  }

  function getActiveTab() {
    const active = document.querySelector('.tab-btn.active');
    return active ? active.dataset.tab : 'whitelist';
  }

  function renderWhitelist() {
    if (whitelist.length === 0) {
      whitelistItems.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✅</div><div>熟词本为空</div><div style="font-size:11px;margin-top:4px;">点击「我认识」后单词会出现在这里</div></div>';
      return;
    }
    whitelistItems.innerHTML = whitelist.map((word, index) => `
      <div class="list-item"><span><span class="list-item-word">${escapeHtml(word)}</span></span><button class="list-item-delete" data-type="whitelist" data-index="${index}">✕</button></div>
    `).join('');
  }

  function renderWordbook() {
    if (wordbook.length === 0) {
      wordbookItems.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📚</div><div>学习名单为空</div><div style="font-size:11px;margin-top:4px;">点击「收藏」后单词会出现在这里</div></div>';
      return;
    }
    wordbookItems.innerHTML = wordbook.map((entry, index) => `
      <div class="list-item"><span><span class="list-item-word">${escapeHtml(entry.word)}</span><span class="list-item-meaning">${escapeHtml(entry.meaning || '')}</span></span><button class="list-item-delete" data-type="wordbook" data-index="${index}">✕</button></div>
    `).join('');
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div'); div.textContent = str; return div.innerHTML;
  }

  function collectSelectedLibs() {
    const checked = libraryGrid.querySelectorAll('input:checked');
    selectedLibs = Array.from(checked).map(cb => cb.dataset.lib);
  }

  async function applySettings() {
    collectSelectedLibs();
    await chrome.storage.local.set({ selectedLibs, enabled, fontSize });

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        await chrome.tabs.sendMessage(tabs[0].id, {
          type: 'REFRESH_PAGE', selectedLibs, enabled, fontSize
        });
        processing.style.display = 'flex';
        setTimeout(() => { processing.style.display = 'none'; queryContentState(); }, 3000);
      }
    } catch (e) { processing.style.display = 'none'; }
  }

  async function deleteItem(type, index) {
    if (type === 'whitelist') { whitelist.splice(index, 1); await chrome.storage.local.set({ whitelist }); }
    else if (type === 'wordbook') { wordbook.splice(index, 1); await chrome.storage.local.set({ wordbook }); }
    render();
    collectSelectedLibs();
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) await chrome.tabs.sendMessage(tabs[0].id, { type: 'REFRESH_PAGE', selectedLibs, enabled, fontSize });
    } catch (e) {}
  }

  async function exportCSV() {
    if (wordbook.length === 0) return;
    const header = '单词,中文释义,来源句子,收藏时间\n';
    const rows = wordbook.map(e => {
      const w = escCsv(e.word||''), m = escCsv(e.meaning||''), s = escCsv(e.sentence||''), t = escCsv(fmtTime(e.time));
      return `${w},${m},${s},${t}`;
    }).join('\n');
    const blob = new Blob(['﻿'+header+rows], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `WordHint_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  }
  function escCsv(f) { if(!f) return ''; if(/[,\n"]/.test(f)) return '"'+f.replace(/"/g,'""')+'"'; return f; }
  function fmtTime(iso) {
    if(!iso) return ''; try { return new Date(iso).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); } catch(e) { return iso; }
  }

  // ─── Event Listeners ───

  enableToggle.addEventListener('change', function() { enabled = this.checked; applySettings(); });

  // Library checkboxes
  libraryGrid.querySelectorAll('input').forEach(cb => {
    cb.addEventListener('change', function() { applySettings(); });
  });

  selectAllBtn.addEventListener('click', () => {
    libraryGrid.querySelectorAll('input').forEach(cb => cb.checked = true);
    applySettings();
  });
  deselectAllBtn.addEventListener('click', () => {
    libraryGrid.querySelectorAll('input').forEach(cb => cb.checked = false);
    applySettings();
  });
  cet6PrefillBtn.addEventListener('click', () => {
    libraryGrid.querySelectorAll('input').forEach(cb => {
      const lib = cb.dataset.lib;
      cb.checked = ['cet6_diff','ielts_diff','toefl_diff','gre_diff'].includes(lib);
    });
    applySettings();
  });

  fontSizeSlider.addEventListener('input', function() { fontSize = parseInt(this.value); fontSizeValue.textContent = fontSize + 'px'; });
  fontSizeSlider.addEventListener('change', function() { fontSize = parseInt(this.value); render(); applySettings(); });

  tabBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      tabBtns.forEach(b => b.classList.remove('active'));
      this.classList.add('active'); render();
    });
  });

  document.addEventListener('click', function(e) {
    const del = e.target.closest('.list-item-delete');
    if (del) { deleteItem(del.dataset.type, parseInt(del.dataset.index)); }
  });

  exportBtn.addEventListener('click', exportCSV);

  chrome.runtime.onMessage.addListener((request) => {
    if (request.type === 'WHITELIST_UPDATED' || request.type === 'WORDBOOK_UPDATED') {
      loadLists().then(render);
    }
  });

  init();
});
