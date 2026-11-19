/* ============================================================
 * 应用编排：把 3D 海豚、桌宠状态机、AI Agent 与页面 UI 连起来
 * ============================================================ */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const D3 = window.Dolphin3D;

  if (!window.PetState || !window.DolphinAgent) {
    console.warn('[App] 依赖脚本未就绪');
    return;
  }

  const pet = new window.PetState();
  const agent = new window.DolphinAgent(pet);
  pet.start();

  /* ---------------- 偏好 ---------------- */
  const prefs = {
    sound: localStorage.getItem('dolphin.sound') !== '0',
    reduce: localStorage.getItem('dolphin.reduce') === '1',
    roam: localStorage.getItem('dolphin.roam') === '1',
  };
  let roamPos = null;
  try { roamPos = JSON.parse(localStorage.getItem('dolphin.roamPos') || 'null'); } catch (_) {}
  let idleTimer = 0;
  let bubbleTimer = 0;
  let lastBubbleAt = 0;
  let notifyAsked = false;

  const rig = $('#heroRig');
  const bubble = $('#heroBubble');
  const chatLog = $('#chatLog');
  const chatInput = $('#chatInput');
  const sendBtn = $('#sendBtn');
  const toastEl = $('#toast');
  const connChip = $('#connChip');
  const connText = $('#connText');
  const agentHint = $('#agentHint');
  const soundBtn = $('#soundBtn');
  const roamBtn = $('#roamBtn');
  const settingsDialog = $('#settingsDialog');
  const contextMenu = $('#contextMenu');

  /* ---------------- 音效 ---------------- */
  let audioCtx = null;
  function ping(kind) {
    if (!prefs.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const map = {
        tap: [620, 880, 0.08],
        happy: [720, 1120, 0.14],
        feed: [480, 760, 0.16],
        sleep: [420, 300, 0.35],
        cheer: [660, 1320, 0.2],
      };
      const [f0, f1, dur] = map[kind] || map.tap;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f0, now);
      osc.frequency.exponentialRampToValueAtTime(f1, now + dur);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.045, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    } catch (_) {}
  }

  /* ---------------- 提示 ---------------- */
  function toast(text, ms = 2600) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => { toastEl.hidden = true; }, ms);
  }

  function say(text, opts = {}) {
    if (!bubble) return;
    bubble.textContent = text;
    bubble.hidden = false;
    requestAnimationFrame(() => bubble.classList.add('show'));
    clearTimeout(bubbleTimer);
    const dur = opts.duration || Math.min(9000, 2600 + text.length * 60);
    bubbleTimer = setTimeout(() => {
      bubble.classList.remove('show');
      setTimeout(() => { bubble.hidden = true; }, 260);
    }, dur);
    lastBubbleAt = Date.now();

    if (opts.speak && D3) {
      D3.speaking(true);
      setTimeout(() => D3.speaking(false), Math.min(6000, 900 + text.length * 80));
    }
    if (opts.sound) ping(opts.sound);
  }

  /* ---------------- 状态渲染 ---------------- */
  const bars = {
    satiety: { bar: $('#satietyBar'), val: $('#satietyVal'), host: document.querySelector('.stat[data-stat="satiety"]') },
    energy: { bar: $('#energyBar'), val: $('#energyVal'), host: document.querySelector('.stat[data-stat="energy"]') },
    happiness: { bar: $('#happinessBar'), val: $('#happinessVal'), host: document.querySelector('.stat[data-stat="happiness"]') },
    affinity: { bar: $('#affinityBar'), val: $('#affinityVal'), host: document.querySelector('.stat[data-stat="affinity"]') },
  };
  const moodChip = $('#moodChip');
  const affinityChip = $('#affinityChip');
  let lastSleeping = null;

  function renderStats(s) {
    Object.keys(bars).forEach((key) => {
      const item = bars[key];
      if (!item.bar) return;
      item.bar.style.width = s[key] + '%';
      if (item.val) item.val.textContent = s[key];
      if (item.host) item.host.classList.toggle('is-low', s[key] < 25);
    });
    if (moodChip) moodChip.textContent = `${s.moodEmoji} ${s.mood}`;
    if (affinityChip) affinityChip.textContent = `亲密 Lv.${s.levelIndex} · ${s.level}`;

    if (D3 && s.sleeping !== lastSleeping) {
      D3.setSleeping(s.sleeping);
      lastSleeping = s.sleeping;
    }
  }

  function renderAgentState() {
    const on = agent.isConfigured();
    if (connChip) {
      connChip.classList.toggle('chip-online', on);
      connChip.classList.toggle('chip-offline', !on);
    }
    if (connText) connText.textContent = on ? '智能模式' : '离线陪伴';
    if (agentHint) {
      agentHint.textContent = on
        ? `已连接 ${agent.config.model} · 可调用桌宠工具`
        : '未配置 API Key 时使用本地规则回复';
    }
  }

  pet.addEventListener('change', (e) => renderStats(e.detail));
  renderStats(pet.snapshot());
  renderAgentState();
  agent.addEventListener('config', renderAgentState);

  /* ---------------- 动作 ---------------- */
  function doAction(name) {
    let result = null;
    switch (name) {
      case 'feed': result = pet.feed(); ping('feed'); break;
      case 'pet': result = pet.pet(); ping('happy'); break;
      case 'play': result = pet.play(); ping('happy'); break;
      case 'sleep': result = pet.toggleSleep(); ping('sleep'); break;
      case 'cheer': result = pet.cheer(); ping('cheer'); break;
      case 'spin':
        if (D3) D3.play('spin');
        result = { text: '转个圈给你看～', action: 'spin' };
        ping('tap');
        break;
      case 'dance':
        if (D3) D3.play('dance');
        result = { text: '一起摇摆！', action: 'dance' };
        break;
      default: return;
    }
    if (!result) return;
    if (result.action && D3) D3.play(result.action);
    say(result.text, { speak: true });
    if (name !== 'sleep') askNotifyPermission();
  }

  document.querySelectorAll('.actions .action').forEach((btn) => {
    btn.addEventListener('click', () => doAction(btn.dataset.action));
  });

  /* ---------------- 3D 交互 ---------------- */
  if (D3) {
    D3.on('pet', () => doAction('pet'));
    D3.on('double', () => doAction('cheer'));
    D3.on('drag', ({ dx, dy }) => moveRoamBy(dx, dy));
  }

  /* ---------------- 2D 降级下的交互 ---------------- */
  const hero2d = document.getElementById('hero2d');
  if (hero2d) {
    let moved2d = false;
    let last2d = null;
    hero2d.addEventListener('pointerdown', (e) => {
      if (!prefs.roam) return;
      moved2d = false;
      last2d = { x: e.clientX, y: e.clientY };
      try { hero2d.setPointerCapture(e.pointerId); } catch (_) {}
    });
    hero2d.addEventListener('pointermove', (e) => {
      if (!last2d) return;
      const dx = e.clientX - last2d.x;
      const dy = e.clientY - last2d.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved2d = true;
      last2d = { x: e.clientX, y: e.clientY };
      moveRoamBy(dx, dy);
    });
    hero2d.addEventListener('pointerup', () => {
      last2d = null;
      if (!prefs.roam) return;
      roamPos = { x: parseFloat(rig.style.left) || 0, y: parseFloat(rig.style.top) || 0 };
      localStorage.setItem('dolphin.roamPos', JSON.stringify(roamPos));
    });
    hero2d.addEventListener('click', () => {
      if (moved2d) { moved2d = false; return; }
      doAction('pet');
    });
    hero2d.addEventListener('dblclick', () => doAction('cheer'));
  }

  /* ---------------- 聊天 ---------------- */
  function appendMessage(role, text) {
    const wrap = document.createElement('div');
    wrap.className = 'msg msg-' + role;
    const inner = document.createElement('div');
    inner.className = 'bubble-text';
    inner.textContent = text;
    wrap.appendChild(inner);
    chatLog.appendChild(wrap);
    chatLog.scrollTop = chatLog.scrollHeight;
    return { wrap, inner };
  }

  function appendTyping() {
    const wrap = document.createElement('div');
    wrap.className = 'msg msg-bot';
    const inner = document.createElement('div');
    inner.className = 'bubble-text';
    inner.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    wrap.appendChild(inner);
    chatLog.appendChild(wrap);
    chatLog.scrollTop = chatLog.scrollHeight;
    return { wrap, inner };
  }

  function scrollChat() {
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  const TOOL_VISUAL = {
    feed: 'eat', pet: 'happy', play: 'playful', sleep: 'stretch',
    cheer: 'cheer', spin: 'spin', dance: 'dance', nod: 'nod',
  };

  function onToolEvent(ev) {
    if (!ev || ev.phase !== 'start' || ev.name !== 'pet_action') return;
    try {
      const args = JSON.parse(ev.args || '{}');
      const visual = TOOL_VISUAL[args.action];
      if (visual && D3) D3.play(visual);
    } catch (_) {}
  }

  async function sendMessage(rawText) {
    const text = (rawText != null ? rawText : chatInput.value).trim();
    if (!text || agent.busy) return;
    agent.busy = true;
    sendBtn.disabled = true;
    chatInput.value = '';
    autoGrow();

    appendMessage('user', text);
    const typing = appendTyping();
    let started = false;
    askNotifyPermission();

    try {
      const reply = await agent.send(text, {
        onDelta(delta) {
          if (!started) {
            started = true;
            typing.inner.textContent = '';
          }
          typing.inner.textContent += delta;
          scrollChat();
        },
        onStatus(status) {
          if (status === 'fallback') toast('网络不可用，已切换本地回复');
        },
        onTool: onToolEvent,
      });

      typing.inner.textContent = reply;
      scrollChat();
      const short = reply.replace(/\s+/g, ' ').slice(0, 80);
      say(short + (reply.length > 80 ? '…' : ''), { speak: true });
    } catch (err) {
      typing.inner.textContent = '呜…我好像卡住了，再试一次好吗？';
    } finally {
      agent.busy = false;
      sendBtn.disabled = false;
      chatInput.focus();
    }
  }

  function autoGrow() {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(120, chatInput.scrollHeight) + 'px';
  }

  document.getElementById('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage();
  });
  chatInput.addEventListener('input', autoGrow);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });

  document.querySelectorAll('.quick-chips button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt || btn.textContent;
      chatInput.value = prompt;
      sendMessage(prompt);
    });
  });

  const clearChatBtn = $('#clearChatBtn');
  if (clearChatBtn) {
    clearChatBtn.addEventListener('click', () => {
      agent.clearHistory();
      chatLog.innerHTML = '';
      appendMessage('bot', '对话清空啦，我们重新开始吧～');
      toast('对话已清空');
    });
  }

  /* ---------------- 设置 ---------------- */
  function openSettings() {
    $('#cfgBaseUrl').value = agent.config.baseUrl || '';
    $('#cfgApiKey').value = agent.config.apiKey || '';
    $('#cfgModel').value = agent.config.model || '';
    $('#cfgSound').checked = prefs.sound;
    $('#cfgReduce').checked = prefs.reduce;
    if (!settingsDialog.open) settingsDialog.showModal();
  }

  $('#settingsBtn').addEventListener('click', openSettings);

  settingsDialog.addEventListener('close', () => {
    if (settingsDialog.returnValue !== 'save') return;
    agent.saveConfig({
      baseUrl: $('#cfgBaseUrl').value.trim() || 'https://api.openai.com/v1',
      apiKey: $('#cfgApiKey').value.trim(),
      model: $('#cfgModel').value.trim() || 'gpt-4o-mini',
    });
    prefs.sound = $('#cfgSound').checked;
    localStorage.setItem('dolphin.sound', prefs.sound ? '1' : '0');
    soundBtn.textContent = prefs.sound ? '🔊' : '🔇';
    soundBtn.setAttribute('aria-pressed', String(prefs.sound));

    const reduce = $('#cfgReduce').checked;
    prefs.reduce = reduce;
    localStorage.setItem('dolphin.reduce', reduce ? '1' : '0');
    if (D3 && !prefs.roam) D3.setMode(reduce ? '2d' : '3d');

    renderAgentState();
    toast('设置已保存');
  });

  $('#testConnBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    const cfg = {
      baseUrl: $('#cfgBaseUrl').value.trim(),
      apiKey: $('#cfgApiKey').value.trim(),
      model: $('#cfgModel').value.trim(),
    };
    const backup = { ...agent.config };
    agent.config = { ...agent.config, ...cfg };
    toast('正在测试连接…', 8000);
    const res = await agent.testConnection();
    agent.config = backup;
    toast(res.message, 4200);
  });

  $('#forgetBtn').addEventListener('click', (e) => {
    e.preventDefault();
    agent.clearMemory();
    toast('长期记忆已清除');
  });

  $('#resetPetBtn').addEventListener('click', (e) => {
    e.preventDefault();
    pet.reset();
    toast('宠物状态已重置');
  });

  soundBtn.addEventListener('click', () => {
    prefs.sound = !prefs.sound;
    localStorage.setItem('dolphin.sound', prefs.sound ? '1' : '0');
    soundBtn.textContent = prefs.sound ? '🔊' : '🔇';
    soundBtn.setAttribute('aria-pressed', String(prefs.sound));
    if (prefs.sound) ping('tap');
  });
  soundBtn.textContent = prefs.sound ? '🔊' : '🔇';
  soundBtn.setAttribute('aria-pressed', String(prefs.sound));

  /* ---------------- 漂浮模式 ---------------- */
  let placeholder = null;

  function ensurePlaceholder() {
    if (placeholder) return;
    placeholder = document.createElement('div');
    placeholder.className = 'is-roaming-placeholder';
    placeholder.textContent = '阿豚正在屏幕上漂浮 · 拖动它，或再次点击「漂浮模式」归位';
    rig.insertAdjacentElement('afterend', placeholder);
  }

  function setRoam(on, silent) {
    prefs.roam = !!on;
    localStorage.setItem('dolphin.roam', on ? '1' : '0');
    roamBtn.setAttribute('aria-pressed', String(!!on));
    if (on) {
      ensurePlaceholder();
      rig.classList.add('is-roaming');
      const rect = rig.getBoundingClientRect();
      const x = roamPos && typeof roamPos.x === 'number' ? roamPos.x : window.innerWidth - rect.width - 24;
      const y = roamPos && typeof roamPos.y === 'number' ? roamPos.y : 96;
      rig.style.left = clampX(x, rect.width) + 'px';
      rig.style.top = clampY(y, rect.height) + 'px';
      if (D3) D3.setDragMode('move');
      if (!silent) toast('漂浮模式：拖动阿豚到任意位置');
    } else {
      rig.classList.remove('is-roaming');
      rig.style.left = '';
      rig.style.top = '';
      if (placeholder) { placeholder.remove(); placeholder = null; }
      if (D3) D3.setDragMode('rotate');
      if (!silent) toast('已回到展台');
    }
  }

  function clampX(x, w) {
    const width = w || rig.offsetWidth || 300;
    return Math.max(8, Math.min(window.innerWidth - width - 8, x));
  }
  function clampY(y, h) {
    const height = h || rig.offsetHeight || 320;
    return Math.max(8, Math.min(window.innerHeight - height - 8, y));
  }

  function moveRoamBy(dx, dy) {
    if (!prefs.roam) return;
    const left = parseFloat(rig.style.left) || 0;
    const top = parseFloat(rig.style.top) || 0;
    rig.style.left = clampX(left + dx) + 'px';
    rig.style.top = clampY(top + dy) + 'px';
    roamPos = { x: parseFloat(rig.style.left), y: parseFloat(rig.style.top) };
  }

  roamBtn.addEventListener('click', () => setRoam(!prefs.roam));
  if (prefs.roam) setRoam(true, true);

  window.addEventListener('resize', () => {
    if (!prefs.roam) return;
    rig.style.left = clampX(parseFloat(rig.style.left) || 0) + 'px';
    rig.style.top = clampY(parseFloat(rig.style.top) || 0) + 'px';
    roamPos = { x: parseFloat(rig.style.left), y: parseFloat(rig.style.top) };
  });

  rig.addEventListener('pointerup', () => {
    if (!prefs.roam) return;
    roamPos = { x: parseFloat(rig.style.left) || 0, y: parseFloat(rig.style.top) || 0 };
    localStorage.setItem('dolphin.roamPos', JSON.stringify(roamPos));
  });

  /* ---------------- 右键菜单 ---------------- */
  rig.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    contextMenu.hidden = false;
    const w = contextMenu.offsetWidth || 170;
    const h = contextMenu.offsetHeight || 240;
    contextMenu.style.left = Math.min(e.clientX, window.innerWidth - w - 8) + 'px';
    contextMenu.style.top = Math.min(e.clientY, window.innerHeight - h - 8) + 'px';
  });

  document.addEventListener('pointerdown', (e) => {
    if (!contextMenu.hidden && !contextMenu.contains(e.target)) contextMenu.hidden = true;
  });

  contextMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cmd]');
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    contextMenu.hidden = true;
    if (cmd === 'talk') { chatInput.focus(); return; }
    if (cmd === 'roam') { setRoam(!prefs.roam); return; }
    if (cmd === 'settings') { openSettings(); return; }
    doAction(cmd);
  });

  /* ---------------- 提醒 ---------------- */
  pet.addEventListener('reminder', (e) => {
    const item = e.detail || {};
    const head = item.missed ? '（补发）到点提醒' : '到点提醒';
    say(`${head}：${item.text}`, { duration: 12000, speak: true, sound: 'cheer' });
    toast(`提醒：${item.text}`, 6000);
    ping('cheer');
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('阿豚的提醒', { body: item.text }); } catch (_) {}
    }
  });

  function askNotifyPermission() {
    if (notifyAsked) return;
    notifyAsked = true;
    if ('Notification' in window && Notification.permission === 'default') {
      try { Notification.requestPermission(); } catch (_) {}
    }
  }

  agent.addEventListener('openurl', (e) => {
    const url = e.detail && e.detail.url;
    if (!url) return;
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (_) {}
  });

  /* ---------------- 空闲行为 ---------------- */
  const IDLE_ACTIONS = ['bounce', 'playful', 'stretch', 'spin'];
  idleTimer = setInterval(() => {
    if (document.hidden) return;
    const idleMs = Date.now() - pet.lastInteraction;
    if (idleMs < 40000) return;

    const need = pet.needsAttention();
    if (need && Date.now() - lastBubbleAt > 100000) {
      say(need.text, { duration: 7000 });
      return;
    }
    if (Math.random() < 0.45 && D3) {
      D3.play(IDLE_ACTIONS[Math.floor(Math.random() * IDLE_ACTIONS.length)]);
    }
  }, 25000);

  /* ---------------- 键盘快捷键 ---------------- */
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== chatInput && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      chatInput.focus();
    }
    if (e.key === 'Escape') {
      contextMenu.hidden = true;
    }
  });

  window.addEventListener('pagehide', () => {
    clearInterval(idleTimer);
    pet.save();
  });

  /* ---------------- 开场 ---------------- */
  setTimeout(() => {
    const s = pet.snapshot();
    if (s.sleeping) say('Zzz… 我在睡觉，悄悄来就好～');
    else if (s.satiety < 30) say('肚子有点饿…有小鱼吃吗？');
    else say(`我是阿豚！${s.moodEmoji} 现在${s.mood}，随时叫我～`);
  }, 900);
})();
