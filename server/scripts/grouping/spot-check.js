'use strict';
/**
 * spot-check.js — 实时 15 条抽样回归
 *
 * 跨 24 个候选分组的代表性抽样，每条创建后解析分组名并比对预期。
 * 用 GET /api/groups（带重试）规避「新建分组提交竞态」。
 *
 * 用法：node scripts/grouping/spot-check.js   （需先启动后端）
 */
const {
  USER_ID,
  createRecord,
  resolveRecordGroup,
  assertEqual,
  cleanup,
} = require('./_lib');

const CASES = [
  { content: '出了份报价单', expected: '报价' },
  { content: '报名了线上课程', expected: '学习成长' },
  { content: '买了瓷砖和卫浴', expected: '采购·建材' },
  { content: '工地开工', expected: '装修施工' },
  { content: '画了张效果图', expected: '设计' },
  { content: '周一开了周会', expected: '会议沟通' },
  { content: '定投了点基金', expected: '理财投资' },
  { content: '打车去高铁站', expected: '出行交通' },
  { content: '出差去外地', expected: '外出' },
  { content: '收到尾款', expected: '财务' },
  { content: '跟供应商谈合作', expected: '客户跟进' },
  { content: '写周报', expected: '工作办公' },
  { content: '晚上吃火锅', expected: '餐饮' },
  { content: '晨跑锻炼', expected: '运动健康' },
  { content: '去医院挂号', expected: '健康医疗' },
];

(async () => {
  try {
    console.log(`=== spot-check: 实时 ${CASES.length} 条抽样回归 ===`);
    let pass = 0;
    for (const t of CASES) {
      const rec = await createRecord(t.content, USER_ID);
      const name = await resolveRecordGroup(rec, USER_ID);
      assertEqual(name, t.expected, t.content);
      pass++;
      console.log(`  ✓ ${t.content} → ${name}`);
    }
    console.log(`${pass}/${CASES.length} ✅`);
    if (pass !== CASES.length) throw new Error('spot-check 未全绿');
    console.log('ALL GREEN ✅');
    process.exit(0);
  } catch (e) {
    console.error('FAILED ❌', e.message);
    process.exit(1);
  } finally {
    await cleanup(USER_ID);
  }
})();
