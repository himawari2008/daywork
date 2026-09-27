// ============================================
// 活记 通用工具函数 v2
// ============================================

/** 心情→emoji映射 */
var MOOD_EMOJI = {
  '开心': '😊',
  '平静': '😌',
  '疲惫': '😫',
  '压力': '😰',
  '生气': '😤',
};

/** 心情→CSS颜色变量映射 */
var MOOD_COLOR = {
  '开心': 'var(--mood-happy)',
  '平静': 'var(--mood-calm)',
  '疲惫': 'var(--mood-tired)',
  '压力': 'var(--mood-stress)',
  '生气': 'var(--mood-angry)',
};

/** 心情→CSS背景色变量映射 */
var MOOD_BG = {
  '开心': '#FFF8E8',
  '平静': '#EDF5F0',
  '疲惫': '#FDF6ED',
  '压力': '#FFF0EB',
  '生气': '#FFEBE8',
};

var util = {
  /**
   * 格式化时间显示
   * - 今天 → "14:30"
   * - 昨天 → "昨天 14:30"
   * - 今年 → "7月4日 14:30"
   * - 更早 → "2026年7月4日"
   */
  formatTime: function (dateStr) {
    var date = new Date(dateStr);
    var now = new Date();
    var hours = date.getHours();
    var mins = date.getMinutes();
    var timeStr = (hours < 10 ? '0' : '') + hours + ':' + (mins < 10 ? '0' : '') + mins;

    // 今天
    if (date.toDateString() === now.toDateString()) {
      return timeStr;
    }

    // 昨天
    var yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return '昨天 ' + timeStr;
    }

    // 今年
    if (date.getFullYear() === now.getFullYear()) {
      return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + timeStr;
    }

    // 更早
    return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日';
  },

  /**
   * 获取今天的日期字符串，如 "7月5日 · 周日"
   */
  getTodayLabel: function () {
    var now = new Date();
    var weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    var month = now.getMonth() + 1;
    var day = now.getDate();
    var weekday = weekdays[now.getDay()];
    return month + '月' + day + '日 · ' + weekday;
  },

  /**
   * 时段问候语（人格化，无 emoji）
   */
  getGreeting: function () {
    var h = new Date().getHours();
    if (h < 6)  return '夜深了，还在记';
    if (h < 9)  return '早上好，新的一天';
    if (h < 12) return '上午好，火力全开';
    if (h < 14) return '中午好，歇口气';
    if (h < 18) return '下午好，冲刺时间';
    if (h < 21) return '傍晚好，落日时分';
    return '晚上好，回顾今天';
  },

  /**
   * 动态空状态提示（根据是否已记录、时间段）
   */
  getEmptyHint: function (hasRecordedToday) {
    var h = new Date().getHours();
    if (hasRecordedToday) {
      if (h < 12) return '上午还没记，来一颗石子？';
      if (h < 18) return '下午还没记，别忘了哦';
      return '今天还没留下痕迹呢';
    }
    // 首次打开（今日尚无记录）：直接引导「张嘴就记」
    var tips = [
      '按住下方麦克风，张嘴就说一句',
      '想记点什么？按住麦克风开始',
      '下方麦克风，按住说话就能记',
    ];
    return tips[Math.floor(Math.random() * tips.length)];
  },

  /**
   * 时间段 CSS 类名（用于空状态样式调整）
   */
  getTimeClass: function () {
    var h = new Date().getHours();
    if (h < 6 || h >= 21) return 'night';
    if (h < 10) return 'morning';
    return '';
  },

  /**
   * 心情→emoji
   */
  moodEmoji: function (mood) {
    return MOOD_EMOJI[mood] || '';
  },

  /**
   * 心情→颜色CSS变量
   */
  moodColor: function (mood) {
    return MOOD_COLOR[mood] || 'var(--mood-neutral)';
  },

  /**
   * 心情→背景色
   */
  moodBg: function (mood) {
    return MOOD_BG[mood] || '#F2F1EE';
  },

  /**
   * 按 count 大小计算标签字号（22rpx ~ 36rpx）
   */
  tagFontSize: function (count, maxCount) {
    if (!maxCount || maxCount <= 0) return 22;
    var min = 22;
    var max = 36;
    var ratio = count / maxCount;
    return Math.round(min + (max - min) * ratio);
  },

  /**
   * 状态显示映射
   */
  statusLabel: function (status) {
    var map = {
      '待办': '待办',
      '已完成': '已完成',
      '待跟进': '待跟进',
    };
    return map[status] || '';
  },

  /**
   * 热力图颜色级别（0-4）
   * @param {number} count - 当日记录数
   * @param {number} maxCount - 最大记录数
   */
  heatLevel: function (count, maxCount) {
    if (!count || count <= 0) return 0;
    if (!maxCount || maxCount <= 0) return 1;
    var ratio = count / maxCount;
    if (ratio <= 0.25) return 1;
    if (ratio <= 0.5) return 2;
    if (ratio <= 0.75) return 3;
    return 4;
  },

  /**
   * 获取本周一的日期
   */
  getWeekStart: function () {
    var now = new Date();
    var day = now.getDay();
    var diff = now.getDate() - day + (day === 0 ? -6 : 1);
    var monday = new Date(now.setDate(diff));
    return monday.toISOString().slice(0, 10);
  },

  /**
   * 获取最近N天的日期列表
   */
  getRecentDates: function (n) {
    var dates = [];
    var now = new Date();
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(now);
      d.setDate(d.getDate() - i);
      dates.push({
        date: d.toISOString().slice(0, 10),
        label: (d.getMonth() + 1) + '/' + d.getDate(),
        weekday: ['日', '一', '二', '三', '四', '五', '六'][d.getDay()],
        isToday: i === 0,
      });
    }
    return dates;
  },

  /**
   * 心情排序权重（用于排序）
   */
  moodWeight: function (mood) {
    var weights = { '开心': 5, '平静': 4, '疲惫': 3, '压力': 2, '生气': 1 };
    return weights[mood] || 0;
  },
};

module.exports = util;
