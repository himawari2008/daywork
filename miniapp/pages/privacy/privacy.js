// 活记 · 隐私协议页
Page({
  data: {
    isDarkTheme: false,
  },
  onLoad: function () {
    this.setData({ isDarkTheme: getApp().globalData._isDark || false });
  }
});
