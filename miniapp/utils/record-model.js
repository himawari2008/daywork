// ============================================
// 活记 · 记录数据模型（数据真相源 / Single Source of Truth）
//
// 本文件是「收口 ParsedRecord schema 契约」的第一轮交付：
//   - 规范化记录字段清单（PARSERECORD_FIELDS）
//   - mockParse(transcript)：无后端时的逼真占位记录（供 UI 渲染）
//   - normalizeRecord(raw)：防御性地把任何后端/导入/语音形状映射为规范 ParsedRecord
//   - validateRecord(r)：返回 { ok, errors }
//
// 设计原则：
//   1. 与现有代码兼容：后端记录字段（summary/content/tags/people/numericInfo/
//      status/mood/groupId/isPinned/remindAt/attachments）保持原样映射，
//      不改动首页 index.js / 详情 detail.js 的读取方式。
//   2. 与任务建议对齐：emotion / moodColor 作为「派生字段」存在，
//      实际情绪真相是 mood.{label, tone, intensity}（沿用 index/detail 既有 parseMood）。
//   3. 纯 JS、无 wx.* / getApp 依赖 —— 可被微信小程序 require，也可被 node 直接跑。
//   4. 绝不抛错：normalizeRecord 在任意异常下回退到默认规范记录。
// ============================================

// —— 合法枚举 ——
var STATUS_VALUES = ['待办', '已完成', '待跟进'];
var MOOD_TONES = ['positive', 'negative', 'neutral'];

// 情绪色调 → 派生色（UI 可用于内联 style 或作为兜底）
var MOOD_COLOR_MAP = {
  positive: '#3FA66A',
  negative: '#E06B5A',
  neutral: '#8A93A6',
};

// 旧格式纯文本心情 → 规范 mood（与 index.js / detail.js 的 legacyMap 保持一致）
var LEGACY_MOOD_MAP = {
  '开心': { label: '开心', tone: 'positive', intensity: 3 },
  '平静': { label: '平静', tone: 'neutral', intensity: 2 },
  '疲惫': { label: '疲惫', tone: 'negative', intensity: 3 },
  '压力': { label: '有压力', tone: 'negative', intensity: 3 },
  '生气': { label: '生气', tone: 'negative', intensity: 4 },
};

// ============================================
// 字段清单（UI Designer 对齐依据）
//   required: 是否为核心必填（校验时参与校验，其余为可选/派生）
//   kind: core(后端既有真相) | new(本轮新增收纳) | derived(由其它字段派生)
// ============================================
var PARSERECORD_FIELDS = [
  { key: 'id',            type: 'string|null', required: false, kind: 'core',
    desc: '后端记录 ID；未保存（导入预览/语音待识别）时为 null' },
  { key: 'type',          type: 'string',      required: false, kind: 'new',
    desc: "记录来源类型：'voice' | 'text' | 'import' | 'image' | 'manual'" },
  { key: 'transcript',    type: 'string',      required: false, kind: 'new',
    desc: '原始转录文本（语音 STT 原文 / 用户粘贴原文），未被 AI 改写' },
  { key: 'content',       type: 'string',      required: false, kind: 'core',
    desc: '正文（创建时提交的文本；语音记录等同 transcript）。UI 渲染主文本' },
  { key: 'text',          type: 'string',      required: false, kind: 'derived',
    desc: 'content 的别名，便于不同来源统一读取' },
  { key: 'summary',       type: 'string',      required: false, kind: 'core',
    desc: 'AI 摘要（一句话提炼），时间线卡片标题' },
  { key: 'tags',          type: 'string[]',    required: false, kind: 'core',
    desc: '标签数组，字符串' },
  { key: 'people',        type: 'string[]',    required: false, kind: 'core',
    desc: '涉及人物数组，字符串（导入/详情页均使用）' },
  { key: 'numericInfo',   type: 'object',      required: false, kind: 'core',
    desc: '键值数值信息，如 { 金额: "120", 数量: "3" }' },
  { key: 'mood',          type: 'object|null', required: false, kind: 'core',
    desc: '情绪真相：{ label:string, tone:positive|negative|neutral, intensity:1-5 }' },
  { key: 'emotion',       type: 'string',      required: false, kind: 'derived',
    desc: '派生：mood ? mood.tone : "neutral"，UI 快捷读取情绪键' },
  { key: 'moodColor',     type: 'string',      required: false, kind: 'derived',
    desc: '派生：情绪对应十六进制色，MOOD_COLOR_MAP[emotion]' },
  { key: 'status',        type: "string|null", required: false, kind: 'core',
    desc: "处理状态：'待办' | '已完成' | '待跟进' | null" },
  { key: 'todos',         type: 'object[]',    required: false, kind: 'new',
    desc: '待办列表 [{ title:string, due:string|null, done:boolean }]' },
  { key: 'events',        type: 'object[]',    required: false, kind: 'new',
    desc: '日程/事件 [{ title:string, start:string|null, end:string|null }]' },
  { key: 'remindAt',      type: 'string|null', required: false, kind: 'core',
    desc: '提醒时间（ISO 字符串）；无提醒为 null' },
  { key: 'groupId',       type: 'string|null', required: false, kind: 'core',
    desc: '所属分组 ID；未分组为 null' },
  { key: 'suggestedGroupName', type: 'string|null', required: false, kind: 'new',
    desc: 'AI 建议分组名（导入预览用，仅 UI 高亮提示，不入库到 groupId）' },
  { key: 'isPinned',      type: 'boolean',     required: false, kind: 'core',
    desc: '是否置顶' },
  { key: 'attachments',   type: 'string[]',    required: false, kind: 'core',
    desc: '附件 URL 数组，如 ["/uploads/voice/xxx.wav"]' },
  { key: 'confidence',    type: 'number',      required: false, kind: 'new',
    desc: 'AI 解析置信度 0-1（mock/后端填充）' },
  { key: 'source',        type: 'string',      required: false, kind: 'new',
    desc: "来源标识：'voice'|'text'|'import'|'image'|'manual'|'mock'" },
  { key: 'createdAt',     type: 'string',      required: false, kind: 'core',
    desc: '创建时间（ISO）' },
  { key: 'updatedAt',     type: 'string',      required: false, kind: 'core',
    desc: '最后更新时间（ISO）' },
  { key: 'recordedAt',    type: 'string|null', required: false, kind: 'core',
    desc: '事件实际发生时间（ISO）；用于时间线分组/日历' },
];

// ============================================
// 工具函数
// ============================================

/** 安全取当前 ISO 时间 */
function _nowISO() {
  try { return new Date().toISOString(); } catch (e) { return ''; }
}

/** 数组兜底 */
function _asArray(v) {
  if (Array.isArray(v)) return v;
  return [];
}

/** 对象兜底（非 null 的纯对象） */
function _asObject(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  return {};
}

/** 规范 mood：兼容 对象 / JSON 字符串 / 旧格式纯文本 */
function parseMood(raw) {
  if (!raw) return null;

  var obj = null;
  if (typeof raw === 'string') {
    var s = raw.trim();
    if (!s) return null;
    // 尝试 JSON 解析（detail/index 入库时 mood 被 JSON.stringify）
    try {
      var parsed = JSON.parse(s);
      if (parsed && typeof parsed === 'object') obj = parsed;
    } catch (e) {
      // 不是 JSON → 旧格式纯文本（5 种中文之一，或任意自定义文本）
      if (LEGACY_MOOD_MAP[s]) return LEGACY_MOOD_MAP[s];
      return { label: s, tone: 'neutral', intensity: 2 };
    }
  } else if (typeof raw === 'object') {
    obj = raw;
  }

  if (!obj) return null;

  var tone = MOOD_TONES.indexOf(obj.tone) >= 0 ? obj.tone : 'neutral';
  var intensity = parseInt(obj.intensity, 10);
  if (isNaN(intensity) || intensity < 1) intensity = 2;
  if (intensity > 5) intensity = 5;

  return {
    label: typeof obj.label === 'string' ? obj.label : '',
    tone: tone,
    intensity: intensity,
  };
}

/** 由 mood 派生情绪键 */
function emotionOf(mood) {
  return (mood && mood.tone) ? mood.tone : 'neutral';
}

/** 由情绪键取派生色 */
function moodColorFor(emotion) {
  return MOOD_COLOR_MAP[emotion] || MOOD_COLOR_MAP.neutral;
}

/** 规范 status 取值 */
function _normStatus(v) {
  if (v === null || v === undefined || v === '') return null;
  if (STATUS_VALUES.indexOf(v) >= 0) return v;
  // 兼容英文/别名
  if (v === 'done' || v === 'completed') return '已完成';
  if (v === 'pending' || v === 'todo') return '待办';
  if (v === 'followup' || v === 'following') return '待跟进';
  return null;
}

// ============================================
// 默认规范记录
// ============================================
function _defaultRecord() {
  var now = _nowISO();
  return {
    id: null,
    type: 'manual',
    transcript: '',
    content: '',
    text: '',
    summary: '',
    tags: [],
    people: [],
    numericInfo: {},
    mood: null,
    emotion: 'neutral',
    moodColor: MOOD_COLOR_MAP.neutral,
    status: null,
    todos: [],
    events: [],
    remindAt: null,
    groupId: null,
    suggestedGroupName: null,
    isPinned: false,
    attachments: [],
    confidence: 0.5,
    source: 'manual',
    createdAt: now,
    updatedAt: now,
    recordedAt: null,
  };
}

// ============================================
// normalizeRecord(raw)：任意形状 → 规范 ParsedRecord
// 绝不抛错；任何异常都回退默认值
// ============================================
function normalizeRecord(raw) {
  var base = _defaultRecord();
  if (!raw || typeof raw !== 'object') return base;

  try {
    if (raw.id != null) base.id = String(raw.id);

    // 来源判定
    var src = raw.source || raw.type || null;
    if (src) { base.source = String(src); base.type = String(src); }
    else if (raw.transcript && !raw.content) base.source = base.type = 'voice';
    else if (raw.attachments && _asArray(raw.attachments).some(function (a) { return /uploads\/voice/.test(a); })) {
      base.source = base.type = 'voice';
    }

    // 文本
    base.transcript = raw.transcript != null ? String(raw.transcript) : '';
    base.content = raw.content != null ? String(raw.content)
      : (raw.text != null ? String(raw.text) : base.transcript);
    base.text = base.content;

    base.summary = raw.summary != null ? String(raw.summary) : '';

    base.tags = _asArray(raw.tags).map(function (t) { return String(t); });
    base.people = _asArray(raw.people).map(function (p) { return String(p); });
    base.numericInfo = _asObject(raw.numericInfo);

    // mood → 规范
    var mood = parseMood(raw.mood);
    base.mood = mood;
    base.emotion = emotionOf(mood);
    base.moodColor = moodColorFor(base.emotion);

    base.status = _normStatus(raw.status);

    // todos：兼容 [{title,...}] 或对象数组
    base.todos = _asArray(raw.todos).map(function (t) {
      if (typeof t === 'string') return { title: t, due: null, done: false };
      return {
        title: t && t.title != null ? String(t.title) : '',
        due: t && t.due != null ? String(t.due) : null,
        done: !!(t && t.done),
      };
    });

    // events
    base.events = _asArray(raw.events).map(function (ev) {
      if (typeof ev === 'string') return { title: ev, start: null, end: null };
      return {
        title: ev && ev.title != null ? String(ev.title) : '',
        start: ev && ev.start != null ? String(ev.start) : null,
        end: ev && ev.end != null ? String(ev.end) : null,
      };
    });

    // 时间
    if (raw.remindAt != null) base.remindAt = String(raw.remindAt);
    if (raw.groupId != null && raw.groupId !== '') base.groupId = String(raw.groupId);
    base.isPinned = !!raw.isPinned;
    base.attachments = _asArray(raw.attachments).map(function (a) { return String(a); });

    if (typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1) {
      base.confidence = raw.confidence;
    }

    if (raw.suggestedGroupName != null) {
      base.suggestedGroupName = String(raw.suggestedGroupName);
    } else if (raw.suggestedGroup && raw.suggestedGroup.name) {
      base.suggestedGroupName = String(raw.suggestedGroup.name);
    }

    if (raw.createdAt) base.createdAt = String(raw.createdAt);
    if (raw.updatedAt) base.updatedAt = String(raw.updatedAt);
    if (raw.recordedAt) base.recordedAt = String(raw.recordedAt);
  } catch (e) {
    // 防御性兜底：返回已填充的默认值 + 原始内容
    console.warn('[record-model] normalizeRecord 异常，已回退默认:', e);
  }

  return base;
}

// ============================================
// validateRecord(r)：返回 { ok, errors }
// ============================================
function validateRecord(r) {
  var errors = [];
  if (!r || typeof r !== 'object') {
    return { ok: false, errors: ['记录对象为空'] };
  }
  if (typeof r.content !== 'string') errors.push('content 必须是字符串');
  if (r.id != null && typeof r.id !== 'string') errors.push('id 必须是字符串或 null');
  if (!Array.isArray(r.tags)) errors.push('tags 必须是数组');
  if (!Array.isArray(r.people)) errors.push('people 必须是数组');
  if (typeof r.numericInfo !== 'object' || Array.isArray(r.numericInfo)) errors.push('numericInfo 必须是对象');

  if (r.status !== null && STATUS_VALUES.indexOf(r.status) < 0) {
    errors.push("status 必须是 '待办' | '已完成' | '待跟进' | null");
  }

  if (r.mood !== null) {
    if (typeof r.mood !== 'object') {
      errors.push('mood 必须是对象或 null');
    } else {
      if (MOOD_TONES.indexOf(r.mood.tone) < 0) errors.push("mood.tone 必须是 positive|negative|neutral");
      if (typeof r.mood.label !== 'string') errors.push('mood.label 必须是字符串');
      var it = parseInt(r.mood.intensity, 10);
      if (isNaN(it) || it < 1 || it > 5) errors.push('mood.intensity 必须是 1-5 的整数');
    }
  }

  if (typeof r.confidence !== 'number' || r.confidence < 0 || r.confidence > 1) {
    errors.push('confidence 必须是 0-1 的数值');
  }

  if (!Array.isArray(r.todos)) {
    errors.push('todos 必须是数组');
  } else {
    r.todos.forEach(function (t, i) {
      if (typeof t.title !== 'string') errors.push('todos[' + i + '].title 必须是字符串');
    });
  }
  if (!Array.isArray(r.events)) {
    errors.push('events 必须是数组');
  }

  return { ok: errors.length === 0, errors: errors };
}

// ============================================
// mockParse(transcript[, opts])：无后端时的逼真占位解析
//   opts: { type, source } 可选，默认 type='voice'
// 用简单规则抽取标签/情绪/待办/事件，供 UI 直接渲染
// ============================================

// 情绪关键词
var POSITIVE_WORDS = ['开心', '高兴', '完成', '成功', '顺利', '棒', '好', '喜欢', '感谢', '收获', '满意', '惊喜'];
var NEGATIVE_WORDS = ['累', '疲惫', '压力', '生气', '烦', '焦虑', '难过', '担心', '失败', '坏', '糟', '辛苦'];
// 待办关键词
var TODO_WORDS = ['待办', '要', '需要', '记得', '提醒', '记得做', 'todo', '去做', '跟进', '联系'];
// 事件关键词
var EVENT_WORDS = ['会议', '拜访', '见面', '聚会', '出差', '面试', '谈判', '聚餐', '约'];

/** 把文本拆成句子 */
function _splitSentences(text) {
  return String(text || '')
    .split(/[。！？!?\n;；]+/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
}

/** 从句子中抽取日期（明天/后天/下周X/M月D日/YYYY-MM-DD） */
function _extractDate(sentence) {
  var m = sentence.match(/(\d{4}-\d{1,2}-\d{1,2})/);
  if (m) return m[1];
  m = sentence.match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (m) return (new Date().getFullYear()) + '-' + m[1] + '-' + m[2];
  if (/后天/.test(sentence)) {
    var d2 = new Date(Date.now() + 2 * 86400000);
    return d2.toISOString().slice(0, 10);
  }
  if (/明天/.test(sentence)) {
    var d1 = new Date(Date.now() + 86400000);
    return d1.toISOString().slice(0, 10);
  }
  if (/下周/.test(sentence)) {
    var d3 = new Date(Date.now() + 7 * 86400000);
    return d3.toISOString().slice(0, 10);
  }
  return null;
}

/** 简易情绪判定 */
function _detectTone(text) {
  var pos = 0, neg = 0;
  POSITIVE_WORDS.forEach(function (w) { if (text.indexOf(w) >= 0) pos++; });
  NEGATIVE_WORDS.forEach(function (w) { if (text.indexOf(w) >= 0) neg++; });
  if (neg > pos) return { tone: 'negative', intensity: 3, label: '有些压力' };
  if (pos > neg) return { tone: 'positive', intensity: 3, label: '不错' };
  return { tone: 'neutral', intensity: 2, label: '' };
}

function mockParse(transcript, opts) {
  opts = opts || {};
  var text = String(transcript || '').trim();
  var type = opts.type || opts.source || 'voice';
  var source = type;

  var sentences = _splitSentences(text);
  var firstSentence = sentences[0] || text;

  // 摘要：取首句，过长截断
  var summary = firstSentence.slice(0, 40);
  if (firstSentence.length > 40) summary += '…';

  // 标签：从 #标签 或高频名词简单抽取
  var tags = [];
  var hashTags = text.match(/#([^\s#]+)/g) || [];
  hashTags.forEach(function (h) { tags.push(h.replace('#', '')); });
  if (tags.length === 0) {
    // 无 # 时，用事件/待办关键词作为轻量标签
    if (/报价|价格|钱|元|万/.test(text)) tags.push('报价');
    if (/客户|拜访/.test(text)) tags.push('客户');
    if (/进货|采购/.test(text)) tags.push('进货');
    if (/工|工地|施工/.test(text)) tags.push('记工');
  }

  // 情绪
  var moodInfo = _detectTone(text);
  var mood = {
    label: moodInfo.label,
    tone: moodInfo.tone,
    intensity: moodInfo.intensity,
  };

  // 待办
  var todos = [];
  sentences.forEach(function (s) {
    var hit = TODO_WORDS.some(function (w) { return s.indexOf(w) >= 0; });
    if (hit) {
      todos.push({ title: s.slice(0, 50), due: _extractDate(s), done: false });
    }
  });

  // 事件
  var events = [];
  sentences.forEach(function (s) {
    var hit = EVENT_WORDS.some(function (w) { return s.indexOf(w) >= 0; });
    if (hit) {
      events.push({ title: s.slice(0, 50), start: _extractDate(s), end: null });
    }
  });

  // 数值：简单匹配 "X元 / X万 / 数量N"
  var numericInfo = {};
  var yuan = text.match(/(\d+(?:\.\d+)?)\s*元/);
  if (yuan) numericInfo['金额'] = yuan[1];
  var wan = text.match(/(\d+(?:\.\d+)?)\s*万/);
  if (wan) numericInfo['金额(万)'] = wan[1];
  var count = text.match(/(\d+(?:\.\d+)?)\s*(?:个|件|箱|袋|束)/);
  if (count) numericInfo['数量'] = count[1];

  // 置信度：基于文本长度启发式（mock 无法真算，给合理值）
  var confidence = 0.5;
  if (text.length < 10) confidence = 0.4;
  else if (text.length < 50) confidence = 0.65;
  else confidence = 0.85;

  var now = _nowISO();
  return {
    id: null,
    type: type,
    transcript: text,
    content: text,
    text: text,
    summary: summary,
    tags: tags,
    people: [],
    numericInfo: numericInfo,
    mood: mood,
    emotion: mood.tone,
    moodColor: MOOD_COLOR_MAP[mood.tone],
    status: todos.length > 0 ? '待办' : null,
    todos: todos,
    events: events,
    remindAt: null,
    groupId: null,
    suggestedGroupName: null,
    isPinned: false,
    attachments: [],
    confidence: confidence,
    source: source,
    createdAt: now,
    updatedAt: now,
    recordedAt: now,
  };
}

// ============================================
// 导出（CommonJS，兼容微信小程序 require）
// ============================================
module.exports = {
  STATUS_VALUES: STATUS_VALUES,
  MOOD_TONES: MOOD_TONES,
  MOOD_COLOR_MAP: MOOD_COLOR_MAP,
  PARSERECORD_FIELDS: PARSERECORD_FIELDS,
  parseMood: parseMood,
  emotionOf: emotionOf,
  moodColorFor: moodColorFor,
  normalizeRecord: normalizeRecord,
  validateRecord: validateRecord,
  mockParse: mockParse,
};
