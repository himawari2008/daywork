/**
 * RecordsService 单元测试
 *
 * 测试范围：
 * - 记录查询（分页、筛选）
 * - CRUD 基本操作
 * - 统计分析
 * - 标签管理
 * - 数据导出
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RecordsService } from './records.service';
import { AiService } from '../ai/ai.service';
import { SpeechService } from '../speech/speech.service';
import { OcrService } from '../speech/ocr.service';
import { GroupsService } from '../groups/groups.service';
import { LoansService } from '../loans/loans.service';
import { DayRecord } from './entities/record.entity';

// ——— 单例 QueryBuilder Mock ———
// 关键：RecordsService 内部多次调用 createQueryBuilder()，每次必须返回同一个实例
// 这样 mockResolvedValue 才能在所有内部调用中生效

const createMockQb = () => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  addGroupBy: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),

  // 查询方法 — 默认返回合理空值
  getMany: jest.fn().mockResolvedValue([]),
  getOne: jest.fn().mockResolvedValue(null),
  getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
  getRawOne: jest.fn().mockResolvedValue(null),
  getRawMany: jest.fn().mockResolvedValue([]),
  getCount: jest.fn().mockResolvedValue(0),
  execute: jest.fn().mockResolvedValue({}),
});

describe('RecordsService', () => {
  let service: RecordsService;
  let mockRepo: ReturnType<typeof createMockRepo>;
  let sharedQb: ReturnType<typeof createMockQb>;
  let mockAi: { parseContent: jest.Mock; chat: jest.Mock; summarize: jest.Mock; parseDocument: jest.Mock; parseImage: jest.Mock; parseVideo: jest.Mock };
  let mockGroups: { findAll: jest.Mock; findOrCreate: jest.Mock; create: jest.Mock };

  const createMockRepo = () => ({
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn().mockReturnValue(sharedQb),
    manager: { createQueryBuilder: jest.fn().mockReturnValue(sharedQb) },
  });

  beforeEach(async () => {
    sharedQb = createMockQb();
    mockAi = {
      parseContent: jest.fn(),
      chat: jest.fn(),
      summarize: jest.fn(),
      parseDocument: jest.fn(),
      parseImage: jest.fn(),
      parseVideo: jest.fn(),
    };
    mockGroups = {
      findAll: jest.fn().mockResolvedValue({ groups: [], ungroupedCount: 0 }),
      findOrCreate: jest.fn(),
      create: jest.fn(),
    };

    mockRepo = createMockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordsService,
        { provide: getRepositoryToken(DayRecord), useValue: mockRepo },
        { provide: AiService, useValue: mockAi },
        { provide: SpeechService, useValue: { recognize: jest.fn(), isConfigured: jest.fn().mockReturnValue(false) } },
        { provide: OcrService, useValue: { recognize: jest.fn(), isConfigured: jest.fn().mockReturnValue(false) } },
        { provide: GroupsService, useValue: mockGroups },
        { provide: LoansService, useValue: { create: jest.fn().mockResolvedValue({ id: 'loan-1' }) } },
      ],
    }).compile();

    service = module.get<RecordsService>(RecordsService);
  });

  // ============================================
  // findAll
  // ============================================

  describe('findAll', () => {
    it('返回分页记录列表', async () => {
      const mockRecords = [
        { id: 'r1', summary: '跟老张聊了供货', userId: 'user1' },
        { id: 'r2', summary: '报价3号馆', userId: 'user1' },
      ];
      (sharedQb.getManyAndCount as jest.Mock).mockResolvedValue([mockRecords, 2]);

      const result = await service.findAll('user1', { page: 1, limit: 20 });

      expect(result.data).toEqual(mockRecords);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('空查询返回空列表', async () => {
      (sharedQb.getManyAndCount as jest.Mock).mockResolvedValue([[], 0]);

      const result = await service.findAll('user1', {});
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // ============================================
  // update
  // ============================================

  describe('update', () => {
    it('更新存在的记录', async () => {
      const record = { id: 'r1', summary: '旧摘要', userId: 'user1' };
      (mockRepo.findOne as jest.Mock).mockResolvedValue(record);
      (mockRepo.save as jest.Mock).mockResolvedValue({ ...record, summary: '新摘要' });

      const result = await service.update('r1', 'user1', { summary: '新摘要' });
      expect(result).toBeTruthy();
      expect(result!.summary).toBe('新摘要');
    });

    it('记录不存在时返回 null', async () => {
      (mockRepo.findOne as jest.Mock).mockResolvedValue(null);

      const result = await service.update('nonexistent', 'user1', { summary: 'x' });
      expect(result).toBeNull();
    });

    it('更新 isPinned 字段', async () => {
      const record = { id: 'r1', isPinned: false, userId: 'user1' };
      (mockRepo.findOne as jest.Mock).mockResolvedValue(record);
      (mockRepo.save as jest.Mock).mockResolvedValue({ ...record, isPinned: true });

      const result = await service.update('r1', 'user1', { isPinned: true });
      expect(result!.isPinned).toBe(true);
    });
  });

  // ============================================
  // remove
  // ============================================

  describe('remove', () => {
    it('删除存在的记录返回 true', async () => {
      (mockRepo.delete as jest.Mock).mockResolvedValue({ affected: 1 });

      const result = await service.remove('r1', 'user1');
      expect(result).toBe(true);
    });

    it('记录不存在返回 false', async () => {
      (mockRepo.delete as jest.Mock).mockResolvedValue({ affected: 0 });

      const result = await service.remove('nonexistent', 'user1');
      expect(result).toBe(false);
    });
  });

  // ============================================
  // getStats
  // ============================================

  describe('getStats', () => {
    beforeEach(() => {
      (mockRepo.count as jest.Mock).mockResolvedValue(42);
      // 注意：sharedQb 单例在每个测试中共享，所以按顺序设置返回值
      (sharedQb.getCount as jest.Mock)
        .mockResolvedValueOnce(15)   // monthCount
        .mockResolvedValueOnce(5);   // weekCount
      (sharedQb.getRawOne as jest.Mock)
        .mockResolvedValueOnce({ days: '30' }); // daysActive
      (sharedQb.getRawMany as jest.Mock)
        .mockResolvedValueOnce([{ tag: '报价', count: '10' }, { tag: '供货', count: '8' }])  // topTags
        .mockResolvedValueOnce([{ status: '已完成', count: '20' }, { status: '待办', count: '12' }])  // statusDist
        .mockResolvedValueOnce([{ person: '老张', count: '15' }, { person: '李总', count: '8' }]); // topPeople
    });

    it('返回完整统计信息', async () => {
      const stats = await service.getStats('user1');

      expect(stats.total).toBe(42);
      expect(stats.monthCount).toBe(15);
      expect(stats.weekCount).toBe(5);
      expect(stats.daysActive).toBe(30);
      expect(stats.topTags).toHaveLength(2);
      expect(stats.statusDistribution).toHaveLength(2);
      expect(stats.topPeople).toHaveLength(2);
    });
  });

  // ============================================
  // 导出
  // ============================================

  describe('exportRecords', () => {
    it('导出 CSV 格式（含表头）', async () => {
      (mockRepo.find as jest.Mock).mockResolvedValue([
        {
          id: 'r1', content: '跟老张聊了供货，报价2800',
          summary: '跟老张聊供货报价', tags: ['报价', '供货'],
          people: ['老张'], status: '已完成', mood: '开心',
          numericInfo: { 金额: 2800 }, recordedAt: new Date('2026-07-06'),
        },
      ]);

      const result = await service.exportRecords('user1', 'csv');
      expect(result.format).toBe('csv');
      expect(result.recordCount).toBe(1);
      expect(result.content).toContain('摘要,标签,人物,状态,心情,数值,时间');
      expect(result.content).toContain('跟老张聊供货报价');
    });

    it('导出 Markdown 格式', async () => {
      (mockRepo.find as jest.Mock).mockResolvedValue([
        {
          id: 'r1', content: '测试内容', summary: '测试摘要',
          tags: ['测试'], people: [], status: null, mood: null,
          numericInfo: null, recordedAt: new Date('2026-07-06'),
        },
      ]);

      const result = await service.exportRecords('user1', 'markdown');
      expect(result.format).toBe('markdown');
      expect(result.recordCount).toBe(1);
      expect(result.content).toContain('# 活记 · 工作记录导出');
      expect(result.content).toContain('测试摘要');
    });

    it('无记录时导出只有表头/标题', async () => {
      (mockRepo.find as jest.Mock).mockResolvedValue([]);

      const csv = await service.exportRecords('user1', 'csv');
      expect(csv.recordCount).toBe(0);

      const md = await service.exportRecords('user1', 'markdown');
      expect(md.recordCount).toBe(0);
    });
  });

  // ============================================
  // 标签管理
  // ============================================

  describe('renameTag', () => {
    it('重命名标签：在所有匹配记录中替换', async () => {
      const record1 = { id: 'r1', tags: ['报价', '工作'], userId: 'user1' };
      const record2 = { id: 'r2', tags: ['报价', '采购'], userId: 'user1' };
      (sharedQb.getMany as jest.Mock).mockResolvedValue([record1, record2]);
      (mockRepo.save as jest.Mock).mockImplementation((r: any) => Promise.resolve(r));

      const count = await service.renameTag('user1', '报价', '预算');
      expect(count).toBe(2);
    });

    it('无匹配记录时返回 0', async () => {
      (sharedQb.getMany as jest.Mock).mockResolvedValue([]);

      const count = await service.renameTag('user1', '不存在的标签', '新标签');
      expect(count).toBe(0);
    });
  });

  describe('removeTag', () => {
    it('从所有匹配记录中移除标签', async () => {
      (sharedQb.getMany as jest.Mock).mockResolvedValue([
        { id: 'r1', tags: ['报价', '工作'], userId: 'user1' },
      ]);
      (mockRepo.save as jest.Mock).mockImplementation((r: any) => Promise.resolve(r));

      const count = await service.removeTag('user1', '报价');
      expect(count).toBe(1);
    });
  });

  // ============================================
  // removeAll
  // ============================================

  describe('removeAll', () => {
    it('删除用户全部记录并返回计数', async () => {
      (mockRepo.delete as jest.Mock).mockResolvedValue({ affected: 42 });

      const count = await service.removeAll('user1');
      expect(count).toBe(42);
    });

    it('无记录时返回 0', async () => {
      (mockRepo.delete as jest.Mock).mockResolvedValue({ affected: 0 });

      const count = await service.removeAll('user1');
      expect(count).toBe(0);
    });
  });

  // ============================================
  // 分组决策：关键词优先 (preferKeywordOverFlatAi + matchKeywordGroup)
  // 修复点：正文命中关键词即权威，覆盖 AI 的扁平分组误判与多级幻觉；
  //        AI 仅作「无关键词命中」时的兜底。
  // ============================================

  describe('分组决策：关键词优先', () => {
    const realAi = new AiService(); // 构造函数无依赖，仅读 env

    it('正文命中关键词时覆盖 AI 扁平分组误判（火锅→餐饮，而非采购）', () => {
      // 模拟原始 bug：AI 把「火锅」误归「采购」
      mockAi.matchKeywordGroup = jest.fn().mockReturnValue(
        realAi.matchKeywordGroup('晚上跟同事去吃了火锅'),
      );
      const sg = { name: '采购', color: '#fff', isNew: false, existingGroupName: '采购', description: 'x' };
      const out = (service as any).preferKeywordOverFlatAi(sg, '晚上跟同事去吃了火锅');
      expect(out.name).toBe('餐饮');
    });

    it('正文命中关键词时覆盖 AI 多级幻觉（瓷砖→采购·建材，而非装修施工）', () => {
      mockAi.matchKeywordGroup = jest.fn().mockReturnValue(
        realAi.matchKeywordGroup('下单买了瓷砖，约了师傅铺砖'),
      );
      const sg = { name: '装修施工/铺砖', color: '#fff', isNew: false, existingGroupName: '装修施工/铺砖', description: 'x' };
      const out = (service as any).preferKeywordOverFlatAi(sg, '下单买了瓷砖，约了师傅铺砖');
      expect(out.name).toBe('采购·建材');
    });

    it('AI 建议与关键词一致时透传', () => {
      mockAi.matchKeywordGroup = jest.fn().mockReturnValue({ name: '餐饮', color: '#E8815C', description: '吃饭餐饮' });
      const sg = { name: '餐饮', color: '#E8815C', isNew: false, existingGroupName: '餐饮', description: '吃饭餐饮' };
      const out = (service as any).preferKeywordOverFlatAi(sg, '晚上跟同事去吃了火锅');
      expect(out.name).toBe('餐饮');
    });

    it('无关键词命中时保留 AI 建议（含多级）', () => {
      mockAi.matchKeywordGroup = jest.fn().mockReturnValue(null);
      const sg = { name: '装修施工/3号馆', color: '#fff', isNew: false, existingGroupName: '装修施工/3号馆', description: 'x' };
      const out = (service as any).preferKeywordOverFlatAi(sg, '一些模糊的描述没有关键词');
      expect(out.name).toBe('装修施工/3号馆');
    });

    it('matchKeywordGroup 仅看正文：供应商打款→财务（结清+尾款，付款意图优先）', () => {
      const m = realAi.matchKeywordGroup('给供应商打了笔款，合同尾款结清');
      expect(m.name).toBe('财务');
    });

    it('matchKeywordGroup 房贷→理财投资（理财投资排在财务前）', () => {
      const m = realAi.matchKeywordGroup('这个月房贷自动扣款了');
      expect(m.name).toBe('理财投资');
    });

    it('matchKeywordGroup 瓷砖→采购·建材（下单不再抢走）', () => {
      const m = realAi.matchKeywordGroup('下单买了瓷砖，约了师傅铺砖');
      expect(m.name).toBe('采购·建材');
    });
  });
});
