// ============================================
// 活记 · 首次引导 — 对标 Day One onboarding
// 3 页滑动介绍，首次启动显示，之后不再出现
// ============================================

var app = getApp();

Page({
  data: {
    current: 0,
    showSplash: false,
    slides: [
      {
        title: '用声音记录每一天',
        desc: '随口说一句，AI 自动整理成\n有条理的工作日记',
        icon: 'voice',
        color: '#E8815C',
      },
      {
        title: 'AI 帮你理解工作',
        desc: '自动提取人物、标签、金额\n设置提醒、分组归类',
        icon: 'ai',
        color: '#4A5C7C',
      },
      {
        title: '回顾，不再遗忘',
        desc: '搜索历史、生成周报、日历热力图\n让每一条记录都有归属',
        icon: 'review',
        color: '#6EA880',
      },
    ],
    isLast: false,
  },

  onLoad: function () {
    var self = this;
    this.setData({ showSplash: true });
    setTimeout(function () {
      self.setData({ showSplash: false });
    }, 1200);
  },

  onSwiperChange: function (e) {
    var current = e.detail.current;
    this.setData({
      current: current,
      isLast: current === 2,
    });
  },

  onSkip: function () {
    this._finish();
  },

  onStart: function () {
    if (this.data.isLast) {
      this._finish();
    } else {
      // 非最后一页 → 滑动到下一页
      var next = this.data.current + 1;
      this.setData({ current: next, isLast: next === 2 });
    }
  },

  _finish: function () {
    try {
      wx.setStorageSync('daywork_onboarded', true);
    } catch (e) { /* ignore */ }
    wx.switchTab({ url: '/pages/index/index' });
  },
});
