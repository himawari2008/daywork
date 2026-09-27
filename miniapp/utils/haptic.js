/**
 * 活记 · 分级震动封装 (haptic)
 * ----------------------------------------
 * 微信振动只有 vibrateShort(15ms) 与 vibrateLong(400ms) 两档,
 * 且 type(light/medium/heavy) 仅 iOS 生效、安卓忽略。
 * 这里统一收口:
 *   - 只用 vibrateShort + type,不用 400ms 长震(太吓人)
 *   - fail 静默降级(iOS 关触感 / 安卓不支持时不报错、不阻塞业务)
 * 各页面用 haptic.light() 等替代裸 wx.vibrateShort,语义一目了然。
 */

// 内部:安全触发一次短震,失败静默
function buzz(type) {
  try {
    wx.vibrateShort({
      type: type,
      // 失败(未授权触感/机型不支持)时什么都不做,靠页面 :active 视觉兜底
      fail: function () {}
    });
  } catch (e) {
    // 极端环境下 API 不存在,忽略
  }
}

module.exports = {
  // 轻反馈:点击、选中、切换、小操作成功
  light: function () { buzz('light'); },

  // 中反馈:保存成功、解锁成功、导入成功
  medium: function () { buzz('medium'); },

  // 成功反馈:语义别名,等价 medium(记录存好等正向结果)
  success: function () { buzz('medium'); },

  // 警告反馈:密码错误、删除前确认等需警觉的操作
  warning: function () { buzz('warning'); },

  // 强反馈:逾期提醒等强提示 —— 单次 heavy,不再叠 400ms 长震
  heavy: function () { buzz('heavy'); }
};
