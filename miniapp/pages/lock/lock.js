// ============================================
// 活记 · 隐私锁屏
// 对标 Day One Face ID / 声间本地私密
// 6位PIN码 + 微信Soter生物认证
// ============================================

var app = getApp();
var haptic = require('../../utils/haptic');

/** 简单 hash：SHA-256 不可用时的 fallback */
function simpleHash(pin, salt) {
  var combined = pin + ':' + salt;
  var hash = 0;
  for (var i = 0; i < combined.length; i++) {
    var char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

function generateSalt() {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

Page({
  data: {
    pin: '',
    pinLength: 0,
    shake: false,
    isDarkTheme: false,
    lockHint: '输入密码解锁',
    bioSupported: false,
    isFirstSetup: false,
    numRows: [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['bio', '0', 'del'],
    ],
  },

  onLoad: function () {
    this.setData({ isDarkTheme: getApp().globalData._isDark || false });
    // 检测是否首次设置密码
    var hash = null;
    try {
      hash = wx.getStorageSync('daywork_pin_hash');
    } catch (e) { /* ignore */ }

    if (!hash) {
      this.setData({
        isFirstSetup: true,
        lockHint: '首次使用，请设置6位密码',
      });
    }

    // 检查生物认证支持
    this._checkBioSupport();
  },

  /** 检查是否支持指纹/面容认证 */
  _checkBioSupport: function () {
    var that = this;
    wx.checkIsSupportSoterAuthentication({
      success: function (res) {
        if (res.supportMode && res.supportMode.length > 0) {
          that.setData({ bioSupported: true });
          // 调整键盘：把最后一行的 bio 替换为 usable
        }
      },
      fail: function () {
        that.setData({ bioSupported: false });
      },
    });
  },

  // ============================================
  // 数字键盘
  // ============================================

  onNumTap: function (e) {
    var key = e.currentTarget.dataset.key;
    if (!key && key !== '0') return;

    // 生物认证按钮
    if (key === 'bio') {
      this.onBioAuth();
      return;
    }

    var that = this;

    // 删除键
    if (key === 'del') {
      var pin = that.data.pin;
      if (pin.length > 0) {
        pin = pin.slice(0, -1);
        that.setData({ pin: pin, pinLength: pin.length });
      }
      return;
    }

    // 数字键
    var pin = that.data.pin + key;
    if (pin.length > 6) return; // 最多6位

    that.setData({ pin: pin, pinLength: pin.length });

    haptic.light();

    // 输入满6位 → 验证
    if (pin.length === 6) {
      that._verify(pin);
    }
  },

  // ============================================
  // 验证密码
  // ============================================

  _verify: function (pin) {
    var that = this;
    var stored = null;
    var salt = null;
    try {
      stored = wx.getStorageSync('daywork_pin_hash');
      salt = wx.getStorageSync('daywork_pin_salt');
    } catch (e) { /* ignore */ }

    if (that.data.isFirstSetup) {
      // 首次设置密码
      var newHash = simpleHash(pin, generateSalt());
      try {
        wx.setStorageSync('daywork_pin_hash', newHash);
        wx.setStorageSync('daywork_pin_salt', salt || generateSalt());
        wx.setStorageSync('daywork_lock_enabled', true);
      } catch (e) { /* ignore */ }

      haptic.medium();
      wx.showToast({ title: '密码设置成功', icon: 'success', duration: 1500 });
      setTimeout(function () { that._unlock(); }, 800);
      return;
    }

    // 验证已有密码
    var expected = simpleHash(pin, salt || '');
    if (expected === stored) {
      haptic.medium();
      that._unlock();
    } else {
      haptic.warning();
      that.setData({ pin: '', pinLength: 0, shake: true, lockHint: '密码错误，请重试' });
      setTimeout(function () {
        that.setData({ shake: false });
      }, 500);
    }
  },

  // ============================================
  // 生物认证
  // ============================================

  onBioAuth: function () {
    var that = this;
    wx.startSoterAuthentication({
      requestAuthModes: ['fingerPrint', 'facial'],
      challenge: 'daywork-biometric-' + Date.now(),
      authContent: '验证身份以解锁活记',
      success: function () {
        haptic.medium();
        that._unlock();
      },
      fail: function () {
        wx.showToast({ title: '验证失败，请使用密码', icon: 'none' });
      },
    });
  },

  // ============================================
  // 解锁
  // ============================================

  _unlock: function () {
    try {
      wx.setStorageSync('daywork_lock_time', Date.now());
    } catch (e) { /* ignore */ }

    // 标记已解锁
    var needOnboard = false;
    try {
      needOnboard = !wx.getStorageSync('daywork_onboarded');
    } catch (e) { /* ignore */ }

    if (needOnboard) {
      wx.reLaunch({ url: '/pages/onboarding/onboarding' });
    } else {
      wx.switchTab({ url: '/pages/index/index' });
    }
  },
});
