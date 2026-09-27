/**
 * 活记 · 离线录音队列
 *
 * 工地信号差 → 录音先存本地 → 有网后自动上传
 *
 * 设计：
 * - wx.getStorageSync 存储待上传队列
 * - wx.onNetworkStatusChange 监听网络恢复
 * - 每条队列项：{ id, filePath, createdAt, retries }
 * - 上传成功 → 移除；失败 → retries++（最多3次）
 */

var api = require('./api');

/** 存储 key */
var QUEUE_KEY = 'daywork_offline_queue';

/** 最大重试次数 */
var MAX_RETRIES = 3;

/** 网络监听是否已注册 */
var _listening = false;

/**
 * 读取当前队列
 */
function _getQueue() {
  try {
    var raw = wx.getStorageSync(QUEUE_KEY) || '[]';
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

/**
 * 保存队列到本地存储
 */
function _saveQueue(queue) {
  try {
    wx.setStorageSync(QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error('[OfflineQueue] 保存队列失败:', e);
  }
}

/**
 * 检查是否有网络
 */
function isOnline() {
  return new Promise(function (resolve) {
    wx.getNetworkType({
      success: function (res) {
        resolve(res.networkType !== 'none');
      },
      fail: function () {
        resolve(false); // 获取失败 → 假定离线
      }
    });
  });
}

/**
 * 获取队列长度（供 UI 显示待同步数量）
 */
function getPendingCount() {
  return _getQueue().length;
}

/**
 * 将一条录音加入离线队列
 * @param {string} filePath - 录音文件临时路径
 * @returns {string} 队列项 ID
 */
function enqueue(filePath) {
  var queue = _getQueue();
  var item = {
    id: 'off_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    filePath: filePath,
    createdAt: new Date().toISOString(),
    retries: 0,
  };
  queue.push(item);
  _saveQueue(queue);

  // 确保网络监听已注册
  _ensureListening();

  console.log('[OfflineQueue] 已入队, 当前队列长度:', queue.length);
  return item.id;
}

/**
 * 尝试上传队列中的所有录音（按序，每次只发一个避免并发）
 */
function flush() {
  var queue = _getQueue();
  if (queue.length === 0) return Promise.resolve({ synced: 0 });

  // 逐个上传（串行避免服务端压力）
  function processNext(index) {
    if (index >= queue.length) {
      return { synced: index };
    }

    var item = queue[index];

    // 检查音频文件是否还存在
    try {
      var fs = wx.getFileSystemManager();
      fs.accessSync(item.filePath);
    } catch (e) {
      // 文件已被清理 → 移除该条
      console.warn('[OfflineQueue] 音频文件丢失，移除队列项:', item.id);
      var newQueue = _getQueue().filter(function (q) { return q.id !== item.id; });
      _saveQueue(newQueue);
      return processNext(index);
    }

    return api.createRecordFromVoice(item.filePath).then(function (res) {
      var records = [];
      if (res && Array.isArray(res.records)) {
        records = res.records;
      } else if (res && res.id) {
        records = [res];
      }

      if (records.length > 0 && records[0] && records[0].id) {
        // 上传成功 → 从队列移除
        var currentQueue = _getQueue().filter(function (q) { return q.id !== item.id; });
        _saveQueue(currentQueue);
        console.log('[OfflineQueue] 同步成功:', item.id, ', 剩余:', currentQueue.length);
        return processNext(index);
      } else {
        throw new Error('上传返回无效记录');
      }
    }).catch(function (err) {
      console.error('[OfflineQueue] 同步失败:', item.id, err);

      // 超过最大重试次数 → 移除
      if (item.retries >= MAX_RETRIES) {
        console.warn('[OfflineQueue] 超过最大重试，移除:', item.id);
        var currentQueue = _getQueue().filter(function (q) { return q.id !== item.id; });
        _saveQueue(currentQueue);
        return processNext(index);
      }

      // 重试计数+1
      item.retries++;
      var currentQueue = _getQueue();
      var idx = currentQueue.findIndex(function (q) { return q.id === item.id; });
      if (idx >= 0) currentQueue[idx] = item;
      _saveQueue(currentQueue);

      // 暂停重试（网络可能还不稳定），继续下一条
      return processNext(index + 1);
    });
  }

  return processNext(0);
}

/**
 * 注册网络状态监听（仅注册一次）
 * 网络从无到有时 → 自动 flush
 */
function _ensureListening() {
  if (_listening) return;
  _listening = true;

  wx.onNetworkStatusChange(function (res) {
    if (res.isConnected) {
      console.log('[OfflineQueue] 网络恢复，开始同步...');
      flush().then(function (result) {
        if (result.synced > 0) {
          console.log('[OfflineQueue] 同步完成:', result.synced, '条');
        }
      });
    }
  });
}

/**
 * 手动触发同步（用户下拉刷新等场景）
 */
function syncNow() {
  return isOnline().then(function (online) {
    if (online) return flush();
    return { synced: 0 };
  });
}

module.exports = {
  enqueue: enqueue,
  flush: flush,
  syncNow: syncNow,
  getPendingCount: getPendingCount,
  isOnline: isOnline,
};
