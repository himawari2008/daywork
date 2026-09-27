'use strict';
/**
 * reclassify-check.js — 实时「错分修正 + 幂等」回归
 *
 * 场景：
 *   1) 创建 A「请客吃火锅」→ 正确归「餐饮」；
 *   2) 故意把 A 移动到「采购·建材」（模拟历史错分 / 用户手动误操作）；
 *   3) 创建 B「买了瓷砖装修」→ 正确归「采购·建材」；
 *   4) 调用 reclassify(scope:'all') 全量重归类；
 *   5) 断言 A 被修正回「餐饮」、B 保持「采购·建材」（幂等、不破坏本来正确者）。
 *
 * 用法：node scripts/grouping/reclassify-check.js   （需先启动后端）
 */
const {
  USER_ID,
  createRecord,
  getRecord,
  getGroupsMap,
  resolveRecordGroup,
  patchJson,
  postJson,
  assertEqual,
  cleanup,
} = require('./_lib');

(async () => {
  try {
    console.log('=== reclassify-check: 错分修正 + 幂等 ===');

    // 1) A 正确归 餐饮
    const a = await createRecord('请客吃火锅', USER_ID);
    const a0 = await resolveRecordGroup(a, USER_ID);
    assertEqual(a0, '餐饮', 'A 初始（火锅→餐饮）');

    // 3) B 正确归 采购·建材（先建 B，确保「采购·建材」分组已存在，便于下面查 groupId）
    const b = await createRecord('买了瓷砖装修', USER_ID);
    const b0 = await resolveRecordGroup(b, USER_ID);
    assertEqual(b0, '采购·建材', 'B 初始（瓷砖→采购·建材）');

    // 2) 故意把 A 移到「采购·建材」模拟错分
    const groups = await getGroupsMap(USER_ID);
    let wrongId = null;
    for (const id of Object.keys(groups)) {
      if (groups[id] === '采购·建材') wrongId = id;
    }
    if (!wrongId) throw new Error('未找到「采购·建材」分组');
    await patchJson(`/api/records/${a.id}/group`, { groupId: wrongId }, USER_ID);
    const aMoved = await resolveRecordGroup(await getRecord(a.id, USER_ID), USER_ID);
    assertEqual(aMoved, '采购·建材', 'A 被人为错分到 采购·建材');

    // 4) 全量重归类
    await postJson('/api/records/reclassify', { scope: 'all' }, USER_ID);
    await new Promise((r) => setTimeout(r, 600));

    // 5) 断言
    const aAfter = await resolveRecordGroup(await getRecord(a.id, USER_ID), USER_ID);
    const bAfter = await resolveRecordGroup(await getRecord(b.id, USER_ID), USER_ID);
    assertEqual(aAfter, '餐饮', 'A 重归类后修正回 餐饮');
    assertEqual(bAfter, '采购·建材', 'B 重归类后保持 采购·建材（幂等）');

    console.log('错分修正 + 幂等 ✅ ALL GREEN');
    process.exit(0);
  } catch (e) {
    console.error('FAILED ❌', e.message);
    process.exit(1);
  } finally {
    await cleanup(USER_ID);
  }
})();
