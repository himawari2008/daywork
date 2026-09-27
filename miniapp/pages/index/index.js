// ============================================
// 活记 v4 · 首页 — 时间河流 + 智能分组
// 侧抽屉 · 统一输入区 · 筛选Tab · 图片·文字混合发送
// ============================================

var api = require('../../utils/api');
var util = require('../../utils/util');
var haptic = require('../../utils/haptic');
var offlineQueue = require('../../utils/offline-queue');

var STATUS_CLASS_MAP = {
  '待办': 'pending',
  '已完成': 'done',
  '待跟进': 'followup',
};

/** 解析心情 JSON（兼容旧格式纯文本） */
function parseMood(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    var parsed = JSON.parse(raw);
    if (parsed && parsed.label) return parsed;
  } catch (e) { /* 旧格式纯文本 */ }
  // 旧格式兼容：5种中文 → 映射为开放式
  var legacyMap = {
    '开心': { label: '开心', tone: 'positive', intensity: 3 },
    '平静': { label: '平静', tone: 'neutral', intensity: 2 },
    '疲惫': { label: '疲惫', tone: 'negative', intensity: 3 },
    '压力': { label: '有压力', tone: 'negative', intensity: 3 },
    '生气': { label: '生气', tone: 'negative', intensity: 4 },
  };
  return legacyMap[raw] || null;
}

/** 心情色调 → CSS 类名 */
function moodToneClass(mood) {
  if (!mood) return 'neutral';
  return mood.tone === 'positive' ? 'positive' : mood.tone === 'negative' ? 'negative' : 'neutral';
}

/** 默认快捷指令 */
var DEFAULT_SHORTCUTS = [
  { id: 'sc_voice', icon: '', label: '语音记工', prompt: '', action: 'record' },
  { id: 'sc_price', icon: '', label: '记报价', prompt: '报价：', action: 'input' },
  { id: 'sc_customer', icon: '', label: '客户拜访', prompt: '拜访了', action: 'input' },
  { id: 'sc_stock', icon: '', label: '进货记录', prompt: '进货：', action: 'input' },
  { id: 'sc_todo', icon: '', label: '待办', prompt: '要去做', action: 'input' },
  { id: 'sc_idea', icon: '', label: '灵感速记', prompt: '', action: 'record' },
];

Page({
  data: {
    todayLabel: '',
    todayDate: '',  // YYYY-MM-DD 格式，供 picker 使用
    greeting: '',
    emptyHint: '',
    timeClass: '',
    todayCount: 0,
    streak: 0,
    totalCount: 0,
    pendingCount: 0,
    records: [],
    showLab: false,    // 实验功能总开关（V2）：false = 首发隐藏 涂鸦

    // 分组
    groups: [],           // 全部 AI 分组（树形结构，含 children）
    flatGroups: [],       // 扁平化的全部分组（含子分组，用于 ID 查找）
    topGroups: [],        // 筛选 Tab 显示的分组（Top 3）
    activeGroupId: 'all', // 当前选中的分组
    ungroupedCount: 0,    // 未分组记录数（驱动「智能整理」红点）
    reclassifying: false, // 是否正在智能整理

    // 日期筛选（独立维度，可跳转任意日期）
    filterDate: null,       // 'YYYY-MM-DD' | null
    filterDateLabel: '',    // 人类可读标签

    // 抽屉内迷你日历
    calendarYear: 0,
    calendarMonth: 0,
    calendarGrid: [],       // [[{day,date,count,isToday,isCurrentMonth}, ...], ...]
    calendarSummary: '',    // "本月 45 条记录"
    _calPickerDate: '',     // 供 picker mode="date" fields="month" 使用

    // 侧抽屉
    drawerOpen: false,
    drawerTouchStartX: 0,

    // + 操作菜单
    showActions: false,

    // 粘贴文本弹窗
    showPaste: false,
    pasteText: '',

    // 图片预览
    previewImages: [],

    // 视频预览 [{ path, thumb, duration }]
    previewVideos: [],

    // 语音 — 按住说话 + 上滑取消
    recording: false,
    cancelIntent: false,        // 是否滑入取消区域
    CANCEL_SLIDE_PX: 80,        // 上滑 > 80px 触发取消

    // 文字输入
    inputText: '',
    sending: false,

    // 列表
    loading: true,
    refreshing: false,
    loadingMore: false,
    page: 1,
    hasMore: true,

    // 触摸手势
    touchStartX: 0,
    touchStartY: 0,
    swipeIndex: -1,
    swipeOffset: 0,

    // 模板 & 连续模式
    templates: [],  // 从 storage 加载，默认值在 _loadTemplates 里
    continuousMode: false,

    // 表格弹窗
    showTable: false,
    tableData: [
      ['', '', ''],
      ['', '', ''],
      ['', '', ''],
    ],
    hasTableContent: false,

    // 批量选择模式
    selectMode: false,
    selectedIds: {},
    selectedCount: 0,

    // 排序 & 视图
    sortBy: 'time',      // 'time' | 'modified'
    sortOrder: 'desc',   // 'desc' | 'asc'
    viewMode: 'list',    // 'list' | 'grid'

    // 快捷指令（v5 新增）
    shortcuts: [],
    activeShortcut: '',

    // 提醒（Phase 1 新增）
    reminderData: { total: 0, overdueCount: 0, upcomingCount: 0, overdue: [], upcoming: [] },
    showReminderPanel: false,
    reminderPulse: false,
    reminderShake: false,
    notifyDismissed: false,

    // 往日回顾卡片
    memoryRecord: null,

    // 确认卡片（记录已存库后的即时复核卡，替代强制跳转详情页）
    showConfirmCard: false,   // 是否显示卡片
    confirmRecord: null,      // 当前复核的记录对象（单条模式）
    confirmBatchRecords: [],  // 批量记录列表（批量模式，≥2条时使用）
    cardEditStatus: null,     // 卡片内本地状态（即时保存）
    cardEditGroupId: null,    // 卡片内本地分组
    cardSavedTags: [],        // 卡片内本地标签
    cardSuggestedGroupName: null, // AI 建议的分组名（用于 UI 高亮）

    // 离线队列
    offlinePendingCount: 0,   // 待同步录音数量

    // 庆祝粒子
    showCelebrate: false,
    celebrateParticles: [],

    // 暗色主题
    isDarkTheme: false,
  },

  // ============================================
  // 生命周期
  // ============================================

  onLoad() {
    var todayStr = new Date().toISOString().slice(0, 10);
    this.setData({
      todayLabel: util.getTodayLabel(),
      todayDate: todayStr,
      greeting: util.getGreeting(),
      emptyHint: util.getEmptyHint(false),
      timeClass: util.getTimeClass(),
      isDarkTheme: getApp().globalData._isDark || false,
      previewImages: [],
      previewVideos: [],
    });
    this._loadShortcuts();
    this._loadTemplates();
    this._loadGroups();
    this.loadRecords();
    this._loadStreak();
    this._loadReminders();
    this._loadCalendar();
    this._loadMemory();
    this._loadOfflineBadge();
  },

  onShow() {
    var todayStr = new Date().toISOString().slice(0, 10);
    this.setData({
      todayLabel: util.getTodayLabel(),
      todayDate: todayStr,
      greeting: util.getGreeting(),
      emptyHint: util.getEmptyHint(this.data.todayCount > 0),
      timeClass: util.getTimeClass(),
      notifyDismissed: false,
      isDarkTheme: getApp().globalData._isDark || false,
      previewImages: [],
      previewVideos: [],
    });
    if (this._hasLoaded) {
      this._loadGroups();
      this.loadRecords(true);
      this._loadStreak();
      this._loadReminders();
    }
    this._hasLoaded = true;
  },

  onHide() {
    // 离开页面时清掉图片/视频预览，避免回来时残留空白条
    this.setData({ previewImages: [], previewVideos: [] });
  },

  onReady() {
    // 纯 CSS flex 布局，无需 JS 计算高度
  },

  // ============================================
  // 分组加载
  // ============================================

  _loadGroups: function () {
    var that = this;
    api.getGroups().then(function (res) {
      // 后端返回树形结构：groups 是一级分组，每个有 children 数组
      var groups = (res.groups || []).filter(function (g) { return g.isActive; });

      // 扁平化所有分组（含子分组），用于下拉选择和 ID 查找
      var flatGroups = [];
      function flatten(list, parentName) {
        list.forEach(function (g) {
          flatGroups.push(g);
          if (g.children && g.children.length > 0) {
            flatten(g.children, g.name);
          }
        });
      }
      flatten(groups);

      // 筛选 Tab 显示的一级分组（Top 3）
      var topGroups = groups
        .sort(function (a, b) { return (b.recordCount || 0) - (a.recordCount || 0); })
        .slice(0, 3);

      // 计算总记录数：含子分组
      var total = 0;
      flatGroups.forEach(function (g) { total += (g.recordCount || 0); });
      total += (res.ungroupedCount || 0);

      that.setData({
        groups: groups,
        flatGroups: flatGroups,
        topGroups: topGroups,
        totalCount: total,
        ungroupedCount: res.ungroupedCount || 0,
      });
    }).catch(function () {
      // 静默失败
    });
  },

  // ============================================
  // 侧抽屉
  // ============================================

  onToggleDrawer: function () {
    var opening = !this.data.drawerOpen;
    this.setData({ drawerOpen: opening });
    if (opening) {
      this._loadCalendar(); // 每次打开抽屉刷新日历
    }
  },

  onCloseDrawer: function () {
    this.setData({ drawerOpen: false });
  },

  /** 抽屉内点击分组筛选 */
  onDrawerFilter: function (e) {
    var group = e.currentTarget.dataset.group;
    if (group === this.data.activeGroupId && !this.data.filterDate) {
      this.setData({ drawerOpen: false });
      return;
    }
    this.setData({
      activeGroupId: group,
      filterDate: null,
      filterDateLabel: '',
      drawerOpen: false,
      page: 1,
      records: [],
      hasMore: true,
    });
    this.loadRecords(true);
  },

  /** 侧抽屉日期快捷跳转：今天/昨天 */
  onQuickDate: function (e) {
    var type = e.currentTarget.dataset.type;
    var now = new Date();
    var targetDate = '';
    var label = '';

    if (type === 'today') {
      targetDate = now.toISOString().slice(0, 10);
      label = '今天';
    } else if (type === 'yesterday') {
      var y = new Date(now.getTime() - 86400000);
      targetDate = y.toISOString().slice(0, 10);
      label = '昨天';
    }

    this.setData({
      filterDate: targetDate,
      filterDateLabel: label,
      activeGroupId: 'all',
      drawerOpen: false,
      page: 1,
      records: [],
      hasMore: true,
    });
    this.loadRecords(true);
  },

  // ============================================
  // 迷你日历（抽屉内可视化日期选择）
  // ============================================

  /** 加载当月日历热力图数据 */
  _loadCalendar: function (year, month) {
    var that = this;
    var now = new Date();
    var y = year || now.getFullYear();
    var m = month || (now.getMonth() + 1);

    api.getCalendar(y, m).then(function (data) {
      // data 是 { 'YYYY-MM-DD': count } 的 map
      var grid = that._buildCalendarGrid(y, m, data || {});
      var total = 0;
      Object.keys(data || {}).forEach(function (k) { total += (data[k] || 0); });
      that.setData({
        calendarYear: y,
        calendarMonth: m,
        calendarGrid: grid,
        calendarSummary: total > 0 ? (m + '月 ' + total + ' 条记录') : (m + '月暂无记录'),
        _calPickerDate: y + '-' + (m < 10 ? '0' + m : m),
      });
    }).catch(function () {
      // 静默失败
    });
  },

  /** 构建日历网格：每周一行，每天 {day, date, count, isToday, isCurrentMonth} */
  _buildCalendarGrid: function (year, month, data) {
    var todayStr = new Date().toISOString().slice(0, 10);
    var weeks = [];
    var week = [];

    // 当月第一天是周几（0=周日 → 调整为周一=0）
    var firstDay = new Date(year, month - 1, 1).getDay();
    var startOffset = firstDay === 0 ? 6 : firstDay - 1; // 周一前面的空白格数

    // 当月总天数
    var daysInMonth = new Date(year, month, 0).getDate();

    // 填充上月末尾的空白格
    for (var i = 0; i < startOffset; i++) {
      var prevDay = new Date(year, month - 1, -i);
      week.push({
        day: prevDay.getDate(),
        date: '',
        count: 0,
        isToday: false,
        isCurrentMonth: false,
      });
    }
    if (week.length > 0) week.reverse(); // 反转顺序

    // 填充当月日期
    for (var d = 1; d <= daysInMonth; d++) {
      var dateStr = year + '-' + ('0' + month).slice(-2) + '-' + ('0' + d).slice(-2);
      week.push({
        day: d,
        date: dateStr,
        count: data[dateStr] || 0,
        isToday: dateStr === todayStr,
        isCurrentMonth: true,
      });

      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
    }

    // 填充下月开头的空白格
    if (week.length > 0) {
      var nextDay = 1;
      while (week.length < 7) {
        week.push({
          day: nextDay,
          date: '',
          count: 0,
          isToday: false,
          isCurrentMonth: false,
        });
        nextDay++;
      }
      weeks.push(week);
    }

    return weeks;
  },

  /** 上一个月 */
  onPrevMonth: function () {
    var m = this.data.calendarMonth - 1;
    var y = this.data.calendarYear;
    if (m < 1) { m = 12; y--; }
    this._loadCalendar(y, m);
  },

  /** 下一个月 */
  onNextMonth: function () {
    var m = this.data.calendarMonth + 1;
    var y = this.data.calendarYear;
    if (m > 12) { m = 1; y++; }
    this._loadCalendar(y, m);
  },

  /** 点击年月标签 → 原生月份选择器 */
  onMonthPickerChange: function (e) {
    var val = e.detail.value; // "YYYY-MM"
    var parts = val.split('-');
    var y = parseInt(parts[0]);
    var m = parseInt(parts[1]);
    this._loadCalendar(y, m);
  },

  /** 点击日历某一天 → 筛选记录 */
  onTapCalendarDay: function (e) {
    var date = e.currentTarget.dataset.date;
    var count = e.currentTarget.dataset.count;
    if (!date) return; // 空白格

    var todayStr = new Date().toISOString().slice(0, 10);
    var yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    var label = date;
    if (date === todayStr) label = '今天';
    else if (date === yesterdayStr) label = '昨天';

    this.setData({
      filterDate: date,
      filterDateLabel: label,
      activeGroupId: 'all',
      drawerOpen: false,
      page: 1,
      records: [],
      hasMore: true,
    });
    this.loadRecords(true);
  },

  /** 清除日期筛选，回到全部 */
  onClearDate: function () {
    if (!this.data.filterDate) return;
    this.setData({
      filterDate: null,
      filterDateLabel: '',
      page: 1,
      records: [],
      hasMore: true,
    });
    // 如果 activeGroupId 是 'today' 也不合理，切回 all
    if (this.data.activeGroupId === 'today') {
      this.setData({ activeGroupId: 'all' });
    }
    this.loadRecords(true);
  },

  // ============================================
  // 筛选 Tab
  // ============================================

  onFilterTab: function (e) {
    var group = e.currentTarget.dataset.group;
    // 点击已激活的 Tab：不重复加载
    if (group === this.data.activeGroupId && !this.data.filterDate) return;
    this.setData({
      activeGroupId: group,
      filterDate: null,
      filterDateLabel: '',
      page: 1,
      records: [],
      hasMore: true,
    });
    this.loadRecords(true);
  },

  // ============================================
  // 数据加载
  // ============================================

  loadRecords: function (silent) {
    var that = this;
    if (!silent) {
      that.setData({ loading: true });
    }

    var params = { page: 1, limit: 20 };
    var activeId = that.data.activeGroupId;

    // 日期筛选（优先级最高）
    var filterDate = that.data.filterDate;
    if (filterDate) {
      params.date = filterDate;
    }

    // 根据选中的分组/筛选条件设置参数
    if (activeId === 'pending') {
      params.status = '待办';
    } else if (activeId === 'today') {
      params.date = new Date().toISOString().slice(0, 10);
    } else if (activeId !== 'all') {
      params.groupId = activeId;
    }

    return api.getRecords(params).then(function (res) {
      var records = (res.data || []).map(function (r, i) {
        return that._enrichRecord(r, i);
      });

      // 计算今日条数
      var todayStr = new Date().toISOString().slice(0, 10);
      var todayCount = that.data.todayCount;
      if (activeId === 'today') {
        // 服务端精确筛选：total 就是今天的记录总数
        todayCount = res.total || records.length;
      } else if (activeId === 'all') {
        // 全部模式下从首页记录中计数（近似值，全部模式翻页会更多）
        todayCount = 0;
        records.forEach(function (r) {
          if (r.recordedAt && r.recordedAt.slice(0, 10) === todayStr) {
            todayCount++;
          }
        });
      }

      // 计算待办数
      var pendingCount = that.data.pendingCount;
      if (activeId === 'all') {
        pendingCount = records.filter(function (r) { return r.status === '待办'; }).length;
      }

      that.setData({
        records: records,
        todayCount: todayCount,
        pendingCount: pendingCount,
        page: 1,
        hasMore: records.length >= 20,
        loading: false,
      }, function () {
        that._applySort();
      });
    }).catch(function () {
      that.setData({ loading: false });
    });
  },

  /** 丰富单条记录的展示字段 */
  _enrichRecord: function (r, i) {
    r._timeLabel = util.formatTime(r.recordedAt);
    r._statusClass = STATUS_CLASS_MAP[r.status] || '';
    r._animClass = 'anim-in';
    r._isPinned = !!r.isPinned; // 映射后端 isPinned 字段

    // 宫格模式卡片尺寸：根据内容总量（标题+正文）分为5档，便签风格
    var summaryText = r.summary || '';
    var contentText = r.content || '';
    var totalLen = summaryText.length + (contentText !== summaryText ? contentText.length : 0);
    if (totalLen <= 30) {
      r._gridSize = 'xs';       // 极短便签：仅标题2行
    } else if (totalLen <= 80) {
      r._gridSize = 'sm';       // 短便签：标题+少量正文
    } else if (totalLen <= 150) {
      r._gridSize = 'md';       // 中等便签：标题+正文预览
    } else if (totalLen <= 300) {
      r._gridSize = 'lg';       // 长便签：标题+正文+标签
    } else {
      r._gridSize = 'xl';       // 超长便签：完整展示
    }
    // 宫格显示：分离标题行和正文预览
    r._gridTitle = summaryText || contentText || '';
    r._gridBody = (summaryText && contentText && contentText !== summaryText) ? contentText : '';

    // 解析心情 JSON（兼容旧格式）
    var moodObj = parseMood(r.mood);
    if (moodObj) {
      r._moodLabel = moodObj.label;
      r._moodToneClass = moodToneClass(moodObj);
    }
    // 情绪色卡片类名（用于卡片左边框 + 微染背景）
    r._moodCardClass = moodObj ? moodToneClass(moodObj) : '';

    // 分组徽标：如果记录有 groupId，从 flatGroups 中找到对应颜色和名称
    if (r.groupId && this.data.flatGroups.length > 0) {
      var g = this.data.flatGroups.find(function (grp) { return grp.id === r.groupId; });
      if (g) {
        r._groupName = g.name;
        r._groupColor = g.color || '#4A5C7C';
      }
    }

    // 提醒时间标签（Phase 1 新增）
    if (r.remindAt) {
      r._hasReminder = true;
      var remindTime = new Date(r.remindAt);
      var now = new Date();
      var diff = remindTime.getTime() - now.getTime();
      var hours = Math.floor(diff / (1000 * 60 * 60));
      var minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      if (diff < 0) {
        r._remindLabel = '已超期';
        r._remindUrgent = true;
      } else if (hours < 1) {
        r._remindLabel = minutes > 0 ? minutes + '分钟后' : '即将到期';
        r._remindUrgent = true;
      } else if (hours < 24) {
        r._remindLabel = hours + '小时后';
      } else {
        r._remindLabel = Math.floor(hours / 24) + '天后';
      }
      // AI 自动建议的提醒用虚线样式标记
      r._remindAiSuggested = !!r._aiSuggested;
    }
    // 语音标记：如果有 /uploads/voice/ 附件，标记可回放
    if (r.attachments && r.attachments.length > 0) {
      for (var i = 0; i < r.attachments.length; i++) {
        if (r.attachments[i] && r.attachments[i].indexOf('/uploads/voice/') !== -1) {
          r._hasVoice = true;
          break;
        }
      }
    }
    return r;
  },

  onLoadMore: function () {
    var that = this;
    if (that.data.loadingMore || !that.data.hasMore) return;

    that.setData({ loadingMore: true });
    var nextPage = that.data.page + 1;

    var params = { page: nextPage, limit: 20 };
    var activeId = that.data.activeGroupId;

    // 日期筛选（优先级最高）
    var filterDate = that.data.filterDate;
    if (filterDate) {
      params.date = filterDate;
    }

    if (activeId === 'pending') {
      params.status = '待办';
    } else if (activeId === 'today') {
      params.date = new Date().toISOString().slice(0, 10);
    } else if (activeId !== 'all') {
      params.groupId = activeId;
    }

    api.getRecords(params).then(function (res) {
      var newRecords = (res.data || []).map(function (r, i) {
        return that._enrichRecord(r, i);
      });

      var all = that.data.records.concat(newRecords);
      that.setData({
        records: all,
        page: nextPage,
        hasMore: newRecords.length >= 20,
        loadingMore: false,
      }, function () {
        that._applySort();
      });
    }).catch(function () {
      that.setData({ loadingMore: false });
    });
  },

  onRefresh: function () {
    var that = this;
    that.setData({ refreshing: true });
    that._loadGroups();
    that.loadRecords(true).then(function () {
      that.setData({ refreshing: false });
      that._loadStreak();
      that._loadReminders();
    });
  },

  _loadStreak: function () {
    var that = this;
    api.getStreak().then(function (res) {
      var streak = res.currentStreak || 0;
      var prevStreak = that.data.streak || 0;
      that.setData({ streak: streak });

      // 庆祝触发：连续天数跨过里程碑时撒花
      var milestones = [7, 14, 21, 30, 60, 100];
      var hitMilestone = false;
      milestones.forEach(function (m) {
        if (prevStreak < m && streak >= m) hitMilestone = true;
      });
      if (hitMilestone) {
        that._celebrate();
        wx.showToast({ title: '连续 ' + streak + ' 天！太棒了', icon: 'none', duration: 2000 });
      }
    }).catch(function () {});
  },

  /** 粒子庆祝动画 */
  _celebrate: function () {
    var that = this;
    var particles = [];
    var colors = ['ce-c1', 'ce-c2', 'ce-c3', 'ce-c4', 'ce-c5'];
    for (var i = 0; i < 18; i++) {
      var angle = (i / 18) * 360;
      var dist = 40 + Math.random() * 80;
      var rad = angle * Math.PI / 180;
      var x = Math.cos(rad) * dist;
      var y = Math.sin(rad) * dist;
      particles.push({
        color: colors[i % colors.length],
        x: x + 'rpx',
        y: y + 'rpx',
        delay: (Math.random() * 0.3) + 's',
      });
    }
    that.setData({ showCelebrate: true, celebrateParticles: particles });
    setTimeout(function () {
      that.setData({ showCelebrate: false, celebrateParticles: [] });
    }, 1200);
  },

  // ============================================
  // 提醒系统（Phase 1 新增）
  // ============================================

  /** 加载提醒数据 + 主动通知（振动、脉冲动画、音频提示） */
  _loadReminders: function () {
    var that = this;
    api.getReminders().then(function (res) {
      if (res) {
        that.setData({ reminderData: res });
        if (res.overdueCount > 0) {
          wx.setTabBarBadge({ index: 0, text: String(res.overdueCount) });
          // 🔔 提示音（模拟器 & 真机均可用）
          that._playNotifySound();
          // 📳 振动提醒（仅真机生效）—— 单次强震,不再叠 400ms 长震
          haptic.heavy();
          // 💫 脉冲闪烁 + 抖动
          that.setData({ reminderPulse: true, reminderShake: true });
          setTimeout(function () { that.setData({ reminderPulse: false, reminderShake: false }); }, 3000);
        } else if (res.upcomingCount > 0) {
          wx.removeTabBarBadge({ index: 0 });
          that._playNotifySound();
          haptic.light();
          that.setData({ reminderPulse: true });
          setTimeout(function () { that.setData({ reminderPulse: false }); }, 2000);
        } else {
          wx.removeTabBarBadge({ index: 0 });
        }
      }
    }).catch(function (err) {
      console.error('[REMINDER] API failed:', err);
    });
  },

  /** 播放提醒提示音 */
  _audioCtx: null,
  _playNotifySound: function () {
    try {
      if (!this._audioCtx) {
        this._audioCtx = wx.createInnerAudioContext();
        this._audioCtx.src = '/assets/notify-beep.wav';
        this._audioCtx.volume = 0.8;
      }
      // 重置并播放
      this._audioCtx.seek(0);
      this._audioCtx.play();
    } catch (e) {
      console.log('[REMINDER] 音频播放失败:', e);
    }
  },

  /** 关闭顶部通知条 */
  onDismissNotify: function () {
    this.setData({ notifyDismissed: true });
  },

  /** 点击提醒横条 → 打开提醒弹窗 */
  onShowReminders: function () {
    if (this.data.reminderData.total === 0) return;
    this.setData({ showReminderPanel: true, notifyDismissed: true });
  },

  /** 关闭提醒弹窗 */
  onCloseReminders: function () {
    this.setData({ showReminderPanel: false });
  },

  /** 提醒列表项点击 → 跳转详情 */
  onTapReminder: function (e) {
    var id = e.currentTarget.dataset.id;
    this.setData({ showReminderPanel: false });
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },

  /** 在提醒弹窗中快速标记已完成 */
  onQuickCompleteReminder: function (e) {
    var that = this;
    var id = e.currentTarget.dataset.id;
    api.updateRecord(id, { status: '已完成' }).then(function () {
      wx.showToast({ title: '已完成', icon: 'success', duration: 1000 });
      that._loadReminders();
      that.loadRecords(true);
    }).catch(function () {
      wx.showToast({ title: '操作失败', icon: 'none' });
    });
  },

  /** 在提醒弹窗中快速取消提醒 */
  onQuickCancelReminder: function (e) {
    var that = this;
    var id = e.currentTarget.dataset.id;
    api.updateRecord(id, { remindAt: null }).then(function () {
      wx.showToast({ title: '已取消提醒', icon: 'success', duration: 1000 });
      that._loadReminders();
    }).catch(function () {
      wx.showToast({ title: '操作失败', icon: 'none' });
    });
  },

  // ============================================
  // 往日回顾（对标 Day One "On This Day" / flomo "每日回顾"）
  // ============================================

  /** 加载往日回顾记录，每天随机一条 */
  _loadMemory: function () {
    var that = this;
    // 每天只加载一次，用本地缓存当天日期判断
    var today = new Date().toISOString().slice(0, 10);
    var cacheKey = 'daywork_memory_date';
    try {
      var cachedDate = wx.getStorageSync(cacheKey);
      if (cachedDate === today) return; // 今天已经加载过
    } catch (e) { /* ignore */ }

    api.getMemory().then(function (res) {
      if (res && res.record) {
        var r = res.record;
        var typeLabel = res.type === 'on-this-day' ? '往年今日' : '一周前';
        that.setData({
          memoryRecord: {
            id: r.id,
            summary: r.summary || r.content.slice(0, 30),
            typeLabel: typeLabel,
            date: r.recordedAt ? r.recordedAt.slice(0, 10) : '',
            mood: r.mood || null,
          }
        });
        try { wx.setStorageSync(cacheKey, today); } catch (e) { /* ignore */ }
      }
    }).catch(function () { /* 静默 */ });
  },

  /** 点击记忆卡片 → 跳转详情 */
  onMemoryTap: function () {
    var id = this.data.memoryRecord && this.data.memoryRecord.id;
    if (id) {
      wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
    }
  },

  /** 换一条记忆 */
  onMemoryRefresh: function () {
    var that = this;
    this.setData({ memoryRecord: null });
    // 清除缓存强制重新加载
    try { wx.removeStorageSync('daywork_memory_date'); } catch (e) { /* ignore */ }
    setTimeout(function () { that._loadMemory(); }, 300);
  },

  /** 关闭记忆卡片 */
  onMemoryDismiss: function () {
    this.setData({ memoryRecord: null });
  },

  // ============================================
  // 文字输入
  // ============================================

  onInputChange: function (e) {
    this.setData({ inputText: e.detail.value });
  },

  onSendText: function () {
    var text = this.data.inputText.trim();
    var images = this.data.previewImages;
    var videos = this.data.previewVideos;
    if ((!text && images.length === 0 && videos.length === 0) || this.data.sending) return;

    // 卡片开着时先收起（编辑已即时保存，无脏数据），再记新的一条
    if (this.data.showConfirmCard) {
      this.setData({ showConfirmCard: false, confirmRecord: null });
    }

    this.setData({ sending: true });

    var that = this;
    var isContinuous = this.data.continuousMode;

    // 收集所有媒体内容 → 合并 → AI 解析
    var mediaParts = [];

    // 1) 上传视频（提取音频 → 后端 ASR → 返回文字）
    var videoPromises = videos.map(function (vid) {
      return api.importUpload(vid.path).then(function (result) {
        if (result.documentSummary) mediaParts.push(result.documentSummary);
        if (result.records && result.records.length > 0) {
          result.records.forEach(function (r) { mediaParts.push(r.summary); });
        }
      }).catch(function (err) {
        console.log('视频上传失败:', err);
        // 视频失败不阻塞整体流程
      });
    });

    // 2) 上传图片
    var imagePromises = images.map(function (path) {
      return api.importUpload(path).then(function (result) {
        if (result.documentSummary) mediaParts.push(result.documentSummary);
        if (result.records && result.records.length > 0) {
          result.records.forEach(function (r) { mediaParts.push(r.summary); });
        }
      }).catch(function (err) {
        console.log('图片上传失败:', err);
      });
    });

    // 并行上传所有媒体
    var allMedia = videoPromises.concat(imagePromises);
    Promise.all(allMedia).then(function () {
      // 合并用户文字 + 媒体识别文字
      var mergedContent = text || '';
      if (mediaParts.length > 0) {
        mergedContent = mediaParts.join('；') + (mergedContent ? '；补充说明：' + mergedContent : '');
      }

      if (!mergedContent || !mergedContent.trim()) {
        that.setData({ sending: false });
        wx.showToast({ title: '未识别到有效内容', icon: 'none' });
        return;
      }

      // 收集附件路径（图片 + 视频缩略图）
      var attachmentPaths = [];
      images.forEach(function (p) { attachmentPaths.push(p); });
      videos.forEach(function (v) { if (v.thumb) attachmentPaths.push(v.thumb); });

      return api.createBatch(mergedContent, undefined, attachmentPaths.length > 0 ? attachmentPaths : undefined);
    }).then(function (res) {
      if (!res) return;

      haptic.light();

      var records = res.records || [];
      var isBatch = res.isBatch && records.length >= 2;
      var firstRecord = records[0];

      if (isContinuous) {
        that.setData({ sending: false });
        var toastTitle = '已记录' + (isBatch ? ' ' + records.length + ' 条' : '');
        if (!isBatch && firstRecord._groupName) { toastTitle = '已归入「' + firstRecord._groupName + '」'; }
        wx.showToast({ title: toastTitle, icon: 'success', duration: 1000 });
      } else {
        that.setData({ inputText: '', previewImages: [], previewVideos: [], sending: false });
        // height auto by flex
        if (isBatch) {
          wx.showToast({ title: '已拆分 ' + records.length + ' 条记录', icon: 'success', duration: 1500 });
        } else {
          var toastTitle2 = '石子已投入河流';
          if (firstRecord._groupName) { toastTitle2 = '已自动归入「' + firstRecord._groupName + '」'; }
          wx.showToast({ title: toastTitle2, icon: 'success', duration: 1500 });
        }
      }

      that._loadGroups();
      that.loadRecords(true);
      that._loadStreak();

      // 非连续模式：弹确认卡片
      if (!isContinuous && firstRecord && firstRecord.id) {
        if (isBatch) {
          that._openBatchConfirmCard(records);
        } else {
          that._openConfirmCard(firstRecord);
        }
      }
    }).catch(function (err) {
      that.setData({ sending: false });
      var msg = '记录失败，重试一下';
      if (err && err.message) msg = err.message;
      wx.showToast({ title: msg, icon: 'none', duration: 2000 });
    });
  },

  // ============================================
  // 语音输入 — 按住说话 + 上滑取消
  // ============================================

  /** 程序触发录音（快捷指令/连续模式"下一个"/操作菜单），不依赖触摸事件 */
  _triggerRecording: function () {
    var that = this;
    if (that.data.recording) return;
    if (that.data.showConfirmCard) {
      that.setData({ showConfirmCard: false, confirmRecord: null });
    }
    // 程序触发时清空已有文字，以录音优先（用户主动点了语音按钮）
    if (that.data.inputText.trim()) {
      that.setData({ inputText: '', previewImages: [], previewVideos: [] });
    }
    that._ensureRecordAuth(function () {
      that._startRecording();
      // 程序触发时，3 秒后自动停止（模拟短按）
      clearTimeout(that._programRecordTimer);
      that._programRecordTimer = setTimeout(function () {
        if (that.data.recording) that._stopRecording();
      }, 3000);
    });
  },

  /** 手指按下麦克风 → 开始录音 */
  onMicTouchStart: function (e) {
    var that = this;
    if (that.data.inputText.trim()) return;
    if (that.data.recording) return;

    // 卡片开着时先收起
    if (that.data.showConfirmCard) {
      that.setData({ showConfirmCard: false, confirmRecord: null });
    }

    // 记录手指起始位置，用于后续判断上滑取消
    var touch = e.touches[0];
    that._touchStartY = touch.clientY;

    // 先确保麦克风授权，再开始录音
    that._ensureRecordAuth(function () {
      that._startRecording();
    });
  },

  /** 手指移动 → 检测上滑取消意图 */
  onMicTouchMove: function (e) {
    if (!this.data.recording) return;
    var touch = e.touches[0];
    if (!touch) return;
    // 上滑距离 = 起始Y - 当前Y（正值=往上滑）
    var dy = this._touchStartY - touch.clientY;
    var shouldCancel = dy > this.data.CANCEL_SLIDE_PX;
    if (shouldCancel !== this.data.cancelIntent) {
      this.setData({ cancelIntent: shouldCancel });
      if (shouldCancel) haptic.warning(); // 进入取消区给一次警告震动
    }
  },

  /** 手指抬起 → 停止录音（或取消） */
  onMicTouchEnd: function (e) {
    if (!this.data.recording) return;

    if (this.data.cancelIntent) {
      // 用户滑入取消区 → 取消本次录音
      clearTimeout(this._recordTimer);
      this.setData({ recording: false, cancelIntent: false });
      if (this._rm) {
        this._rm.stop();
        this._rm = null;
      }
      wx.showToast({ title: '已取消', icon: 'none', duration: 800 });
    } else {
      // 正常松手 → 停止并处理
      this._stopRecording();
    }
  },

  /** 确保录音授权：已授权直接回调；从未申请弹系统授权；曾拒绝引导去设置页 */
  _ensureRecordAuth: function (onOk) {
    wx.getSetting({
      success: function (res) {
        var st = res.authSetting['scope.record'];
        if (st) {
          onOk();
        } else if (st === false) {
          // 曾拒绝过 → 引导去设置页开启
          wx.showModal({
            title: '需要麦克风权限',
            content: '语音记录需要使用麦克风，去设置里开启一下？',
            confirmText: '去设置',
            success: function (m) {
              if (m.confirm) {
                wx.openSetting({
                  success: function (r) {
                    if (r.authSetting['scope.record']) onOk();
                  }
                });
              }
            }
          });
        } else {
          // 从未申请过 → 弹系统授权
          wx.authorize({
            scope: 'scope.record',
            success: function () { onOk(); },
            fail: function () {
              wx.showToast({ title: '没有麦克风权限，试试打字', icon: 'none' });
            }
          });
        }
      },
      fail: function () { onOk(); } // getSetting 失败则直接尝试，start 会兜底弹窗
    });
  },

  /** 真正开始录音 */
  _startRecording: function () {
    var that = this;
    haptic.light();
    that.setData({ recording: true, cancelIntent: false });

    var rm = wx.getRecorderManager();
    rm.start({ format: 'wav', sampleRate: 16000, numberOfChannels: 1 });

    // 30 秒安全上限（超时自动停止，防止忘松手）
    that._recordTimer = setTimeout(function () {
      that._stopRecording();
    }, 30000);

    rm.onStop(function (res) {
      clearTimeout(that._recordTimer);
      that.setData({ recording: false, cancelIntent: false });

      if (!res.tempFilePath) {
        wx.showToast({ title: '没听清，再试一次', icon: 'none' });
        return;
      }
      that._handleVoiceResult(res.tempFilePath);
    });

    rm.onError(function (err) {
      clearTimeout(that._recordTimer);
      that.setData({ recording: false, cancelIntent: false });
      console.error('录音错误:', err);
      wx.showToast({ title: '录音失败，试试打字', icon: 'none' });
    });

    that._rm = rm;
  },

  _stopRecording: function () {
    if (this._rm) { this._rm.stop(); }
  },

  _handleVoiceResult: function (filePath) {
    var that = this;
    var isContinuous = this.data.continuousMode;

    // 离线检测：先检查网络，离线则保存到本地队列
    offlineQueue.isOnline().then(function (online) {
      if (!online) {
        // 离线 → 保存到本地队列，等网络恢复后自动上传
        wx.hideLoading();
        offlineQueue.enqueue(filePath);
        var pendingCount = offlineQueue.getPendingCount();
        haptic.light();
        wx.showToast({
          title: '已保存到本地（' + pendingCount + '条待同步）',
          icon: 'none',
          duration: 2000
        });
        that._loadOfflineBadge();
        return;
      }

      // 在线 → 正常上传
      wx.showLoading({ title: 'AI 倾听中...' });
      that._uploadVoice(filePath, isContinuous);
    });
  },

  /** 上传语音到服务端（在线模式） */
  _uploadVoice: function (filePath, isContinuous) {
    var that = this;

    // 语音也走批量创建（语音提到多人时自动拆分）
    api.createRecordFromVoice(filePath).then(function (res) {
      wx.hideLoading();

      // 兼容新旧返回格式：新格式 { records, isBatch }，旧格式单条 record
      var records = [];
      var isBatch = false;
      if (res && Array.isArray(res.records)) {
        records = res.records;
        isBatch = res.isBatch && records.length >= 2;
      } else if (res && res.id) {
        records = [res];
      }

      if (records.length === 0 || !records[0] || !records[0].id) {
        wx.showToast({ title: (res && res.message) || '没听清，请打字输入', icon: 'none' });
        return;
      }

      var firstRecord = records[0];

      haptic.light();

      // ====== 语音指令检测（v5 新增）======
      // 批量模式下跳过语音指令（多条记录时语义复杂）
      if (!isBatch) {
        var rawContent = (firstRecord.content || '').trim();
        var voiceCmd = null;

        if (/^(下一个|换一条|下一条|再来一条|继续)/.test(rawContent)) {
          voiceCmd = 'next';
        } else if (/^(完成了|搞定了|弄好了|做完了)/.test(rawContent)) {
          voiceCmd = 'done';
        } else if (/^(待跟进|再看看|再说|还没定)/.test(rawContent)) {
          voiceCmd = 'followup';
        }

        if (voiceCmd === 'next') {
          wx.showToast({ title: '已记录，继续...', icon: 'none', duration: 600 });
          that._loadGroups();
          that.loadRecords(true);
          that._loadStreak();
          setTimeout(function () { that._triggerRecording(); }, 400);
          return;
        }

        if (voiceCmd === 'done' || voiceCmd === 'followup') {
          var newStatus = voiceCmd === 'done' ? '已完成' : '待跟进';
          api.updateRecord(firstRecord.id, { status: newStatus }).then(function () {
            var toastMap = { done: '已完成', followup: '待跟进' };
            wx.showToast({ title: toastMap[voiceCmd], icon: 'success', duration: 1000 });
          }).catch(function () {});
        }
      }
      // ====== 语音指令检测结束 ======

      if (isBatch) {
        wx.showToast({ title: '语音已拆 ' + records.length + ' 条记录', icon: 'success', duration: isContinuous ? 800 : 1500 });
      } else {
        var voiceToast = isContinuous ? '已记录 · 录音已保存' : '石子已投入河流 · 可回放';
        if (firstRecord._groupName) { voiceToast = '已归入「' + firstRecord._groupName + '」· 可回放'; }
        wx.showToast({ title: voiceToast, icon: 'success', duration: isContinuous ? 800 : 1500 });
      }

      that._loadGroups();
      that.loadRecords(true);
      that._loadStreak();

      // 非连续模式：弹确认卡片
      if (!isContinuous && firstRecord.id) {
        if (isBatch) {
          that._openBatchConfirmCard(records);
        } else {
          that._openConfirmCard(firstRecord);
        }
      }
    }).catch(function (err) {
      wx.hideLoading();
      console.error('语音识别失败:', err);
      // 网络错误 → 自动降级为离线保存
      if (err && (err.errMsg || '').indexOf('timeout') >= 0 || (err.errMsg || '').indexOf('fail') >= 0) {
        offlineQueue.enqueue(filePath);
        var pendingCount = offlineQueue.getPendingCount();
        wx.showToast({ title: '网络不佳，已保存到本地（' + pendingCount + '条待同步）', icon: 'none', duration: 2000 });
        that._loadOfflineBadge();
      } else {
        wx.showToast({ title: '网络不太好，试试打字', icon: 'none' });
      }
    });
  },

  /** 加载离线队列角标 */
  _loadOfflineBadge: function () {
    var count = offlineQueue.getPendingCount();
    this.setData({ offlinePendingCount: count });
  },

  /** 手动触发离线同步 */
  onSyncOffline: function () {
    var that = this;
    haptic.light();
    wx.showLoading({ title: '同步中...' });
    offlineQueue.syncNow().then(function (result) {
      wx.hideLoading();
      if (result.synced > 0) {
        haptic.medium();
        wx.showToast({ title: '已同步 ' + result.synced + ' 条记录', icon: 'success' });
        that._loadGroups();
        that.loadRecords(true);
        that._loadStreak();
      } else {
        wx.showToast({ title: '没有待同步的记录', icon: 'none' });
      }
      that._loadOfflineBadge();
    }).catch(function () {
      wx.hideLoading();
      wx.showToast({ title: '同步失败，请检查网络', icon: 'none' });
    });
  },

  // ============================================
  // + 菜单 & 图片 & 粘贴
  // ============================================

  onToggleActions: function () {
    this.setData({ showActions: !this.data.showActions });
  },

  // ============================================
  // 确认卡片（记录已存库后的即时复核）
  // ============================================

  /** 打开确认卡片，载入待复核记录 */
  _openConfirmCard: function (record) {
    // 查找 AI 建议的分组名（记录已有 _groupName）
    var suggestedName = record._groupName || null;
    this.setData({
      showConfirmCard: true,
      confirmRecord: record,
      confirmBatchRecords: [],
      cardEditStatus: record.status || null,
      cardEditGroupId: (record.groupId != null ? record.groupId : null),
      cardSavedTags: record.tags || [],
      cardSuggestedGroupName: suggestedName
    });
  },

  /** 打开批量确认卡片（多条独立记录） */
  _openBatchConfirmCard: function (records) {
    this.setData({
      showConfirmCard: true,
      confirmRecord: null,          // 单条模式关闭
      confirmBatchRecords: records, // 批量记录列表
    });
  },

  /** 批量卡片：点击某条记录跳详情 */
  onConfirmBatchTapRecord: function (e) {
    var id = e.currentTarget.dataset.id;
    this.setData({ showConfirmCard: false, confirmBatchRecords: [] });
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },

  /** 删除批量中的某条 */
  onConfirmBatchDeleteRecord: function (e) {
    var that = this;
    var id = e.currentTarget.dataset.id;
    haptic.warning();
    api.deleteRecord(id).then(function () {
      var remaining = (that.data.confirmBatchRecords || []).filter(function (r) { return r.id !== id; });
      if (remaining.length === 0) {
        that.setData({ showConfirmCard: false, confirmBatchRecords: [] });
        that._loadGroups();
        that.loadRecords(true);
        that._loadStreak();
        wx.showToast({ title: '已全部删除', icon: 'none' });
      } else {
        that.setData({ confirmBatchRecords: remaining });
        wx.showToast({ title: '已删除', icon: 'none' });
      }
    }).catch(function () {
      wx.showToast({ title: '删除失败', icon: 'none' });
    });
  },

  /** 收起卡片（点遮罩 / 关闭 / 知道了） */
  onConfirmDismiss: function () {
    this.setData({ showConfirmCard: false, confirmRecord: null, confirmBatchRecords: [] });
  },
  onConfirmOverlayTap: function () {
    this.onConfirmDismiss();
  },

  /** 去详情页深度编辑 */
  onConfirmGoDetail: function () {
    var rec = this.data.confirmRecord;
    if (!rec) return;
    var id = rec.id;
    this.setData({ showConfirmCard: false, confirmRecord: null });
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },

  /** 删除这条（记错了） */
  onConfirmDelete: function () {
    var that = this;
    var rec = this.data.confirmRecord;
    if (!rec) return;
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复',
      confirmText: '删除',
      confirmColor: '#E05A44',
      success: function (m) {
        if (!m.confirm) return;
        api.deleteRecord(rec.id).then(function () {
          haptic.warning();
          that.setData({ showConfirmCard: false, confirmRecord: null });
          that._loadGroups();
          that.loadRecords(true);
          that._loadStreak();
          wx.showToast({ title: '已删除', icon: 'none' });
        }).catch(function () {
          wx.showToast({ title: '删除失败，重试', icon: 'none' });
        });
      }
    });
  },

  /** AI建议：给当前记录设提醒 */
  onConfirmSetRemind: function () {
    var that = this;
    var rec = this.data.confirmRecord;
    if (!rec) return;
    // 默认提醒时间：明天早上9点
    var tomorrow = new Date(Date.now() + 86400000);
    var remindTime = tomorrow.toISOString().slice(0, 10) + 'T09:00:00.000Z';
    haptic.light();
    api.updateRecord(rec.id, { remindAt: remindTime }).then(function () {
      wx.showToast({ title: '已设置提醒，明天早上9点', icon: 'success', duration: 1500 });
      that.loadRecords(true);
    }).catch(function () {
      wx.showToast({ title: '设置失败', icon: 'none' });
    });
  },

  /** 切换状态（即时保存） */
  onConfirmSetStatus: function (e) {
    var that = this;
    var rec = this.data.confirmRecord;
    if (!rec) return;
    var status = e.currentTarget.dataset.status || null;
    // 再点当前状态则取消
    if (status === this.data.cardEditStatus) status = null;
    haptic.light();
    this.setData({ cardEditStatus: status });
    api.updateRecord(rec.id, { status: status }).then(function () {
      that.loadRecords(true);
    }).catch(function () {});
  },

  /** 切换分组（即时保存） */
  onConfirmSetGroup: function (e) {
    var that = this;
    var rec = this.data.confirmRecord;
    if (!rec) return;
    var groupId = e.currentTarget.dataset.groupId;
    if (groupId === '' || groupId === undefined) groupId = null;
    // 再点当前分组则移出分组
    if (groupId === this.data.cardEditGroupId) groupId = null;
    haptic.light();
    this.setData({ cardEditGroupId: groupId });
    api.moveRecordToGroup(rec.id, groupId).then(function () {
      that._loadGroups();
      that.loadRecords(true);
    }).catch(function () {});
  },

  /** 移除某个 AI 标签（即时保存） */
  onConfirmRemoveTag: function (e) {
    var that = this;
    var rec = this.data.confirmRecord;
    if (!rec) return;
    var tag = e.currentTarget.dataset.tag;
    var tags = (this.data.cardSavedTags || []).filter(function (t) { return t !== tag; });
    haptic.light();
    this.setData({ cardSavedTags: tags });
    api.updateRecord(rec.id, { tags: tags }).then(function () {
      that.loadRecords(true);
    }).catch(function () {});
  },

  /** 拍照 */
  onTakePhoto: function () {
    var that = this;
    this.setData({ showActions: false });

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['camera'],
      success: function (res) {
        var paths = (res.tempFiles || []).map(function (f) { return f.tempFilePath; });
        var images = that.data.previewImages.concat(paths);
        that.setData({ previewImages: images.slice(0, 9) });
      },
      fail: function (err) {
        // 模拟器无摄像头，真机用户可能拒绝授权
        if (err.errMsg && err.errMsg.indexOf('cancel') !== -1) {
          // 用户主动取消，不提示
        } else {
          wx.showToast({ title: '拍照失败，请在真机上测试或检查相机权限', icon: 'none', duration: 2500 });
        }
      },
    });
  },

  /** 选图片 */
  onPickImages: function () {
    var that = this;
    this.setData({ showActions: false });

    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: function (res) {
        var paths = (res.tempFiles || []).map(function (f) { return f.tempFilePath; });
        var current = that.data.previewImages;
        var images = current.concat(paths).slice(0, 9);
        that.setData({ previewImages: images });
      },
      fail: function (err) {
        if (err.errMsg && err.errMsg.indexOf('cancel') !== -1) {
          // 用户取消
        } else {
          wx.showToast({ title: '选图失败，请检查相册权限', icon: 'none', duration: 2500 });
        }
      },
    });
  },

  /** 选视频 */
  onPickVideo: function () {
    var that = this;
    this.setData({ showActions: false });

    wx.chooseMedia({
      count: 3,
      mediaType: ['video'],
      sourceType: ['album', 'camera'],
      maxDuration: 60,
      success: function (res) {
        var current = that.data.previewVideos;
        var newVideos = res.tempFiles.map(function (f) {
          return {
            path: f.tempFilePath,
            thumb: f.thumbTempFilePath || '',
            duration: f.duration || 0,
          };
        });
        var videos = current.concat(newVideos).slice(0, 3);
        that.setData({ previewVideos: videos });
      },
      fail: function (err) {
        if (err.errMsg && err.errMsg.indexOf('cancel') !== -1) {
          // 用户取消
        } else {
          wx.showToast({ title: '选视频失败，请检查相册权限', icon: 'none', duration: 2500 });
        }
      },
    });
  },

  /** 涂鸦 — 打开画板页面 */
  onDoodle: function () {
    this.setData({ showActions: false });
    wx.navigateTo({ url: '/pages/doodle/doodle' });
  },

  /** 表格输入 — 弹出表格弹窗 */
  onTableInput: function () {
    this.setData({ showActions: false, showTable: true });
  },

  /** 扫描文档 — 拍照 + OCR */
  onScanDoc: function () {
    var that = this;
    this.setData({ showActions: false });
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['camera'],
      success: function (res) {
        var filePath = (res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath) || '';
        if (!filePath) { wx.showToast({ title: '未获取到图片', icon: 'none' }); return; }
        wx.showLoading({ title: '扫描识别中...', mask: true });
        api.importUpload(filePath).then(function (result) {
          wx.hideLoading();
          if (result.documentSummary) {
            that.setData({ inputText: result.documentSummary });
            wx.showToast({ title: '已识别文字并填入', icon: 'success' });
          } else if (result.records && result.records.length > 0) {
            var texts = result.records.map(function (r) { return r.summary; }).join('；');
            that.setData({ inputText: texts });
            wx.showToast({ title: '已识别并填入', icon: 'success' });
          } else {
            wx.showToast({ title: '未识别到文字', icon: 'none' });
          }
        }).catch(function (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '扫描失败', icon: 'none' });
        });
      },
      fail: function (err) {
        if (err.errMsg && err.errMsg.indexOf('cancel') !== -1) {
          // 用户取消
        } else {
          wx.showToast({ title: '无法打开相机，请在真机上测试', icon: 'none', duration: 2500 });
        }
      },
    });
  },

  /** 快速录音 — 同底栏麦克风 */
  onQuickRecord: function () {
    this.setData({ showActions: false });
    this._triggerRecording();
  },

  // ============================================
  // 表格输入
  // ============================================

  onCloseTable: function () {
    this.setData({ showTable: false });
  },

  onTableCellInput: function (e) {
    var ri = e.currentTarget.dataset.ri;
    var ci = e.currentTarget.dataset.ci;
    var val = e.detail.value;
    var tableData = this.data.tableData;
    tableData[ri][ci] = val;

    // 检查是否有内容
    var hasContent = false;
    tableData.forEach(function (row) {
      row.forEach(function (cell) {
        if (cell && cell.trim()) hasContent = true;
      });
    });

    this.setData({ tableData: tableData, hasTableContent: hasContent });
  },

  onAddTableRow: function () {
    var tableData = this.data.tableData;
    var cols = tableData[0].length;
    var newRow = [];
    for (var i = 0; i < cols; i++) newRow.push('');
    tableData.push(newRow);
    this.setData({ tableData: tableData });
  },

  onAddTableCol: function () {
    var tableData = this.data.tableData;
    tableData.forEach(function (row) { row.push(''); });
    this.setData({ tableData: tableData });
  },

  onClearTable: function () {
    var tableData = this.data.tableData;
    tableData.forEach(function (row) {
      for (var i = 0; i < row.length; i++) row[i] = '';
    });
    this.setData({ tableData: tableData, hasTableContent: false });
  },

  onSubmitTable: function () {
    if (!this.data.hasTableContent) return;
    var tableData = this.data.tableData;

    // 转为 Markdown 表格
    var lines = [];
    // 表头行
    var headers = tableData[0].map(function (c) { return c || '列'; });
    lines.push('| ' + headers.join(' | ') + ' |');
    // 分隔行
    lines.push('| ' + headers.map(function () { return '---'; }).join(' | ') + ' |');
    // 数据行
    for (var i = 1; i < tableData.length; i++) {
      var row = tableData[i];
      var hasAny = row.some(function (c) { return c && c.trim(); });
      if (!hasAny) continue;
      lines.push('| ' + row.map(function (c) { return c || ''; }).join(' | ') + ' |');
    }

    var md = lines.join('\n');
    this.setData({ showTable: false });

    // 发送给 AI 解析
    wx.showLoading({ title: 'AI 解析中...', mask: true });
    var that = this;
    api.importPreview(md).then(function (res) {
      wx.hideLoading();
      if (res.records && res.records.length > 0) {
        api.importSave({
          documentSummary: res.documentSummary,
          records: res.records,
        }).then(function (saveRes) {
          wx.showToast({ title: '已导入 ' + saveRes.savedCount + ' 条', icon: 'success', duration: 1500 });
          that._loadGroups();
          that.loadRecords(true);
          that._loadStreak();
        }).catch(function (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '保存失败', icon: 'none' });
        });
      } else {
        wx.showToast({ title: '未识别到结构化记录', icon: 'none' });
        // 把 Markdown 填回输入框让用户手动处理
        that.setData({ inputText: md });
      }
    }).catch(function (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || 'AI 解析失败', icon: 'none' });
      that.setData({ inputText: md });
    });
  },

  /** 删除单个预览媒体（图片或视频） */
  onRemovePreviewMedia: function (e) {
    var idx = e.currentTarget.dataset.index;
    var type = e.currentTarget.dataset.type;
    if (type === 'video') {
      var videos = this.data.previewVideos;
      videos.splice(idx, 1);
      this.setData({ previewVideos: videos });
      // height auto by flex
    } else {
      var images = this.data.previewImages;
      images.splice(idx, 1);
      this.setData({ previewImages: images });
      // height auto by flex
    }
  },

  /** 图片加载失败 → 自动移除以避免空白占位 */
  onPreviewImageError: function (e) {
    var idx = e.currentTarget.dataset.index;
    var type = e.currentTarget.dataset.type;
    if (type === 'video') {
      var videos = this.data.previewVideos.slice();
      if (idx >= 0 && idx < videos.length) videos.splice(idx, 1);
      this.setData({ previewVideos: videos });
    } else {
      var images = this.data.previewImages.slice();
      if (idx >= 0 && idx < images.length) images.splice(idx, 1);
      this.setData({ previewImages: images });
    }
  },

  /** 清除所有预览媒体 */
  onClearPreviewImages: function () {
    this.setData({ previewImages: [], previewVideos: [] });
    // 修复：_scheduleComputeHeight 早已随高度计算逻辑删除（改由 flex 自适应），残留调用会报错
  },

  /** 粘贴文本弹窗 */
  onPasteText: function () {
    this.setData({ showActions: false, showPaste: true });
  },

  onClosePaste: function () {
    this.setData({ showPaste: false, pasteText: '' });
  },

  onPasteInput: function (e) {
    this.setData({ pasteText: e.detail.value });
  },

  onSubmitPaste: function () {
    var text = this.data.pasteText.trim();
    if (!text) return;

    this.setData({ showPaste: false });
    wx.showLoading({ title: 'AI 解析中...', mask: true });

    var that = this;
    api.importPreview(text).then(function (res) {
      wx.hideLoading();
      // 如果有 records，保存它们
      if (res.records && res.records.length > 0) {
        api.importSave({
          documentSummary: res.documentSummary,
          records: res.records,
        }).then(function (saveRes) {
          that.setData({ pasteText: '' });
          wx.showToast({ title: '已导入 ' + saveRes.savedCount + ' 条记录', icon: 'success', duration: 1500 });
          that._loadGroups();
          that.loadRecords(true);
          that._loadStreak();
        }).catch(function (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '保存失败', icon: 'none' });
        });
      } else {
        wx.showToast({ title: '未识别到记录', icon: 'none' });
        that.setData({ pasteText: text }); // 恢复文本
      }
    }).catch(function (err) {
      wx.hideLoading();
      that.setData({ pasteText: text });
      wx.showToast({ title: err.message || 'AI 解析失败', icon: 'none' });
    });
  },

  // ============================================
  // 分组管理
  // ============================================

  onNewGroup: function () {
    var that = this; // 修复：原先漏定义 that，创建成功回调里 that._loadGroups() 会直接报错
    this.setData({ drawerOpen: false });
    // 弹出输入框让用户输入分组名
    wx.showModal({
      title: '新建分组',
      editable: true,
      placeholderText: '输入分组名',
      confirmText: '创建',
      success: function (res) {
        if (res.confirm && res.content && res.content.trim()) {
          api.createGroup({ name: res.content.trim() }).then(function () {
            wx.showToast({ title: '分组已创建', icon: 'success' });
            that._loadGroups();
          }).catch(function (err) {
            wx.showToast({ title: err.message || '创建失败', icon: 'none' });
          });
        }
      },
    });
  },

  /** 智能整理：重新 AI 归类未分组记录（含关键词兜底） */
  onSmartOrganize: function () {
    var that = this;
    if (that.data.reclassifying) return;
    var count = that.data.ungroupedCount || 0;
    if (count === 0) {
      wx.showToast({ title: '没有待整理的记录', icon: 'none' });
      return;
    }
    that.setData({ reclassifying: true });
    wx.showLoading({ title: '智能整理中...', mask: true });
    api.reclassifyRecords({ scope: 'ungrouped' }).then(function (res) {
      wx.hideLoading();
      that.setData({ reclassifying: false });
      that._loadGroups();
      that.loadRecords(true);
      var grouped = (res && res.grouped) || 0;
      wx.showToast({
        title: grouped > 0 ? ('已整理 ' + grouped + ' 条') : '暂无可整理内容',
        icon: grouped > 0 ? 'success' : 'none',
      });
    }).catch(function (err) {
      wx.hideLoading();
      that.setData({ reclassifying: false });
      wx.showToast({ title: (err && err.message) || '整理失败', icon: 'none' });
    });
  },

  /** 长按分组项 → 编辑/删除 */
  onGroupLongPress: function (e) {
    var that = this;
    var groupId = e.currentTarget.dataset.group;
    var group = that.data.flatGroups.find(function (g) { return g.id === groupId; });
    if (!group) return;

    haptic.light();

    wx.showActionSheet({
      itemList: ['编辑名称', '删除分组'],
      itemColor: '#2D2B28',
      success: function (res) {
        if (res.tapIndex === 0) {
          // 编辑名称
          wx.showModal({
            title: '修改分组名',
            editable: true,
            placeholderText: '输入新名称',
            content: group.name,
            confirmText: '保存',
            success: function (modalRes) {
              if (modalRes.confirm && modalRes.content && modalRes.content.trim()) {
                api.updateGroup(groupId, { name: modalRes.content.trim() }).then(function () {
                  wx.showToast({ title: '已更新', icon: 'success' });
                  that._loadGroups();
                }).catch(function (err) {
                  wx.showToast({ title: err.message || '更新失败', icon: 'none' });
                });
              }
            },
          });
        } else if (res.tapIndex === 1) {
          // 删除分组
          var recordCount = group.recordCount || 0;
          wx.showModal({
            title: '删除分组「' + group.name + '」？',
            content: recordCount > 0 ? '其下 ' + recordCount + ' 条记录将变为未分组，可随时重新归类' : '该分组下暂无记录',
            confirmText: '删除',
            confirmColor: '#D08070',
            success: function (modalRes) {
              if (modalRes.confirm) {
                api.deleteGroup(groupId).then(function () {
                  wx.showToast({ title: '分组已删除', icon: 'success' });
                  // 如果当前正在按此分组筛选，切回全部
                  if (that.data.activeGroupId === groupId) {
                    that.setData({ activeGroupId: 'all', page: 1, records: [], hasMore: true });
                    that.loadRecords(true);
                  }
                  that._loadGroups();
                }).catch(function (err) {
                  wx.showToast({ title: err.message || '删除失败', icon: 'none' });
                });
              }
            },
          });
        }
      },
    });
  },

  // ============================================
  // 手势 — 左边缘右滑打开抽屉
  // ============================================

  onTouchStart: function (e) {
    // 选择模式下不处理滑动
    if (this.data.selectMode) return;
    var t = e.touches[0];
    this.setData({
      touchStartX: t.clientX,
      touchStartY: t.clientY,
      swipeIndex: e.currentTarget.dataset.index,
      swipeOffset: 0,
    });
  },

  onTouchMove: function (e) {
    var dx = e.touches[0].clientX - this.data.touchStartX;
    var dy = e.touches[0].clientY - this.data.touchStartY;

    if (Math.abs(dy) > Math.abs(dx) * 0.6) return;

    var offset = Math.max(-120, Math.min(120, dx));
    this.setData({ swipeOffset: offset });
  },

  onTouchEnd: function (e) {
    var offset = this.data.swipeOffset;
    var index = this.data.swipeIndex;

    if (offset > 60) {
      this._quickToggleStatus(index);
    } else if (offset < -60) {
      this._quickConfirmDelete(index); // 修复：原调用名 _confirmQuickDelete 不存在，左滑删除一直报错
    }

    this.setData({ swipeOffset: 0, swipeIndex: -1 });
  },

  _quickToggleStatus: function (index) {
    var record = this.data.records[index];
    if (!record) return;

    var newStatus = record.status === '已完成' ? '待办' : '已完成';
    var that = this;

    haptic.light();

    api.updateRecord(record.id, { status: newStatus }).then(function () {
      var records = that.data.records;
      records[index].status = newStatus;
      records[index]._statusClass = STATUS_CLASS_MAP[newStatus] || '';
      that.setData({ records: records });
      wx.showToast({ title: newStatus === '已完成' ? '已完成' : '已标为待办', icon: 'none', duration: 1000 });
    }).catch(function () {
      wx.showToast({ title: '操作失败', icon: 'none' });
    });
  },

  _quickConfirmDelete: function (index) {
    var record = this.data.records[index];
    if (!record) return;
    var that = this;

    haptic.warning();

    wx.showModal({
      title: '删除这条记录？',
      content: (record.summary || record.content || '').slice(0, 30),
      confirmColor: '#D08070',
      success: function (res) {
        if (res.confirm) {
          api.deleteRecord(record.id).then(function () {
            var records = that.data.records;
            records.splice(index, 1);
            that.setData({ records: records });
            haptic.light();
            wx.showToast({ title: '已删除', icon: 'none', duration: 1000 });
            that._loadStreak();
            that._loadGroups();
          }).catch(function () {
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
        }
      },
    });
  },

  // ============================================
  // 快捷指令（v5 新增）
  // ============================================

  _loadShortcuts: function () {
    var stored = wx.getStorageSync('daywork_shortcuts');
    var shortcuts = (stored && stored.length > 0) ? stored : DEFAULT_SHORTCUTS.slice();
    this.setData({ shortcuts: shortcuts });
  },

  /** 点击快捷指令 */
  onShortcutTap: function (e) {
    var id = e.currentTarget.dataset.id;
    var shortcut = this.data.shortcuts.find(function (s) { return s.id === id; });
    if (!shortcut) return;

    haptic.light();
    this.setData({ activeShortcut: id });

    if (shortcut.action === 'record') {
      // 直接开始录音
      this._triggerRecording();
    } else {
      // 填入提示文字，聚焦输入框
      this.setData({ inputText: shortcut.prompt });
    }

    // 3秒后清除 active 状态
    var that = this;
    clearTimeout(this._scTimer);
    this._scTimer = setTimeout(function () {
      that.setData({ activeShortcut: '' });
    }, 3000);
  },

  /** 长按快捷指令 → 编辑/删除 */
  onShortcutLongPress: function (e) {
    var that = this;
    var id = e.currentTarget.dataset.id;
    var shortcut = that.data.shortcuts.find(function (s) { return s.id === id; });
    if (!shortcut) return;

    haptic.light();
    wx.showActionSheet({
      itemList: ['编辑「' + shortcut.label + '」', '删除'],
      success: function (res) {
        if (res.tapIndex === 0) {
          // 编辑
          wx.showModal({
            title: '编辑快捷指令',
            editable: true,
            placeholderText: '输入名称',
            content: shortcut.label,
            confirmText: '保存',
            success: function (modalRes) {
              if (modalRes.confirm && modalRes.content && modalRes.content.trim()) {
                shortcut.label = modalRes.content.trim();
                that._saveShortcuts();
              }
            },
          });
        } else if (res.tapIndex === 1) {
          // 删除（默认指令不能删，只能隐藏）
          var shortcuts = that.data.shortcuts.filter(function (s) { return s.id !== id; });
          that.setData({ shortcuts: shortcuts });
          that._saveShortcuts();
          wx.showToast({ title: '已移除', icon: 'none', duration: 1000 });
        }
      },
    });
  },

  /** 添加自定义快捷指令 */
  onAddShortcut: function () {
    var that = this;
    wx.showModal({
      title: '新建快捷指令',
      editable: true,
      placeholderText: '如：跟老张聊了',
      confirmText: '创建',
      success: function (res) {
        if (res.confirm && res.content && res.content.trim()) {
          var label = res.content.trim();
          var shortcuts = that.data.shortcuts;
          shortcuts.push({
            id: 'sc_custom_' + Date.now(),
            icon: '',
            label: label,
            prompt: label,
            action: 'input',
          });
          that.setData({ shortcuts: shortcuts });
          that._saveShortcuts();
          haptic.light();
          wx.showToast({ title: '已添加「' + label + '」', icon: 'success', duration: 1200 });
        }
      },
    });
  },

  /** 持久化快捷指令到 storage */
  _saveShortcuts: function () {
    wx.setStorageSync('daywork_shortcuts', this.data.shortcuts);
  },

  // ============================================
  // 导航
  // ============================================

  /** 点击语音图标 → 跳转详情页并自动播放录音 */
  onPlayVoice: function (e) {
    var id = e.currentTarget.dataset.id;
    if (id) {
      wx.navigateTo({ url: '/pages/detail/detail?id=' + id + '&autoPlayVoice=1' });
    }
  },

  onTapRecord: function (e) {
    var id = e.currentTarget.dataset.id;
    // 选择模式下：切换选中状态
    if (this.data.selectMode) {
      this._toggleSelect(id);
      return;
    }
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },

  // ============================================
  // 长按记录 → ActionSheet 快捷菜单
  // ============================================

  onLongPressRecord: function (e) {
    var that = this;
    var id = e.currentTarget.dataset.id;
    // 查找记录详情
    var records = that.data.records;
    var record = null;
    for (var i = 0; i < records.length; i++) {
      if (records[i].id === id) { record = records[i]; break; }
    }
    if (!record) return;

    haptic.light();

    var itemList = ['编辑', record._isPinned ? '取消置顶' : '置顶', '移动分组', '多选', '删除'];

    wx.showActionSheet({
      itemList: itemList,
      success: function (res) {
        switch (res.tapIndex) {
          case 0: // 编辑 → 跳详情
            wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
            break;
          case 1: // 置顶 / 取消置顶
            that._togglePinRecord(id, record);
            break;
          case 2: // 移动分组
            that._showMoveGroupSheet(id);
            break;
          case 3: // 多选 → 进入选择模式，长按的这条默认选中
            // 修复：07-14 长按改成菜单后忘了留多选入口，onEnterSelectMode 成了死代码，
            // 顶栏全选/取消、勾选圈、底部批量栏整套功能从此够不着
            that.onEnterSelectMode({ currentTarget: { dataset: { id: id } } });
            break;
          case 4: // 删除
            that._confirmDeleteRecord(id);
            break;
        }
      },
    });
  },

  /** 置顶 / 取消置顶 */
  _togglePinRecord: function (id, record) {
    var that = this;
    var newPinned = !record._isPinned;
    api.updateRecord(id, { isPinned: newPinned }).then(function () {
      // 更新本地 records 中的 _isPinned
      var records = that.data.records;
      for (var i = 0; i < records.length; i++) {
        if (records[i].id === id) { records[i]._isPinned = newPinned; break; }
      }
      that.setData({ records: records }, function () {
        // 置顶后立即重新排序，让置顶记录移到最前面
        that._applySort();
      });
      wx.showToast({ title: newPinned ? '已置顶' : '已取消置顶', icon: 'none', duration: 1000 });
    }).catch(function (err) {
      console.error('置顶操作失败:', err);
      wx.showToast({ title: '操作失败，请重试', icon: 'none' });
    });
  },

  /** 移动分组：弹出分组选择 ActionSheet */
  _showMoveGroupSheet: function (id) {
    var that = this;
    var groups = that.data.flatGroups || [];

    // 无分组时引导创建
    if (groups.length === 0) {
      wx.showModal({
        title: '暂无分组',
        content: '还没有分组，AI会根据你的记录内容自动创建分组。想去「我的」页面手动创建一个吗？',
        confirmText: '去创建',
        cancelText: '取消',
        success: function (res) {
          if (res.confirm) {
            wx.switchTab({ url: '/pages/mine/mine' });
          }
        },
      });
      return;
    }

    // 最多取前 5 个分组 + "无分组"
    var groupNames = groups.slice(0, 5).map(function (g) { return g.name; });
    groupNames.push('无分组');

    wx.showActionSheet({
      itemList: groupNames,
      success: function (res) {
        var idx = res.tapIndex;
        var targetGroupId = null;
        if (idx < groups.length) {
          targetGroupId = groups[idx].id;
        }
        api.moveRecordToGroup(id, targetGroupId).then(function () {
          // 本地更新
          var records = that.data.records;
          for (var i = 0; i < records.length; i++) {
            if (records[i].id === id) { records[i].groupId = targetGroupId; break; }
          }
          that.setData({ records: records });
          if (that.data.activeGroupId && that.data.activeGroupId !== 'today' && that.data.activeGroupId !== 'pending' && that.data.activeGroupId !== 'all') {
            // 如果在分组视图，刷新列表
            that.loadRecords(true);
          }
          var label = targetGroupId ? (groups[idx] ? groups[idx].name : '') : '无分组';
          wx.showToast({ title: '已移至「' + label + '」', icon: 'none', duration: 1500 });
        }).catch(function () {
          wx.showToast({ title: '移动失败', icon: 'none' });
        });
      },
    });
  },

  /** 确认删除单条记录 */
  _confirmDeleteRecord: function (id) {
    var that = this;
    wx.showModal({
      title: '删除这条记录？',
      content: '删除后无法恢复',
      confirmText: '删除',
      confirmColor: '#D08070',
      success: function (res) {
        if (res.confirm) {
          api.deleteRecord(id).then(function () {
            // 从本地列表中移除
            var records = that.data.records.filter(function (r) { return r.id !== id; });
            that.setData({ records: records });
            that._loadStreak();
            that._loadGroups();
            wx.showToast({ title: '已删除', icon: 'none', duration: 1000 });
          }).catch(function () {
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
        }
      },
    });
  },

  // ============================================
  // 批量选择模式
  // ============================================

  /** 进入选择模式（长按触发 或 通过按钮触发） */
  onEnterSelectMode: function (e) {
    if (this.data.selectMode) return;
    var id = e && e.currentTarget && e.currentTarget.dataset.id;
    var selectedIds = {};
    if (id) {
      selectedIds[id] = true;
    }
    haptic.light();
    this.setData({
      selectMode: true,
      selectedIds: selectedIds,
      selectedCount: id ? 1 : 0,
    });
  },

  /** 退出选择模式 */
  onExitSelectMode: function () {
    this.setData({
      selectMode: false,
      selectedIds: {},
      selectedCount: 0,
    });
  },

  /** 切换单条记录选中 */
  _toggleSelect: function (id) {
    var selectedIds = this.data.selectedIds;
    if (selectedIds[id]) {
      delete selectedIds[id];
    } else {
      selectedIds[id] = true;
    }
    var count = Object.keys(selectedIds).length;
    this.setData({
      selectedIds: selectedIds,
      selectedCount: count,
    });
  },

  /** 全选 / 取消全选 */
  onToggleSelectAll: function () {
    var that = this;
    var allSelected = that.data.selectedCount === that.data.records.length;
    if (allSelected) {
      that.setData({ selectedIds: {}, selectedCount: 0 });
    } else {
      var ids = {};
      that.data.records.forEach(function (r) {
        ids[r.id] = true;
      });
      that.setData({ selectedIds: ids, selectedCount: that.data.records.length });
    }
  },

  /** 批量删除 */
  onBatchDelete: function () {
    var that = this;
    var ids = Object.keys(that.data.selectedIds);
    if (ids.length === 0) return;

    haptic.warning();

    wx.showModal({
      title: '确认删除',
      content: '将删除选中的 ' + ids.length + ' 条记录，删除后不可恢复',
      confirmText: '删除',
      confirmColor: '#D08070',
      success: function (res) {
        if (!res.confirm) return;

        wx.showLoading({ title: '删除中...', mask: true });
        api.deleteRecords(ids).then(function (result) {
          wx.hideLoading();
          var deletedCount = result && result.deletedCount !== undefined ? result.deletedCount : ids.length;
          wx.showToast({ title: '已删除 ' + deletedCount + ' 条', icon: 'success', duration: 1500 });
          haptic.light();

          // 退出选择模式并刷新
          that.setData({ selectMode: false, selectedIds: {}, selectedCount: 0 });
          that._loadGroups();
          that.loadRecords(true);
          that._loadStreak();
        }).catch(function (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '删除失败', icon: 'none' });
        });
      },
    });
  },

  /** 批量移动选中记录到分组 */
  onBatchMoveToGroup: function () {
    var that = this;
    var ids = Object.keys(that.data.selectedIds);
    if (ids.length === 0) return;

    var groups = that.data.flatGroups || [];
    // 无分组时引导创建
    if (groups.length === 0) {
      wx.showModal({
        title: '暂无分组',
        content: '还没有分组，先去「我的」页面创建一个分组吧',
        showCancel: false,
        confirmText: '知道了',
      });
      return;
    }

    var groupNames = groups.slice(0, 5).map(function (g) { return g.name; });
    groupNames.push('无分组');

    wx.showActionSheet({
      itemList: groupNames,
      success: function (res) {
        var idx = res.tapIndex;
        var targetGroupId = null;
        if (idx < groups.length) {
          targetGroupId = groups[idx].id;
        }

        wx.showLoading({ title: '移动中...', mask: true });
        // 逐条移动
        var promises = ids.map(function (id) {
          return api.moveRecordToGroup(id, targetGroupId);
        });
        Promise.all(promises).then(function () {
          wx.hideLoading();
          var label = targetGroupId ? (groups[idx] ? groups[idx].name : '') : '无分组';
          wx.showToast({ title: '已移动 ' + ids.length + ' 条至「' + label + '」', icon: 'none', duration: 1500 });
          that.setData({ selectMode: false, selectedIds: {}, selectedCount: 0 });
          that._loadGroups();
          that.loadRecords(true);
        }).catch(function (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '移动失败', icon: 'none' });
        });
      },
    });
  },

  /** 批量标记为已完成 */
  onBatchMarkDone: function () {
    var that = this;
    var ids = Object.keys(that.data.selectedIds);
    if (ids.length === 0) return;

    wx.showLoading({ title: '标记中...', mask: true });
    var promises = ids.map(function (id) {
      return api.updateRecord(id, { status: '已完成' });
    });
    Promise.all(promises).then(function () {
      wx.hideLoading();
      wx.showToast({ title: '已标记 ' + ids.length + ' 条为已完成', icon: 'success', duration: 1500 });
      that.setData({ selectMode: false, selectedIds: {}, selectedCount: 0 });
      that.loadRecords(true);
    }).catch(function (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    });
  },

  // ============================================
  // 排序 & 视图模式切换
  // ============================================

  /** 切换排序方式 */
  onToggleSort: function () {
    var that = this;
    var currentSort = that.data.sortBy;
    var currentOrder = that.data.sortOrder;

    var itemList = [
      '按记录时间（最新在前）',
      '按记录时间（最早在前）',
      '按修改时间（最新在前）',
      '按修改时间（最早在前）',
    ];

    wx.showActionSheet({
      itemList: itemList,
      success: function (res) {
        var sortBy, sortOrder;
        switch (res.tapIndex) {
          case 0: sortBy = 'time'; sortOrder = 'desc'; break;
          case 1: sortBy = 'time'; sortOrder = 'asc'; break;
          case 2: sortBy = 'modified'; sortOrder = 'desc'; break;
          case 3: sortBy = 'modified'; sortOrder = 'asc'; break;
        }
        if (sortBy === currentSort && sortOrder === currentOrder) return;
        that.setData({ sortBy: sortBy, sortOrder: sortOrder });
        that._applySort();
      },
    });
  },

  /** 切换列表/宫格视图 */
  onToggleViewMode: function () {
    var newMode = this.data.viewMode === 'list' ? 'grid' : 'list';
    this.setData({ viewMode: newMode });
  },

  /** 对当前记录列表应用排序 */
  _applySort: function () {
    var that = this;
    var records = that.data.records.slice();
    var sortBy = that.data.sortBy;
    var sortOrder = that.data.sortOrder;

    records.sort(function (a, b) {
      var va, vb;
      if (sortBy === 'modified') {
        va = a.updatedAt || a.recordedAt || '';
        vb = b.updatedAt || b.recordedAt || '';
      } else {
        va = a.recordedAt || '';
        vb = b.recordedAt || '';
      }
      if (sortOrder === 'asc') {
        return va < vb ? -1 : va > vb ? 1 : 0;
      } else {
        return va > vb ? -1 : va < vb ? 1 : 0;
      }
    });

    // 置顶记录始终排在最前
    var pinned = records.filter(function (r) { return r._isPinned; });
    var unpinned = records.filter(function (r) { return !r._isPinned; });
    that.setData({ records: pinned.concat(unpinned) });
  },

  onGoSearch: function () {
    wx.navigateTo({ url: '/pages/search/search' });
  },

  onGoImport: function () {
    this.setData({ showActions: false });
    wx.navigateTo({ url: '/pages/import/import' });
  },

  onGoMine: function () {
    this.setData({ drawerOpen: false });
    wx.switchTab({ url: '/pages/mine/mine' });
  },

  onExport: function () {
    var that = this;
    wx.showActionSheet({
      itemList: ['导出 CSV（表格软件打开）', '导出 Markdown（纯文本）'],
      success: function (res) {
        var format = res.tapIndex === 0 ? 'csv' : 'markdown';
        wx.showLoading({ title: '导出中...', mask: true });
        api.exportRecords(format).then(function (result) {
          wx.hideLoading();
          var content = result.content || '';
          if (!content) {
            wx.showToast({ title: '没有可导出的记录', icon: 'none' });
            return;
          }
          // 写入临时文件并分享
          var fs = wx.getFileSystemManager();
          var ext = format === 'csv' ? '.csv' : '.md';
          var filePath = wx.env.USER_DATA_PATH + '/活记导出_' + new Date().toISOString().slice(0, 10) + ext;
          fs.writeFile({
            filePath: filePath,
            data: content,
            encoding: 'utf-8',
            success: function () {
              wx.showToast({ title: '已导出 ' + (result.recordCount || '') + ' 条记录', icon: 'success', duration: 2000 });
              // 延迟打开分享面板
              setTimeout(function () {
                wx.shareFileMessage({
                  filePath: filePath,
                  fileName: '活记导出_' + new Date().toISOString().slice(0, 10) + ext,
                  success: function () {},
                  fail: function () {
                    // 分享失败不影响，文件已保存
                  },
                });
              }, 800);
            },
            fail: function (err) {
              wx.hideLoading();
              wx.showToast({ title: '导出失败：' + (err.errMsg || '未知错误'), icon: 'none', duration: 2500 });
            },
          });
        }).catch(function (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '导出失败', icon: 'none' });
        });
      },
    });
  },

  onTapTemplate: function (e) {
    var text = e.currentTarget.dataset.text || '';
    haptic.light();
    this.setData({ inputText: text });
  },

  /** 加载模板快捷词（storage → 默认值兜底） */
  _loadTemplates: function () {
    var DEFAULT_TEMPLATES = ['要去做', '完成了', '报价：', '进货：', '收款：', '拜访了'];
    try {
      var stored = wx.getStorageSync('daywork_templates');
      this.setData({ templates: (stored && stored.length > 0) ? stored : DEFAULT_TEMPLATES.slice() });
    } catch (e) {
      this.setData({ templates: DEFAULT_TEMPLATES.slice() });
    }
  },

  /** 持久化模板到 storage */
  _saveTemplates: function () {
    wx.setStorageSync('daywork_templates', this.data.templates);
  },

  /** 长按模板 → 编辑/删除 */
  onTemplateLongPress: function (e) {
    var that = this;
    var idx = e.currentTarget.dataset.index;
    var text = e.currentTarget.dataset.text || '';
    haptic.light();
    wx.showActionSheet({
      itemList: ['编辑「' + text.trim() + '」', '删除'],
      success: function (res) {
        if (res.tapIndex === 0) {
          // 编辑
          wx.showModal({
            title: '修改快捷词',
            editable: true,
            placeholderText: '输入新内容',
            content: text,
            confirmText: '保存',
            success: function (modalRes) {
              if (modalRes.confirm && modalRes.content && modalRes.content.trim()) {
                var templates = that.data.templates.slice();
                templates[idx] = modalRes.content;
                that.setData({ templates: templates });
                that._saveTemplates();
                wx.showToast({ title: '已更新', icon: 'success', duration: 1000 });
              }
            },
          });
        } else if (res.tapIndex === 1) {
          // 删除
          var templates = that.data.templates.slice();
          templates.splice(idx, 1);
          that.setData({ templates: templates });
          that._saveTemplates();
          wx.showToast({ title: '已删除', icon: 'none', duration: 1000 });
        }
      },
    });
  },

  /** 添加自定义模板快捷词 */
  onAddTemplate: function () {
    var that = this;
    wx.showModal({
      title: '添加快捷词',
      editable: true,
      placeholderText: '如：跟老张聊了',
      confirmText: '添加',
      success: function (res) {
        if (res.confirm && res.content && res.content.trim()) {
          var templates = that.data.templates.slice();
          templates.push(res.content.trim());
          that.setData({ templates: templates });
          that._saveTemplates();
          haptic.light();
          wx.showToast({ title: '已添加', icon: 'success', duration: 1000 });
        }
      },
    });
  },

  onToggleContinuous: function () {
    var newVal = !this.data.continuousMode;
    this.setData({ continuousMode: newVal });
    wx.showToast({
      title: newVal ? '连续记录：开（发完不跳转）' : '连续记录：关',
      icon: 'none',
      duration: 1200,
    });
  },

  /** 阻止事件穿透的空函数 */
  noop: function () {},
});
