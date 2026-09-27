// ============================================
// 活记 · 导入页
// 批量文档/图片导入：输入 → AI解析 → 审核 → 保存
// ============================================

var api = require('../../utils/api.js');
var haptic = require('../../utils/haptic.js');

Page({
  data: {
    isDarkTheme: false,      // 主题（onLoad 从 globalData 读取）
    step: 'input',           // 'input' | 'review' | 'done'
    currentTab: 'file',      // 'file' | 'paste' | 'csv'

    // CSV 标准导入
    csvText: '',
    csvFileName: '',
    csvEnhance: false,
    csvImporting: false,
    csvResult: null,          // { success, message }

    // 文件
    selectedFile: null,      // { name, size, path, _sizeLabel }
    // 粘贴
    pasteText: '',
    // 补充说明（v4 新增）
    supplementNote: '',
    // 解析
    parsing: false,
    canParse: false,
    error: '',

    // 审核
    documentSummary: '',
    records: [],             // [{...ParsedRecord, _checked, _expanded, _index}]
    checkedCount: 0,
    saving: false,

    // 完成
    savedCount: 0,
    autoCompleted: 0,
  },

  /** 从 globalData 读主题（无 onLoad，在页面首次渲染前通过 onShow 补） */
  onLoad: function () {
    this.setData({ isDarkTheme: getApp().globalData._isDark || false });
  },

  // ========== Tab 切换 ==========
  onSwitchTab: function (e) {
    var tab = e.currentTarget.dataset.tab;
    var canParse = false;
    if (tab === 'file') canParse = !!this.data.selectedFile;
    else if (tab === 'paste') canParse = this.data.pasteText.trim().length > 0;
    else if (tab === 'csv') canParse = this.data.csvText.trim().length > 0;
    this.setData({
      currentTab: tab,
      error: '',
      canParse: canParse,
    });
  },

  // ========== 文件选择 ==========
  onSelectFile: function () {
    var that = this;
    // 支持从聊天记录选择文件 + 拍照/相册选择图片
    wx.showActionSheet({
      itemList: ['从聊天记录选择文件', '拍照或选择图片'],
      success: function (res) {
        if (res.tapIndex === 0) {
          // 文本文件
          wx.chooseMessageFile({
            type: 'file',
            count: 1,
            success: function (result) {
              var f = result.tempFiles[0];
              that._setFile(f);
            },
            fail: function () {
              // 用户取消，忽略
            },
          });
        } else if (res.tapIndex === 1) {
          // 图片（拍照或相册）
          wx.chooseImage({
            count: 1,
            sizeType: ['compressed'],
            sourceType: ['album', 'camera'],
            success: function (result) {
              var path = result.tempFilePaths[0];
              // 构造一个类 file 对象
              that.setData({
                selectedFile: {
                  name: '图片 ' + new Date().toLocaleTimeString(),
                  size: result.tempFiles ? (result.tempFiles[0] && result.tempFiles[0].size) || 0 : 0,
                  path: path,
                  _sizeLabel: '图片文件',
                  _isImage: true,
                },
                canParse: true,
                error: '',
              });
            },
          });
        }
      },
    });
  },

  _setFile: function (f) {
    var sizeLabel = '';
    if (f.size < 1024) {
      sizeLabel = f.size + ' B';
    } else if (f.size < 1024 * 1024) {
      sizeLabel = (f.size / 1024).toFixed(1) + ' KB';
    } else {
      sizeLabel = (f.size / (1024 * 1024)).toFixed(1) + ' MB';
    }

    this.setData({
      selectedFile: {
        name: f.name,
        size: f.size,
        path: f.path,
        _sizeLabel: sizeLabel,
        _isImage: false,
      },
      canParse: true,
      error: '',
    });
  },

  onRemoveFile: function () {
    this.setData({ selectedFile: null, canParse: false });
  },

  // ========== 文本粘贴 ==========
  onPasteInput: function (e) {
    var text = e.detail.value;
    this.setData({
      pasteText: text,
      canParse: text.trim().length > 0,
      error: '',
    });
  },

  /** 补充说明输入（v4 新增） */
  onSupplementInput: function (e) {
    this.setData({ supplementNote: e.detail.value });
  },

  // ========== 触发解析 ==========
  onParse: function () {
    if (!this.data.canParse || this.data.parsing) return;

    if (this.data.currentTab === 'file') {
      this._parseFile();
    } else {
      this._parsePaste();
    }
  },

  _parseFile: function () {
    var file = this.data.selectedFile;
    if (!file) return;

    this.setData({ parsing: true, error: '' });
    wx.showLoading({ title: file._isImage ? 'AI 识别图片中...' : 'AI 分析文件中...', mask: true });

    var that = this;
    api.importUpload(file.path).then(function (res) {
      wx.hideLoading();
      that._enterReview(res.documentSummary, res.records, res.isImage);
    }).catch(function (err) {
      wx.hideLoading();
      // 提取可读的错误信息
      var msg = '解析失败，请重试';
      if (err && err.message) {
        msg = err.message;
      } else if (err && err.errMsg) {
        msg = err.errMsg;
      }
      // 网络错误特别提示
      if (msg.indexOf('request:fail') >= 0 || msg.indexOf('timeout') >= 0) {
        msg = '网络连接失败，请确认：\n1. 手机和电脑在同一 Wi-Fi\n2. 服务器已启动(127.0.0.1:3000)\n3. 小程序已关闭域名校验';
      }
      that.setData({
        parsing: false,
        error: msg,
      });
    });
  },

  _parsePaste: function () {
    var text = this.data.pasteText.trim();
    if (!text) return;

    // 如果有补充说明，拼接到文本前面
    var note = this.data.supplementNote.trim();
    if (note) {
      text = '【补充说明】' + note + '\n\n' + text;
    }

    this.setData({ parsing: true, error: '' });
    wx.showLoading({ title: 'AI 分析中...', mask: true });

    var that = this;
    api.importPreview(text).then(function (res) {
      wx.hideLoading();
      that._enterReview(res.documentSummary, res.records, false);
    }).catch(function (err) {
      wx.hideLoading();
      var msg = '解析失败，请重试';
      if (err && err.message) msg = err.message;
      else if (err && err.errMsg) msg = err.errMsg;
      that.setData({
        parsing: false,
        error: msg,
      });
    });
  },

  _enterReview: function (summary, records, fromImage) {
    if (!records || records.length === 0) {
      this.setData({
        parsing: false,
        error: '未识别出任何记录。请确认：\n'
          + (fromImage ? '• 图片是否清晰\n• 文字是否可辨认\n' : '• 文档格式是否正确\n• 内容是否包含可识别的时间/事件信息'),
      });
      return;
    }

    var enriched = records.map(function (r, i) {
      // 携带 AI 建议的分组名（后端 findOrCreate 时使用）
      var suggestedGroupName = null;
      if (r.suggestedGroup && r.suggestedGroup.name) {
        suggestedGroupName = r.suggestedGroup.name;
      }
      // 解析心情（新格式 JSON {label, tone, intensity} / 旧格式纯文本）
      var moodLabel = '';
      if (r.mood) {
        if (typeof r.mood === 'object' && r.mood.label) {
          moodLabel = r.mood.label;
        } else {
          moodLabel = String(r.mood);
        }
      }
      return {
        summary: r.summary || '(无摘要)',
        tags: r.tags || [],
        people: r.people || [],
        numericInfo: r.numericInfo || {},
        status: r.status || null,
        mood: r.mood || null,
        recordedAt: r.recordedAt || null,
        // 分组字段
        groupId: null,
        suggestedGroupName: suggestedGroupName,
        _checked: true,
        _expanded: false,
        _index: i,
        _moodLabel: moodLabel,
      };
    });

    this.setData({
      step: 'review',
      parsing: false,
      documentSummary: summary,
      records: enriched,
      checkedCount: enriched.length,
      error: '',
    });

    haptic.light();
  },

  // ========== 审核操作 ==========

  onToggleCheck: function (e) {
    var idx = e.currentTarget.dataset.index;
    var records = this.data.records;
    records[idx]._checked = !records[idx]._checked;
    var checkedCount = records.filter(function (r) { return r._checked; }).length;
    this.setData({ records: records, checkedCount: checkedCount });
  },

  onToggleExpand: function (e) {
    var idx = e.currentTarget.dataset.index;
    var key = 'records[' + idx + ']._expanded';
    var records = this.data.records;
    records[idx]._expanded = !records[idx]._expanded;
    this.setData({ records: records });
  },

  onEditField: function (e) {
    var idx = e.currentTarget.dataset.index;
    var field = e.currentTarget.dataset.field;
    var value = e.detail.value;
    var key = 'records[' + idx + '].' + field;
    this.setData({ [key]: value });
  },

  onDeleteRecord: function (e) {
    var idx = e.currentTarget.dataset.index;
    var records = this.data.records.filter(function (_, i) { return i !== idx; });
    // 重新分配索引
    records = records.map(function (r, i) { r._index = i; return r; });
    var checkedCount = records.filter(function (r) { return r._checked; }).length;
    this.setData({ records: records, checkedCount: checkedCount });
  },

  // ========== 保存 ==========

  onSave: function () {
    var checkedRecords = this.data.records.filter(function (r) { return r._checked; });
    if (checkedRecords.length === 0) return;
    if (this.data.saving) return;

    this.setData({ saving: true });

    var payload = {
      documentSummary: this.data.documentSummary,
      records: checkedRecords.map(function (r) {
        // 心情序列化：MoodInfo 对象 → JSON 字符串
        var moodVal = r.mood;
        if (moodVal && typeof moodVal === 'object') {
          moodVal = JSON.stringify(moodVal);
        }
        return {
          summary: r.summary,
          tags: r.tags,
          people: r.people,
          numericInfo: r.numericInfo,
          status: r.status,
          mood: moodVal,
          recordedAt: r.recordedAt,
          groupId: r.groupId || null,
          suggestedGroupName: r.suggestedGroupName || null,
        };
      }),
      fileName: this.data.selectedFile ? this.data.selectedFile.name : undefined,
    };

    var that = this;
    api.importSave(payload).then(function (res) {
      that.setData({
        step: 'done',
        savedCount: res.savedCount || checkedRecords.length,
        autoCompleted: res.autoCompletedCount || 0,
        saving: false,
      });
      haptic.medium();
    }).catch(function (err) {
      that.setData({ saving: false });
      wx.showToast({ title: err.message || '保存失败', icon: 'none', duration: 2500 });
    });
  },

  // ========== CSV 标准导入 ==========

  onCsvInput: function (e) {
    var text = e.detail.value;
    this.setData({ csvText: text, csvResult: null });
  },

  /** 选择 CSV 文件并读取内容 */
  onPickCsvFile: function () {
    var that = this;
    wx.chooseMessageFile({
      type: 'file',
      count: 1,
      success: function (res) {
        var file = res.tempFiles[0];
        var fs = wx.getFileSystemManager();
        try {
          var content = fs.readFileSync(file.path, 'utf-8');
          that.setData({
            csvText: content,
            csvFileName: file.name,
            csvResult: null,
          });
        } catch (e) {
          wx.showToast({ title: '文件读取失败，请粘贴内容', icon: 'none', duration: 2000 });
        }
      },
    });
  },

  onCsvEnhanceToggle: function (e) {
    this.setData({ csvEnhance: e.detail.value });
  },

  /** 执行 CSV 导入 */
  onCsvImport: function () {
    var that = this;
    var csvText = that.data.csvText.trim();
    if (!csvText) return;
    if (that.data.csvImporting) return;

    that.setData({ csvImporting: true, csvResult: null, error: '' });
    wx.showLoading({ title: '导入中...', mask: true });

    api.importCsv(csvText, that.data.csvEnhance).then(function (res) {
      wx.hideLoading();
      that.setData({
        csvImporting: false,
        csvResult: {
          success: true,
          message: res.savedCount ? '成功导入 ' + res.savedCount + ' 条记录' : (res.message || '导入完成'),
        },
        csvText: '', // 清空
      });
      haptic.medium();
    }).catch(function (err) {
      wx.hideLoading();
      var msg = '导入失败';
      if (err && err.message) msg = err.message;
      else if (err && err.errMsg) msg = err.errMsg;
      that.setData({
        csvImporting: false,
        csvResult: { success: false, message: msg },
      });
    });
  },

  // ========== 完成跳转 ==========
  onViewAll: function () {
    wx.switchTab({ url: '/pages/index/index' });
  },
  onGoHome: function () {
    wx.switchTab({ url: '/pages/index/index' });
  },
});
