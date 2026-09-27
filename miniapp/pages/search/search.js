// ============================================
// 活记 v3 · 搜索页
// 关键词搜索 + 标签/状态/人物筛选
// ============================================

var api = require('../../utils/api');
var util = require('../../utils/util');

Page({
  data: {
    isDarkTheme: false,
    keyword: '',
    results: [],
    loading: false,
    searched: false,
    // 筛选
    filterTag: '',
    filterStatus: '',
    filterGroupId: 'all',
    // 分组列表
    groups: [],
    // 可用筛选选项（从结果中动态收集）
    availableTags: [],
    availableStatuses: ['待办', '已完成', '待跟进'],
  },

  onLoad: function () {
    this.setData({ isDarkTheme: getApp().globalData._isDark || false });
    var that = this;
    // 聚焦搜索框
    setTimeout(function () {
      that.setData({ _focusInput: true });
    }, 300);
    // 加载分组列表
    this._loadGroups();
  },

  _loadGroups: function () {
    var that = this;
    api.getGroups().then(function (res) {
      // 扁平化分组用于筛选芯片
      var flat = [];
      function flatten(list) {
        list.forEach(function (g) {
          if (g.isActive) {
            flat.push({ id: g.id, name: g.name });
            if (g.children && g.children.length > 0) flatten(g.children);
          }
        });
      }
      flatten(res.groups || []);
      that.setData({ groups: flat });
    }).catch(function () {});
  },

  // ============================================
  // 搜索（300ms 防抖）
  // ============================================

  onSearchInput: function (e) {
    var that = this;
    var value = e.detail.value;
    that.setData({ keyword: value });

    if (that._searchTimer) clearTimeout(that._searchTimer);
    if (!value.trim()) {
      that.setData({ results: [], searched: false });
      return;
    }

    that._searchTimer = setTimeout(function () {
      that._doSearch();
    }, 300);
  },

  onClearSearch: function () {
    this.setData({ keyword: '', results: [], searched: false, filterTag: '', filterStatus: '', filterGroupId: 'all' });
  },

  _doSearch: function () {
    var that = this;
    var params = { limit: 100 };

    var keyword = that.data.keyword.trim();
    if (keyword) params.keyword = keyword;
    if (that.data.filterTag) params.tag = that.data.filterTag;
    if (that.data.filterStatus) params.status = that.data.filterStatus;
    if (that.data.filterGroupId && that.data.filterGroupId !== 'all') {
      params.groupId = that.data.filterGroupId;
    }

    that.setData({ loading: true });

    api.searchRecords(params).then(function (res) {
      var records = (res.data || []).map(function (r) {
        r._timeLabel = util.formatTime(r.recordedAt);
        r._highlightSummary = that._highlight(r.summary || r.content, keyword);
        r._highlightContent = that._highlight(r.content, keyword);
        return r;
      });

      // 从结果中收集标签
      var tagSet = {};
      records.forEach(function (r) {
        (r.tags || []).forEach(function (t) { tagSet[t] = true; });
      });

      that.setData({
        results: records,
        loading: false,
        searched: true,
        availableTags: Object.keys(tagSet),
      });
    }).catch(function () {
      that.setData({ loading: false, searched: true });
    });
  },

  // 关键词高亮：返回 [{text, highlight}] 数组供 WXML 分段渲染
  _highlight: function (text, keyword) {
    if (!text || !keyword) return [{ text: text || '', highlight: false }];
    var escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('(' + escaped + ')', 'gi');
    var parts = text.split(re);
    var result = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === '') continue;
      result.push({
        text: parts[i],
        highlight: re.test(parts[i]),
      });
    }
    return result.length > 0 ? result : [{ text: text, highlight: false }];
  },

  // ============================================
  // 筛选
  // ============================================

  onFilterTag: function (e) {
    var tag = e.currentTarget.dataset.tag;
    if (tag === this.data.filterTag) tag = '';
    this.setData({ filterTag: tag });
    if (this.data.keyword.trim() || tag || this.data.filterStatus || this.data.filterGroupId !== 'all') {
      this._doSearch();
    }
  },

  onFilterStatus: function (e) {
    var status = e.currentTarget.dataset.status;
    if (status === this.data.filterStatus) status = '';
    this.setData({ filterStatus: status });
    if (this.data.keyword.trim() || status || this.data.filterTag || this.data.filterGroupId !== 'all') {
      this._doSearch();
    }
  },

  onFilterGroup: function (e) {
    var groupId = e.currentTarget.dataset.group;
    if (groupId === this.data.filterGroupId) groupId = 'all';
    this.setData({ filterGroupId: groupId });
    if (this.data.keyword.trim() || groupId !== 'all' || this.data.filterTag || this.data.filterStatus) {
      this._doSearch();
    }
  },

  // ============================================
  // 导航
  // ============================================

  onTapRecord: function (e) {
    var id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: '/pages/detail/detail?id=' + id,
    });
  },
});
