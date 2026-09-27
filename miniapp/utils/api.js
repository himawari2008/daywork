// ============================================
// 活记 API 工具层
// 封装 wx.request，自动带 x-user-id header
// ============================================

var app = getApp();

/**
 * 基础请求
 * @param {string} url    - API 路径，如 '/records'
 * @param {object} options - { method, data, silent }
 */
function request(url, options) {
  var opts = options || {};
  var method = opts.method || 'GET';
  var data = opts.data || {};
  var silent = opts.silent || false;

  return new Promise(function (resolve, reject) {
    // 获取认证 headers（优先 JWT → 降级 x-user-id）
    var authHeaders = {};
    try {
      if (app && app.getAuthHeaders) {
        authHeaders = app.getAuthHeaders();
      }
    } catch (e) { /* ignore */ }

    // 如果 app 不可用，回退到直接读 storage
    if (!authHeaders['x-user-id'] && !authHeaders['Authorization']) {
      try {
        var userId = wx.getStorageSync('daywork_userId') || '';
        if (userId) authHeaders['x-user-id'] = userId;
      } catch (e) { /* ignore */ }
    }

    wx.request({
      url: (app && app.globalData && app.globalData.apiBase || 'http://127.0.0.1:3000/api') + url,
      method: method,
      data: data,
      header: Object.assign({
        'Content-Type': 'application/json',
      }, authHeaders),
      timeout: 10000, // 10s 超时，后端不在时不卡页面
      success: function (res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          var msg = (res.data && res.data.message) || '请求失败';
          if (!silent) {
            wx.showToast({ title: msg, icon: 'none', duration: 2000 });
          }
          reject(new Error(msg));
        }
      },
      fail: function (err) {
        if (!silent) {
          wx.showToast({ title: '网络开小差了', icon: 'none', duration: 2000 });
        }
        reject(err);
      },
    });
  });
}

// ============================================
// 快捷方法
// ============================================

var api = {
  get: function (url, data, silent) {
    return request(url, { method: 'GET', data: data, silent: silent });
  },
  post: function (url, data, silent) {
    return request(url, { method: 'POST', data: data, silent: silent });
  },
  patch: function (url, data, silent) {
    return request(url, { method: 'PATCH', data: data, silent: silent });
  },
  del: function (url, data, silent) {
    return request(url, { method: 'DELETE', data: data, silent: silent });
  },

  // —— 记录 API ——

  /** 创建记录：发送原始文本，后端 AI 解析后返回完整记录 */
  createRecord: function (content, recordedAt, attachments) {
    return api.post('/records', {
      content: content,
      recordedAt: recordedAt || undefined,
      attachments: attachments || undefined,
    });
  },

  /**
   * 批量创建记录：智能检测多人/多任务 → 自动拆分为多条
   * 返回 { records: [...], isBatch: true|false }
   * isBatch=true 时 records.length >= 2
   */
  createBatch: function (content, recordedAt, attachments) {
    return api.post('/records/batch', {
      content: content,
      recordedAt: recordedAt || undefined,
      attachments: attachments || undefined,
    });
  },

  /** 查询记录列表 */
  getRecords: function (params) {
    return api.get('/records', params);
  },

  /** 查询单条记录 */
  getRecordDetail: function (id) {
    return api.get('/records/' + id);
  },

  /** 修改记录（用户手动修正 AI 解析字段） */
  updateRecord: function (id, data) {
    return api.patch('/records/' + id, data);
  },

  /** 删除记录 */
  deleteRecord: function (id) {
    return api.del('/records/' + id);
  },

  /** 批量删除记录 */
  deleteRecords: function (ids) {
    return api.post('/records/batch-delete', { ids: ids }, true);
  },

  /** 删除全部记录（危险操作） */
  deleteAllRecords: function () {
    return api.del('/records/all', null, true);
  },

  /** 重命名标签：在所有记录中替换 */
  renameTag: function (oldName, newName) {
    return api.patch('/records/tags/rename', { oldName: oldName, newName: newName });
  },

  /** 删除标签：从所有记录中移除 */
  removeTag: function (tagName) {
    return api.post('/records/tags/remove', { tagName: tagName });
  },

  /** 获取统计概览 */
  getStats: function () {
    return api.get('/records/stats', null, true); // 静默：统计失败不打扰用户
  },

  /** 日历热力图：指定年月的每日记录数 */
  getCalendar: function (year, month) {
    return api.get('/records/calendar', { year: year, month: month }, true);
  },

  /** 心情河流：最近 N 天的心情概览 */
  getMoodRiver: function (days) {
    return api.get('/records/mood-river', { days: days || 7 }, true);
  },

  /** 连续记录天数 */
  getStreak: function () {
    return api.get('/records/streak', null, true);
  },

  // —— 搜索 API ——

  /** 搜索记录：关键词 + 标签筛选 + 状态筛选 */
  searchRecords: function (params) {
    return api.get('/records', params, true);
  },

  // —— AI 对话 & 总结 API ——

  /** AI 对话：问自己的记录数据 */
  chatWithAI: function (question) {
    return api.post('/records/chat', { question: question });
  },

  /** AI 总结：生成周报/月报 */
  getSummary: function (period) {
    return api.post('/records/summary', { period: period || 'week' });
  },

  /** 导出记录：CSV 或 Markdown 格式 */
  exportRecords: function (format) {
    return api.get('/records/export', { format: format || 'csv' });
  },

  // —— 提醒 API ——

  /** 获取提醒列表（超期 + 即将到期），静默模式不弹 toast */
  getReminders: function () {
    return api.get('/records/reminders', null, true);
  },

  // —— 回忆 API ——

  /** 「往日回顾」：随机返回一条历史记录 */
  getMemory: function () {
    return api.get('/records/memory', null, true);
  },

  /** 「往年今日」：同月同日的历史记录（不同年份） */
  getOnThisDay: function (dateStr) {
    return api.get('/records/on-this-day', { date: dateStr }, true);
  },

  // —— 导入 API ——

  /** 导入预览：粘贴文本 → AI 解析 */
  importPreview: function (content) {
    return api.post('/records/import/preview', { content: content });
  },

  /** 导入预览：上传文件（文本/图片）→ AI 解析 */
  importUpload: function (filePath) {
    var authHeaders = {};
    try { if (app && app.getAuthHeaders) authHeaders = app.getAuthHeaders(); } catch (e) { /* ignore */ }
    if (!authHeaders['x-user-id'] && !authHeaders['Authorization']) {
      try { var uid = wx.getStorageSync('daywork_userId') || ''; if (uid) authHeaders['x-user-id'] = uid; } catch (e) { /* ignore */ }
    }

    return new Promise(function (resolve, reject) {
      wx.uploadFile({
        url: (app && app.globalData && app.globalData.apiBase || 'http://127.0.0.1:3000/api') + '/records/import/preview/file',
        filePath: filePath,
        name: 'file',
        header: authHeaders,
        timeout: 120000, // 2 分钟超时 — 图片上传 + AI 视觉解析需要时间
        success: function (res) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(res.data)); }
            catch (e) { reject(new Error('响应格式异常')); }
          } else {
            var msg = '文件上传失败';
            try {
              var errData = JSON.parse(res.data);
              msg = errData.message || msg;
            } catch (e) { /* ignore */ }
            reject(new Error(msg));
          }
        },
        fail: function (err) {
          if (err.errMsg && err.errMsg.indexOf('timeout') >= 0) {
            reject(new Error('请求超时，AI 正在识别图片，请稍后重试'));
          } else {
            reject(err);
          }
        },
      });
    });
  },

  /** 导入保存：审核确认后批量保存 */
  importSave: function (data) {
    return api.post('/records/import/save', data);
  },

  // —— 语音 API ——

  /** 语音创建记录：上传音频文件，后端 STT + AI 解析 */
  createRecordFromVoice: function (filePath) {
    var authHeaders = {};
    try { if (app && app.getAuthHeaders) authHeaders = app.getAuthHeaders(); } catch (e) { /* ignore */ }
    if (!authHeaders['x-user-id'] && !authHeaders['Authorization']) {
      try { var uid = wx.getStorageSync('daywork_userId') || ''; if (uid) authHeaders['x-user-id'] = uid; } catch (e) { /* ignore */ }
    }

    return new Promise(function (resolve, reject) {
      wx.uploadFile({
        url: (app && app.globalData && app.globalData.apiBase || 'http://127.0.0.1:3000/api') + '/records/voice',
        filePath: filePath,
        name: 'audio',
        header: authHeaders,
        success: function (res) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              var data = JSON.parse(res.data);
              resolve(data);
            } catch (e) {
              reject(new Error('响应格式异常'));
            }
          } else {
            var msg = '识别失败';
            try {
              var errData = JSON.parse(res.data);
              msg = errData.message || msg;
            } catch (e) { /* ignore */ }
            reject(new Error(msg));
          }
        },
        fail: function (err) {
          reject(err);
        },
      });
    });
  },

  // —— 分组 API ——

  /** 获取所有分组（含记录数统计） */
  getGroups: function () {
    return api.get('/groups', null, true);
  },

  /** 创建分组 */
  createGroup: function (data) {
    return api.post('/groups', data);
  },

  /** 更新分组 */
  updateGroup: function (id, data) {
    return api.patch('/groups/' + id, data);
  },

  /** 删除分组 */
  deleteGroup: function (id) {
    return api.del('/groups/' + id);
  },

  /** 纯解析：AI 解析文本但不保存，用于重新解析 */
  parseContent: function (content) {
    return api.post('/records/parse', { content: content });
  },

  /** 移动记录到分组（groupId=null 取消分组） */
  moveRecordToGroup: function (recordId, groupId) {
    return api.patch('/records/' + recordId + '/group', { groupId: groupId });
  },

  /**
   * 智能整理：对未分组（或全部）记录重新 AI 归类
   * @param {object} opts - { scope: 'ungrouped' | 'all' }
   */
  reclassifyRecords: function (opts) {
    return api.post('/records/reclassify', { scope: (opts && opts.scope) || 'ungrouped' }, true);
  },

  // ============================================
  // —— 借支 API ——
  // ============================================

  /** 新增一笔借支 */
  createLoan: function (data) {
    return api.post('/loans', data);
  },

  /** 查询借支列表（支持 ?person= + ?status= ） */
  getLoans: function (params) {
    return api.get('/loans', params, true);
  },

  /** 按人物汇总借支余额 */
  getLoansSummary: function () {
    return api.get('/loans/summary', null, true);
  },

  /** 查询单条借支 */
  getLoanDetail: function (id) {
    return api.get('/loans/' + id, null, true);
  },

  /** 更新借支（标记还款等） */
  updateLoan: function (id, data) {
    return api.patch('/loans/' + id, data);
  },

  /** 删除借支 */
  deleteLoan: function (id) {
    return api.del('/loans/' + id, null, true);
  },

  /**
   * CSV 标准导入
   * @param {string} csvText - CSV 文件内容
   * @param {boolean} enhance - 是否 AI 增强（补标签/分组/状态）
   */
  importCsv: function (csvText, enhance) {
    return api.post('/records/import/csv', { csvText: csvText, enhance: !!enhance }, true);
  },

  /** 混合发送：先上传图片，再合并文字创建记录 */
  createRecordMixed: function (content, imagePaths) {
    var authHeaders = {};
    try { if (app && app.getAuthHeaders) authHeaders = app.getAuthHeaders(); } catch (e) { /* ignore */ }
    if (!authHeaders['x-user-id'] && !authHeaders['Authorization']) {
      try { var uid = wx.getStorageSync('daywork_userId') || ''; if (uid) authHeaders['x-user-id'] = uid; } catch (e) { /* ignore */ }
    }

    return new Promise(function (resolve, reject) {
      // 如果有图片，先上传所有图片
      var uploadPromises = [];
      if (imagePaths && imagePaths.length > 0) {
        imagePaths.forEach(function (path) {
          uploadPromises.push(new Promise(function (resUp, rejUp) {
            wx.uploadFile({
              url: (app && app.globalData && app.globalData.apiBase || 'http://127.0.0.1:3000/api') + '/records/import/preview/file',
              filePath: path,
              name: 'file',
              header: authHeaders,
              timeout: 120000,
              success: function (res) {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                  try {
                    var data = JSON.parse(res.data);
                    resUp(data);
                  } catch (e) { rejUp(new Error('图片解析响应异常')); }
                } else { rejUp(new Error('图片上传失败')); }
              },
              fail: function (err) { rejUp(err); },
            });
          }));
        });
      }

      // 并行上传所有图片
      Promise.all(uploadPromises).then(function (imageResults) {
        // 合并图片识别文字 + 用户输入文字 → 给 DeepSeek 解析
        var mergedContent = content || '';

        // 汇总图片识别出的所有文字
        if (imageResults.length > 0) {
          var imageTexts = [];
          var allRecords = [];
          imageResults.forEach(function (r) {
            if (r.documentSummary) imageTexts.push(r.documentSummary);
            if (r.records) {
              r.records.forEach(function (rec) {
                allRecords.push(rec.summary);
              });
            }
          });
          if (imageTexts.length > 0) {
            mergedContent = '图片内容：' + imageTexts.join('；') + (mergedContent ? '；补充说明：' + mergedContent : '');
          }
          if (allRecords.length > 0 && !mergedContent) {
            mergedContent = allRecords.join('；');
          }
        }

        // 如果没有有效内容，返回错误
        if (!mergedContent || !mergedContent.trim()) {
          reject(new Error('图片中未识别到文字内容'));
          return;
        }

        // 调用文字创建 API
        api.createRecord(mergedContent).then(function (record) {
          resolve(record);
        }).catch(function (err) {
          reject(err);
        });
      }).catch(function (err) {
        reject(err);
      });
    });
  },
};

module.exports = api;
