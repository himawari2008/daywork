// ============================================
// 活记 v3 · AI 对话页
// 基于自己的记录进行自然语言问答
// 参考：微信聊天UI + 飞书智能伙伴
// ============================================

var api = require('../../utils/api');
var haptic = require('../../utils/haptic');

/** 默认快捷提问（可自定义，存 daywork_chat_quick_questions） */
var DEFAULT_QUICK_QUESTIONS = [
  '今天记了什么？',
  '还有哪些待办没完成？',
  '帮我写今日总结',
  '帮我写一份周报',
  '最近心情怎么样？',
  '最近跟谁联系最多？',
];

Page({
  data: {
    isDarkTheme: false,
    messages: [],       // { role: 'user'|'ai', content, time }
    inputText: '',
    thinking: false,
    // 快捷提问（输入框上方常驻 chips，长按可编辑/删除，+ 号新增）
    quickQuestions: [],
  },

  onLoad: function () {
    this.setData({ isDarkTheme: getApp().globalData._isDark || false });
    this._loadQuickQuestions();
    // 从本地存储恢复对话历史
    var savedMessages = [];
    try {
      savedMessages = wx.getStorageSync('daywork_chat_messages') || [];
    } catch (e) {
      // ignore
    }

    if (savedMessages.length > 0) {
      this.setData({ messages: savedMessages });
      // 恢复历史对话后滚动到底部
      var that = this;
      setTimeout(function () {
        that._scrollToBottom();
      }, 300);
    } else {
      // 首次进入：显示欢迎消息
      var greeting = this._getTimeGreeting();
      this.setData({
        messages: [{
          role: 'ai',
          content: greeting + '，我是活记 AI。你可以问我关于你工作记录的任何问题——比如"这周做了什么"、"帮我写周报"、"还有哪些事没做完"。',
          time: this._now(),
        }],
      });
    }
  },

  /** 从其他页面返回时刷新主题 */
  onShow: function () {
    this.setData({ isDarkTheme: getApp().globalData._isDark || false });
  },

  _getTimeGreeting: function () {
    var h = new Date().getHours();
    if (h < 6) return '夜深了';
    if (h < 9) return '早上好';
    if (h < 12) return '上午好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  },

  _now: function () {
    var d = new Date();
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  },

  // ============================================
  // 输入
  // ============================================

  onInputChange: function (e) {
    this.setData({ inputText: e.detail.value });
  },

  // ============================================
  // 发送消息
  // ============================================

  onSend: function () {
    var that = this;
    var text = that.data.inputText.trim();
    if (!text || that.data.thinking) return;

    // 添加用户消息
    var userMsg = { role: 'user', content: text, time: that._now() };
    var messages = that.data.messages.concat([userMsg]);

    that.setData({
      messages: messages,
      inputText: '',
      thinking: true,
    });
    that._saveMessages();

    // 滚动到底部
    that._scrollToBottom();

    // 调用 AI
    api.chatWithAI(text).then(function (res) {
      var rawAnswer = res.answer || '抱歉，暂时无法回答。';
      var aiMsg = {
        role: 'ai',
        content: that._formatMarkdown(rawAnswer),
        time: that._now(),
        relevantCount: res.relevantCount || 0,
        /** 相关记录列表（可点击跳转详情） */
        relevantRecords: res.relevantRecords || [],
      };
      that.setData({
        messages: that.data.messages.concat([aiMsg]),
        thinking: false,
      });
      that._saveMessages();
      that._scrollToBottom();
      haptic.light();
    }).catch(function () {
      that.setData({
        messages: that.data.messages.concat([{
          role: 'ai',
          content: '抱歉，网络不太好，请重试。',
          time: that._now(),
        }]),
        thinking: false,
      });
      that._saveMessages();
    });
  },

  // ============================================
  // 快捷提问 — 输入框上方常驻 chips
  // 点按=发送 · 长按=编辑/删除 · +号=新增 · 本地持久化
  // ============================================

  /** 读取自定义快捷提问，无则用默认 */
  _loadQuickQuestions: function () {
    var stored = null;
    try {
      stored = wx.getStorageSync('daywork_chat_quick_questions');
    } catch (e) { /* ignore */ }
    var list = (stored && stored.length > 0) ? stored : DEFAULT_QUICK_QUESTIONS.slice();
    this.setData({ quickQuestions: list });
  },

  _saveQuickQuestions: function () {
    try {
      wx.setStorageSync('daywork_chat_quick_questions', this.data.quickQuestions);
    } catch (e) { /* ignore */ }
  },

  onQuickQuestion: function (e) {
    var q = e.currentTarget.dataset.question;
    this.setData({ inputText: q });
    var that = this;
    // 自动发送
    setTimeout(function () {
      that.onSend();
    }, 100);
  },

  /** 长按 chip → 编辑 / 删除 */
  onQuickQuestionLongPress: function (e) {
    var that = this;
    var index = e.currentTarget.dataset.index;
    var q = that.data.quickQuestions[index];
    if (q == null) return;

    haptic.light();
    wx.showActionSheet({
      itemList: ['编辑', '删除'],
      success: function (res) {
        if (res.tapIndex === 0) {
          // 编辑
          wx.showModal({
            title: '编辑快捷提问',
            editable: true,
            content: q,
            placeholderText: '输入常用的问题',
            success: function (modalRes) {
              if (modalRes.confirm && modalRes.content && modalRes.content.trim()) {
                var list = that.data.quickQuestions.slice();
                list[index] = modalRes.content.trim();
                that.setData({ quickQuestions: list });
                that._saveQuickQuestions();
              }
            },
          });
        } else if (res.tapIndex === 1) {
          // 删除
          var list = that.data.quickQuestions.filter(function (_, i) { return i !== index; });
          that.setData({ quickQuestions: list });
          that._saveQuickQuestions();
        }
      },
    });
  },

  /** + 号 → 新增自定义快捷提问 */
  onAddQuickQuestion: function () {
    var that = this;
    haptic.light();
    wx.showModal({
      title: '新增快捷提问',
      editable: true,
      placeholderText: '输入常用的问题，如：这个月花了多少钱',
      success: function (res) {
        if (res.confirm && res.content && res.content.trim()) {
          var list = that.data.quickQuestions.concat([res.content.trim()]);
          that.setData({ quickQuestions: list });
          that._saveQuickQuestions();
        }
      },
    });
  },

  // ============================================
  // 滚动
  // ============================================

  _scrollToBottom: function () {
    var that = this;
    setTimeout(function () {
      that.setData({ _scrollToView: 'msg-' + (that.data.messages.length - 1) });
    }, 100);
  },

  /** 点击 AI 回答中的记录卡片 → 跳转详情 */
  onTapRelevantRecord: function (e) {
    var id = e.currentTarget.dataset.id;
    if (id) {
      wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
    }
  },

  // ============================================
  // 长按消息 → 复制 / 删除
  // ============================================

  onLongPressMsg: function (e) {
    var that = this;
    var index = e.currentTarget.dataset.index;
    var msg = that.data.messages[index];
    if (!msg) return;

    haptic.light();

    var itemList = ['复制全文'];
    if (msg.role === 'user') {
      itemList.push('删除这条');
    }

    wx.showActionSheet({
      itemList: itemList,
      success: function (res) {
        if (res.tapIndex === 0) {
          // 复制全文
          wx.setClipboardData({
            data: msg.content,
            success: function () {
              wx.showToast({ title: '已复制', icon: 'success', duration: 1000 });
            },
          });
        } else if (res.tapIndex === 1 && msg.role === 'user') {
          // 删除这条消息
          that._deleteMessage(index);
        }
      },
    });
  },

  /** 删除单条消息 + 后续AI回复（成对删除） */
  _deleteMessage: function (index) {
    var messages = this.data.messages;
    // 删除用户消息，以及紧随其后的AI回复
    var deleteCount = 1;
    if (index + 1 < messages.length && messages[index + 1].role === 'ai') {
      deleteCount = 2;
    }
    messages.splice(index, deleteCount);
    this.setData({ messages: messages });
    this._saveMessages();
    wx.showToast({ title: '已删除', icon: 'none', duration: 1000 });
  },

  /** 清除全部对话 */
  onClearChat: function () {
    var that = this;
    wx.showModal({
      title: '清除对话',
      content: '将清空所有对话历史，无法恢复',
      confirmText: '确认清除',
      confirmColor: '#D08070',
      success: function (res) {
        if (res.confirm) {
          that.setData({ messages: [], thinking: false });
          try { wx.removeStorageSync('daywork_chat_messages'); } catch (e) { /* ignore */ }
          wx.showToast({ title: '对话已清除', icon: 'success' });

          // 重新显示欢迎消息
          var greeting = that._getTimeGreeting();
          that.setData({
            messages: [{
              role: 'ai',
              content: greeting + '，我是活记 AI。你可以问我关于你工作记录的任何问题。',
              time: that._now(),
            }],
          });
        }
      },
    });
  },

  /**
   * 简单 Markdown → 文本预处理
   * 把 AI 返回的文本中 **bold** 和 - list 转为纯文本格式
   */
  _formatMarkdown: function (text) {
    if (!text) return text;
    // 保留原始换行
    return text
      .replace(/\*\*(.+?)\*\*/g, '「$1」')
      .replace(/^\- /gm, '· ')
      .replace(/^(\d+)\. /gm, '$1. ');
  },

  /** 持久化消息到本地存储（最多保留 50 条） */
  _saveMessages: function () {
    try {
      var messages = this.data.messages.slice(-50);
      wx.setStorageSync('daywork_chat_messages', messages);
    } catch (e) {
      // 存储空间不足，静默失败
    }
  },
});
