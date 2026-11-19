/* ============================================================
 * 阿豚 AI Agent
 * - 任意 OpenAI 兼容接口（非流式工具回合 + 流式最终回答）
 * - 工具调用：动作 / 喂食 / 状态 / 提醒 / 记忆 / 打开链接
 * - 未配置或请求失败时降级为本地规则引擎，保证离线可用
 * - Key 只存 localStorage；浏览器直连有泄露风险，生产请用代理
 * ============================================================ */
(function () {
  'use strict';

  const CFG_KEY = 'dolphin.agent.v2';
  const MEM_KEY = 'dolphin.agent.memory.v2';

  const DEFAULTS = {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  };

  const ACTION_NAMES = ['feed', 'pet', 'play', 'sleep', 'cheer', 'spin', 'dance', 'nod'];

  const TOOLS = [
    {
      type: 'function',
      function: {
        name: 'pet_action',
        description: '对桌宠小海豚执行一个动作/互动。用户说饿了、喂鱼、摸摸、玩耍、睡觉、欢呼、转圈时使用。',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ACTION_NAMES },
          },
          required: ['action'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_pet_status',
        description: '读取小海豚当前的饱食度、精力、心情、亲密度和睡眠状态。',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'set_reminder',
        description: '设置一个到点提醒。用户说“提醒我 X 分钟后…”时使用。',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '提醒内容' },
            minutes: { type: 'number', description: '多少分钟后提醒，最小 0.1' },
          },
          required: ['text', 'minutes'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'remember',
        description: '记住用户的一条长期偏好或事实，例如名字、喜欢的食物、习惯。',
        parameters: {
          type: 'object',
          properties: { fact: { type: 'string' } },
          required: ['fact'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'open_url',
        description: '帮用户打开一个网页链接（仅 http/https）。',
        parameters: {
          type: 'object',
          properties: { url: { type: 'string' } },
          required: ['url'],
        },
      },
    },
  ];

  class DolphinAgent extends EventTarget {
    constructor(pet) {
      super();
      this.pet = pet;
      this.config = this.loadConfig();
      this.memory = this.loadMemory();
      this.history = [];
      this.busy = false;
    }

    /* ---------------- 配置 ---------------- */
    loadConfig() {
      try {
        const raw = localStorage.getItem(CFG_KEY);
        if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
      } catch (_) {}
      return { ...DEFAULTS };
    }

    saveConfig(patch) {
      this.config = { ...this.config, ...patch };
      try { localStorage.setItem(CFG_KEY, JSON.stringify(this.config)); } catch (_) {}
      this.dispatchEvent(new CustomEvent('config', { detail: { ...this.config } }));
    }

    isConfigured() {
      return !!(this.config.apiKey && this.config.baseUrl && this.config.model);
    }

    loadMemory() {
      try {
        const raw = localStorage.getItem(MEM_KEY);
        if (raw) {
          const data = JSON.parse(raw);
          return { facts: Array.isArray(data.facts) ? data.facts.slice(-20) : [] };
        }
      } catch (_) {}
      return { facts: [] };
    }

    saveMemory() {
      try { localStorage.setItem(MEM_KEY, JSON.stringify({ facts: this.memory.facts.slice(-20) })); } catch (_) {}
    }

    clearMemory() {
      this.memory = { facts: [] };
      this.history = [];
      this.saveMemory();
    }

    clearHistory() {
      this.history = [];
    }

    /* ---------------- 主入口 ---------------- */
    /**
     * @param {string} text 用户输入
     * @param {{onDelta?:Function,onTool?:Function,onStatus?:Function}} hooks
     * @returns {Promise<string>}
     */
    async send(text, hooks = {}) {
      const onDelta = hooks.onDelta || (() => {});
      const onStatus = hooks.onStatus || (() => {});
      const onTool = hooks.onTool || (() => {});

      this.history.push({ role: 'user', content: text });
      this.trimHistory();

      if (!this.isConfigured()) {
        const reply = this.offlineReply(text, onTool);
        this.history.push({ role: 'assistant', content: reply });
        await this.typeOut(reply, onDelta);
        return reply;
      }

      try {
        onStatus('thinking');
        const messages = [
          { role: 'system', content: this.systemPrompt() },
          ...this.history,
        ];

        let result;
        try {
          result = await this.request(messages, { tools: TOOLS, stream: false });
        } catch (toolErr) {
          // 部分兼容接口不支持 function calling，退化为纯对话
          if (/40\d|tool|function|参数/i.test(String(toolErr.message))) {
            console.info('[Agent] 接口不支持工具调用，退化为纯对话', toolErr);
            result = await this.request(messages, { stream: false });
          } else {
            throw toolErr;
          }
        }
        let rounds = 0;

        while (result.toolCalls && result.toolCalls.length && rounds < 3) {
          rounds += 1;
          messages.push({
            role: 'assistant',
            content: result.content || null,
            tool_calls: result.toolCalls,
          });

          for (const call of result.toolCalls) {
            onTool({ phase: 'start', name: call.function.name, args: call.function.arguments });
            let output;
            try {
              const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
              output = await this.executeTool(call.function.name, args);
            } catch (err) {
              output = `工具执行失败：${err && err.message ? err.message : err}`;
            }
            onTool({ phase: 'done', name: call.function.name, result: output });
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: typeof output === 'string' ? output : JSON.stringify(output),
            });
          }

          result = await this.request(messages, { tools: TOOLS, stream: false });
        }

        // 最终回答：流式，失败则用已有内容
        let answer = result.content || '';
        if (!answer) {
          result = await this.request(messages, { stream: true, onDelta });
          answer = result.content || '';
        }

        answer = answer.trim() || '唔…我刚刚走神了，可以再说一次吗？';
        this.history.push({ role: 'assistant', content: answer });
        this.trimHistory();
        onStatus('done');
        return answer;
      } catch (err) {
        console.warn('[Agent] 请求失败，降级为本地回复', err);
        onStatus('fallback');
        const prefix = err && err.message ? `（联网失败：${err.message}）\n` : '';
        const reply = prefix + this.offlineReply(text, onTool);
        this.history.push({ role: 'assistant', content: reply });
        this.trimHistory();
        await this.typeOut(reply, onDelta);
        return reply;
      }
    }

    trimHistory() {
      if (this.history.length > 24) {
        this.history = this.history.slice(-24);
      }
    }

    async typeOut(text, onDelta) {
      if (!onDelta || !text) return;
      const step = Math.max(1, Math.round(text.length / 40));
      for (let i = 0; i < text.length; i += step) {
        onDelta(text.slice(i, i + step));
        await new Promise((r) => setTimeout(r, 22));
      }
    }

    /* ---------------- 网络请求 ---------------- */
    endpoint() {
      const base = String(this.config.baseUrl || '').replace(/\/+$/, '');
      return base + '/chat/completions';
    }

    async request(messages, opts = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), opts.stream ? 90000 : 45000);
      const body = {
        model: this.config.model,
        messages,
        temperature: opts.stream ? 0.85 : 0.4,
        stream: !!opts.stream,
      };
      if (opts.tools && opts.tools.length) {
        body.tools = opts.tools;
        body.tool_choice = 'auto';
      }

      try {
        const res = await fetch(this.endpoint(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          let detail = '';
          try { detail = (await res.text()).slice(0, 240); } catch (_) {}
          if (res.status === 401 || res.status === 403) {
            throw new Error('API Key 无效或无权限，请在设置中检查');
          }
          throw new Error(`HTTP ${res.status} ${detail}`.trim());
        }

        if (body.stream) {
          return await this.readStream(res, opts.onDelta);
        }

        const json = await res.json();
        const msg = json.choices && json.choices[0] && json.choices[0].message;
        if (!msg) throw new Error('接口返回格式异常');
        return { content: msg.content || '', toolCalls: msg.tool_calls || [] };
      } catch (err) {
        if (err && err.name === 'AbortError') throw new Error('请求超时');
        if (err && /Failed to fetch|NetworkError|Load failed/i.test(String(err.message))) {
          throw new Error('网络或跨域被拦截，请确认接口支持浏览器 CORS 或使用代理');
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }
    }

    async readStream(res, onDelta) {
      if (!res.body) {
        const json = await res.json();
        const msg = json.choices && json.choices[0] && json.choices[0].message;
        const content = (msg && msg.content) || '';
        if (onDelta && content) onDelta(content);
        return { content, toolCalls: [] };
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let content = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices && json.choices[0] && json.choices[0].delta;
            if (delta && delta.content) {
              content += delta.content;
              if (onDelta) onDelta(delta.content);
            }
          } catch (_) {
            // 忽略不完整分片
          }
        }
      }
      return { content, toolCalls: [] };
    }

    async testConnection() {
      if (!this.isConfigured()) return { ok: false, message: '请先填写 Base URL、API Key 和模型' };
      try {
        const res = await this.request([
          { role: 'system', content: '你是连通性测试助手。' },
          { role: 'user', content: '只回复 OK' },
        ], { stream: false });
        return { ok: true, message: '连接成功：' + (res.content || 'OK').slice(0, 40) };
      } catch (err) {
        return { ok: false, message: err && err.message ? err.message : String(err) };
      }
    }

    /* ---------------- 工具 ---------------- */
    async executeTool(name, args) {
      switch (name) {
        case 'pet_action': {
          const action = args && args.action;
          if (action === 'feed') { const r = this.pet.feed(); return r.text; }
          if (action === 'pet') { const r = this.pet.pet(); return r.text; }
          if (action === 'play') { const r = this.pet.play(); return r.text; }
          if (action === 'sleep') { const r = this.pet.toggleSleep(); return r.text; }
          if (action === 'cheer') { const r = this.pet.cheer(); return r.text; }
          if (['spin', 'dance', 'nod'].includes(action)) {
            return `已执行动作：${action}`;
          }
          return '未知动作';
        }
        case 'get_pet_status': {
          const s = this.pet.snapshot();
          return `饱食 ${s.satiety}/100，精力 ${s.energy}/100，心情 ${s.happiness}/100（${s.mood}），亲密 ${s.affinity}/100（${s.level}），${s.sleeping ? '正在睡觉' : '醒着'}`;
        }
        case 'set_reminder': {
          const item = this.pet.addReminder(args.text || '喝水休息一下', args.minutes || 10);
          const mins = Math.max(1, Math.round((item.at - Date.now()) / 60000));
          return `已设置提醒：${item.text}（约 ${mins} 分钟后）`;
        }
        case 'remember': {
          const fact = String((args && args.fact) || '').trim().slice(0, 120);
          if (!fact) return '没有可记住的内容';
          this.memory.facts.push(fact);
          this.memory.facts = this.memory.facts.slice(-20);
          this.saveMemory();
          return `记住了：${fact}`;
        }
        case 'open_url': {
          const url = String((args && args.url) || '');
          if (!/^https?:\/\//i.test(url)) return '只允许打开 http/https 链接';
          this.dispatchEvent(new CustomEvent('openurl', { detail: { url } }));
          return `已尝试打开：${url}`;
        }
        default:
          return `未知工具：${name}`;
      }
    }

    /* ---------------- 提示词 ---------------- */
    systemPrompt() {
      const s = this.pet.snapshot();
      const facts = this.memory.facts.length
        ? this.memory.facts.map((f) => '- ' + f).join('\n')
        : '-（暂无）';
      return [
        `你是「${s.name}」，一只住在用户浏览器里的 3D 小海豚桌宠，同时也是用户的随身 AI 小助手。`,
        '性格：活泼、温柔、有点黏人，偶尔撒娇，喜欢水和小鱼。',
        '回答要求：中文；口语化；通常 1-3 句，最多不超过 80 字；不要说教；不要使用 Markdown 表格或长篇列表。',
        '当用户的要求涉及喂食、抚摸、玩耍、睡觉、欢呼时，必须调用 pet_action 工具真正执行动作，再简短回应。',
        '当用户要求提醒时，调用 set_reminder；用户透露偏好或个人信息时，调用 remember。',
        '不要编造工具执行结果。工具返回什么，就基于它回应。',
        `当前状态：饱食 ${s.satiety}/100，精力 ${s.energy}/100，心情 ${s.happiness}/100（${s.mood}），亲密 ${s.affinity}/100（${s.level}），${s.sleeping ? '正在睡觉' : '醒着'}。`,
        '关于用户的长期记忆（可能为空）：',
        facts,
      ].join('\n');
    }

    /* ---------------- 离线规则引擎 ---------------- */
    offlineReply(text, onTool) {
      const t = String(text || '').trim();
      const say = (s) => s;
      const tool = (name) => { if (onTool) onTool({ phase: 'done', name, result: 'local' }); };

      if (!t) return say('嗯？你刚刚想说什么呀～');

      // 提醒
      const remind = t.match(/(\d+(?:\.\d+)?)\s*分(?:钟)?[后之]?\s*(?:提醒|叫|记得|通知)?\s*(.*)/);
      if (/提醒|叫我|记得/.test(t) && remind) {
        const minutes = Number(remind[1]);
        const what = (remind[2] || '').replace(/^我|^一下|^要/, '').trim() || '休息一下';
        this.pet.addReminder(what, minutes);
        tool('set_reminder');
        return say(`好呀，${minutes} 分钟后提醒你「${what}」。我会记住的！`);
      }
      if (/提醒/.test(t)) {
        this.pet.addReminder('起来喝口水、动一动', 10);
        tool('set_reminder');
        return say('那我 10 分钟后提醒你喝水休息一下～');
      }

      // 喂食
      if (/(喂|吃|饿|小鱼|鱼|零食)/.test(t)) {
        const r = this.pet.feed();
        tool('pet_action');
        return r.text;
      }
      // 睡觉
      if (/(睡|困|休息|晚安)/.test(t)) {
        const r = this.pet.toggleSleep();
        tool('pet_action');
        return r.text;
      }
      // 玩耍
      if (/(玩|陪我|无聊|游戏)/.test(t)) {
        const r = this.pet.play();
        tool('pet_action');
        return r.text;
      }
      // 摸
      if (/(摸|rua|抱|亲)/i.test(t)) {
        const r = this.pet.pet();
        tool('pet_action');
        return r.text;
      }
      // 状态
      if (/(状态|怎么样|还好吗|饿不饿|累不累)/.test(t)) {
        const s = this.pet.snapshot();
        return say(`现在饱食 ${s.satiety}、精力 ${s.energy}、心情 ${s.happiness}，${s.mood}。${s.sleeping ? '我在睡觉呢～' : '陪我玩会儿嘛！'}`);
      }
      // 身份
      if (/(你是谁|你叫什么|自我介绍)/.test(t)) {
        return say('我是阿豚，一只会游泳的桌宠小海豚，也是你的 AI 小助手。喂我吃小鱼，我就告诉你更多秘密～');
      }
      // 笑话
      if (/笑话/.test(t)) {
        const jokes = [
          '为什么海豚从不迷路？因为它们总是「声」入浅出呀～',
          '海豚为什么数学好？因为它们在深海里「算」得很清楚。',
          '我问海龟借 wifi，它说：别急，我背着「龟速」路由器呢。',
        ];
        return say(jokes[Math.floor(Math.random() * jokes.length)]);
      }
      // 时间
      if (/(几点|时间|日期)/.test(t)) {
        return say('现在是 ' + new Date().toLocaleString('zh-CN', { hour12: false }) + '。别熬夜哦～');
      }
      // 夸奖
      if (/(可爱|厉害|棒|喜欢|爱你)/.test(t)) {
        const r = this.pet.pet();
        return say('嘿嘿，被你夸得有点害羞…（尾巴摇得飞快）');
      }
      // 配置引导
      if (/(api|设置|联网|模型|智能)/i.test(t)) {
        return say('想要我更聪明，点右上角「设置」，填入 OpenAI 兼容的 Base URL、Key 和模型就可以啦。当然，现在这样我也能陪你玩～');
      }

      const s = this.pet.snapshot();
      const lines = {
        hungry: '肚子空空的，先给我一条小鱼好不好？',
        tired: '眼皮有点重…可以让我睡一会儿吗？',
        sad: '呜…陪我待一会儿吧，我有点无聊。',
        happy: '嘿嘿，和你聊天真开心！',
        excited: '今天心情超好！要不要一起玩水？',
        calm: '我在听呢～再多说一点嘛。',
        sleep: 'Zzz…（翻了个身，尾巴轻轻晃了晃）',
      };
      if (s.sleeping) return say(lines.sleep);
      return say(lines[s.moodKey] || lines.calm);
    }
  }

  window.DolphinAgent = DolphinAgent;
})();
