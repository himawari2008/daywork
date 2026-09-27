// 活记 · 职业名片
var api = require('../../utils/api');
var haptic = require('../../utils/haptic');

// Canvas 尺寸（2x 高清）
var W = 375 * 2;
var PAD = 24 * 2;
var R = 16 * 2;

Page({
  data: {
    isDarkTheme: false,
    loading: true,
    portrait: null,
    canvasWidth: 375,
    canvasHeight: 600,
    showTags: true,
    showPeople: true,
    showMood: true,
    showMonths: true,
  },

  onLoad: function () {
    var app = getApp();
    this.setData({
      isDarkTheme: app.globalData._isDark || false,
    });
    this.loadPortrait();
  },

  onShow: function () {
    var app = getApp();
    this.setData({ isDarkTheme: app.globalData._isDark || false });
  },

  // ============================================
  // 数据加载
  // ============================================
  loadPortrait: function () {
    var that = this;
    this.setData({ loading: true });

    api.get('/records/portrait', null, true).then(function (res) {
      if (!res || !res.totalRecords || res.totalRecords === 0) {
        that.setData({ loading: false, portrait: null });
        return;
      }
      that.setData({ portrait: res, loading: false }, function () {
        // 等数据渲染后画 Canvas
        setTimeout(function () { that.drawCard(); }, 300);
      });
    }).catch(function () {
      that.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  // ============================================
  // Canvas 绘制
  // ============================================
  drawCard: function () {
    var that = this;
    var p = this.data.portrait;
    if (!p) return;

    var showTags = this.data.showTags;
    var showPeople = this.data.showPeople;
    var showMood = this.data.showMood;
    var showMonths = this.data.showMonths;

    // 计算高度
    var h = PAD; // top padding
    h += 48 * 2; // header
    h += 20 * 2; // gap
    h += 32 * 2 * 5; // stats (5 rows)
    h += 24 * 2; // gap

    if (showTags && p.topTags && p.topTags.length > 0) {
      h += 32 * 2 + 20 * 2; // section header
      h += 28 * 2; // tag row
      h += 20 * 2; // gap
    }

    if (showPeople && p.topPeople && p.topPeople.length > 0) {
      h += 32 * 2 + 20 * 2;
      h += 28 * 2;
      h += 20 * 2;
    }

    if (showMood && p.moodTotal > 0) {
      h += 32 * 2 + 20 * 2; // header
      h += 20 * 2 * 3; // 3 mood bars
      h += 20 * 2;
    }

    // Status row
    if (p.statusDistribution && p.statusDistribution.length > 0) {
      h += 32 * 2 + 20 * 2;
      h += 28 * 2;
      h += 20 * 2;
    }

    if (showMonths && p.busyMonths && p.busyMonths.length > 0) {
      h += 32 * 2 + 20 * 2;
      h += 60 * 2; // mini bars
      h += 20 * 2;
    }

    h += 16 * 2; // divider gap
    h += 1 * 2;  // divider
    h += 16 * 2;
    h += 24 * 2; // footer
    h += PAD;    // bottom

    var canvasH = Math.max(h / 2, 400);
    this.setData({ canvasHeight: canvasH });

    // 获取 Canvas 上下文（延迟确保 canvas 渲染）
    setTimeout(function () {
      var query = wx.createSelectorQuery();
      query.select('#cardCanvas')
        .fields({ node: true, size: true })
        .exec(function (res) {
          if (!res || !res[0] || !res[0].node) {
            console.error('Canvas node not found');
            return;
          }
          var canvas = res[0].node;
          var ctx = canvas.getContext('2d');
          var dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio;
          canvas.width = W;
          canvas.height = h;
          ctx.scale(dpr, dpr);

          that._renderCard(ctx, p, h, showTags, showPeople, showMood, showMonths);
        });
    }, 200);
  },

  _renderCard: function (ctx, p, H, showTags, showPeople, showMood, showMonths) {
    // ==== 背景 ====
    ctx.fillStyle = '#FAF8F5';
    ctx.beginPath();
    this._roundRect(ctx, 0, 0, W, H, R);
    ctx.fill();

    // 顶部装饰条
    var gradH = ctx.createLinearGradient(0, 0, W, 0);
    gradH.addColorStop(0, '#E8815C');
    gradH.addColorStop(1, '#D4B860');
    ctx.fillStyle = gradH;
    ctx.beginPath();
    this._roundRectTop(ctx, 0, 0, W, 6 * 2, R);
    ctx.fill();

    var y = PAD;
    var textColor = '#2C2C2E';
    var faintColor = '#8E8E93';
    var accentColor = '#E8815C';

    // ==== 标题 ====
    ctx.fillStyle = textColor;
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText('活记 · 职业名片', PAD, y + 36);
    y += 48 * 2;

    ctx.fillStyle = faintColor;
    ctx.font = '22px sans-serif';
    ctx.fillText('Work Identity Card', PAD, y + 22);
    y += 20 * 2 + 16 * 2;

    // ==== 统计卡片 ====
    var cardX = PAD;
    var cardW = W - PAD * 2;
    var cardH = 32 * 2 * 5 + PAD;
    var cardY = y;

    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    this._roundRect(ctx, cardX, cardY, cardW, cardH, 12 * 2);
    ctx.fill();

    // 阴影
    ctx.shadowColor = 'rgba(0,0,0,0.04)';
    ctx.shadowBlur = 8 * 2;
    ctx.shadowOffsetY = 2 * 2;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    var statY = cardY + PAD;
    var statH = 32 * 2;
    var cols = [
      { label: '总记录', value: p.totalRecords + '条', icon: '📊' },
      { label: '活跃天数', value: p.totalDays + '天', icon: '📅' },
      { label: '连续记录', value: p.currentStreak + '天', icon: '🔥' },
      { label: '最长连续', value: p.longestStreak + '天', icon: '⭐' },
      { label: '本周记录', value: p.weekCount + '条', icon: '📆' },
    ];

    for (var i = 0; i < cols.length; i++) {
      var col = cols[i];
      // 图标
      ctx.font = '22px sans-serif';
      ctx.fillText(col.icon, cardX + PAD, statY + statH / 2 + 7);

      // 数值
      ctx.fillStyle = textColor;
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText(col.value, cardX + PAD + 36 * 2, statY + statH / 2 + 9);

      // 标签
      ctx.fillStyle = faintColor;
      ctx.font = '22px sans-serif';
      var valW = ctx.measureText(col.value).width;
      ctx.fillText(col.label, cardX + PAD + 36 * 2 + valW + 10 * 2, statY + statH / 2 + 9);

      statY += statH;
    }

    y = cardY + cardH + 24 * 2;

    // ==== 标签云 ====
    if (showTags && p.topTags && p.topTags.length > 0) {
      ctx.fillStyle = textColor;
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('常用标签', PAD, y + 28);
      y += 32 * 2 + 20 * 2;

      var tagX = PAD;
      var tagY = y;
      var maxTagW = cardW;
      for (var ti = 0; ti < p.topTags.length; ti++) {
        var t = p.topTags[ti];
        var label = t.tag + ' ' + t.count;
        ctx.font = '22px sans-serif';
        var tw = ctx.measureText(label).width + 24 * 2;

        if (tagX + tw > cardX + cardW && tagX > PAD) {
          tagX = PAD;
          tagY += 36 * 2;
        }

        ctx.fillStyle = '#F5F0EB';
        ctx.beginPath();
        this._roundRect(ctx, tagX, tagY, tw, 28 * 2, 14 * 2);
        ctx.fill();

        ctx.fillStyle = accentColor;
        ctx.font = '22px sans-serif';
        ctx.fillText(label, tagX + 12 * 2, tagY + 18 * 2);

        tagX += tw + 8 * 2;
      }
      y = tagY + 36 * 2 + 20 * 2;
    }

    // ==== 人物云 ====
    if (showPeople && p.topPeople && p.topPeople.length > 0) {
      ctx.fillStyle = textColor;
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('常联系的人', PAD, y + 28);
      y += 32 * 2 + 20 * 2;

      var pX = PAD;
      var pY = y;
      for (var pi = 0; pi < p.topPeople.length; pi++) {
        var person = p.topPeople[pi];
        var plabel = person.person + ' ' + person.count + '次';
        ctx.font = '22px sans-serif';
        var pw = ctx.measureText(plabel).width + 24 * 2;

        if (pX + pw > cardX + cardW && pX > PAD) {
          pX = PAD;
          pY += 36 * 2;
        }

        ctx.fillStyle = '#EDF0F5';
        ctx.beginPath();
        this._roundRect(ctx, pX, pY, pw, 28 * 2, 14 * 2);
        ctx.fill();

        ctx.fillStyle = '#4A5C7C';
        ctx.font = '22px sans-serif';
        ctx.fillText(plabel, pX + 12 * 2, pY + 18 * 2);

        pX += pw + 8 * 2;
      }
      y = pY + 36 * 2 + 20 * 2;
    }

    // ==== 心情分布 ====
    if (showMood && p.moodTotal > 0) {
      ctx.fillStyle = textColor;
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('心情分布', PAD, y + 28);
      y += 32 * 2 + 20 * 2;

      var moodBars = [
        { key: 'positive', label: '正向', color: '#7EC89A' },
        { key: 'neutral', label: '中性', color: '#B8B5B0' },
        { key: 'negative', label: '低落', color: '#E8A0A0' },
      ];

      var barW = cardW - 120 * 2;
      for (var mi = 0; mi < moodBars.length; mi++) {
        var mb = moodBars[mi];
        var count = p.moodDistribution[mb.key] || 0;
        var pct = p.moodTotal > 0 ? Math.round(count / p.moodTotal * 100) : 0;
        var filledW = Math.max(4 * 2, barW * count / Math.max(p.moodTotal, 1));

        // 标签
        ctx.fillStyle = textColor;
        ctx.font = '22px sans-serif';
        ctx.fillText(mb.label, PAD, y + 16);

        // 百分比
        ctx.fillStyle = faintColor;
        ctx.font = '20px sans-serif';
        ctx.fillText(pct + '%', PAD + 60 * 2, y + 16);

        // 进度条背景
        ctx.fillStyle = '#EDEBE7';
        ctx.beginPath();
        this._roundRect(ctx, PAD + 100 * 2, y + 4, barW, 12 * 2, 6 * 2);
        ctx.fill();

        // 进度条
        ctx.fillStyle = mb.color;
        ctx.beginPath();
        this._roundRect(ctx, PAD + 100 * 2, y + 4, filledW, 12 * 2, 6 * 2);
        ctx.fill();

        y += 20 * 2;
      }
      y += 20 * 2;
    }

    // ==== 状态分布 ====
    if (p.statusDistribution && p.statusDistribution.length > 0) {
      ctx.fillStyle = textColor;
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('状态分布', PAD, y + 28);
      y += 32 * 2 + 20 * 2;

      var sX = PAD;
      var sY = y;
      var statusColors = {
        '已完成': { bg: '#E8F5E9', text: '#4CAF50' },
        '待办': { bg: '#FFF3E8', text: '#E8815C' },
        '待跟进': { bg: '#FFF9F0', text: '#D4B860' },
      };

      for (var si = 0; si < p.statusDistribution.length; si++) {
        var sd = p.statusDistribution[si];
        var sc = statusColors[sd.status] || { bg: '#F2F1EE', text: faintColor };
        var slabel = (sd.status || '无状态') + ' ' + sd.count;
        ctx.font = '20px sans-serif';
        var sw = ctx.measureText(slabel).width + 24 * 2;

        ctx.fillStyle = sc.bg;
        ctx.beginPath();
        this._roundRect(ctx, sX, sY, sw, 28 * 2, 14 * 2);
        ctx.fill();

        ctx.fillStyle = sc.text;
        ctx.font = '20px sans-serif';
        ctx.fillText(slabel, sX + 12 * 2, sY + 18 * 2);

        sX += sw + 10 * 2;
      }
      y = sY + 32 * 2 + 20 * 2;
    }

    // ==== 繁忙月份 ====
    if (showMonths && p.busyMonths && p.busyMonths.length > 0) {
      ctx.fillStyle = textColor;
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('月度记录', PAD, y + 28);
      y += 32 * 2 + 20 * 2;

      var maxCount = 0;
      for (var bmi = 0; bmi < p.busyMonths.length; bmi++) {
        if (p.busyMonths[bmi].count > maxCount) maxCount = p.busyMonths[bmi].count;
      }

      var barAreaW = cardW;
      var barGap = 6 * 2;
      var barCount = Math.min(p.busyMonths.length, 12);
      var barWidth = (barAreaW - barGap * (barCount - 1)) / barCount;

      for (var bi = 0; bi < barCount; bi++) {
        var bm = p.busyMonths[bi];
        var bH = maxCount > 0 ? Math.max(4 * 2, (bm.count / maxCount) * 60 * 2) : 4 * 2;
        var bx = PAD + bi * (barWidth + barGap);
        var by = y + 60 * 2 - bH;

        // 柱子
        var barGrad = ctx.createLinearGradient(bx, by, bx, y + 60 * 2);
        barGrad.addColorStop(0, accentColor);
        barGrad.addColorStop(1, '#F0C8B0');
        ctx.fillStyle = barGrad;
        ctx.beginPath();
        this._roundRect(ctx, bx, by, barWidth, bH, 4 * 2);
        ctx.fill();

        // 月份标签
        ctx.fillStyle = faintColor;
        ctx.font = '16px sans-serif';
        var mLabel = bm.month.slice(5); // "03"
        var mlW = ctx.measureText(mLabel).width;
        ctx.fillText(mLabel, bx + barWidth / 2 - mlW / 2, y + 60 * 2 + 14 * 2);
      }
      y += 60 * 2 + 20 * 2 + 20 * 2;
    }

    // ==== 分割线 ====
    y += 16 * 2;
    ctx.strokeStyle = '#E5E2DD';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
    y += 16 * 2 + 1;

    // ==== 底部 ====
    ctx.fillStyle = faintColor;
    ctx.font = '20px sans-serif';
    ctx.fillText('活记 · 为生活留痕', PAD, y + 20);

    var dateRange = '';
    if (p.firstRecordDate) {
      dateRange = p.firstRecordDate.slice(0, 7) + ' — ' + new Date().toISOString().slice(0, 7);
    }
    ctx.textAlign = 'right';
    ctx.fillText(dateRange, W - PAD, y + 20);
    ctx.textAlign = 'left';
  },

  // ============================================
  // 工具：Canvas 圆角矩形
  // ============================================
  _roundRect: function (ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  _roundRectTop: function (ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x + r, y, x + w, y, 0);
    ctx.closePath();
  },

  // ============================================
  // 操作
  // ============================================
  onToggleItem: function (e) {
    haptic.light();
    var key = e.currentTarget.dataset.key;
    var data = {};
    data[key] = !this.data[key];
    this.setData(data, this.drawCard.bind(this));
  },

  onRefresh: function () {
    haptic.light();
    this.loadPortrait();
  },

  /** 分享给微信好友 */
  onShareCard: function () {
    var that = this;
    haptic.light();
    wx.showLoading({ title: '生成图片...' });

    var query = wx.createSelectorQuery();
    query.select('#cardCanvas')
      .fields({ node: true, size: true })
      .exec(function (res) {
        if (!res || !res[0] || !res[0].node) {
          wx.hideLoading();
          wx.showToast({ title: '生成失败', icon: 'none' });
          return;
        }
        wx.canvasToTempFilePath({
          canvas: res[0].node,
          success: function (imgRes) {
            wx.hideLoading();
            // 微信小程序分享图片
            wx.showShareImageMenu({
              path: imgRes.tempFilePath,
              success: function () {
                haptic.medium();
              },
              fail: function () {
                // 降级：预览图片
                wx.previewImage({
                  urls: [imgRes.tempFilePath],
                });
              }
            });
          },
          fail: function () {
            wx.hideLoading();
            wx.showToast({ title: '图片生成失败', icon: 'none' });
          }
        });
      });
  },

  /** 保存到相册 */
  onSaveToAlbum: function () {
    var that = this;
    haptic.light();

    // 先检查相册权限
    wx.getSetting({
      success: function (settingRes) {
        var auth = settingRes.authSetting['scope.writePhotosAlbum'];
        if (auth === false) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存名片到相册需要相册权限',
            confirmText: '去设置',
            success: function (m) {
              if (m.confirm) wx.openSetting();
            }
          });
          return;
        }

        wx.showLoading({ title: '保存中...' });
        var query = wx.createSelectorQuery();
        query.select('#cardCanvas')
          .fields({ node: true, size: true })
          .exec(function (res) {
            if (!res || !res[0] || !res[0].node) {
              wx.hideLoading();
              wx.showToast({ title: '生成失败', icon: 'none' });
              return;
            }
            wx.canvasToTempFilePath({
              canvas: res[0].node,
              success: function (imgRes) {
                wx.saveImageToPhotosAlbum({
                  filePath: imgRes.tempFilePath,
                  success: function () {
                    wx.hideLoading();
                    haptic.medium();
                    wx.showToast({ title: '已保存到相册', icon: 'success' });
                  },
                  fail: function (err) {
                    wx.hideLoading();
                    if (err.errMsg.indexOf('auth deny') >= 0) {
                      wx.showToast({ title: '请授权相册权限', icon: 'none' });
                    } else {
                      wx.showToast({ title: '保存失败', icon: 'none' });
                    }
                  }
                });
              },
              fail: function () {
                wx.hideLoading();
                wx.showToast({ title: '图片生成失败', icon: 'none' });
              }
            });
          });
      }
    });
  },

  /** 分享到朋友圈/好友（页面级） */
  onShareAppMessage: function () {
    return {
      title: '这是我的活记职业名片',
      path: '/pages/index/index',
      imageUrl: '/images/share-card.png',
    };
  },
});
