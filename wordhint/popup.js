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
  const exportAllBtn = document.getElementById('exportAllBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  const annotatedCount = document.getElementById('annotatedCount');
  const processing = document.getElementById('processing');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const deselectAllBtn = document.getElementById('deselectAllBtn');
  const cet6PrefillBtn = document.getElementById('cet6PrefillBtn');
  const phoneSyncURL = document.getElementById('phoneSyncURL');
  const phoneSyncBtn = document.getElementById('phoneSyncBtn');
  const phoneSyncStatus = document.getElementById('phoneSyncStatus');
  const cloudURL = document.getElementById('cloudURL');
  const cloudName = document.getElementById('cloudName');
  const cloudEmail = document.getElementById('cloudEmail');
  const cloudPassword = document.getElementById('cloudPassword');
  const cloudLoggedOut = document.getElementById('cloudLoggedOut');
  const cloudLoggedIn = document.getElementById('cloudLoggedIn');
  const cloudIdentity = document.getElementById('cloudIdentity');
  const cloudStatus = document.getElementById('cloudStatus');
  const cloudRegisterBtn = document.getElementById('cloudRegisterBtn');
  const cloudLoginBtn = document.getElementById('cloudLoginBtn');
  const cloudLogoutBtn = document.getElementById('cloudLogoutBtn');
  const cloudSyncBtn = document.getElementById('cloudSyncBtn');

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
    const savedSync = await chrome.storage.local.get('phoneSyncURL');
    phoneSyncURL.value = savedSync.phoneSyncURL || '';
    const cloud = await chrome.storage.local.get(['cloudBaseURL', 'cloudToken', 'cloudUser', 'cloudLastSync']);
    cloudURL.value = cloud.cloudBaseURL || '';
    renderCloudSession(cloud);
  }

  function cleanBaseURL(value) { return value.trim().replace(/\/+$/, ''); }

  function renderCloudSession(session) {
    const loggedIn = Boolean(session.cloudToken);
    cloudLoggedOut.style.display = loggedIn ? 'none' : 'block';
    cloudLoggedIn.style.display = loggedIn ? 'block' : 'none';
    cloudIdentity.textContent = loggedIn ? `${session.cloudUser?.name || '用户'} · ${session.cloudUser?.email || ''}` : '';
  }

  async function cloudRequest(path, options = {}, requireAuth = false) {
    const saved = await chrome.storage.local.get(['cloudBaseURL', 'cloudToken']);
    const baseURL = cleanBaseURL(cloudURL.value || saved.cloudBaseURL || '');
    if (!/^https?:\/\//.test(baseURL)) throw new Error('请填写服务器地址');
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (requireAuth) {
      if (!saved.cloudToken) throw new Error('请先登录');
      headers.Authorization = `Bearer ${saved.cloudToken}`;
    }
    const response = await fetch(baseURL + path, { ...options, headers });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
    return result;
  }

  async function registerCloud() {
    cloudRegisterBtn.disabled = true;
    try {
      const baseURL = cleanBaseURL(cloudURL.value);
      await chrome.storage.local.set({ cloudBaseURL: baseURL });
      const result = await cloudRequest('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ name: cloudName.value.trim(), email: cloudEmail.value.trim(), password: cloudPassword.value }) });
      cloudStatus.textContent = result.message;
    } catch (error) { cloudStatus.textContent = `注册失败：${error.message}`; }
    finally { cloudRegisterBtn.disabled = false; }
  }

  async function loginCloud() {
    cloudLoginBtn.disabled = true;
    try {
      const baseURL = cleanBaseURL(cloudURL.value);
      await chrome.storage.local.set({ cloudBaseURL: baseURL });
      const result = await cloudRequest('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: cloudEmail.value.trim(), password: cloudPassword.value }) });
      await chrome.storage.local.set({ cloudToken: result.token, cloudUser: result.user });
      renderCloudSession({ cloudToken: result.token, cloudUser: result.user });
      cloudStatus.textContent = '登录成功，正在同步…';
      await syncCloud();
    } catch (error) { cloudStatus.textContent = `登录失败：${error.message}`; }
    finally { cloudLoginBtn.disabled = false; }
  }

  async function syncCloud() {
    cloudSyncBtn.disabled = true;
    cloudStatus.textContent = '正在双向同步…';
    try {
      const saved = await chrome.storage.local.get('cloudLastSync');
      const latest = await chrome.runtime.sendMessage({ type: 'GET_SAVED_DATA' });
      const result = await cloudRequest('/api/v1/sync', { method: 'POST', body: JSON.stringify({ words: latest.wordbook || [], whitelist: latest.whitelist || [], since: saved.cloudLastSync || null }) }, true);
      const remoteWhitelist = result.words.filter(item => !item.deleted && item.statusRaw === 'ignored').map(item => item.word);
      const remoteWords = result.words.filter(item => !item.deleted && item.statusRaw !== 'ignored');
      const merged = await chrome.runtime.sendMessage({ type: 'IMPORT_SAVED_DATA', mode: 'merge', data: { whitelist: [...(latest.whitelist || []), ...remoteWhitelist], wordbook: [...(latest.wordbook || []), ...remoteWords] } });
      if (!merged?.success) throw new Error(merged?.error || '本地合并失败');
      whitelist = merged.whitelist; wordbook = merged.wordbook;
      await chrome.storage.local.set({ cloudLastSync: result.serverTime });
      render();
      cloudStatus.textContent = `同步完成 · 学习名单 ${wordbook.length} · 熟词 ${whitelist.length}`;
    } catch (error) {
      if (/401|登录已失效/.test(error.message)) await chrome.storage.local.remove(['cloudToken', 'cloudUser']);
      cloudStatus.textContent = `同步失败：${error.message}`;
    } finally { cloudSyncBtn.disabled = false; }
  }

  cloudRegisterBtn.addEventListener('click', registerCloud);
  cloudLoginBtn.addEventListener('click', loginCloud);
  cloudSyncBtn.addEventListener('click', syncCloud);
  cloudLogoutBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove(['cloudToken', 'cloudUser', 'cloudLastSync']);
    renderCloudSession({}); cloudStatus.textContent = '已退出，手机上的离线数据不会删除';
  });

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
    const item = type === 'whitelist' ? whitelist[index] : wordbook[index]?.word;
    if (!item) return;
    const result = await chrome.runtime.sendMessage({ type: 'DELETE_SAVED_ITEM', list: type, word: item });
    if (!result?.success) return;
    whitelist = result.whitelist;
    wordbook = result.wordbook;
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
  exportAllBtn.addEventListener('click', exportAllData);
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importData(file);
    importFile.value = ''; // 重置以便重复导入同一文件
  });
  phoneSyncBtn.addEventListener('click', syncToPhone);

  chrome.runtime.onMessage.addListener((request) => {
    if (request.type === 'WHITELIST_UPDATED' || request.type === 'WORDBOOK_UPDATED') {
      loadLists().then(render);
    }
  });

  // ─── 备份所有数据（熟词本 + 学习名单 + 设置）───
  async function exportAllData() {
    const latest = await chrome.runtime.sendMessage({ type: 'GET_SAVED_DATA' });
    whitelist = latest.whitelist || [];
    wordbook = latest.wordbook || [];
    const data = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      whitelist: whitelist,
      wordbook: wordbook,
      settings: { selectedLibs, enabled, fontSize }
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `WordHint_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  }

  async function syncToPhone() {
    const url = phoneSyncURL.value.trim();
    if (!/^http:\/\/[^/]+:\d+\/api\/import$/.test(url)) {
      phoneSyncStatus.textContent = '请输入 App 中显示的完整同步地址';
      return;
    }
    phoneSyncBtn.disabled = true;
    phoneSyncStatus.textContent = '正在发送学习数据…';
    try {
      await chrome.storage.local.set({ phoneSyncURL: url });
      const latest = await chrome.runtime.sendMessage({ type: 'GET_SAVED_DATA' });
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: '1.0', exportDate: new Date().toISOString(), whitelist: latest.whitelist || [], wordbook: latest.wordbook || [] })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      phoneSyncStatus.textContent = `同步完成：新增 ${result.inserted || 0}，更新 ${result.updated || 0}，跳过 ${result.skipped || 0}`;
    } catch (error) {
      phoneSyncStatus.textContent = `同步失败：${error.message}。请确认同一 Wi-Fi 且 App 正在接收`;
    } finally {
      phoneSyncBtn.disabled = false;
    }
  }

  // ─── 导入数据 ───
  async function importData(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data.whitelist) || !Array.isArray(data.wordbook)) { alert('备份文件格式无效'); return; }
      if (data.settings) {
        selectedLibs = data.settings.selectedLibs || selectedLibs;
        enabled = data.settings.enabled !== undefined ? data.settings.enabled : enabled;
        fontSize = data.settings.fontSize || fontSize;
      }
      const result = await chrome.runtime.sendMessage({ type: 'IMPORT_SAVED_DATA', mode: 'merge', data });
      if (!result?.success) throw new Error(result?.error || '名单写入失败');
      whitelist = result.whitelist;
      wordbook = result.wordbook;
      await chrome.storage.local.set({ selectedLibs, enabled, fontSize });
      render();
      collectSelectedLibs();
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) await chrome.tabs.sendMessage(tabs[0].id, { type: 'REFRESH_PAGE', selectedLibs, enabled, fontSize });
      } catch (e) {}
      alert(`数据已合并\n\n熟词本：${whitelist.length} 词\n学习名单：${wordbook.length} 词`);
    } catch (e) {
      console.error('Import error:', e);
      alert('导入失败：' + e.message);
    }
  }

  init();
});
