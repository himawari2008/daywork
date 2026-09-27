// ============================================
// 活记 · 涂鸦画板
// Canvas 2D 自由绘制 → 导出图片
// ============================================

Page({
  data: {
    colors: ['#2D2B28', '#E8815C', '#4A5C7C', '#6EA880', '#C8A060', '#8B7EC8', '#D4B860', '#D08070'],
    currentColor: '#2D2B28',
    sizes: [
      { value: 2, dot: 8 },
      { value: 4, dot: 14 },
      { value: 8, dot: 22 },
    ],
    currentSize: 4,
    isDarkTheme: false,
    eraserMode: false,
  },

  // 绘画状态
  _drawing: false,
  _lastX: 0,
  _lastY: 0,
  _paths: [],       // 所有路径 [{ points, color, size, isEraser }]
  _currentPath: null,
  _canvas: null,
  _ctx: null,
  _dpr: 1,

  onReady: function () {
    this.setData({ isDarkTheme: getApp().globalData._isDark || false });
    this._initCanvas();
  },

  _initCanvas: function () {
    var that = this;
    var query = wx.createSelectorQuery();
    query.select('#doodleCanvas')
      .fields({ node: true, size: true })
      .exec(function (res) {
        if (!res || !res[0]) return;
        var canvas = res[0].node;
        var ctx = canvas.getContext('2d');
        var dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio;

        canvas.width = res[0].width * dpr;
        canvas.height = res[0].height * dpr;
        ctx.scale(dpr, dpr);

        that._canvas = canvas;
        that._ctx = ctx;
        that._dpr = dpr;

        // 白底
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, res[0].width, res[0].height);
      });
  },

  // 颜色
  onPickColor: function (e) {
    this.setData({ currentColor: e.currentTarget.dataset.color, eraserMode: false });
  },

  // 粗细
  onPickSize: function (e) {
    this.setData({ currentSize: e.currentTarget.dataset.size });
  },

  // 橡皮擦
  onToggleEraser: function () {
    this.setData({ eraserMode: !this.data.eraserMode });
  },

  // 撤销
  onUndo: function () {
    if (this._paths.length === 0) return;
    this._paths.pop();
    this._redrawAll();
  },

  // 清空
  onClearCanvas: function () {
    var that = this;
    wx.showModal({
      title: '清空画布？',
      content: '清除后将无法恢复',
      confirmColor: '#D08070',
      success: function (res) {
        if (res.confirm) {
          that._paths = [];
          that._redrawAll();
        }
      },
    });
  },

  // 触摸事件
  onTouchStart: function (e) {
    this._drawing = true;
    var touch = e.touches[0];
    this._lastX = touch.x;
    this._lastY = touch.y;

    this._currentPath = {
      points: [{ x: touch.x, y: touch.y }],
      color: this.data.eraserMode ? '#FFFFFF' : this.data.currentColor,
      size: this.data.currentSize,
      isEraser: this.data.eraserMode,
    };
  },

  onTouchMove: function (e) {
    if (!this._drawing || !this._ctx) return;
    var touch = e.touches[0];
    var ctx = this._ctx;

    ctx.beginPath();
    ctx.moveTo(this._lastX, this._lastY);
    ctx.lineTo(touch.x, touch.y);
    ctx.strokeStyle = this.data.eraserMode ? '#FFFFFF' : this.data.currentColor;
    ctx.lineWidth = this.data.currentSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    this._lastX = touch.x;
    this._lastY = touch.y;
    this._currentPath.points.push({ x: touch.x, y: touch.y });
  },

  onTouchEnd: function () {
    if (!this._drawing) return;
    this._drawing = false;
    if (this._currentPath && this._currentPath.points.length > 0) {
      this._paths.push(this._currentPath);
    }
    this._currentPath = null;
  },

  // 重绘所有路径
  _redrawAll: function () {
    if (!this._ctx) return;
    var ctx = this._ctx;
    var width = this._canvas.width / this._dpr;
    var height = this._canvas.height / this._dpr;

    // 清空
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    // 重绘每条路径
    var paths = this._paths;
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      if (p.points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(p.points[0].x, p.points[0].y);
      for (var j = 1; j < p.points.length; j++) {
        ctx.lineTo(p.points[j].x, p.points[j].y);
      }
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  },

  // 取消
  onCancel: function () {
    wx.navigateBack();
  },

  // 完成 → 导出图片到首页
  onDone: function () {
    var that = this;
    if (!this._canvas) {
      wx.navigateBack();
      return;
    }

    wx.showLoading({ title: '导出中...' });

    wx.canvasToTempFilePath({
      canvas: that._canvas,
      success: function (res) {
        wx.hideLoading();
        // 通过 getCurrentPages 将图片路径传回首页
        var pages = getCurrentPages();
        var prevPage = pages[pages.length - 2];
        if (prevPage && prevPage.data) {
          var images = prevPage.data.previewImages || [];
          images.push(res.tempFilePath);
          if (images.length > 9) images = images.slice(-9);
          prevPage.setData({ previewImages: images });
        }
        wx.navigateBack();
      },
      fail: function () {
        wx.hideLoading();
        wx.showToast({ title: '导出失败', icon: 'none' });
      },
    });
  },
});
