// ============================================
// 活记 — 个人AI智能体 微信小程序入口
// ============================================

App({
  globalData: {
    userId: null,
    /** JWT token（微信登录后获取） */
    token: null,
    /** 微信 openid */
    openid: null,
    // 开发环境指向本地后端，真机需改为局域网 IP 或已备案域名
    // 真机调试改为局域网 IP；本地开发用 127.0.0.1
    apiBase: 'http://127.0.0.1:3000/api',
    /** 待处理提醒数（Phase 1 新增） */
    reminderCount: 0,
    /** 隐私锁：退后台时间戳 */
    _hideTimestamp: 0,
    /** 主题：'light' | 'dark' | 'system' */
    theme: 'system',
  },

  onLaunch() {
    // 首次启动 → 跳转引导页（对标 Day One onboarding）
    var onboarded = false;
    try {
      onboarded = wx.getStorageSync('daywork_onboarded');
    } catch (e) { /* ignore */ }
    if (!onboarded) {
      // 延迟跳转，确保 App 初始化完成
      var that = this;
      setTimeout(function () {
        wx.reLaunch({ url: '/pages/onboarding/onboarding' });
      }, 100);
      // 仍然继续初始化（userId 等），引导页不需要但保持一致性
    }

    this._initUserId();
    this._initTheme();
    // 尝试微信登录（静默，失败不影响使用）
    this._tryWechatLogin();
  },

  /** 初始化主题：存储偏好 > 系统主题 */
  _initTheme() {
    var stored = 'system';
    try {
      stored = wx.getStorageSync('daywork_theme') || 'system';
    } catch (e) { /* ignore */ }
    this.globalData.theme = stored;
    this._applyTheme(stored);
  },

  /** 应用主题到全局 page 元素 */
  _applyTheme(theme) {
    var isDark = false;
    if (theme === 'dark') {
      isDark = true;
    } else if (theme === 'system' || !theme) {
      // getSystemInfoSync 已废弃，主题信息改用 getAppBaseInfo（低版本库回退旧 API）
      var sysInfo = wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync();
      isDark = sysInfo.theme === 'dark';
    }
    // 通过设置 page 的 class 切换 CSS 变量
    var pages = getCurrentPages();
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].setData) {
        pages[i].setData({ isDarkTheme: isDark });
      }
    }
    // 后续页面通过 onShow 读取 globalData
    this.globalData._isDark = isDark;
  },

  /** 手动切换主题（供 mine 页调用） */
  switchTheme(theme) {
    this.globalData.theme = theme;
    try {
      wx.setStorageSync('daywork_theme', theme);
    } catch (e) { /* ignore */ }
    this._applyTheme(theme);
  },

  /**
   * 退后台：记录时间戳，用于隐私锁判断
   */
  onHide() {
    this.globalData._hideTimestamp = Date.now();
  },

  /**
   * 回前台：检查是否需要弹出隐私锁
   */
  onShow() {
    var that = this;
    var lockEnabled = false;
    try {
      lockEnabled = wx.getStorageSync('daywork_lock_enabled');
    } catch (e) { /* ignore */ }

    if (!lockEnabled) return;

    // 检查锁屏延时（默认1分钟）
    var lockDelay = 60; // 秒
    try {
      var customDelay = wx.getStorageSync('daywork_lock_delay');
      if (customDelay) lockDelay = parseInt(customDelay);
    } catch (e) { /* ignore */ }

    var elapsed = (Date.now() - this.globalData._hideTimestamp) / 1000;
    if (elapsed >= lockDelay) {
      // 需要锁定：跳转到锁屏页
      try {
        wx.setStorageSync('daywork_need_lock', true);
      } catch (e) { /* ignore */ }
      wx.navigateTo({ url: '/pages/lock/lock' });
    }

    // 重新检查提醒
    var that2 = this;
    setTimeout(function () { that2._checkReminders(); }, 500);
  },

  /** 初始化用户标识：首次启动生成 UUID，存入本地 storage */
  _initUserId() {
    var stored = null;
    try {
      stored = wx.getStorageSync('daywork_userId');
    } catch (e) {
      // ignore
    }

    if (stored) {
      this.globalData.userId = stored;
      return;
    }

    // 生成简单 UUID v4
    var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });

    try {
      wx.setStorageSync('daywork_userId', uuid);
    } catch (e) {
      // ignore
    }

    this.globalData.userId = uuid;
  },

  /**
   * 微信登录：wx.login() → 后端换取 JWT
   * 静默执行，失败回退到 x-user-id 模式
   */
  _tryWechatLogin() {
    var that = this;

    // 如果已有缓存的 token，先恢复
    var cachedToken = null;
    try {
      cachedToken = wx.getStorageSync('daywork_token');
    } catch (e) { /* ignore */ }
    if (cachedToken) {
      this.globalData.token = cachedToken;
    }

    // 尝试微信登录获取最新 token
    wx.login({
      success: function (res) {
        if (!res.code) return;

        wx.request({
          url: that.globalData.apiBase + '/auth/login',
          method: 'POST',
          data: { code: res.code },
          header: { 'Content-Type': 'application/json' },
          timeout: 10000,
          success: function (loginRes) {
            if (loginRes.statusCode === 200 && loginRes.data && loginRes.data.token) {
              that.globalData.token = loginRes.data.token;
              that.globalData.openid = loginRes.data.openid;
              try {
                wx.setStorageSync('daywork_token', loginRes.data.token);
              } catch (e) { /* ignore */ }
              console.log('[Auth] 微信登录成功');
            }
          },
          fail: function () {
            console.log('[Auth] 微信登录失败，使用 x-user-id 模式');
          },
        });
      },
      fail: function () {
        console.log('[Auth] wx.login 失败，使用 x-user-id 模式');
      },
    });

    // 启动后稍等片刻检查提醒（等登录完成）
    var that2 = this;
    setTimeout(function () { that2._checkReminders(); }, 2500);
  },

  /** 静默检查逾期提醒，设置 TabBar 徽标 */
  _checkReminders: function () {
    var that = this;
    var authHeaders = that.getAuthHeaders();
    // 需要至少有一个身份标识才能发请求
    if (!authHeaders['x-user-id'] && !authHeaders['Authorization']) return;

    wx.request({
      url: that.globalData.apiBase + '/records/reminders',
      method: 'GET',
      header: authHeaders,
      timeout: 8000,
      success: function (res) {
        if (res.statusCode === 200 && res.data) {
          var count = (res.data.overdueCount || 0) + (res.data.upcomingCount || 0);
          that.globalData.reminderCount = count;
          if (count > 0) {
            wx.setTabBarBadge({ index: 0, text: String(count) });
          } else {
            wx.removeTabBarBadge({ index: 0 });
          }
        }
      },
      fail: function () { /* 静默 */ },
    });
  },

  /** 获取当前有效的认证 header */
  getAuthHeaders() {
    var headers = {};
    // 优先使用 JWT token
    if (this.globalData.token) {
      headers['Authorization'] = 'Bearer ' + this.globalData.token;
    }
    // 向后兼容：同时发送 x-user-id
    if (this.globalData.userId) {
      headers['x-user-id'] = this.globalData.userId;
    }
    return headers;
  },
});
