import { Injectable } from '@nestjs/common';

/**
 * AI 借支检测 — 从记录内容中自动识别借贷语义
 */
export interface LoanDetection {
  /** 借贷对象 */
  person: string;
  /** 金额 */
  amount: number;
  /** lend=借出（别人欠我），borrow=借入（我欠别人） */
  direction: 'lend' | 'borrow';
  /** 借贷原因 */
  reason: string | null;
}

/**
 * AI 分组建议 — 根据内容语义判断记录应归属的分组
 */
export interface SuggestedGroup {
  /** 分组名称 */
  name: string;
  /** 建议颜色（HEX） */
  color: string;
  /** 是否建议创建新分组（false 表示已有分组可复用） */
  isNew: boolean;
  /** 已有分组的名称（isNew=false 时填写，后端据此查找匹配的分组） */
  existingGroupName: string | null;
  /** AI 生成的分组描述 */
  description: string | null;
}

/**
 * AI 解析结果的结构化类型
 */
/** 心情结构化数据 — 不再用5种固定分类，AI 自由描述 */
export interface MoodInfo {
  /** 自由文本心情描述，如"有点累但很充实"、"烦躁，被催单" */
  label: string;
  /** 情绪色调，前端用于选颜色 */
  tone: 'positive' | 'negative' | 'neutral';
  /** 强度 1-5，前端用于视觉权重 */
  intensity: number;
}

export interface ParsedRecord {
  summary: string;
  tags: string[];
  people: string[];
  numericInfo: Record<string, any>;
  status: string | null;
  /** 开放式心情：AI 自由描述 + 色调 + 强度 */
  mood: MoodInfo | null;
  recordedAt: string | null;
  /** AI 提取的提醒时间（ISO 格式）。用户说"明天下午3点..." → AI 自动解析 */
  remindAt: string | null;
  /** AI 建议的分组（可选） */
  suggestedGroup: SuggestedGroup | null;
  /** AI 检测到的借贷信息（可选）。如"借给老李500"→自动创建借支记录 */
  loan: LoanDetection | null;
}

/**
 * 文档批量解析结果
 */
export interface DocumentParseResult {
  documentSummary: string;
  records: ParsedRecord[];
}

/**
 * AI 对话中的行动指令
 */
export interface ChatAction {
  type: 'update_status' | 'update_tags' | 'update_summary' | 'add_record' | 'none';
  /** 操作目标记录 ID（add_record 时不需要） */
  recordId?: string;
  /** update_status: 新状态 */
  status?: string;
  /** update_tags: 新标签数组 */
  tags?: string[];
  /** update_summary / add_record: 新摘要 */
  summary?: string;
  /** add_record: 关联人物 */
  people?: string[];
  /** add_record: 数值信息 */
  numericInfo?: Record<string, any>;
  /** add_record: 心情（开放式：{label, tone, intensity}） */
  mood?: MoodInfo | string;
}

/**
 * AI 对话的结构化响应
 */
export interface ChatResponse {
  answer: string;
  actions: ChatAction[];
}

/**
 * AI 解析引擎
 * 调用 DeepSeek V3（deepseek-chat）将自然语言 → 结构化记录
 *
 * DeepSeek API 完全兼容 OpenAI 格式，支持 json_object 模式。
 * 对中文口语的理解和情绪识别能力远超 GLM-4-Flash。
 *
 * 设计原则：
 * - 不预设模板，AI 根据内容动态判断需要哪些字段
 * - 失败不阻塞：解析失败时返回最小可用结构
 * - baseUrl 兼容 OpenAI 格式，随时可切换模型
 */

/**
 * 分组候选库（活记推荐分组体系）
 * - fallbackGroup 用它做本地关键词兜底归类
 * - DeepSeek 新建分组时优先从中选最接近的名称，避免分组碎片化
 */
export const GROUP_TAXONOMY: Array<{ kw: string[]; name: string; color: string; desc: string }> = [
  // —— 工作 / 项目类 ——
  { kw: ['报价', '询价', '单价', '比价', '报价单', '出价'], name: '报价', color: '#D4B860', desc: '价格咨询与报价' },
  { kw: ['采购', '进货', '订货', '补货'], name: '采购', color: '#6EA880', desc: '物资采购' },
  { kw: ['瓷砖', '卫浴', '五金', '灯具', '沙子', '水泥', '木料', '钢筋', '玻璃', '建材', '材料', '电线', '管材'], name: '采购·建材', color: '#6EA880', desc: '建材采购' },
  { kw: ['装修', '施工', '工地', '贴砖', '铺砖', '刷墙', '水电', '吊顶', '木工', '油漆', '开工', '翻新', '改造'], name: '装修施工', color: '#6EA880', desc: '装修与施工' },
  { kw: ['设计', '图纸', '方案', '渲染', 'cad', '效果图', '排版', 'ui', 'ux'], name: '设计', color: '#8B7EC8', desc: '设计相关' },
  { kw: ['开会', '会议', '沟通', '对接', '洽谈', '谈判', '碰头', '复盘', '启动会', '周会', '例会', '评审会', '沟通会'], name: '会议沟通', color: '#4A5C7C', desc: '会议与沟通' },
  { kw: ['股票', '基金', '存钱', '理财', '保险', '投资', '房贷', '利息', '定投', '攒钱'], name: '理财投资', color: '#D4B860', desc: '理财与投资' },
  { kw: ['开车', '打车', '地铁', '公交', '高铁', '火车', '飞机', '出行', '通勤', '停车', '加油', '驾照', '违章', '堵车', '车票'], name: '出行交通', color: '#4A5C7C', desc: '出行与交通' },
  { kw: ['出差', '外出', '跑腿', '奔波', '考察', '驻场'], name: '外出', color: '#4A5C7C', desc: '外出事务' },
  { kw: ['报销', '付款', '收款', '到账', '发票', '工资', '账单', '转账', '尾款', '定金', '结款', '开支', '打款', '结清'], name: '财务', color: '#D4B860', desc: '财务往来' },
  { kw: ['客户', '甲方', '乙方', '业主', '房东', '供应商', '合作方', '反馈', '修改意见', '收房', '验房'], name: '客户跟进', color: '#4A5C7C', desc: '客户与合作关系' },
  { kw: ['加班', '周报', '月报', '汇报', 'ppt', '文档', '邮件', '写报告', '总结', '述职'], name: '工作办公', color: '#4A5C7C', desc: '日常办公' },
  // —— 生活类 ——
  { kw: ['吃饭', '聚餐', '餐厅', '外卖', '做饭', '买菜', '火锅', '烧烤', '下午茶', '美食', '夜宵', '食堂'], name: '餐饮', color: '#E8815C', desc: '吃饭餐饮' },
  { kw: ['健身', '跑步', '运动', '瑜伽', '游泳', '打球', '徒步', '骑行', '锻炼', '晨跑', '慢跑', '夜跑'], name: '运动健康', color: '#6EA880', desc: '运动健身' },
  { kw: ['家人', '爸妈', '父母', '孩子', '老婆', '老公', '亲戚', '家里', '娃', '带娃'], name: '家庭', color: '#E8815C', desc: '家庭事务' },
  { kw: ['学习', '读书', '课程', '培训', '考试', '看书', '网课'], name: '学习成长', color: '#8B7EC8', desc: '学习成长' },
  { kw: ['看病', '医院', '体检', '药', '挂号', '问诊', '打针', '复诊'], name: '健康医疗', color: '#6EA880', desc: '就医问诊' },
  { kw: ['购物', '淘宝', '京东', '拼多多', '快递', '网购', '商城', '超市', '便利店', '买衣服', '到货', '收货', '包裹'], name: '购物消费', color: '#E8815C', desc: '购物消费' },
  { kw: ['电影', '游戏', '旅游', '旅行', '唱歌', '逛街', '追剧', '抖音', '短视频', '小说', '听歌', '音乐', '剧本杀', '露营'], name: '娱乐休闲', color: '#E8815C', desc: '娱乐休闲' },
  { kw: ['打扫', '洗衣', '拖地', '收纳', '搬家', '维修', '物业', '卫生', '打扫卫生', '整理', '通下水道'], name: '家务居住', color: '#6EA880', desc: '家务与居住' },
  { kw: ['狗', '猫', '宠物', '遛狗', '铲屎', '毛孩子', '猫粮', '狗粮', '兽医'], name: '宠物', color: '#E8815C', desc: '宠物相关' },
  { kw: ['睡觉', '熬夜', '早起', '失眠', '午休', '作息', '困', '补觉'], name: '睡眠作息', color: '#4A5C7C', desc: '睡眠与作息' },
  { kw: ['朋友', '聚会', '约饭', '老同学', '闺蜜', '兄弟', '社交', '联谊', '室友', '同学'], name: '社交朋友', color: '#E8815C', desc: '社交与朋友' },
  { kw: ['焦虑', '压力', 'emo', '抑郁', '放松', '冥想', '心理咨询', '心情差', '内耗'], name: '情绪心理', color: '#8B7EC8', desc: '情绪与心理' },
];

@Injectable()
export class AiService {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly zhipuApiKey: string;
  private readonly zhipuBaseUrl: string;
  private readonly qwenApiKey: string;
  private readonly qwenBaseUrl: string;

  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY || '';
    this.baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
    this.zhipuApiKey = process.env.ZHIPU_API_KEY || '';
    this.zhipuBaseUrl = process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
    this.qwenApiKey = process.env.QWEN_VL_API_KEY || '';
    this.qwenBaseUrl = process.env.QWEN_VL_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  }

  /**
   * 解析用户输入的自然语言，返回结构化记录
   *
   * @param content 用户输入的原始文本
   * @param existingGroupNames 已有分组的名称列表（供 AI 匹配复用）
   */
  async parseContent(content: string, existingGroupNames?: string[], existingTags?: string[]): Promise<ParsedRecord> {
    const today = new Date().toISOString().slice(0, 10);

    // 构建分组和标签上下文
    let extraContext = '';
    if (existingGroupNames && existingGroupNames.length > 0) {
      extraContext += `\n## 已有分组\n用户当前有这些分组：${existingGroupNames.map((n) => `「${n}」`).join('、')}。在 suggestedGroup 中优先匹配这些已有分组。`;
    }
    if (existingTags && existingTags.length > 0) {
      extraContext += `\n## 用户常用标签\n用户之前用过这些标签：${existingTags.slice(0, 20).map((t) => `「${t}」`).join('、')}。优先复用这些已有标签，如果内容确实涉及新主题才创建新标签。`;
    }

    const systemPrompt = `你是活记，一个个人AI语音日记助手。用户随口说出今天发生的事或要做的事，你需要把口语转换成结构化 JSON。

## 核心原则
- 你是一个理解者，不是模板匹配器。先理解用户在说什么事，再决定字段。
- 标签反映内容的实际领域，不是套用任何预设列表。

## 字段规则

### summary（摘要）
一句话概括，中文 15 字以内。保留关键动作和对象。
- "跟老张聊了供货" → 正确。保留人物+动作+对象。
- 注意动词方向："报价"是向外报，"收款/收到"是向内收，"借给XX"是借出，"向XX借/跟XX借"是借入。

### tags（标签）
根据语义提取 2-4 个标签，反映内容的真实主题。
- 先用自己的话概括用户在说什么事，再为这件事选标签。
- 标签应该是简洁的中文词（2-3字）。
- 绝对禁止：不要使用任何预设标签列表。每句话的主题不同，标签自然不同。

### people（人物）
提取所有提到的人物。识别模式：老X、小X、X总、X师傅、X哥、X姐、阿X、完整中文姓名。一个不漏。没有人就返回 []。

### numericInfo（数值）
提取数值信息，键用中文如"金额"、"数量"、"时长"、"截止日期"。没有就返回 {}。

### status（状态）
根据动词和语气判断，不看有没有数字：
- "要/需要/得/必须/准备/打算 + 做某事" → "待办"
- "已经/收到了/完成了/搞定了/弄好了" → "已完成"
- "在等/看情况/再说/还没定/不确定" → "待跟进"
- 纯粹描述已发生的事，无待办倾向 → null

### mood（心情）
这是最重要的字段。不要做表面关键词匹配——要去感受用户说这句话时的真实情绪状态。

分析维度：
1. **语言节奏**：短促破碎 = 疲惫/焦虑，流畅舒展 = 平静/开心
2. **用词选择**：正向形容词/感叹词 → 开心，负面形容词/抱怨词 → 生气/压力
3. **隐含态度**：对事件的评价是积极还是消极？有没有无奈的潜台词？
4. **生理线索**：提到"累""困""不想动""太多事" → 疲惫
5. **社交线索**：提到"被骂""被催""又要""还得" → 压力/生气

只返回以下之一：
- "开心"：满足、期待、感恩、兴奋、有成就感
- "平静"：中性陈述、日常记录、不带情绪的事实描述
- "疲惫"：身体累、心累、事情太多、缺乏动力
- "压力"：焦虑、紧张、担心、赶时间、被催促
- "生气"：不满、抱怨、失望、愤怒、被冒犯

关键区别：
- "今天做了很多事" → 可能是"平静"（陈述事实），也可能是"疲惫"（暗示累）。要结合上下文语气判断。
- "跟老张聊完了" → 如果没带情绪词，是"平静"，不要因为提到了人就猜"开心"。
- "又加班到十点" → "又"字透露无奈，是"疲惫"或"压力"，不是"平静"。
- "终于搞定了那个方案" → "终于"透露松了一口气，是"开心"。

如果确实无法判断（纯客观信息，无任何情感线索），返回 null。

### recordedAt（记录时间）
用户提到的具体时间点（事件发生时间或截止时间），ISO 格式如 "2026-07-08T15:00:00"。
- 识别模式："今天下午"、"昨天"、"上周三"、"7月15号"、"明天上午10点"
- 如果用户只说了大概时间（"上周""月初"），用最合理的近似时间
- 如果是纯待办/计划（还没发生），用计划时间
- 无法判断明确的日期时间 → null

### remindAt（提醒时间）
从内容中提取用户**隐含或明确需要的提醒时间**。这是未来时间，用于到时提醒用户。
识别以下模式：
- **明确时间表述**："明天下午3点给李总报价" → remindAt = 明天15:00，"下周三上午开会" → remindAt = 下周三9:00
- **截止日期**："7月15号前要完成" → remindAt = 7月15号9:00
- **模糊未来**："下周记得跟进" → remindAt = 下周一9:00，"过两天" → 两天后9:00
- **今天稍后**："下午记得发报价" → remindAt = 今天下午(具体时间或14:00)
- 如果是已发生的事（"昨天跟老张聊了"）→ remindAt = null
- 如果是纯粹的描述性待办但无时间暗示（"要买材料"）→ remindAt = null
- 输出 ISO 格式 "2026-07-08T15:00:00"，无法判断 → null

### suggestedGroup（分组建议）
根据内容语义，判断这条记录应该归属哪个分组。分组就像工作文件夹，帮助用户整理记录。

## 推荐分组候选库（新建分组时优先从这里选，保持分组体系一致，避免碎片化）
「报价」「采购」「采购·建材」「装修施工」「设计」「会议沟通」「财务」「外出」「客户跟进」「工作办公」
「餐饮」「运动健康」「家庭」「学习成长」「健康医疗」「出行交通」「购物消费」「娱乐休闲」「家务居住」「理财投资」「宠物」「睡眠作息」「社交朋友」「情绪心理」
- 如需新建分组，优先从上述候选库中选一个最接近的名称（可用「/」做多级，如「装修施工/3号馆」）。
- 仅当内容确实超出以上所有领域时，才创建候选库之外的新名称。

分组判断规则：
1. 先思考这句话属于什么工作/生活领域：是某个项目的？跟某个人相关的？某个主题（报价、采购、设计）？
2. 检查已有分组列表（如果提供），看是否有匹配的：
   - 如果分组成员与记录人物重叠 → 建议该分组
   - 如果分组名与记录标签/主题重叠 → 建议该分组
3. 如果没有匹配的已有分组，判断是否需要创建新分组：
   - 涉及具体项目/事件/客户 → 建议创建新分组
   - 通用日常琐事 → 也尽量归入宽泛主题分组（如「日常杂项」「生活记录」）。**只有当内容完全无主题（纯碎碎念、无人物/事件/主题）时才返回 null**
4. **多级分组**：如果一条记录同时涉及多个维度（如地点+品牌+品类），使用 "/" 分隔父子层级：
   - 格式："父组名/子组名"（如 "项目采购/3号馆B区"、"跟老张/瓷砖报价"）
   - 父组 = 项目/客户/大类，子组 = 具体地点/子项/细分
   - 最多两级，不要过度拆分，子组会自动创建在父组下
5. 颜色选择：根据分组主题选合适的颜色：
   - 工作/项目 → 深蓝系 #4A5C7C
   - 金钱/报价 → 暖金系 #D4B860 或琥珀 #C8A060
   - 人物/社交 → 珊瑚系 #E8815C
   - 采购/物资 → 暖绿系 #6EA880
   - 文档/知识 → 淡紫系 #8B7EC8
   - 其他 → 上述颜色随机

输出格式：
{
  "suggestedGroup": {
    "name": "项目采购/3号馆B区",
    "color": "#D4B860",
    "isNew": true,          // 是否建议新建分组
    "existingGroupName": null,  // 如匹配已有分组，填分组名；否则 null
    "description": "3号馆B区的瓷砖和卫浴采购"  // 一句话描述
  }
}

仅当内容完全无主题、无法提炼任何领域/人物/事件/主题时才返回 null；其余情况都应给出分组建议，让记录尽量归入某个分组（鼓励用多级「父/子」表达更细的归类）。

### loan（借贷检测）
检测内容中的借贷/金钱往来语义。识别以下模式：
- **借出**："借给XX N元"、"XX跟我借了N"、"垫付XX N元" → direction="lend"
- **借入**："跟XX借了N元"、"向XX借N"、"XX借给我N" → direction="borrow"
- **还款**："XX还了我N元" → 这是已还款，不要生成 loan
- **工资/付款**："发了XX工资"、"付了XX材料款" → 这是交易不是借贷，不要生成 loan
- 金额提取 numericInfo 中的"金额"字段，或从文本中提取数字
- 人物提取 people 中第一个匹配的人名
- reason 提取借贷原因（如"买材料"、"生活费"），没有则 null
- 没有借贷语义 → loan 返回 null

输出格式：{ "person": "老李", "amount": 500, "direction": "lend", "reason": "买材料" } 或 null`;

    // 用 JSON 模式强制模型返回合法 JSON
    const requestBody: Record<string, any> = {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: extraContext ? content + extraContext : content },
      ],
      max_tokens: 600,
      response_format: { type: 'json_object' },
    };

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify(requestBody)),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepSeek API 错误 ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const rawText = data.choices[0].message.content;

      // 容错：提取 JSON（模型偶尔包裹在代码块中）
      let jsonText = rawText.trim();
      const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
      }

      const parsed = JSON.parse(jsonText) as ParsedRecord & { suggestedGroup?: SuggestedGroup };

      // 校验 mood 值（开放式：{label, tone, intensity} 结构）
      let mood: MoodInfo | null = null;
      if (parsed.mood && typeof parsed.mood === 'object' && parsed.mood.label) {
        const validTones = ['positive', 'negative', 'neutral'];
        mood = {
          label: String(parsed.mood.label).slice(0, 20),
          tone: validTones.includes(parsed.mood.tone) ? parsed.mood.tone : 'neutral',
          intensity: Math.min(5, Math.max(1, Number(parsed.mood.intensity) || 3)),
        };
      }

      // 校验 suggestedGroup
      let suggestedGroup: SuggestedGroup | null = null;
      if (parsed.suggestedGroup && typeof parsed.suggestedGroup === 'object' && parsed.suggestedGroup.name) {
        suggestedGroup = {
          name: parsed.suggestedGroup.name,
          color: parsed.suggestedGroup.color || '#4A5C7C',
          isNew: !!parsed.suggestedGroup.isNew,
          existingGroupName: parsed.suggestedGroup.existingGroupName || null,
          description: parsed.suggestedGroup.description || null,
        };
      }

      // 校验 remindAt：必须是合法的 ISO 日期字符串
      let remindAt: string | null = null;
      if (parsed.remindAt && typeof parsed.remindAt === 'string') {
        const d = new Date(parsed.remindAt);
        if (!isNaN(d.getTime())) {
          remindAt = d.toISOString();
        }
      }

      // 校验 loan：AI 检测到的借贷信息
      let loan: LoanDetection | null = null;
      if (parsed.loan && typeof parsed.loan === 'object' && parsed.loan.person && parsed.loan.amount > 0) {
        const dir = parsed.loan.direction === 'borrow' ? 'borrow' : 'lend';
        loan = {
          person: String(parsed.loan.person).slice(0, 20),
          amount: Math.round(Number(parsed.loan.amount) * 100) / 100,
          direction: dir,
          reason: parsed.loan.reason ? String(parsed.loan.reason).slice(0, 50) : null,
        };
      }

      return {
        summary: parsed.summary || content.slice(0, 15),
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        people: Array.isArray(parsed.people) ? parsed.people : [],
        numericInfo:
          parsed.numericInfo && typeof parsed.numericInfo === 'object'
            ? parsed.numericInfo
            : {},
        status: parsed.status || null,
        mood,
        recordedAt: parsed.recordedAt || null,
        remindAt,
        suggestedGroup,
        loan,
      };
    } catch (error) {
      console.error('AI 解析失败，使用兜底结构:', (error as Error).message);
      return {
        summary: content.slice(0, 15),
        tags: [],
        people: [],
        numericInfo: {},
        status: null,
        mood: null,
        recordedAt: null,
        remindAt: null,
        suggestedGroup: this.fallbackGroup(content),
        loan: null,
      };
    }
  }

  /**
   * 批量解析：智能检测多人/多任务内容，自动拆分为多条独立记录
   *
   * 适用场景：工头一句话说了多个人干不同活 → AI 每人拆一条记录
   * - "老张贴砖20平方、老李刷墙、小王搬货" → 3条
   * - "我和老李一起贴砖" → 1条（协作，不拆）
   * - "今天贴了厕所砖，还装了厨房吊顶" → 可能拆为2条（不同工种）
   *
   * @returns { records: ParsedRecord[], isBatch: boolean }
   *   isBatch=true 表示确实拆分为多条（≥2），false 表示只有1条
   */
  async parseBatch(
    content: string,
    existingGroupNames?: string[],
    existingTags?: string[],
  ): Promise<{ records: ParsedRecord[]; isBatch: boolean }> {
    let extraContext = '';
    if (existingGroupNames && existingGroupNames.length > 0) {
      extraContext += `\n## 已有分组\n用户当前有这些分组：${existingGroupNames.map((n) => `「${n}」`).join('、')}。`;
    }
    if (existingTags && existingTags.length > 0) {
      extraContext += `\n## 用户常用标签\n用户之前用过这些标签：${existingTags.slice(0, 20).map((t) => `「${t}」`).join('、')}。`;
    }

    const systemPrompt = `你是活记，一个个人AI语音日记助手。用户可能一口气说了多个人各自干了不同的事。你需要智能判断是否应该拆分成多条记录。

## 拆分判断规则

### 应该拆分为多条（每人/每事一条）：
1. **不同人物，不同工作**："老张贴砖20平方、老李刷墙、小王搬货" → 每人一条
2. **同一人物，不同项目/工种**："上午贴了3号馆的砖，下午装了4号馆的灯" → 每条工作一条
3. **明确的并列结构**：用顿号/分号/换行/数字序号分隔的独立事项

### 不应该拆分（保持1条）：
1. **协作同一任务**："我和老李一起贴砖" → 1条（协作关系）
2. **同一件事的不同步骤**："先去量尺，再回来报价" → 1条（先后关系）
3. **纯粹的单人陈述**：只有一个人、一件事 → 1条

## 每条记录的字段规则（与单条解析相同）

### summary（摘要）
一句话概括，中文 15 字以内。保留关键人物+动作+对象。

### tags（标签）
根据语义提取 2-3 个标签，简洁中文词（2-3字）。优先复用已有标签。

### people（人物）
提取该条涉及的人物。只填该条的人物，不要把别条的人物混进来。

### numericInfo（数值）
提取数值信息，键用中文如"面积"、"金额"、"数量"、"时长"。没有就返回 {}。

### status（状态）
- "要/需要/得/准备/打算 + 做某事" → "待办"
- "已经/完成了/搞定了" → "已完成"
- "在等/看情况/再说" → "待跟进"
- 纯粹描述已发生的事 → null

### mood（心情）
感受用户的真实情绪：{ "label": "自由描述", "tone": "positive|negative|neutral", "intensity": 1-5 }。
无法判断 → null。

### recordedAt（提醒时间）
用户提到的时间点，ISO格式。无法判断 → null。

### remindAt（提醒时间）
未来时间，ISO格式。已发生的事 → null。

### suggestedGroup（分组建议）
{ "name": "分组名", "color": "#HEX色值", "isNew": true|false, "existingGroupName": null|"已有组名", "description": "描述" }

## 推荐分组候选库（新建分组时优先从这里选，保持分组体系一致，避免碎片化）
「报价」「采购」「采购·建材」「装修施工」「设计」「会议沟通」「财务」「外出」「客户跟进」「工作办公」
「餐饮」「运动健康」「家庭」「学习成长」「健康医疗」「出行交通」「购物消费」「娱乐休闲」「家务居住」「理财投资」「宠物」「睡眠作息」「社交朋友」「情绪心理」
- 如需新建分组，优先从上述候选库中选一个最接近的名称（可用「/」做多级，如「装修施工/3号馆」）。
- 仅当内容确实超出以上所有领域时，才创建候选库之外的新名称。

绝大多数记录都应给出分组建议；仅当内容完全无主题、无法归类时才返回 null。

### loan（借贷检测）
检测每条记录中的借贷/金钱往来语义：
- "借给XX N元"、"垫付XX N" → { "person": "XX", "amount": N, "direction": "lend", "reason": "..." }
- "跟XX借了N"、"向XX借N" → { "person": "XX", "amount": N, "direction": "borrow", "reason": "..." }
- "XX还了我N" → 已还款，不要生成 loan
- 工资/货款等 → 交易非借贷，不要生成 loan
- 没有借贷语义 → loan 返回 null

## 输出格式

严格输出 JSON：
{
  "records": [
    { "summary": "...", "tags": [...], "people": [...], "numericInfo": {...}, "status": "...", "mood": {...}, "recordedAt": "...", "remindAt": null, "suggestedGroup": {...}, "loan": null|{...} },
    ...
  ],
  "isBatch": true
}

如果不需要拆分（只有1条），isBatch 返回 false，records 数组也只有1个元素。`;

    const requestBody: Record<string, any> = {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: extraContext ? content + extraContext : content },
      ],
      max_tokens: 1200,
      response_format: { type: 'json_object' },
    };

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify(requestBody)),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepSeek API 错误 ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const rawText = data.choices[0].message.content;

      let jsonText = rawText.trim();
      const codeBlockMatch = jsonText.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
      }

      const parsed = JSON.parse(jsonText);
      const rawRecords: any[] = Array.isArray(parsed.records) && parsed.records.length > 0
        ? parsed.records
        : [parsed]; // 兜底：如果 AI 没返回 records 数组，把整个对象当一条

      const records: ParsedRecord[] = rawRecords.map((r: any) => {
        let mood: MoodInfo | null = null;
        if (r.mood && typeof r.mood === 'object' && r.mood.label) {
          const validTones = ['positive', 'negative', 'neutral'];
          mood = {
            label: String(r.mood.label).slice(0, 20),
            tone: validTones.includes(r.mood.tone) ? r.mood.tone : 'neutral',
            intensity: Math.min(5, Math.max(1, Number(r.mood.intensity) || 3)),
          };
        }

        let suggestedGroup: SuggestedGroup | null = null;
        if (r.suggestedGroup && typeof r.suggestedGroup === 'object' && r.suggestedGroup.name) {
          suggestedGroup = {
            name: r.suggestedGroup.name,
            color: r.suggestedGroup.color || '#4A5C7C',
            isNew: !!r.suggestedGroup.isNew,
            existingGroupName: r.suggestedGroup.existingGroupName || null,
            description: r.suggestedGroup.description || null,
          };
        }

        let remindAt: string | null = null;
        if (r.remindAt && typeof r.remindAt === 'string') {
          const d = new Date(r.remindAt);
          if (!isNaN(d.getTime())) remindAt = d.toISOString();
        }

        let loan: LoanDetection | null = null;
        if (r.loan && typeof r.loan === 'object' && r.loan.person && r.loan.amount > 0) {
          const dir = r.loan.direction === 'borrow' ? 'borrow' : 'lend';
          loan = {
            person: String(r.loan.person).slice(0, 20),
            amount: Math.round(Number(r.loan.amount) * 100) / 100,
            direction: dir,
            reason: r.loan.reason ? String(r.loan.reason).slice(0, 50) : null,
          };
        }

        return {
          summary: r.summary || content.slice(0, 15),
          tags: Array.isArray(r.tags) ? r.tags : [],
          people: Array.isArray(r.people) ? r.people : [],
          numericInfo: r.numericInfo && typeof r.numericInfo === 'object' ? r.numericInfo : {},
          status: r.status || null,
          mood,
          recordedAt: r.recordedAt || null,
          remindAt,
          suggestedGroup,
          loan,
        };
      });

      const isBatch = records.length >= 2;

      return { records, isBatch };
    } catch (error) {
      console.error('AI 批量解析失败，降级为单条兜底:', (error as Error).message);
      // 降级：返回单条兜底记录
      return {
        records: [{
          summary: content.slice(0, 15),
          tags: [],
          people: [],
          numericInfo: {},
          status: null,
          mood: null,
          recordedAt: null,
          remindAt: null,
          suggestedGroup: this.fallbackGroup(content),
          loan: null,
        }],
        isBatch: false,
      };
    }
  }

  /**
   * 关键词匹配（带打分）：仅基于正文返回命中最具体的分组及命中词数量。
   * 供 records 层做「关键词优先」决策——正文命中即权威，AI 仅作无命中兜底。
   * 返回 null 表示正文无任何关键词命中。
   */
  matchKeywordGroup(
    content: string,
  ): { name: string; color: string; description: string; hits: number } | null {
    const text = (content || '').toLowerCase();
    const rules = GROUP_TAXONOMY;

    let best: (typeof rules)[number] | null = null;
    let bestScore = 0;
    let bestHits = 0;
    for (const r of rules) {
      const hits = r.kw.filter((k) => text.includes(k.toLowerCase()));
      if (hits.length === 0) continue;
      const score = hits.length * 10 + hits.reduce((s, k) => s + k.length, 0);
      if (score > bestScore) {
        bestScore = score;
        best = r;
        bestHits = hits.length;
      }
    }
    if (!best) return null;
    return { name: best.name, color: best.color, description: '自动归类（关键词匹配）', hits: bestHits };
  }

  fallbackGroup(content: string): SuggestedGroup | null {
    // 分组决策只基于正文，避免把 AI 自带的 tags 再喂回关键词匹配（否则 AI 变相给自己归类，偏离已校准的词库）
    const m = this.matchKeywordGroup(content);
    if (!m) return null;
    return {
      name: m.name,
      color: m.color,
      isNew: true,
      existingGroupName: null,
      description: m.description,
    };
  }

  /**
   * 语义相似度兜底层（方案 C）
   * 当关键词兜底也失败时，用本地中文 embedding 模型把记录内容与分组候选库做向量比对，
   * 选余弦相似度最高的分组。可 catch 同义词/变体（如「种多肉」≈家务居住、「金毛串门」≈宠物）。
   *
   * 实现：transformers.js 在 Node 内运行 bge-small-zh 模型，无需 Python / 外部服务。
   * 健壮性：模型加载或推理失败时一律返回 null（不阻塞主流程，退化为「关键词 + AI」两层）。
   */
  private embedder: any = null;
  private embedderLoading = false;
  private embedderFailed = false;
  private groupEmbeddings: Array<{ name: string; color: string; vec: number[] }> | null = null;
  private readonly EMBED_MODEL = 'Xenova/bge-small-zh-v1.5';

  private async getEmbedder(): Promise<any> {
    if (this.embedder) return this.embedder;
    if (this.embedderFailed || this.embedderLoading) return null;
    this.embedderLoading = true;
    try {
      const { pipeline } = await import('@xenova/transformers');
      this.embedder = await pipeline('feature-extraction', this.EMBED_MODEL);
      console.log('[semanticGroup] embedding 模型已加载:', this.EMBED_MODEL);
      return this.embedder;
    } catch (e) {
      console.error('[semanticGroup] 模型加载失败，跳过语义层（本次会话不再重试）:', (e as Error).message);
      this.embedder = null;
      this.embedderFailed = true;
      return null;
    } finally {
      this.embedderLoading = false;
    }
  }

  private cosine(a: number[], b: number[]): number {
    let dot = 0;
    let na = 0;
    let nb = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  private async getGroupEmbeddings(embedder: any): Promise<Array<{ name: string; color: string; vec: number[] }>> {
    if (this.groupEmbeddings) return this.groupEmbeddings;
    // 每组用「名称 + 描述 + 种子词」拼成代表性文本，向量化一次后缓存
    const texts = GROUP_TAXONOMY.map((g) => `${g.name} ${g.desc} ${g.kw.join(' ')}`);
    const out = await embedder(texts, { pooling: 'mean', normalize: true });
    const vecs: number[][] = out.tolist();
    this.groupEmbeddings = GROUP_TAXONOMY.map((g, i) => ({ name: g.name, color: g.color, vec: vecs[i] }));
    return this.groupEmbeddings;
  }

  /**
   * 语义相似度归类：返回最匹配的分组，或 null（相似度不足 / 模型不可用）。
   * @param threshold 余弦相似度阈值，低于此值视为不相关
   */
  async semanticGroupMatch(content: string, tags?: string[], threshold = 0.30): Promise<SuggestedGroup | null> {
    try {
      const embedder = await this.getEmbedder();
      if (!embedder) return null;
      const groups = await this.getGroupEmbeddings(embedder);
      const text = `${(content || '').trim()} ${(tags || []).join(' ')}`.trim();
      if (!text) return null;
      const out = await embedder(text, { pooling: 'mean', normalize: true });
      const vec: number[] = out.tolist()[0];
      let best: { name: string; color: string; score: number } | null = null;
      for (const g of groups) {
        const s = this.cosine(vec, g.vec);
        if (!best || s > best.score) best = { name: g.name, color: g.color, score: s };
      }
      if (best && best.score >= threshold) {
        return {
          name: best.name,
          color: best.color,
          isNew: true,
          existingGroupName: null,
          description: `自动归类（语义相似度 ${best.score.toFixed(2)}）`,
        };
      }
    } catch (e) {
      console.error('[semanticGroup] 匹配失败:', (e as Error).message);
    }
    return null;
  }

  /**
   * AI 对话：基于用户的所有记录进行问答，并执行用户要求的操作
   * 用于"问问活记"功能 — 用户用自然语言查询数据、要求修改/创建记录
   *
   * @param question 用户的问题或操作要求
   * @param recordsContext 检索到的相关记录（含 id 和结构化字段），供 AI 参考和定位操作目标
   * @param userInfo  用户的基本统计信息（总数、连续天数等）
   * @returns 结构化响应：自然语言回答 + 待执行的操作列表
   */
  async chat(
    question: string,
    recordsContext: Array<{
      id: string;
      summary?: string;
      content?: string;
      tags?: string[];
      people?: string[];
      status?: string;
      mood?: string;
      numericInfo?: Record<string, any>;
      recordedAt?: Date;
    }>,
    userInfo: { totalRecords: number; daysActive: number; currentStreak: number },
  ): Promise<ChatResponse> {
    // 构建带 ID 的记录上下文
    const contextText = recordsContext.map((r) => {
      const parts = [`[id: ${r.id}] [${r.recordedAt ? new Date(r.recordedAt).toISOString().slice(0, 10) : '未知日期'}]`];
      if (r.summary) parts.push(r.summary);
      if (r.tags && r.tags.length > 0) parts.push(`标签: ${r.tags.join('、')}`);
      if (r.people && r.people.length > 0) parts.push(`人物: ${r.people.join('、')}`);
      if (r.status) parts.push(`状态: ${r.status}`);
      if (r.mood) parts.push(`心情: ${r.mood}`);
      if (r.numericInfo && Object.keys(r.numericInfo).length > 0)
        parts.push(`数值: ${JSON.stringify(r.numericInfo)}`);
      return parts.join(' | ');
    }).join('\n');

    const systemPrompt = `你是活记 AI 助手，帮用户理解和操作他们的工作记录。

## 你的能力
你不仅能回答问题，**还能执行操作**。用户的记录已在上下文中列出，每条记录都有一个唯一 id。

用户可能要求你：
1. **纯查询**（"我这周做了什么""还有哪些待办"）→ 只需要 answer
2. **修改记录**（"把跟老张的待办标为完成""把那条改成已完成"）→ 需要在 actions 中指定操作
3. **创建记录**（"帮我记一条：明天要去找老张"）→ 使用 add_record 操作

## 上下文 — 用户的记录（每条带 id，用于操作定位）
${contextText}

## 用户概况
- 总记录数：${userInfo.totalRecords}
- 活跃天数：${userInfo.daysActive}
- 连续记录：${userInfo.currentStreak} 天

## 操作规则
- **修改记录时**：必须在 actions 中写明目标记录的 id。先确认上下文中有匹配的记录。
- **创建记录时**：用 add_record，summary 必填，tags/people/status/mood 可选。
- **纯提问时**：actions 返回空数组 []。
- **没有匹配记录时**：在 answer 中诚实告知，actions 返回 []。
- **每个操作只做一次**：不要对同一条记录输出多个 update_status。

## 回答规则
1. 基于用户的实际记录回答，不要编造信息。
2. 回答要具体、有数据支撑。引用记录中的真实人物、标签、事件。
3. 语气温暖但不油腻，像同事帮你回忆工作。
4. 用中文回答，结构清晰。

## 输出格式（严格遵守）
必须返回以下 JSON：
{
  "answer": "你的自然语言回答...",
  "actions": [
    {
      "type": "update_status",
      "recordId": "记录id",
      "status": "已完成"
    }
  ]
}

有效的 action type: "update_status" | "update_tags" | "update_summary" | "add_record" | "none"
有效的 status 值: "待办" | "已完成" | "待跟进"`;

    const requestBody: Record<string, any> = {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    };

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify(requestBody)),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepSeek Chat API 错误 ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const rawText = data.choices[0].message.content;

      // 容错：提取 JSON
      let jsonText = rawText.trim();
      const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
      }

      const parsed = JSON.parse(jsonText);

      // 校验 actions
      const validTypes = ['update_status', 'update_tags', 'update_summary', 'add_record', 'none'];
      const validStatuses = ['待办', '已完成', '待跟进'];
      const actions: ChatAction[] = (Array.isArray(parsed.actions) ? parsed.actions : [])
        .filter((a: any) => validTypes.includes(a.type))
        .map((a: any) => {
          const action: ChatAction = { type: a.type };
          if (a.recordId && typeof a.recordId === 'string') action.recordId = a.recordId;
          if (a.status && validStatuses.includes(a.status)) action.status = a.status;
          if (Array.isArray(a.tags)) action.tags = a.tags;
          if (a.summary && typeof a.summary === 'string') action.summary = a.summary;
          if (Array.isArray(a.people)) action.people = a.people;
          if (a.numericInfo && typeof a.numericInfo === 'object') action.numericInfo = a.numericInfo;
          if (a.mood) action.mood = a.mood;
          return action;
        });

      return {
        answer: parsed.answer || '抱歉，我暂时无法回答这个问题。',
        actions,
      };
    } catch (error) {
      console.error('AI 对话失败:', (error as Error).message);
      return {
        answer: '抱歉，AI 暂时无法回答。请稍后再试。',
        actions: [],
      };
    }
  }

  /**
   * 批量文档解析：将完整文档拆解为多条结构化记录 + 整体摘要
   * 用于"导入文档"功能 — 用户上传聊天记录/会议纪要/工作日志
   *
   * @param content 完整文档文本（最长 30000 字符）
   * @returns 文档摘要 + 解析出的记录数组
   */
  async parseDocument(content: string): Promise<DocumentParseResult> {
    const systemPrompt = `你是活记，一个个人AI工作日记助手。用户上传了一份文档（可能是聊天记录、会议纪要、工作日志、笔记等），你需要：

## 第一步：理解文档
先判断这是什么类型的文档（微信聊天导出？会议记录？工作日报？笔记？），了解文档的时间跨度和主要内容。

## 第二步：识别记录边界
将文档拆分为独立的"记录"。边界的判断依据（按优先级）：
1. 时间戳换行（如 "2024-01-15 14:30"、"1月15日 下午"、"昨天"）
2. 发言人切换（如 "张三："、"李四说"、"我："）
3. 空行分隔的段落
4. 编号/列表项（如 "1. "、" - "、"·"）

每个独立的话题/事件/事项 = 一条记录。不要合并不同的事，也不要拆分同一件事。

## 第三步：逐条解析
对每条记录提取以下字段：

- **summary**：一句话摘要（≤15字），保留关键动作+对象+人物。
- **tags**：2-3个中文标签，反映内容的真实主题，不要用预设列表。
- **people**：提取所有人物。中文名称模式：老X、小X、X总、X师傅、X哥、X姐、全名。没有就返回[]。
- **numericInfo**：数值信息，键用中文如 {"金额": 6800, "数量": 3}。没有就返回{}。
- **status**：根据动词判断：
  - "要/需要/得/必须/准备/打算 + 做" → "待办"
  - "已经/收到了/完成了/搞定了/弄好了/确定了" → "已完成"
  - "在等/看情况/再说/还没定/待确认" → "待跟进"
  - 纯粹描述已发生的事 → null
- **mood**：感受用户的情绪。输出 JSON 对象 { "label": "自由描述3-8字", "tone": "positive"|"negative"|"neutral", "intensity": 1-5 }。无法判断时返回null。
- **recordedAt**：从文档中提取的时间戳，ISO格式。如果该条记录没有明确时间，返回null。
- **suggestedGroup**：根据内容主题建议一个分组名。规则：
  - 按项目/客户/地点等业务维度拆分，使用"父组/子组"格式（如"项目采购/3号馆B区"）支持两级
  - 与同一个项目/客户相关的多条记录应共享相同的分组名
  - 通用日常琐事（无明确项目归属）→ 返回 null
  - 格式：{ "name": "分组名", "color": "#4A5C7C", "isNew": true, "description": "一句话描述" }

## 第四步：生成文档摘要
用一段200字以内的中文概括：
- 文档类型和来源
- 时间跨度
- 主要人物/主题
- 关键事件概览
- 总记录条数

## 输出格式
严格返回以下JSON（response_format: json_object）：
{
  "documentSummary": "文档摘要文字...",
  "records": [
    {
      "summary": "...",
      "tags": ["...", "..."],
      "people": ["..."],
      "numericInfo": {},
      "status": "待办",
      "mood": {"label": "日常记录", "tone": "neutral", "intensity": 2},
      "recordedAt": "2024-01-15T14:30:00",
      "suggestedGroup": { "name": "项目采购/3号馆B区", "color": "#4A5C7C", "isNew": true, "description": "3号馆B区采购相关" }
    }
  ]
}

## 重要规则
- 每条记录都要有summary，不能为空。
- 不要编造文档中没有的信息。
- records数组最多50条。如果文档内容超过50条记录，合并相近的条目。
- 标签用词要自然，来自对内容的理解，不是套模板。
- suggestedGroup 不是每条记录都必须有，没有明确项目归属的可返回 null。`;

    const requestBody: Record<string, any> = {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: content.slice(0, 30000) },
      ],
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    };

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify(requestBody)),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepSeek ParseDocument API 错误 ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const rawText = data.choices[0].message.content;

      // 容错：提取 JSON
      let jsonText = rawText.trim();
      const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
      }

      const parsed = JSON.parse(jsonText);

      // 校验并规范化
      const validTonesDoc = ['positive', 'negative', 'neutral'];
      const validStatuses = ['待办', '已完成', '待跟进'];

      const records: ParsedRecord[] = (Array.isArray(parsed.records) ? parsed.records : []).map(
        (r: any) => {
          // 解析 suggestedGroup
          let suggestedGroup: SuggestedGroup | null = null;
          if (r.suggestedGroup && typeof r.suggestedGroup === 'object' && r.suggestedGroup.name) {
            suggestedGroup = {
              name: r.suggestedGroup.name,
              color: r.suggestedGroup.color || '#4A5C7C',
              isNew: r.suggestedGroup.isNew !== false,
              existingGroupName: r.suggestedGroup.existingGroupName || null,
              description: r.suggestedGroup.description || null,
            };
          }
          return {
            summary: r.summary || '(无摘要)',
            tags: Array.isArray(r.tags) ? r.tags.slice(0, 5) : [],
            people: Array.isArray(r.people) ? r.people : [],
            numericInfo: r.numericInfo && typeof r.numericInfo === 'object' ? r.numericInfo : {},
            status: r.status && validStatuses.includes(r.status) ? r.status : null,
            mood: r.mood && typeof r.mood === 'object' && r.mood.label ? { label: String(r.mood.label).slice(0, 20), tone: validTonesDoc.includes(r.mood.tone) ? r.mood.tone : 'neutral', intensity: Math.min(5, Math.max(1, Number(r.mood.intensity) || 3)) } : null,
            recordedAt: r.recordedAt || null,
            suggestedGroup,
          };
        },
      );

      return {
        documentSummary:
          parsed.documentSummary || `解析完成，共识别 ${records.length} 条记录`,
        records,
      };
    } catch (error) {
      console.error('AI 文档解析失败:', (error as Error).message);
      return {
        documentSummary: 'AI解析失败，请确认文档格式后重试',
        records: [],
      };
    }
  }

  /**
   * 图片 AI 解析：直接对图片进行文字识别 + 结构化解析
   *
   * 使用通义千问 Qwen-VL（视觉模型）一步完成"看懂图片文字 + 解析为记录"，
   * 无需单独的 OCR 步骤。相比"百度OCR → DeepSeek解析"的两步方案：
   * - 少一次 HTTP 调用
   * - 视觉模型能理解截图上下文（微信聊天、表格、手写笔记等）
   * - 不需要百度 API 密钥
   * - 阿里云百炼 100万 tokens/月 免费额度
   *
   * @param imageBase64 图片的 base64 编码（不含 data:xxx;base64, 前缀）
   * @param mimeType   图片 MIME 类型，如 "image/png"
   * @returns 文档摘要 + 解析出的记录数组
   */
  async parseImage(imageBase64: string, mimeType: string): Promise<DocumentParseResult> {
    if (!this.qwenApiKey) {
      throw new Error('通义千问 API 密钥未配置，请在 .env 中设置 QWEN_VL_API_KEY');
    }

    const systemPrompt = `你是活记，一个个人AI工作日记助手。用户上传了一张图片（可能是聊天截图、手写笔记、表格照片、文档拍照等）。

## 你的任务
1. **文字提取**：看清楚图片中所有文字内容，理解上下文。
2. **内容解析**：将图片中的信息拆分为独立的"工作记录"，逐条解析。
3. **生成摘要**：概括整张图片的内容。

## 记录识别规则
- 每条独立的话题/事件/事项 = 一条记录
- 边界依据：时间戳、发言人、空行、编号符号
- 不要合并不同的事，也不要拆分同一件事

## 字段规则（同文字解析）
- **summary**：一句话摘要（≤15字），保留关键动作+对象+人物
- **tags**：2-3个中文标签，反映内容真实主题
- **people**：提取所有人物（老X、小X、X总、X师傅、X哥、X姐、全名）
- **numericInfo**：数值信息，键用中文如{"金额": 6800}
- **status**：根据动词判断 → "待办"/"已完成"/"待跟进"/null
- **mood**：感受情绪 → JSON对象 {"label":"自由描述", "tone":"positive"|"negative"|"neutral", "intensity":1-5}。无法判断时返回null
- **recordedAt**：从图片文字中提取的时间戳，ISO格式，没有则null
- **suggestedGroup**：根据内容主题建议分组名，用"父组/子组"格式。无明确项目归属则null。
  格式：{"name": "分组名", "color": "#4A5C7C", "isNew": true, "description": "一句话"}

## 输出格式（严格遵守）
{
  "documentSummary": "图片内容摘要（200字内）",
  "records": [
    {
      "summary": "...",
      "tags": ["...", "..."],
      "people": ["..."],
      "numericInfo": {},
      "status": "待办",
      "mood": {"label": "日常记录", "tone": "neutral", "intensity": 2},
      "recordedAt": "2024-01-15T14:30:00",
      "suggestedGroup": null
    }
  ]
}

## 重要规则
- 每条记录必须有summary
- 不要编造图片中没有的信息
- records最多50条。如果内容超过50条，合并相近条目
- 如果图片中无任何文字，documentSummary说明"图片无可识别文字"，records返回[]`;

    // 注意：Qwen-VL 不完全兼容 OpenAI 的 response_format: json_object，
    // 改为在 prompt 中强约束 JSON 输出 + 代码块容错提取
    const requestBody: Record<string, any> = {
      model: process.env.QWEN_VL_MODEL || 'qwen-vl-plus',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`,
              },
            },
            {
              type: 'text',
              text: '请解析这张图片中的工作记录。\n\n【重要】只输出纯 JSON，不要加任何解释文字，格式如下：\n{"documentSummary":"...","records":[{"summary":"...","tags":[],"people":[],"numericInfo":{},"status":null,"mood":null,"recordedAt":null,"suggestedGroup":{"name":"父组/子组","color":"#4A5C7C","isNew":true,"description":"..."}}]}',
            },
          ],
        },
      ],
      max_tokens: 3000,
      // 不使用 response_format，改为 prompt 中强制 JSON + 代码块容错
    };

    // 依次尝试不同模型（有些 key 可能只开通了特定版本）
    const modelsToTry = [
      process.env.QWEN_VL_MODEL || 'qwen-vl-plus',
      'qwen-vl-max',
      'qwen3-vl-plus',
    ].filter((m, i, arr) => arr.indexOf(m) === i); // 去重

    let lastError: Error | null = null;

    for (const model of modelsToTry) {
      try {
        const modelRequestBody = { ...requestBody, model };
        const response = await fetch(`${this.qwenBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.qwenApiKey}`,
            'Content-Type': 'application/json',
          },
          body: Buffer.from(JSON.stringify(modelRequestBody)),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorJson: any = {};
          try { errorJson = JSON.parse(errorText); } catch { /* not JSON */ }
          const apiError = errorJson?.error?.message || errorText;
          console.warn(`通义千问 ${model} API 错误 ${response.status}: ${apiError}`);
          lastError = new Error(`${model}: ${response.status} ${apiError}`);
          continue; // 尝试下一个模型
        }

        const data = await response.json();
        const rawText = data.choices[0].message.content;

        // 容错：提取 JSON
        let jsonText = rawText.trim();
        const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
          jsonText = codeBlockMatch[1].trim();
        }

        const parsed = JSON.parse(jsonText);

        // 校验并规范化
        const validTonesDoc = ['positive', 'negative', 'neutral'];
        const validStatuses = ['待办', '已完成', '待跟进'];

        const records: ParsedRecord[] = (Array.isArray(parsed.records) ? parsed.records : []).map(
          (r: any) => {
            let suggestedGroup: SuggestedGroup | null = null;
            if (r.suggestedGroup && typeof r.suggestedGroup === 'object' && r.suggestedGroup.name) {
              suggestedGroup = {
                name: r.suggestedGroup.name,
                color: r.suggestedGroup.color || '#4A5C7C',
                isNew: r.suggestedGroup.isNew !== false,
                existingGroupName: r.suggestedGroup.existingGroupName || null,
                description: r.suggestedGroup.description || null,
              };
            }
            return {
              summary: r.summary || '(无摘要)',
              tags: Array.isArray(r.tags) ? r.tags.slice(0, 5) : [],
              people: Array.isArray(r.people) ? r.people : [],
              numericInfo: r.numericInfo && typeof r.numericInfo === 'object' ? r.numericInfo : {},
              status: r.status && validStatuses.includes(r.status) ? r.status : null,
              mood: r.mood && typeof r.mood === 'object' && r.mood.label ? { label: String(r.mood.label).slice(0, 20), tone: validTonesDoc.includes(r.mood.tone) ? r.mood.tone : 'neutral', intensity: Math.min(5, Math.max(1, Number(r.mood.intensity) || 3)) } : null,
              recordedAt: r.recordedAt || null,
              suggestedGroup,
            };
          },
        );

        console.log(`通义千问 ${model} 图片解析成功，识别 ${records.length} 条记录`);
        return {
          documentSummary:
            parsed.documentSummary || `图片解析完成，共识别 ${records.length} 条记录`,
          records,
        };
      } catch (error) {
        lastError = error as Error;
        if ((error as Error).message.includes('JSON') || (error as Error).message.includes('parse')) {
          // JSON 解析失败说明模型返回了文字但格式不对 — 不换模型重试
          break;
        }
        // 其他错误（网络、鉴权）→ 尝试下一个模型
      }
    }

    console.error('通义千问 Qwen-VL 图片解析失败（所有模型）:', lastError?.message);
    throw lastError || new Error('所有视觉模型均不可用，请确认 QWEN_VL_API_KEY 是否有效');
  }

  /**
   * 使用通义千问 Qwen-VL 解析视频内容
   * 尝试用视觉模型理解视频画面 → 提取工作记录
   * 注意：视频 base64 体积大，可能超时或超限，需降级处理
   */
  async parseVideo(videoBase64: string, mimeType: string): Promise<DocumentParseResult> {
    if (!this.qwenApiKey) {
      throw new Error('通义千问 API 密钥未配置，请设置 QWEN_VL_API_KEY');
    }

    // 视频超过 10MB base64 时直接降级（避免 API 调用失败）
    const sizeMB = videoBase64.length / (1024 * 1024);
    if (sizeMB > 10) {
      console.log(`视频 base64 体积 ${sizeMB.toFixed(1)}MB，超过 10MB 限制，降级处理`);
      return {
        documentSummary: '视频已上传（文件较大），请补充文字说明录制的工作内容',
        records: [],
      };
    }

    const requestBody: Record<string, any> = {
      model: process.env.QWEN_VL_MODEL || 'qwen-vl-plus',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'video',
              video: `data:${mimeType};base64,${videoBase64}`,
            },
            {
              type: 'text',
              text: '请分析这段视频中的工作内容，提取成工作记录。\n\n【重要】只输出纯 JSON，不要加任何解释文字，格式如下：\n{"documentSummary":"...","records":[{"summary":"...","tags":[],"people":[],"numericInfo":{},"status":null,"mood":null,"recordedAt":null}]}',
            },
          ],
        },
      ],
      max_tokens: 3000,
    };

    const modelsToTry = [
      process.env.QWEN_VL_MODEL || 'qwen-vl-plus',
      'qwen-vl-max',
      'qwen3-vl-plus',
    ].filter((m, i, arr) => arr.indexOf(m) === i);

    let lastError: Error | null = null;

    for (const model of modelsToTry) {
      try {
        const modelRequestBody = { ...requestBody, model };
        const response = await fetch(`${this.qwenBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.qwenApiKey}`,
            'Content-Type': 'application/json',
          },
          body: Buffer.from(JSON.stringify(modelRequestBody)),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorJson: any = {};
          try { errorJson = JSON.parse(errorText); } catch { /* not JSON */ }
          console.warn(`Qwen-VL 视频解析 ${model} API 错误 ${response.status}: ${errorJson?.error?.message || errorText}`);
          lastError = new Error(`${model}: ${response.status}`);
          continue;
        }

        const data = await response.json();
        const rawContent = data.choices?.[0]?.message?.content || '';

        // 容错提取 JSON（同图片解析逻辑）
        let jsonText = rawContent.trim();
        const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
          jsonText = codeBlockMatch[1].trim();
        }

        const parsed = JSON.parse(jsonText);

        const validTonesDoc = ['positive', 'negative', 'neutral'];
        const validStatuses = ['待办', '已完成', '待跟进'];

        const records: ParsedRecord[] = (Array.isArray(parsed.records) ? parsed.records : []).map(
          (r: any) => ({
            summary: r.summary || '(无摘要)',
            tags: Array.isArray(r.tags) ? r.tags.slice(0, 5) : [],
            people: Array.isArray(r.people) ? r.people : [],
            numericInfo: r.numericInfo && typeof r.numericInfo === 'object' ? r.numericInfo : {},
            status: r.status && validStatuses.includes(r.status) ? r.status : null,
            mood: r.mood && typeof r.mood === 'object' && r.mood.label ? { label: String(r.mood.label).slice(0, 20), tone: validTonesDoc.includes(r.mood.tone) ? r.mood.tone : 'neutral', intensity: Math.min(5, Math.max(1, Number(r.mood.intensity) || 3)) } : null,
            recordedAt: r.recordedAt || null,
          }),
        );

        console.log(`Qwen-VL 视频解析成功，识别 ${records.length} 条记录`);
        return {
          documentSummary:
            parsed.documentSummary || `视频解析完成，共识别 ${records.length} 条记录`,
          records,
        };
      } catch (error) {
        console.warn(`Qwen-VL 视频解析 ${model} 网络错误:`, (error as Error).message);
        lastError = error as Error;
        continue;
      }
    }

    console.error('通义千问 Qwen-VL 视频解析失败（所有模型）:', lastError?.message);
    throw lastError || new Error('所有视觉模型均不可用');
  }

  /**
   * AI 总结：根据一段时间的记录生成结构化总结
   *
   * @param periodLabel 时间标签，如"本周（7月1日-7月5日）"
   * @param recordsSummary 记录的汇总文本
   */
  async summarize(periodLabel: string, recordsSummary: string): Promise<string> {
    const systemPrompt = `你是活记 AI 助手，帮用户回顾和总结一段时间的工作。

## 用户这段时间的记录
${recordsSummary}

## 总结要求
请生成一份结构化的回顾，包含以下部分：

### 📊 概览
这${periodLabel}，你记录了 X 条记录，涉及 Y 个人物，主要标签包括...

### 🔑 关键事件
列出 3-5 件最重要的事，每条一句话。

### 👥 高频联系人
提到最多的人物及次数。

### ✅ 完成情况
待办/已完成/待跟进各多少，完成率如何。

### 😊 情绪趋势
如果记录中有心情数据，描述这周的情绪变化。

### 💡 一句话
用一句温暖的话总结这${periodLabel}。

请直接输出上述格式的总结，不要额外解释。语气温暖真诚。`;

    const requestBody: Record<string, any> = {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `请帮我总结${periodLabel}的工作。` },
      ],
      max_tokens: 800,
    };

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify(requestBody)),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepSeek Summarize API 错误 ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error('AI 总结失败:', (error as Error).message);
      return '抱歉，AI 暂时无法生成总结。请稍后再试。';
    }
  }
}
