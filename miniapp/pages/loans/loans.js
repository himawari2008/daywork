// 活记 · 借支管理
var api = require('../../utils/api');
var haptic = require('../../utils/haptic');
var app = getApp();

Page({
  data: {
    isDarkTheme: false,
    tab: 'summary',       // summary | detail
    summary: [],          // 汇总列表
    detail: [],           // 明细列表
    loading: true,

    // 弹窗
    showModal: false,
    editingId: null,
    formPerson: '',
    formAmount: '',
    formDirection: 'lend',
    formReason: '',
  },

  onLoad: function () {
    try { this.setData({ isDarkTheme: app.globalData.isDarkTheme || false }); } catch (e) { /* ignore */ }
    this.loadData();
  },

  onShow: function () {
    try { this.setData({ isDarkTheme: app.globalData.isDarkTheme || false }); } catch (e) { /* ignore */ }
    this.loadData();
  },

  onPullDownRefresh: function () {
    this.loadData().then(function () { wx.stopPullDownRefresh(); });
  },

  loadData: function () {
    var that = this;
    this.setData({ loading: true });

    return Promise.all([
      api.getLoansSummary(),
      api.getLoans(),
    ]).then(function (res) {
      var summary = (res[0] && res[0].summary) || [];
      var detail = (res[1] || []).map(function (item) {
        item._timeLabel = item.recordedAt
          ? item.recordedAt.slice(0, 10) + ' ' + item.recordedAt.slice(11, 16)
          : '';
        return item;
      });

      that.setData({
        summary: summary,
        detail: detail,
        loading: false,
      });
    }).catch(function () {
      that.setData({ loading: false });
    });
  },

  // ============================================
  // Tab 切换
  // ============================================
  onSwitchTab: function (e) {
    haptic.light();
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  // ============================================
  // 汇总页：点击人物 → 筛选该人物的明细
  // ============================================
  onTapPerson: function (e) {
    haptic.light();
    var person = e.currentTarget.dataset.person;
    // 切换到明细 tab，筛选该人物
    var that = this;
    this.setData({ tab: 'detail', loading: true });
    api.getLoans({ person: person }).then(function (loans) {
      var list = (loans || []).map(function (item) {
        item._timeLabel = item.recordedAt
          ? item.recordedAt.slice(0, 10) + ' ' + item.recordedAt.slice(11, 16)
          : '';
        return item;
      });
      that.setData({ detail: list, loading: false });
    }).catch(function () {
      that.setData({ loading: false });
    });
  },

  // ============================================
  // 明细页：点击 → 标记还款 / 恢复未还
  // ============================================
  onTapLoan: function (e) {
    haptic.light();
    var that = this;
    var id = e.currentTarget.dataset.id;
    var loan = this.data.detail.find(function (l) { return l.id === id; });
    if (!loan) return;

    var isRepaid = loan.status === 'repaid';
    var title = isRepaid ? '恢复为未还？' : '确认已还款？';
    var confirmText = isRepaid ? '恢复未还' : '已还';

    wx.showModal({
      title: title,
      content: loan.person + ' · ' + loan.amount + '元 · ' + (loan.reason || ''),
      confirmText: confirmText,
      confirmColor: isRepaid ? '#4A5C7C' : '#7EC89A',
      success: function (m) {
        if (!m.confirm) return;
        var newStatus = isRepaid ? 'pending' : 'repaid';
        api.updateLoan(id, { status: newStatus }).then(function () {
          haptic.medium();
          wx.showToast({ title: isRepaid ? '已恢复未还' : '已标记还款', icon: 'success' });
          that.loadData();
        }).catch(function () {
          wx.showToast({ title: '操作失败', icon: 'none' });
        });
      }
    });
  },

  /** 长按删除 */
  onLongPressLoan: function (e) {
    haptic.warning();
    var that = this;
    var id = e.currentTarget.dataset.id;
    var loan = this.data.detail.find(function (l) { return l.id === id; });
    if (!loan) return;

    wx.showModal({
      title: '删除借支记录',
      content: loan.person + ' · ' + loan.amount + '元',
      confirmText: '删除',
      confirmColor: '#E05A44',
      success: function (m) {
        if (!m.confirm) return;
        api.deleteLoan(id).then(function () {
          haptic.warning();
          wx.showToast({ title: '已删除', icon: 'none' });
          that.loadData();
        }).catch(function () {
          wx.showToast({ title: '删除失败', icon: 'none' });
        });
      }
    });
  },

  // ============================================
  // 新增/编辑弹窗
  // ============================================
  onShowAdd: function () {
    haptic.light();
    this.setData({
      showModal: true,
      editingId: null,
      formPerson: '',
      formAmount: '',
      formDirection: 'lend',
      formReason: '',
    });
  },

  onHideModal: function () {
    this.setData({ showModal: false });
  },

  onFormInput: function (e) {
    var field = e.currentTarget.dataset.field;
    var data = {};
    data['form' + field.charAt(0).toUpperCase() + field.slice(1)] = e.detail.value;
    this.setData(data);
  },

  onToggleDir: function (e) {
    haptic.light();
    this.setData({ formDirection: e.currentTarget.dataset.dir });
  },

  onSaveLoan: function () {
    var that = this;
    var person = (this.data.formPerson || '').trim();
    var amount = parseFloat(this.data.formAmount);

    if (!person) { wx.showToast({ title: '请输入借支对象', icon: 'none' }); return; }
    if (!amount || amount <= 0) { wx.showToast({ title: '请输入有效金额', icon: 'none' }); return; }

    var data = {
      person: person,
      amount: amount,
      direction: this.data.formDirection,
      reason: (this.data.formReason || '').trim() || undefined,
    };

    var promise;
    if (this.data.editingId) {
      promise = api.updateLoan(this.data.editingId, data);
    } else {
      promise = api.createLoan(data);
    }

    promise.then(function () {
      haptic.medium();
      wx.showToast({ title: that.data.editingId ? '已更新' : '已记录', icon: 'success' });
      that.setData({ showModal: false });
      that.loadData();
    }).catch(function (err) {
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' });
    });
  },
});
