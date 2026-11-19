/* ============================================================
 * 桌宠状态机
 * 饱食 / 精力 / 心情 / 亲密，随时间衰减，localStorage 持久化。
 * 提供 feed / pet / play / sleep / cheer 等互动与提醒调度。
 * ============================================================ */
(function () {
  'use strict';

  const STORAGE_KEY = 'dolphin.pet.v2';
  const MAX_OFFLINE_MS = 8 * 60 * 60 * 1000; // 最多补算 8 小时

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const MOODS = {
    sleep:   { label: '呼呼大睡', emoji: '😴' },
    hungry:  { label: '饿扁了',   emoji: '🍤' },
    tired:   { label: '有点累',   emoji: '🥱' },
    excited: { label: '超兴奋',   emoji: '🤩' },
    happy:   { label: '很开心',   emoji: '😊' },
    sad:     { label: '有点低落', emoji: '😢' },
    calm:    { label: '平静',     emoji: '😌' },
  };

  const LEVELS = [
    { min: 0,  name: '陌生' },
    { min: 20, name: '熟悉' },
    { min: 45, name: '亲近' },
    { min: 70, name: '挚友' },
    { min: 90, name: '灵魂伙伴' },
  ];

  class PetState extends EventTarget {
    constructor() {
      super();
      this.name = '阿豚';
      this.satiety = 78;
      this.energy = 82;
      this.happiness = 72;
      this.affinity = 12;
      this.sleeping = false;
      this.lastAt = Date.now();
      this.reminders = [];
      this.reminderTimers = new Map();
      this.lastInteraction = Date.now();
      this._timer = 0;
      this.load();
    }

    /* ---------------- 持久化 ---------------- */
    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (typeof data.satiety === 'number') this.satiety = clamp(data.satiety, 0, 100);
        if (typeof data.energy === 'number') this.energy = clamp(data.energy, 0, 100);
        if (typeof data.happiness === 'number') this.happiness = clamp(data.happiness, 0, 100);
        if (typeof data.affinity === 'number') this.affinity = clamp(data.affinity, 0, 100);
        this.sleeping = !!data.sleeping;
        this.reminders = Array.isArray(data.reminders) ? data.reminders : [];
        if (typeof data.lastAt === 'number') {
          const elapsed = clamp(Date.now() - data.lastAt, 0, MAX_OFFLINE_MS);
          this.advance(elapsed, true);
        }
      } catch (err) {
        console.warn('[Pet] 读取存档失败', err);
      }
      this.lastAt = Date.now();
      this.rescheduleReminders();
    }

    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          satiety: this.satiety,
          energy: this.energy,
          happiness: this.happiness,
          affinity: this.affinity,
          sleeping: this.sleeping,
          reminders: this.reminders,
          lastAt: Date.now(),
        }));
      } catch (err) {
        console.warn('[Pet] 保存失败', err);
      }
    }

    /* ---------------- 时间推进 ---------------- */
    advance(ms, offline) {
      const minutes = ms / 60000;
      if (minutes <= 0) return;

      if (this.sleeping) {
        this.energy = clamp(this.energy + minutes * 2.4, 0, 100);
        this.satiety = clamp(this.satiety - minutes * 0.12, 0, 100);
        this.happiness = clamp(this.happiness + minutes * 0.08, 0, 100);
      } else {
        this.energy = clamp(this.energy - minutes * 0.42, 0, 100);
        this.satiety = clamp(this.satiety - minutes * 0.55, 0, 100);
      }

      // 心情向当前身体状态靠拢
      const target = 42 + (this.satiety - 50) * 0.22 + (this.energy - 50) * 0.18 + this.affinity * 0.22;
      const rate = offline ? 0.35 : Math.min(0.5, minutes * 0.09);
      this.happiness = clamp(this.happiness + (target - this.happiness) * rate, 0, 100);

      // 饿了/累了自动睡
      if (!this.sleeping && this.energy < 8 && !offline) {
        this.sleeping = true;
      }
    }

    tick() {
      const now = Date.now();
      const dt = now - this.lastAt;
      this.lastAt = now;
      this.advance(dt, false);
      this.changed();
    }

    start() {
      if (this._timer) return;
      this.lastAt = Date.now();
      this._timer = setInterval(() => this.tick(), 10000);
      window.addEventListener('pagehide', () => this.save());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.save();
        else {
          const dt = Date.now() - this.lastAt;
          this.lastAt = Date.now();
          if (dt > 60000) {
            this.advance(dt, true);
            this.changed();
          }
        }
      });
    }

    /* ---------------- 派生状态 ---------------- */
    mood() {
      if (this.sleeping) return { key: 'sleep', ...MOODS.sleep };
      if (this.satiety < 25) return { key: 'hungry', ...MOODS.hungry };
      if (this.energy < 22) return { key: 'tired', ...MOODS.tired };
      if (this.happiness >= 78) return { key: 'excited', ...MOODS.excited };
      if (this.happiness >= 58) return { key: 'happy', ...MOODS.happy };
      if (this.happiness < 32) return { key: 'sad', ...MOODS.sad };
      return { key: 'calm', ...MOODS.calm };
    }

    level() {
      let lv = LEVELS[0];
      LEVELS.forEach((l) => { if (this.affinity >= l.min) lv = l; });
      return { ...lv, index: LEVELS.indexOf(lv) + 1 };
    }

    snapshot() {
      const mood = this.mood();
      const level = this.level();
      return {
        name: this.name,
        satiety: Math.round(this.satiety),
        energy: Math.round(this.energy),
        happiness: Math.round(this.happiness),
        affinity: Math.round(this.affinity),
        sleeping: this.sleeping,
        mood: mood.label,
        moodKey: mood.key,
        moodEmoji: mood.emoji,
        level: level.name,
        levelIndex: level.index,
      };
    }

    changed() {
      this.save();
      this.dispatchEvent(new CustomEvent('change', { detail: this.snapshot() }));
    }

    /* ---------------- 互动 ---------------- */
    feed() {
      this.noteInteraction();
      const wasSleeping = this.sleeping;
      this.sleeping = false;
      this.satiety = clamp(this.satiety + 26, 0, 100);
      this.happiness = clamp(this.happiness + 6, 0, 100);
      this.affinity = clamp(this.affinity + 1.5, 0, 100);
      this.lastAt = Date.now();
      this.changed();
      if (this.satiety >= 99) return { text: '呜哇，吃得太饱啦…（打了个水嗝）', action: 'happy' };
      if (wasSleeping) return { text: '唔…？有小鱼的味道！我醒啦～', action: 'eat' };
      return { text: '是小鱼！阿豚最喜欢你啦～（咔嚓咔嚓）', action: 'eat' };
    }

    pet() {
      this.noteInteraction();
      const wasSleeping = this.sleeping;
      this.sleeping = false;
      this.happiness = clamp(this.happiness + 7, 0, 100);
      this.affinity = clamp(this.affinity + 1.2, 0, 100);
      this.lastAt = Date.now();
      this.changed();
      if (wasSleeping) return { text: '唔…被摸醒啦，不过好舒服～', action: 'shy' };
      if (this.happiness > 92) return { text: '嘿嘿…再摸一下下嘛。', action: 'shy' };
      return { text: '（蹭了蹭你的手）好暖和呀～', action: 'happy' };
    }

    play() {
      this.noteInteraction();
      if (this.sleeping) {
        return { text: '我还在睡觉呢…先让我再眯一会儿。', action: 'nod' };
      }
      if (this.energy < 15) {
        return { text: '没力气玩了…让我睡一觉好不好？', action: 'nod' };
      }
      this.energy = clamp(this.energy - 11, 0, 100);
      this.satiety = clamp(this.satiety - 4, 0, 100);
      this.happiness = clamp(this.happiness + 12, 0, 100);
      this.affinity = clamp(this.affinity + 2.4, 0, 100);
      this.lastAt = Date.now();
      this.changed();
      const lines = [
        '接住水球！嘿——（溅起好大一片水花）',
        '再来一次！这次我一定能跳得更高～',
        '和你玩水最开心啦！',
      ];
      return { text: lines[Math.floor(Math.random() * lines.length)], action: 'playful' };
    }

    toggleSleep() {
      this.noteInteraction();
      if (this.sleeping) {
        this.sleeping = false;
        this.energy = clamp(this.energy + 6, 0, 100);
        this.lastAt = Date.now();
        this.changed();
        return { text: '唔…睡得正香呢。好吧，我醒啦！', action: 'stretch', sleeping: false };
      }
      if (this.energy > 90) {
        return { text: '我还精神得很，现在睡不着啦～', action: 'nod', sleeping: false };
      }
      this.sleeping = true;
      this.lastAt = Date.now();
      this.changed();
      return { text: '那我先睡一会儿…有事叫我哦。Zzz～', action: 'sleep', sleeping: true };
    }

    cheer() {
      this.noteInteraction();
      this.sleeping = false;
      this.happiness = clamp(this.happiness + 8, 0, 100);
      this.energy = clamp(this.energy - 3, 0, 100);
      this.affinity = clamp(this.affinity + 1, 0, 100);
      this.lastAt = Date.now();
      this.changed();
      return { text: '耶——！今天也要开开心心的！', action: 'cheer' };
    }

    noteInteraction() {
      this.lastInteraction = Date.now();
    }

    // 配额不足时的撒娇提醒
    needsAttention() {
      const idleMs = Date.now() - this.lastInteraction;
      if (this.sleeping) return null;
      if (this.satiety < 30) return { text: '肚子咕咕叫…有小鱼吗？', mood: 'hungry' };
      if (this.energy < 20) return { text: '好困呀，眼皮要打架了…', mood: 'tired' };
      if (idleMs > 5 * 60 * 1000) return { text: '你去哪啦？我一个人游来游去好无聊…', mood: 'sad' };
      return null;
    }

    /* ---------------- 提醒 ---------------- */
    addReminder(text, minutes) {
      const mins = clamp(Number(minutes) || 10, 0.05, 24 * 60);
      const item = {
        id: 'r' + Date.now().toString(36),
        text: String(text || '').slice(0, 120),
        at: Date.now() + mins * 60000,
      };
      this.reminders.push(item);
      this.schedule(item);
      this.save();
      return item;
    }

    schedule(item) {
      const delay = Math.max(0, item.at - Date.now());
      const timer = setTimeout(() => {
        this.reminders = this.reminders.filter((r) => r.id !== item.id);
        this.reminderTimers.delete(item.id);
        this.save();
        this.dispatchEvent(new CustomEvent('reminder', { detail: item }));
      }, Math.min(delay, 0x7fffffff));
      this.reminderTimers.set(item.id, timer);
    }

    rescheduleReminders() {
      const now = Date.now();
      const due = this.reminders.filter((r) => r.at <= now);
      this.reminders = this.reminders.filter((r) => r.at > now);
      this.reminders.forEach((r) => this.schedule(r));
      due.forEach((r) => {
        this.dispatchEvent(new CustomEvent('reminder', { detail: { ...r, missed: true } }));
      });
      if (due.length) this.save();
    }

    /* ---------------- 管理 ---------------- */
    reset() {
      this.satiety = 78;
      this.energy = 82;
      this.happiness = 72;
      this.affinity = 12;
      this.sleeping = false;
      this.lastAt = Date.now();
      this.lastInteraction = Date.now();
      this.changed();
    }

    dispose() {
      clearInterval(this._timer);
      this._timer = 0;
      this.reminderTimers.forEach((t) => clearTimeout(t));
      this.reminderTimers.clear();
    }
  }

  window.PetState = PetState;
})();
