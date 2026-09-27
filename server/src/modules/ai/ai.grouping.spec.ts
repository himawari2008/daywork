import { AiService, GROUP_TAXONOMY } from './ai.service';

/**
 * 分组关键词匹配回归测试（单元测试，无需启动服务）
 *
 * 决策规则（见 records.service.preferKeywordOverFlatAi / ai.service.fallbackGroup）：
 * 1. 分组决策【只看正文】，AI 自带的 tags 不回灌关键词匹配；
 * 2. 正文命中关键词即权威，覆盖 AI 任意分组建议；
 * 3. 数组顺序即优先级：理财投资 → 财务 → 客户跟进（同分时靠前者胜）。
 *
 * 该 fixture 是「分组决策」的契约：任何对 GROUP_TAXONOMY 或打分逻辑的改动，
 * 只要改变了下列任一映射，测试都会失败，从而防止分组回归。
 */

interface Case {
  content: string;
  expected: string | null;
}

const CASES: Case[] = [
  // —— 每类一个代表词（覆盖 24 个候选分组）——
  { content: '出了份报价单', expected: '报价' },
  { content: '采购了一批办公物资', expected: '采购' },
  { content: '买了瓷砖和卫浴', expected: '采购·建材' },
  { content: '工地开工贴砖', expected: '装修施工' },
  { content: '画了张效果图', expected: '设计' },
  { content: '周一开了周会', expected: '会议沟通' },
  { content: '定投了点基金', expected: '理财投资' },
  { content: '打车去高铁站', expected: '出行交通' },
  { content: '出差去外地考察', expected: '外出' },
  { content: '收到尾款和发票', expected: '财务' },
  { content: '跟供应商谈合作', expected: '客户跟进' },
  { content: '写周报做汇报', expected: '工作办公' },
  { content: '晚上吃火锅', expected: '餐饮' },
  { content: '晨跑锻炼', expected: '运动健康' },
  { content: '带娃去公园', expected: '家庭' },
  { content: '报名网课学习', expected: '学习成长' },
  { content: '去医院挂号看病', expected: '健康医疗' },
  { content: '淘宝买了衣服', expected: '购物消费' },
  { content: '看场电影放松', expected: '娱乐休闲' },
  { content: '打扫卫生整理房间', expected: '家务居住' },
  { content: '遛狗喂猫粮', expected: '宠物' },
  { content: '昨晚失眠没睡好', expected: '睡眠作息' },
  { content: '跟老同学聚会', expected: '社交朋友' },
  { content: '最近有点焦虑内耗', expected: '情绪心理' },

  // —— 易错消歧（优先级 / 数组顺序）——
  { content: '发了工资转理财', expected: '理财投资' }, // 理财投资 优先于 财务
  { content: '跟供应商打款', expected: '客户跟进' }, // 供应商(13) > 财务(打款 12)
  { content: '下单买了瓷砖', expected: '采购·建材' }, // 历史回归：AI tags 不应把瓷砖拐去「采购」
  { content: '火锅店聚餐', expected: '餐饮' }, // 不是采购
  { content: '装修贴砖刷墙', expected: '装修施工' },
  { content: '买菜做饭给家人', expected: '餐饮' }, // 餐饮(24) > 家庭(12)
  { content: '房贷利息好高', expected: '理财投资' },
  { content: '老板催着开会', expected: '会议沟通' },
  { content: '甲方要求改图纸', expected: '设计' }, // 图纸(设计) 与 甲方(客户跟进) 同分 → 数组顺序 设计 胜
  { content: '监理验房收房', expected: '客户跟进' },
  { content: '通下水道维修', expected: '家务居住' },
  { content: '跟闺蜜约饭', expected: '社交朋友' }, // 约饭 在社交朋友，不在餐饮
  { content: '看抖音短视频', expected: '娱乐休闲' },
  { content: '加班到十点写文档', expected: '工作办公' },
  { content: '股票涨了点', expected: '理财投资' },

  // —— 无命中 → null（交给 AI / 语义兜底）——
  { content: '今天天气不错', expected: null },
  { content: '随便记一笔', expected: null },
];

describe('AiService.matchKeywordGroup — 分组决策契约', () => {
  const service = new AiService();

  test.each(CASES)('「$content」 → $expected', (c: Case) => {
    const got = service.matchKeywordGroup(c.content);
    const name = got ? got.name : null;
    expect(name).toBe(c.expected);
  });

  test('fixture 覆盖 GROUP_TAXONOMY 全部 24 个候选分组', () => {
    const covered = new Set(CASES.filter((c) => c.expected).map((c) => c.expected as string));
    const expectedAll = GROUP_TAXONOMY.map((g) => g.name);
    const missing = expectedAll.filter((n) => !covered.has(n));
    expect(missing).toEqual([]);
  });
});
