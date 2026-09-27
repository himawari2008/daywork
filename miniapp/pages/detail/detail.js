// ============================================
// 活记 v2 · 记录详情 — 石子纹理
// 内联编辑 + 心情选择 + 重新AI解析
// ============================================

var api = require('../../utils/api');
var util = require('../../utils/util');
var haptic = require('../../utils/haptic');

/** 解析心情 JSON（兼容旧格式） */
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

Page({
  data: {
    isDarkTheme: false,
    loading: true,
    record: null,
    // 分组列表（v4 新增）
    availableGroups: [],
    // 编辑态控制
    editing: {},
    // 编辑中的值
    editValues: {
      summary: '',
      tags: [],
      people: [],
      numericInfo: {},
      status: null,
      groupId: null,
      isPinned: false,
      // 提醒（Phase 1 新增）
      remindAt: null,
      remindDate: '',
      remindTime: '',
    },
    numericKeys: [],
    // 内联添加标签/人物
    addingTag: false,
    newTag: '',
    addingPerson: false,
    newPerson: '',
    // 保存状态
    saving: false,
    saved: false,
    // 重新解析
    reparsing: false,
    // 今天日期（供 picker min 使用）
    todayStr: '',
  },

  onLoad(options) {
    this.setData({ isDarkTheme: getApp().globalData._isDark || false });
    var id = options.id;
    if (!id || id === 'undefined' || id === 'null') {
      wx.showToast({ title: '记录不存在', icon: 'none' });
      wx.navigateBack();
      return;
    }
    this._id = id;
    this._autoPlayVoice = options.autoPlayVoice === '1';
    this.setData({ todayStr: new Date().toISOString().slice(0, 10) });
    this._loadGroups();
    this.loadRecord();
  },

  /** 从其他页面返回时刷新主题 */
  onShow: function () {
    this.setData({ isDarkTheme: getApp().globalData._isDark || false });
  },

  // ============================================
  // 加载分组（v4 新增）
  // ============================================

  _loadGroups: function () {
    var that = this;
    api.getGroups().then(function (res) {
      var groups = res.groups || [];
      // 刷新选中分组名/颜色（可能 loadRecord 先到达，此时 availableGroups 为空）
      var gid = that.data.editValues.groupId;
      var gname = '未分组';
      var gcolor = '#4A5C7C';
      if (gid) {
        var found = groups.find(function (g) { return g.id === gid; });
        if (found) {
          gname = found.name;
          gcolor = found.color || '#4A5C7C';
        }
      }
      that.setData({
        availableGroups: groups,
        _selectedGroupName: gname,
        _selectedGroupColor: gcolor,
      });
    }).catch(function () {});
  },

  onUnload: function () {
    this._cleanupVoice();
  },

  // ============================================
  // 加载记录
  // ============================================

  loadRecord: function () {
    var that = this;
    that.setData({ loading: true });

    api.getRecordDetail(that._id).then(function (record) {
      record._timeFull = util.formatTime(record.recordedAt);

      var tags = (record.tags || []).slice();
      var people = (record.people || []).slice();
      var numericInfo = record.numericInfo ? JSON.parse(JSON.stringify(record.numericInfo)) : {};

      // 检测语音附件（/uploads/voice/ 前缀）
      var voiceUrl = null;
      var attachments = record.attachments || [];
      for (var i = 0; i < attachments.length; i++) {
        if (attachments[i] && attachments[i].indexOf('/uploads/voice/') !== -1) {
          voiceUrl = attachments[i];
          break;
        }
      }

      var moodObj = parseMood(record.mood);

      // 计算当前分组名和颜色
      var selectedGroupId = record.groupId || null;
      var selectedGroupName = '未分组';
      var selectedGroupColor = '#4A5C7C';
      if (selectedGroupId && that.data.availableGroups.length > 0) {
        var found = that.data.availableGroups.find(function (g) { return g.id === selectedGroupId; });
        if (found) {
          selectedGroupName = found.name;
          selectedGroupColor = found.color || '#4A5C7C';
        }
      }

      // 解析 remindAt（Phase 1 新增）
      var remindAt = record.remindAt || null;
      var remindDate = '';
      var remindTime = '';
      if (remindAt) {
        var d = new Date(remindAt);
        remindDate = d.toISOString().slice(0, 10);
        var hours = String(d.getHours());
        var minutes = String(d.getMinutes());
        if (hours.length < 2) hours = '0' + hours;
        if (minutes.length < 2) minutes = '0' + minutes;
        remindTime = hours + ':' + minutes;
        remindAt = d.getFullYear() + '-' +
          String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0') + ' ' +
          hours + ':' + minutes;
      }

      that.setData({
        loading: false,
        record: record,
        hasVoice: !!voiceUrl,
        voiceUrl: voiceUrl,
        voicePlaying: false,
        _selectedGroupName: selectedGroupName,
        _selectedGroupColor: selectedGroupColor,
        editValues: {
          summary: record.summary || '',
          tags: tags,
          people: people,
          numericInfo: numericInfo,
          status: record.status || null,
          mood: moodObj,
          groupId: record.groupId || null,
          isPinned: record._isPinned || false,
          remindAt: remindAt,
          remindDate: remindDate,
          remindTime: remindTime,
        },
        numericKeys: Object.keys(numericInfo),
      });

      // 自动播放语音（从首页语音图标进入时）
      if (that._autoPlayVoice && voiceUrl) {
        setTimeout(function () { that.onToggleVoice(); }, 500);
        that._autoPlayVoice = false;
      }
    }).catch(function () {
      that.setData({ loading: false });
    });
  },

  // ============================================
  // 原始内容编辑（v5 新增）
  // ============================================

  onEditContent: function () {
    this.setData({ 'editing.content': true });
  },

  onContentInput: function (e) {
    var record = this.data.record;
    record.content = e.detail.value;
    this.setData({ record: record });
  },

  onContentBlur: function () {
    this.setData({ 'editing.content': false });
  },

  // ============================================
  // 摘要编辑
  // ============================================

  onEditField: function (e) {
    var field = e.currentTarget.dataset.field;
    var ed = {};
    ed[field] = true;
    this.setData({ editing: ed });
  },

  onFieldInput: function (e) {
    var field = e.currentTarget.dataset.field;
    var ev = this.data.editValues;
    ev[field] = e.detail.value;
    this.setData({ editValues: ev });
  },

  onFieldBlur: function (e) {
    var field = e.currentTarget.dataset.field;
    var ed = {};
    ed[field] = false;
    this.setData({ editing: ed });
  },

  // ============================================
  // 标签 — 内联添加/删除
  // ============================================

  onShowAddTag: function () {
    this.setData({ addingTag: true, newTag: '' });
  },

  onNewTagInput: function (e) {
    this.setData({ newTag: e.detail.value });
  },

  onConfirmTag: function () {
    var tag = (this.data.newTag || '').trim();
    this.setData({ addingTag: false, newTag: '' });
    if (!tag) return;

    var tags = this.data.editValues.tags;
    if (tags.indexOf(tag) === -1) {
      tags.push(tag);
      var ev = this.data.editValues;
      ev.tags = tags;
      this.setData({ editValues: ev });
    }
  },

  onRemoveTag: function (e) {
    var tag = e.currentTarget.dataset.tag;
    var tags = this.data.editValues.tags.filter(function (t) { return t !== tag; });
    var ev = this.data.editValues;
    ev.tags = tags;
    this.setData({ editValues: ev });
  },

  // ============================================
  // 人物 — 内联添加/删除
  // ============================================

  onShowAddPerson: function () {
    this.setData({ addingPerson: true, newPerson: '' });
  },

  onNewPersonInput: function (e) {
    this.setData({ newPerson: e.detail.value });
  },

  onConfirmPerson: function () {
    var person = (this.data.newPerson || '').trim();
    this.setData({ addingPerson: false, newPerson: '' });
    if (!person) return;

    var people = this.data.editValues.people;
    if (people.indexOf(person) === -1) {
      people.push(person);
      var ev = this.data.editValues;
      ev.people = people;
      this.setData({ editValues: ev });
    }
  },

  onRemovePerson: function (e) {
    var person = e.currentTarget.dataset.person;
    var people = this.data.editValues.people.filter(function (p) { return p !== person; });
    var ev = this.data.editValues;
    ev.people = people;
    this.setData({ editValues: ev });
  },

  // ============================================
  // 数值
  // ============================================

  onEditNumeric: function (e) {
    var key = e.currentTarget.dataset.key;
    var that = this;
    var currentVal = that.data.editValues.numericInfo[key] || '';

    wx.showModal({
      title: '编辑 ' + key,
      editable: true,
      placeholderText: '输入值',
      content: String(currentVal),
      success: function (res) {
        if (res.confirm && res.content) {
          var ev = that.data.editValues;
          ev.numericInfo[key] = res.content.trim();
          that.setData({ editValues: ev, numericKeys: Object.keys(ev.numericInfo) });
        }
      },
    });
  },

  onDeleteNumeric: function (e) {
    var key = e.currentTarget.dataset.key;
    var that = this;
    wx.showModal({
      title: '删除 ' + key + '？',
      content: '将从这条记录中移除该数值',
      confirmColor: '#D08070',
      success: function (res) {
        if (res.confirm) {
          var ev = that.data.editValues;
          delete ev.numericInfo[key];
          that.setData({ editValues: ev, numericKeys: Object.keys(ev.numericInfo) });
          haptic.light();
        }
      },
    });
  },

  onAddNumeric: function () {
    var that = this;
    wx.showModal({
      title: '添加数值',
      editable: true,
      placeholderText: '如：金额、数量、时长',
      success: function (res) {
        if (res.confirm && res.content && res.content.trim()) {
          var key = res.content.trim();
          wx.showModal({
            title: key + ' 的值',
            editable: true,
            placeholderText: '输入值',
            success: function (res2) {
              if (res2.confirm) {
                var ev = that.data.editValues;
                ev.numericInfo[key] = res2.content ? res2.content.trim() : '';
                that.setData({ editValues: ev, numericKeys: Object.keys(ev.numericInfo) });
              }
            },
          });
        }
      },
    });
  },

  // ============================================
  // 心情编辑
  // ============================================

  onEditMood: function () {
    // 如果当前没有心情对象，初始化一个
    var ev = this.data.editValues;
    if (!ev.mood || !ev.mood.label) {
      ev.mood = { label: '', tone: 'neutral', intensity: 2 };
      this.setData({ editValues: ev });
    }
    this.setData({ 'editing.mood': true });
  },

  onMoodLabelInput: function (e) {
    var ev = this.data.editValues;
    if (!ev.mood) ev.mood = { label: '', tone: 'neutral', intensity: 2 };
    ev.mood.label = e.detail.value;
    this.setData({ editValues: ev });
  },

  onMoodBlur: function () {
    this.setData({ 'editing.mood': false });
  },

  onSelectMoodTone: function (e) {
    var tone = e.currentTarget.dataset.tone;
    var ev = this.data.editValues;
    if (!ev.mood) ev.mood = { label: '', tone: 'neutral', intensity: 2 };
    ev.mood.tone = tone;
    // 根据色调自动调整强度
    if (tone === 'positive') ev.mood.intensity = 3;
    else if (tone === 'negative') ev.mood.intensity = 3;
    else ev.mood.intensity = 2;
    this.setData({ editValues: ev });
    haptic.light();
  },

  onClearMood: function () {
    var ev = this.data.editValues;
    ev.mood = null;
    this.setData({ editValues: ev });
    haptic.light();
  },

  // ============================================
  // 提醒设置（Phase 1 新增）
  // ============================================

  onEditRemindAt: function () {
    var ev = this.data.editValues;
    var now = new Date();
    if (!ev.remindDate) {
      ev.remindDate = now.toISOString().slice(0, 10);
    }
    if (!ev.remindTime) {
      var h = String(now.getHours());
      var m = String(now.getMinutes() + 1);
      if (h.length < 2) h = '0' + h;
      if (m.length < 2) m = '0' + m;
      ev.remindTime = h + ':' + m;
    }
    this.setData({ editValues: ev, 'editing.remindAt': true });
  },

  onRemindDateChange: function (e) {
    var ev = this.data.editValues;
    ev.remindDate = e.detail.value;
    this.setData({ editValues: ev });
  },

  onRemindTimeChange: function (e) {
    var ev = this.data.editValues;
    ev.remindTime = e.detail.value;
    this.setData({ editValues: ev });
  },

  onConfirmRemindAt: function () {
    var that = this;
    var ev = that.data.editValues;
    if (!ev.remindDate || !ev.remindTime) return;

    // 拼装本地时间 → UTC ISO 字符串
    var localDate = new Date(ev.remindDate + 'T' + ev.remindTime + ':00');
    var remindISO = localDate.toISOString();
    var hours = localDate.getHours();
    var minutes = localDate.getMinutes();
    var hStr = String(hours); if (hStr.length < 2) hStr = '0' + hStr;
    var mStr = String(minutes); if (mStr.length < 2) mStr = '0' + mStr;
    var displayStr = ev.remindDate + ' ' + hStr + ':' + mStr;

    ev.remindAt = displayStr;
    that.setData({ editValues: ev, 'editing.remindAt': false });
    haptic.light();

    // 即时保存提醒时间
    api.updateRecord(that._id, { remindAt: remindISO }).then(function () {
      wx.showToast({ title: '提醒已设置', icon: 'success', duration: 1000 });
    }).catch(function () {
      wx.showToast({ title: '设置失败', icon: 'none' });
    });
  },

  onCancelRemindEdit: function () {
    // 恢复原值
    var ev = this.data.editValues;
    if (!ev.remindAt) { ev.remindDate = ''; ev.remindTime = ''; }
    this.setData({ 'editing.remindAt': false });
  },

  onClearRemindAt: function () {
    var that = this;
    wx.showModal({
      title: '清除提醒？',
      confirmText: '清除',
      confirmColor: '#D08070',
      success: function (res) {
        if (res.confirm) {
          var ev = that.data.editValues;
          ev.remindAt = null;
          ev.remindDate = '';
          ev.remindTime = '';
          that.setData({ editValues: ev });
          haptic.light();
          api.updateRecord(that._id, { remindAt: null }).then(function () {
            wx.showToast({ title: '提醒已清除', icon: 'success', duration: 1000 });
          }).catch(function () {
            wx.showToast({ title: '操作失败', icon: 'none' });
          });
        }
      },
    });
  },

  // ============================================
  // 状态
  // ============================================

  onSelectStatus: function (e) {
    var status = e.currentTarget.dataset.status;
    if (status === '') status = null;
    var ev = this.data.editValues;
    ev.status = status;
    this.setData({ editValues: ev });
  },

  // ============================================
  // 重新AI解析（新增）
  // ============================================

  onReparse: function () {
    var that = this;
    wx.showModal({
      title: '重新AI解析？',
      content: '将用原始内容重新生成摘要、标签、心情等信息',
      confirmText: '重新解析',
      success: function (res) {
        if (res.confirm) {
          that.setData({ reparsing: true });
          wx.showLoading({ title: 'AI 重新理解中...' });

          var content = that.data.record.content;
          // 使用纯解析端点：AI 解析但不创建数据库记录
          api.parseContent(content).then(function (parsed) {
            wx.hideLoading();
            var moodObj = parseMood(parsed.mood);
            that.setData({
              reparsing: false,
              editValues: {
                summary: parsed.summary || '',
                tags: (parsed.tags || []).slice(),
                people: (parsed.people || []).slice(),
                numericInfo: parsed.numericInfo ? JSON.parse(JSON.stringify(parsed.numericInfo)) : {},
                status: parsed.status || null,
                mood: moodObj,
                groupId: that.data.editValues.groupId,
                isPinned: that.data.editValues.isPinned,
                remindAt: that.data.editValues.remindAt,
                remindDate: that.data.editValues.remindDate,
                remindTime: that.data.editValues.remindTime,
              },
              numericKeys: Object.keys(parsed.numericInfo || {}),
            });

            wx.showToast({ title: 'AI 已重新理解', icon: 'success' });
            haptic.light();
          }).catch(function () {
            that.setData({ reparsing: false });
            wx.hideLoading();
            wx.showToast({ title: '解析失败，请重试', icon: 'none' });
          });
        }
      },
    });
  },

  // ============================================
  // 分组选择（v5 改为确认态+点击展开）
  // ============================================

  onToggleGroupEdit: function () {
    this.setData({ 'editing.group': !this.data.editing.group });
  },

  onSelectGroup: function (e) {
    var groupId = e.currentTarget.dataset.groupId;
    if (groupId === '') groupId = null;
    var ev = this.data.editValues;
    ev.groupId = groupId;

    // 更新显示的分组名和颜色
    if (groupId) {
      var found = this.data.availableGroups.find(function (g) { return g.id === groupId; });
      if (found) {
        this.setData({
          _selectedGroupName: found.name,
          _selectedGroupColor: found.color || '#4A5C7C',
        });
      }
    } else {
      this.setData({
        _selectedGroupName: '未分组',
        _selectedGroupColor: '#4A5C7C',
      });
    }

    // 关闭选择面板
    this.setData({ 'editing.group': false });

    // 调用 API 移动记录到分组
    var that = this;
    api.moveRecordToGroup(that._id, groupId).then(function () {
      that.setData({ editValues: ev });
      haptic.light();
    }).catch(function () {
      that.setData({ editValues: ev });
    });
  },

  // ============================================
  // 置顶切换（v4 新增）
  // ============================================

  onTogglePin: function () {
    var that = this;
    var ev = that.data.editValues;
    ev.isPinned = !ev.isPinned;
    that.setData({ editValues: ev });
    haptic.light();

    // 置顶切换即时保存
    api.updateRecord(that._id, { isPinned: ev.isPinned }).then(function () {
      wx.showToast({ title: ev.isPinned ? '已置顶' : '已取消置顶', icon: 'none', duration: 1000 });
    }).catch(function () {
      // 失败时回滚状态
      ev.isPinned = !ev.isPinned;
      that.setData({ editValues: ev });
    });
  },

  // ============================================
  // 保存 & 删除
  // ============================================

  onSave: function () {
    var that = this;
    if (that.data.saving || that.data.saved) return;

    var ev = that.data.editValues;
    that.setData({ saving: true });

    api.updateRecord(that._id, {
      content: that.data.record.content || null,
      summary: ev.summary || null,
      tags: ev.tags,
      people: ev.people,
      numericInfo: ev.numericInfo,
      status: ev.status || null,
      mood: ev.mood ? JSON.stringify(ev.mood) : null,
      isPinned: ev.isPinned,
    }).then(function () {
      haptic.medium();

      that.setData({ saving: false, saved: true });

      // 保存成功动画：按钮变绿 + 对勾
      setTimeout(function () {
        wx.navigateBack();
      }, 800);
    }).catch(function () {
      that.setData({ saving: false });
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    });
  },

  // ============================================
  // 分享
  // ============================================

  onShareRecord: function () {
    // 触发微信原生分享面板
    wx.showShareMenu({
      withShareTicket: false,
      menus: ['shareAppMessage', 'shareTimeline'],
    });
    wx.showToast({ title: '点击右上角 ··· 分享', icon: 'none', duration: 2000 });
  },

  /** 微信原生分享 — 分享给朋友 */
  onShareAppMessage: function () {
    var record = this.data.record;
    var editValues = this.data.editValues;
    var summary = editValues.summary || record.summary || record.content || '活记';
    var tags = (editValues.tags || []).join('、');
    return {
      title: tags ? summary + ' [' + tags + ']' : summary,
      path: '/pages/detail/detail?id=' + (record.id || ''),
      imageUrl: '/images/share-card.png',
    };
  },

  /** 微信原生分享 — 分享到朋友圈 */
  onShareTimeline: function () {
    var record = this.data.record;
    var editValues = this.data.editValues;
    return {
      title: editValues.summary || record.summary || record.content || '来自活记',
      query: 'id=' + (record.id || ''),
      imageUrl: '/images/share-card.png',
    };
  },

  onDelete: function () {
    var that = this;
    wx.showModal({
      title: '确认删除？',
      content: '删除后无法恢复',
      confirmColor: '#D08070',
      success: function (res) {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          api.deleteRecord(that._id).then(function () {
            wx.hideLoading();
            haptic.light();
            wx.showToast({ title: '已删除', icon: 'success' });
            setTimeout(function () {
              wx.navigateBack();
            }, 800);
          }).catch(function () {
            wx.hideLoading();
          });
        }
      },
    });
  },

  // ============================================
  // 语音回放（对标声间 App）
  // ============================================

  /** 播放/暂停原始录音 */
  onToggleVoice: function () {
    var that = this;
    if (that.data.voicePlaying) {
      that._stopVoice();
      return;
    }

    // 构建完整音频 URL
    var voiceUrl = that.data.voiceUrl;
    if (!voiceUrl) return;

    var baseUrl = '';
    try {
      baseUrl = (getApp && getApp().globalData && getApp().globalData.apiBase) || '';
      // apiBase 是 /api 结尾，去掉 /api 部分
      baseUrl = baseUrl.replace(/\/api$/, '');
    } catch (e) { /* ignore */ }

    var fullUrl = baseUrl + voiceUrl;

    var audioCtx = wx.createInnerAudioContext();
    audioCtx.src = fullUrl;
    audioCtx.autoplay = true;

    audioCtx.onPlay(function () {
      that.setData({ voicePlaying: true });
    });

    audioCtx.onEnded(function () {
      that.setData({ voicePlaying: false });
      audioCtx.destroy();
    });

    audioCtx.onStop(function () {
      that.setData({ voicePlaying: false });
      audioCtx.destroy();
    });

    audioCtx.onError(function (err) {
      console.log('[Voice] 播放失败:', err);
      wx.showToast({ title: '音频无法播放', icon: 'none' });
      that.setData({ voicePlaying: false });
      audioCtx.destroy();
    });

    that._voiceAudio = audioCtx;
  },

  /** 停止播放 */
  _stopVoice: function () {
    if (this._voiceAudio) {
      this._voiceAudio.stop();
      this._voiceAudio = null;
    }
    this.setData({ voicePlaying: false });
  },

  /** 页面卸载时清理音频 */
  _cleanupVoice: function () {
    if (this._voiceAudio) {
      this._voiceAudio.destroy();
      this._voiceAudio = null;
    }
  },
});
