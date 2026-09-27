// ============================================
// 活记 v2 · 我的页 — 河床地形图
// 统计 + 心情河流 + 热力图 + 连续环
// 参考 心光洞见 + Day One Stats
// ============================================

var api = require('../../utils/api');
var util = require('../../utils/util');
var haptic = require('../../utils/haptic');

var BAR_CLASS_MAP = {
  '待办': 'pending',
  '已完成': 'done',
  '待跟进': 'followup',
};

/** 解析心情 JSON（兼容旧格式纯文本），同 index.js */
function parseMood(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    var parsed = JSON.parse(raw);
    if (parsed && parsed.label) return parsed;
  } catch (e) { /* 旧格式 */ }
  var legacyMap = {
    '开心': { label: '开心', tone: 'positive', intensity: 3 },
    '平静': { label: '平静', tone: 'neutral', intensity: 2 },
    '疲惫': { label: '疲惫', tone: 'negative', intensity: 3 },
    '压力': { label: '有压力', tone: 'negative', intensity: 3 },
    '生气': { label: '生气', tone: 'negative', intensity: 4 },
  };
  return legacyMap[raw] || null;
}

/** 色调 → CSS 类名 */
function moodToneClass(mood) {
  if (!mood) return 'neutral';
  var t = mood.tone;
  return t === 'positive' ? 'positive' : t === 'negative' ? 'negative' : 'neutral';
}

Page({
  data: {
    loading: true,
    showLab: false,    // 实验功能总开关（V2）：false = 首发隐藏 借支/名片/涂鸦
    stats: {
      total: 0,
      monthCount: 0,
      weekCount: 0,
      days: 0,
      streak: 0,
      longestStreak: 0,
    },
    streakPercent: 0,   // 连续环百分比（360度*连续天数/目标）
    statusBars: [],
    tagCloud: [],
    topPeople: [],
    calendarData: [],   // 热力图数据
    calendarMonths: [], // 热力图月份标签
    // AI 周报
    summaryText: '',
    summaryLoading: false,
    // 分组管理（v4 新增）
    mineGroups: [],
    summaryPeriod: '',
    // 借支管理
    loanSummary: '',
    // 往年今日 + 随机回顾（从回顾 tab 合并）
    onThisDay: { records: [], loading: true },
    flashback: { record: null, loading: true },
    // 心情河流（v5 新增）
    moodRiverData: [],
    moodRiverLoading: false,
    // 隐私锁（v6 新增）
    lockEnabled: false,
    lockDelayLabel: '1 分钟',
    lockDelaySeconds: 60,
  },

  onShow() {
    this.loadAll();
    this._loadOnThisDay();
    this._loadFlashback();
    this._loadMineGroups();
    this._loadPrivacySettings();
    this._loadTheme();
    this._loadLoanSummary();
  },

  /** 加载当前主题设置 */
  _loadTheme() {
    var app = getApp();
    var theme = app.globalData.theme || 'system';
    var isDark = app.globalData._isDark || false;
    this.setData({ theme: theme, isDarkTheme: isDark });
  },

  /** 切换主题：亮色 → 暗色 → 跟随系统 */
  onChangeTheme() {
    var that = this;
    var themes = ['light', 'dark', 'system'];
    var labels = ['浅色模式', '深色模式', '跟随系统'];
    wx.showActionSheet({
      itemList: labels,
      success: function (res) {
        var theme = themes[res.tapIndex];
        getApp().switchTheme(theme);
        that._loadTheme();
        haptic.light();
      },
    });
  },

  // ============================================
  // 并行加载所有数据
  // ============================================

  loadAll: function () {
    var that = this;
    that.setData({ loading: true });

    var now = new Date();
    var currentYear = now.getFullYear();
    var currentMonth = now.getMonth() + 1;

    // 并行请求：统计（含人物频率/天数/周计数）+ 连续天数 + 热力图 + 心情河流
    Promise.all([
      api.getStats(),
      api.getStreak(),
      api.getCalendar(currentYear, currentMonth),
      api.getCalendar(currentMonth === 1 ? currentYear - 1 : currentYear, currentMonth === 1 ? 12 : currentMonth - 1),
      api.getCalendar(currentMonth <= 2 ? currentYear - 1 : currentYear, currentMonth <= 2 ? (currentMonth - 2 + 12) : currentMonth - 2),
      api.getMoodRiver(7),
    ]).then(function (results) {
      var stats = results[0];
      var streakData = results[1];
      var calCurrent = results[2];
      var calPrev1 = results[3];
      var calPrev2 = results[4];
      var moodRiverData = (results[5] || []).map(function (item) {
        var moodObj = parseMood(item.dominantMood);
        return Object.assign({}, item, {
          moodLabel: moodObj ? moodObj.label : (item.dominantMood || '—'),
          moodToneClass: moodToneClass(moodObj),
          moodIntensity: moodObj ? moodObj.intensity : 0,
        });
      });

      // ========== 基础统计（全部来自后端，不再客户端聚合 500 条）==========

      // 连续环：30天达标 → 360度
      var streakTarget = 30;
      var streakPercent = Math.min(360, Math.round((streakData.currentStreak || 0) / streakTarget * 360));

      // ========== 状态分布 ==========
      var dist = stats.statusDistribution || [];
      var totalStatus = 0;
      dist.forEach(function (d) { totalStatus += Number(d.count); });

      var statusBars = dist.map(function (d) {
        var count = Number(d.count);
        var st = d.status || '无状态';
        return {
          status: st,
          label: st,
          count: count,
          percent: totalStatus > 0 ? Math.round((count / totalStatus) * 100) : 0,
          _barClass: BAR_CLASS_MAP[st] || 'none',
        };
      });

      // ========== 标签云 ==========
      var topTags = stats.topTags || [];
      var maxCount = topTags.length > 0 ? Number(topTags[0].count) : 0;
      var colors = ['#4A5C7C', '#5C6B8A', '#7D8BA3', '#9EAABD', '#BFC8D6'];
      var tagCloud = topTags.map(function (t, i) {
        return {
          tag: t.tag,
          size: util.tagFontSize(Number(t.count), maxCount),
          color: colors[i % colors.length],
        };
      });

      // ========== 人物频率（来自后端统计，不再客户端聚合）==========
      var peopleStats = stats.topPeople || [];
      var topPeople = peopleStats.map(function (p) {
        return { name: p.person, count: Number(p.count) };
      }).slice(0, 8);

      // ========== 热力图数据 ==========
      // 合并3个月数据
      var allCalData = {};
      var mergeCal = function (calMap) {
        Object.keys(calMap).forEach(function (date) {
          allCalData[date] = (allCalData[date] || 0) + Number(calMap[date]);
        });
      };
      mergeCal(calCurrent);
      mergeCal(calPrev1);
      mergeCal(calPrev2);

      // 计算最大日记录数
      var maxDayCount = 0;
      Object.values(allCalData).forEach(function (c) {
        if (Number(c) > maxDayCount) maxDayCount = Number(c);
      });

      // 生成约90天的网格数据
      var calList = [];
      var monthSet = {};
      var endDate = new Date();
      var startDate = new Date();
      startDate.setDate(startDate.getDate() - 89); // ~90天

      // 填充到周一起始
      while (startDate.getDay() !== 1) {
        startDate.setDate(startDate.getDate() - 1);
      }

      for (var d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        var ds = d.toISOString().slice(0, 10);
        var count = Number(allCalData[ds]) || 0;
        var level = util.heatLevel(count, maxDayCount);
        calList.push({ date: ds, count: count, level: level });
        // 记录月份
        var mKey = (d.getMonth() + 1) + '月';
        monthSet[mKey] = true;
      }

      // 月份标签按顺序排列
      var monthOrder = [];
      for (var m = startDate.getMonth() + 1; ; m++) {
        var mk = (m > 12 ? m - 12 : m) + '月';
        if (monthSet[mk] && monthOrder.indexOf(mk) === -1) monthOrder.push(mk);
        if (m > endDate.getMonth() + 1 + 12) break; // safety
      }

      that.setData({
        loading: false,
        stats: {
          total: stats.total || 0,
          monthCount: stats.monthCount || 0,
          weekCount: stats.weekCount || 0,
          days: stats.daysActive || 0,
          streak: streakData.currentStreak || 0,
          longestStreak: streakData.longestStreak || 0,
        },
        streakPercent: streakPercent,
        statusBars: statusBars,
        tagCloud: tagCloud,
        topPeople: topPeople,
        calendarData: calList,
        calendarMonths: monthOrder,
        moodRiverData: moodRiverData,
      });
    }).catch(function () {
      that.setData({ loading: false });
    });
  },

  // ============================================
  // AI 周报
  // ============================================

  onGenerateSummary: function () {
    var that = this;
    if (that.data.summaryLoading) return;

    that.setData({ summaryLoading: true, summaryText: '' });

    api.getSummary('week').then(function (res) {
      that.setData({
        summaryLoading: false,
        summaryText: res.summaryText || '',
        summaryPeriod: res.period || '',
      });
      haptic.light();
    }).catch(function () {
      that.setData({ summaryLoading: false });
      wx.showToast({ title: '生成失败，请重试', icon: 'none' });
    });
  },

  // ============================================
  // 往年今日（从回顾 tab 合并）
  // ============================================

  _loadOnThisDay: function () {
    var that = this;
    var todayStr = new Date().toISOString().slice(0, 10);
    var parts = todayStr.split('-');
    var md = parts[1] + '-' + parts[2];

    this.setData({ 'onThisDay.loading': true });

    var promise;
    if (api.getOnThisDay) {
      promise = api.getOnThisDay(todayStr);
    } else {
      // 降级：搜索同月同日但不同年份
      promise = api.getRecords({ datePattern: md, pageSize: 10 }).then(function (res) {
        var records = (res.data || []).filter(function (r) {
          return r.recordedAt && r.recordedAt.slice(5, 10) === md && r.recordedAt.slice(0, 4) !== todayStr.slice(0, 4);
        });
        return { records: records };
      });
    }

    promise.then(function (res) {
      var records = (res.records || []).map(function (r) {
        var moodObj = parseMood(r.mood);
        r._yearLabel = r.recordedAt ? r.recordedAt.slice(0, 4) + '年' : '那年';
        r._moodLabel = moodObj ? moodObj.label : null;
        r._moodToneClass = moodToneClass(moodObj);
        return r;
      });
      that.setData({
        'onThisDay.records': records,
        'onThisDay.loading': false,
      });
    }).catch(function () {
      that.setData({ 'onThisDay.records': [], 'onThisDay.loading': false });
    });
  },

  onShuffleOnThisDay: function () {
    var that = this;
    this.setData({ 'onThisDay.loading': true, 'onThisDay.records': [] });
    var now = new Date();
    var offset = Math.floor(Math.random() * 60) - 30;
    now.setDate(now.getDate() + offset);
    var newDate = now.toISOString().slice(0, 10);
    var md = newDate.slice(5);

    var promise;
    if (api.getOnThisDay) {
      promise = api.getOnThisDay(newDate);
    } else {
      promise = api.getRecords({ datePattern: md, pageSize: 10 }).then(function (res) {
        var records = (res.data || []).filter(function (r) {
          return r.recordedAt && r.recordedAt.slice(5, 10) === md && r.recordedAt.slice(0, 4) !== newDate.slice(0, 4);
        });
        return { records: records };
      });
    }

    promise.then(function (res) {
      var records = (res.records || []).map(function (r) {
        var moodObj = parseMood(r.mood);
        r._yearLabel = r.recordedAt ? r.recordedAt.slice(0, 4) + '年' : '那年';
        r._moodLabel = moodObj ? moodObj.label : null;
        r._moodToneClass = moodToneClass(moodObj);
        return r;
      });
      that.setData({ 'onThisDay.records': records, 'onThisDay.loading': false });
    }).catch(function () {
      that.setData({ 'onThisDay.records': [], 'onThisDay.loading': false });
    });
  },

  // ============================================
  // 随机回顾（从回顾 tab 合并）
  // ============================================

  _loadFlashback: function () {
    var that = this;
    this.setData({ 'flashback.loading': true });

    api.getMemory().then(function (res) {
      if (res && res.record) {
        var r = res.record;
        var moodObj = parseMood(r.mood);
        r._dateLabel = r.recordedAt ? r.recordedAt.slice(0, 10) : '';
        r._moodLabel = moodObj ? moodObj.label : null;
        r._moodToneClass = moodToneClass(moodObj);
        that.setData({ 'flashback.record': r, 'flashback.loading': false });
      } else {
        that.setData({ 'flashback.record': null, 'flashback.loading': false });
      }
    }).catch(function () {
      that.setData({ 'flashback.record': null, 'flashback.loading': false });
    });
  },

  onShuffleFlashback: function () {
    this.setData({ 'flashback.record': null });
    this._loadFlashback();
  },

  onDismissFlashback: function () {
    this.setData({ 'flashback.record': null });
  },

  /** 点击往年今日/随机回顾的记录卡片 → 跳转详情 */
  onTapReviewRecord: function (e) {
    var id = e.currentTarget.dataset.id;
    if (id) {
      wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
    }
  },

  // ============================================
  // 分组管理（v4 新增）
  // ============================================

  _loadMineGroups: function () {
    var that = this;
    api.getGroups().then(function (res) {
      that.setData({ mineGroups: res.groups || [] });
    }).catch(function () {});
  },

  // ============================================
  // 借支管理
  // ============================================
  _loadLoanSummary: function () {
    var that = this;
    api.getLoansSummary().then(function (res) {
      var summary = (res && res.summary) || [];
      if (summary.length === 0) {
        that.setData({ loanSummary: '' });
        return;
      }
      // 取前3个人名拼成摘要，如 "老李+500、老张-300、小王+0"
      var parts = summary.slice(0, 3).map(function (s) {
        var sign = s.net > 0 ? '+' : '';
        return s.person + sign + s.net;
      });
      var text = parts.join('、');
      if (summary.length > 3) text += ' 等' + summary.length + '人';
      that.setData({ loanSummary: text });
    }).catch(function () {
      that.setData({ loanSummary: '' });
    });
  },

  onOpenCard: function () {
    haptic.light();
    wx.navigateTo({ url: '/pages/card/card' });
  },

  onOpenLoans: function () {
    haptic.light();
    wx.navigateTo({ url: '/pages/loans/loans' });
  },

  onNewGroupFromMine: function () {
    wx.showModal({
      title: '新建分组',
      editable: true,
      placeholderText: '输入分组名',
      confirmText: '创建',
      success: function (res) {
        if (res.confirm && res.content && res.content.trim()) {
          api.createGroup({ name: res.content.trim() }).then(function () {
            wx.showToast({ title: '分组已创建', icon: 'success' });
            that._loadMineGroups();
          }).catch(function (err) {
            wx.showToast({ title: err.message || '创建失败', icon: 'none' });
          });
        }
      },
    });
  },

  onToggleGroupPin: function (e) {
    var id = e.currentTarget.dataset.id;
    var currentPinned = e.currentTarget.dataset.pinned;
    var that = this;
    api.updateGroup(id, { isPinned: !currentPinned }).then(function () {
      that._loadMineGroups();
    }).catch(function () {
      wx.showToast({ title: '操作失败', icon: 'none' });
    });
  },

  onDeleteGroup: function (e) {
    var id = e.currentTarget.dataset.id;
    var that = this;
    wx.showModal({
      title: '删除分组？',
      content: '分组内的记录将变为未分组',
      confirmColor: '#D08070',
      success: function (res) {
        if (res.confirm) {
          api.deleteGroup(id).then(function () {
            that._loadMineGroups();
            wx.showToast({ title: '已删除', icon: 'success' });
          }).catch(function () {
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
        }
      },
    });
  },

  // ============================================
  // 隐私锁设置（v6 新增）
  // ============================================

  _loadPrivacySettings: function () {
    var lockEnabled = false;
    var lockDelay = 60;
    try {
      lockEnabled = !!wx.getStorageSync('daywork_lock_enabled');
      var saved = wx.getStorageSync('daywork_lock_delay');
      if (saved) lockDelay = parseInt(saved);
    } catch (e) { /* ignore */ }

    var labels = { 10: '10 秒', 30: '30 秒', 60: '1 分钟', 120: '2 分钟', 300: '5 分钟' };
    this.setData({
      lockEnabled: lockEnabled,
      lockDelaySeconds: lockDelay,
      lockDelayLabel: labels[lockDelay] || lockDelay + ' 秒',
    });
  },

  /** 开关应用锁 */
  onToggleLock: function (e) {
    var enabled = e.detail.value;
    var that = this;

    if (enabled) {
      // 开启 → 跳转到锁屏页设置密码
      try {
        wx.removeStorageSync('daywork_pin_hash');
        wx.removeStorageSync('daywork_pin_salt');
      } catch (e) { /* ignore */ }

      wx.navigateTo({
        url: '/pages/lock/lock',
        success: function () {
          // 返回后刷新状态
          setTimeout(function () {
            that._loadPrivacySettings();
          }, 500);
        },
      });
    } else {
      // 关闭 → 先验证一次密码
      wx.showModal({
        title: '关闭应用锁',
        content: '关闭后不再需要密码验证',
        confirmText: '确认关闭',
        confirmColor: '#D08070',
        success: function (res) {
          if (res.confirm) {
            try {
              wx.removeStorageSync('daywork_pin_hash');
              wx.removeStorageSync('daywork_pin_salt');
              wx.setStorageSync('daywork_lock_enabled', false);
            } catch (e) { /* ignore */ }
            that.setData({ lockEnabled: false });
            wx.showToast({ title: '应用锁已关闭', icon: 'success' });
          }
        },
      });
    }
  },

  /** 修改锁定延时 */
  onChangeLockDelay: function () {
    var that = this;
    var delays = [10, 30, 60, 120, 300];
    var labels = ['10 秒', '30 秒', '1 分钟', '2 分钟', '5 分钟'];
    wx.showActionSheet({
      itemList: labels,
      success: function (res) {
        var delay = delays[res.tapIndex];
        try {
          wx.setStorageSync('daywork_lock_delay', delay);
        } catch (e) { /* ignore */ }
        that._loadPrivacySettings();
        wx.showToast({ title: '锁定延时已更新', icon: 'success' });
      },
    });
  },

  /** 修改密码 */
  onChangePin: function () {
    wx.showModal({
      title: '修改密码',
      content: '将跳转到密码设置页面',
      confirmText: '去修改',
      success: function (res) {
        if (res.confirm) {
          try {
            wx.removeStorageSync('daywork_pin_hash');
            wx.removeStorageSync('daywork_pin_salt');
          } catch (e) { /* ignore */ }
          wx.navigateTo({ url: '/pages/lock/lock' });
        }
      },
    });
  },

  /** 打开隐私协议 */
  onOpenPrivacy: function () {
    haptic.light();
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  // ============================================
  // 设置操作
  // ============================================

  /** 清除全部数据（需二次确认） */
  onClearAllData: function () {
    var that = this;
    var totalCount = that.data.stats.total || 0;
    if (totalCount === 0) {
      wx.showToast({ title: '没有可清除的数据', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '⚠️ 清除全部数据',
      content: '即将永久删除 ' + totalCount + ' 条记录、所有分组和统计数据。此操作不可恢复！',
      confirmText: '确认清除',
      confirmColor: '#D08070',
      success: function (res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '清除中...', mask: true });
        api.deleteAllRecords().then(function (result) {
          wx.hideLoading();
          wx.showToast({ title: '已清除 ' + (result.deletedCount || 0) + ' 条记录', icon: 'success', duration: 2000 });
          haptic.medium();
          // 重新加载空数据
          that.loadAll();
          that._loadMineGroups();
        }).catch(function (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '清除失败', icon: 'none' });
        });
      },
    });
  },

  /** 显示关于信息 */
  onShowAbout: function () {
    wx.showModal({
      title: '关于活记',
      content: '活记 v0.4\n个人 AI 语音工作日记\n\n用声音记录每一天的工作\nAI 自动整理、分类、回顾\n\n为家航 © 2026',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  // ============================================
  // 标签管理（长按标签云）
  // ============================================

  onTagLongPress: function (e) {
    var that = this;
    var tagName = e.currentTarget.dataset.tag;
    if (!tagName) return;

    haptic.light();
    wx.showActionSheet({
      itemList: ['重命名「' + tagName + '」', '删除「' + tagName + '」'],
      success: function (res) {
        if (res.tapIndex === 0) {
          // 重命名
          wx.showModal({
            title: '重命名标签',
            editable: true,
            placeholderText: '输入新标签名',
            content: tagName,
            confirmText: '保存',
            success: function (modalRes) {
              if (modalRes.confirm && modalRes.content && modalRes.content.trim()) {
                var newName = modalRes.content.trim();
                if (newName === tagName) return;
                wx.showLoading({ title: '更新中...', mask: true });
                api.renameTag(tagName, newName).then(function (result) {
                  wx.hideLoading();
                  wx.showToast({ title: '已更新 ' + (result.updatedCount || 0) + ' 条记录', icon: 'success' });
                  that.loadAll(); // 刷新统计数据
                }).catch(function (err) {
                  wx.hideLoading();
                  wx.showToast({ title: err.message || '重命名失败', icon: 'none' });
                });
              }
            },
          });
        } else if (res.tapIndex === 1) {
          // 删除标签
          wx.showModal({
            title: '删除标签「' + tagName + '」？',
            content: '将从所有记录中移除此标签',
            confirmText: '删除',
            confirmColor: '#D08070',
            success: function (modalRes) {
              if (!modalRes.confirm) return;
              wx.showLoading({ title: '移除中...', mask: true });
              api.removeTag(tagName).then(function (result) {
                wx.hideLoading();
                wx.showToast({ title: '已从 ' + (result.updatedCount || 0) + ' 条记录中移除', icon: 'success' });
                that.loadAll();
              }).catch(function (err) {
                wx.hideLoading();
                wx.showToast({ title: err.message || '删除失败', icon: 'none' });
              });
            },
          });
        }
      },
    });
  },

  onExport: function () {
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
          var fs = wx.getFileSystemManager();
          var ext = format === 'csv' ? '.csv' : '.md';
          var filePath = wx.env.USER_DATA_PATH + '/活记导出_' + new Date().toISOString().slice(0, 10) + ext;
          fs.writeFile({
            filePath: filePath,
            data: content,
            encoding: 'utf-8',
            success: function () {
              wx.showToast({ title: '已导出 ' + (result.recordCount || '') + ' 条记录', icon: 'success', duration: 2000 });
              setTimeout(function () {
                wx.shareFileMessage({
                  filePath: filePath,
                  fileName: '活记导出_' + new Date().toISOString().slice(0, 10) + ext,
                  success: function () {},
                  fail: function () {},
                });
              }, 800);
            },
            fail: function (err) {
              wx.hideLoading();
              wx.showToast({ title: '导出失败', icon: 'none' });
            },
          });
        }).catch(function (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '导出失败', icon: 'none' });
        });
      },
    });
  },
});
