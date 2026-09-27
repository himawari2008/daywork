'use strict';
/**
 * verify-group.js — 实时「核心 + 稳定性」回归
 *
 * 核心 6 条：最易错的分组消歧用例，必须 6/6 通过。
 * 稳定性：再跑一遍核心 6 条，验证分组决策确定性（不随调用抖动），需 6/6 通过。
 *
 * 用法：node scripts/grouping/verify-group.js   （需先启动后端）
 */
const {
  USER_ID,
  createRecord,
  resolveRecordGroup,
  assertEqual,
  cleanup,
} = require('./_lib');

// 6 条最易错的消歧用例
const CORE = [
  { content: '发了工资转理财', expected: '理财投资' },
  { content: '跟供应商打款', expected: '客户跟进' },
  { content: '下单买了瓷砖', expected: '采购·建材' },
  { content: '火锅店聚餐', expected: '餐饮' },
  { content: '甲方要求改图纸', expected: '设计' },
  { content: '跟闺蜜约饭', expected: '社交朋友' },
];

async function runCorePass(label) {
  let pass = 0;
  for (const t of CORE) {
    const rec = await createRecord(t.content, USER_ID);
    const name = await resolveRecordGroup(rec, USER_ID);
    assertEqual(name, t.expected, `[${label}] ${t.content}`);
    pass++;
  }
  return pass;
}

(async () => {
  try {
    console.log('=== verify-group: 实时核心 + 稳定性回归 ===');
    const corePass = await runCorePass('core');
    console.log(`核心 ${corePass}/${CORE.length} ✅`);

    const stablePass = await runCorePass('stability');
    console.log(`稳定性 ${stablePass}/${CORE.length} ✅`);

    if (corePass !== CORE.length || stablePass !== CORE.length) {
      throw new Error('分组回归未达 6/6 + 6/6');
    }
    console.log('ALL GREEN ✅');
    process.exit(0);
  } catch (e) {
    console.error('FAILED ❌', e.message);
    process.exit(1);
  } finally {
    await cleanup(USER_ID);
  }
})();
