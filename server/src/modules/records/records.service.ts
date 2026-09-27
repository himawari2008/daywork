import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { DayRecord } from './entities/record.entity';
import { CreateRecordDto } from './dto/create-record.dto';
import { UpdateRecordDto } from './dto/update-record.dto';
import { QueryRecordDto } from './dto/query-record.dto';
import { AiService } from '../ai/ai.service';
import { SuggestedGroup } from '../ai/ai.service';
import { SpeechService } from '../speech/speech.service';
import { OcrService } from '../speech/ocr.service';
import { GroupsService } from '../groups/groups.service';
import { LoansService } from '../loans/loans.service';
import { BatchSaveDto } from './dto/batch-save.dto';
import { CsvImportDto } from './dto/csv-import.dto';

/**
 * 记录服务
 * 核心业务逻辑：创建记录时调用 AI 解析，自动分组，CRUD 管理
 */
@Injectable()
export class RecordsService {
  constructor(
    @InjectRepository(DayRecord)
    private readonly recordRepo: Repository<DayRecord>,
    private readonly aiService: AiService,
    private readonly speechService: SpeechService,
    private readonly ocrService: OcrService,
    private readonly groupsService: GroupsService,
    private readonly loansService: LoansService,
  ) {}

  /**
   * 关键词优先决议：正文命中关键词即权威，覆盖 AI 任意分组建议；
   * AI 仅作「无关键词命中」时的兜底（保留其创意名称与多级「父/子」结构）。
   * 这样既能纠正 AI 把「火锅」误归「采购」这类错分，
   * 又不会让 AI 用自带的 tags 反过来覆盖已校准的词库（分组决策只看正文）。
   * 语义相似度兜底由调用方在 sg 为 null 时再调用。
   */
  private preferKeywordOverFlatAi(
    sg: SuggestedGroup | null,
    content: string,
  ): SuggestedGroup | null {
    // 关键词优先：正文命中的关键词分类即权威结果，AI 建议仅作「无关键词命中」时的兜底。
    // 这样既能纠正 AI 把「火锅」误归「采购」这类错分，又不会让 AI 反过来覆盖已校准的词库。
    const m = this.aiService.matchKeywordGroup(content); // 只用正文，不让 AI tags 回灌影响分组
    if (!m) return sg;
    if (sg && sg.name === m.name) return sg; // 关键词与 AI 一致，无需覆盖
    return {
      name: m.name,
      color: m.color,
      isNew: true,
      existingGroupName: null,
      description: m.description,
    };
  }

  /**
   * 创建记录：用户说的话 → AI 解析 → 自动分组 → 保存到数据库
   */
  async create(dto: CreateRecordDto, userId: string): Promise<DayRecord> {
    // 0. 获取已有分组名列表和常用标签（供 AI 匹配复用）
    const existingGroups = await this.groupsService.findAll(userId);
    const existingGroupNames = existingGroups.groups.map((g) => g.name);
    // 获取用户 Top 20 常用标签，让 AI 优先复用，提高分类一致性
    const tagStats = await this.recordRepo
      .createQueryBuilder('record')
      .select('unnest(record.tags)', 'tag')
      .addSelect('COUNT(*)', 'count')
      .where('record.userId = :userId', { userId })
      .groupBy('tag')
      .orderBy('count', 'DESC')
      .limit(20)
      .getRawMany();
    const existingTags = tagStats.map((r: any) => r.tag);

    // 1. 调用 AI 解析（传入已有分组名和常用标签）
    const parsed = await this.aiService.parseContent(dto.content, existingGroupNames, existingTags);

    // 2. 处理 AI 建议的分组：匹配已有分组 或 创建新分组
    let groupId: string | null = null;
    let groupName: string | null = null;
    // 可靠性兜底：AI 成功解析但没给分组（suggestedGroup 为 null）时，
    // 用关键词/标签规则再兜底归类一次，避免「只有标签、没有分组」。
    let sg = this.preferKeywordOverFlatAi(parsed.suggestedGroup, dto.content);
    if (!sg) {
      sg = this.aiService.fallbackGroup(dto.content);
    }
    if (!sg) {
      sg = await this.aiService.semanticGroupMatch(dto.content, parsed.tags);
    }
    if (sg) {
      // 优先按 AI 指定的已有分组名精确匹配；匹配不到或建议新建时，统一按 name 兜底创建/复用。
      // 关键点：只要 suggestedGroup 带了 name，就绝不放过 —— 避免「AI 给了分组却被丢弃 → 只有标签」。
      if (!sg.isNew && sg.existingGroupName) {
        const matched = existingGroups.groups.find(
          (g) => g.name === sg!.existingGroupName,
        );
        if (matched) {
          groupId = matched.id;
          groupName = matched.name;
        }
      }
      // 未匹配到已有分组（或 AI 建议新建 / 没给 existingGroupName）→ 按 name 兜底
      if (!groupId && sg.name) {
        const group = await this.groupsService.findOrCreate(
          sg.name,
          userId,
          sg.color,
          sg.description || undefined,
        );
        groupId = group.id;
        groupName = group.name;
      }
    }

    // 最终兜底：若 AI 返回的分组对象无法解析（极少数情况），再跑一次关键词 + 语义，
    // 确保「尽量有分组」，绝不退回「只有标签」。
    if (!groupId) {
      const kw = this.aiService.fallbackGroup(dto.content);
      if (kw) {
        const g = await this.groupsService.findOrCreate(
          kw.name,
          userId,
          kw.color,
          kw.description || undefined,
        );
        groupId = g.id;
        groupName = g.name;
      }
    }
    if (!groupId) {
      const sm = await this.aiService.semanticGroupMatch(dto.content, parsed.tags);
      if (sm) {
        const g = await this.groupsService.findOrCreate(
          sm.name,
          userId,
          sm.color,
          sm.description || undefined,
        );
        groupId = g.id;
        groupName = g.name;
      }
    }

    // 3. 创建实体，用户原始内容为准，AI 结果辅助
    const record = this.recordRepo.create({
      content: dto.content,
      summary: parsed.summary,
      tags: parsed.tags,
      people: parsed.people,
      numericInfo: parsed.numericInfo,
      status: parsed.status,
      mood: parsed.mood ? JSON.stringify(parsed.mood) : null,
      attachments: dto.attachments || [],
      remindAt: parsed.remindAt ? new Date(parsed.remindAt) : null,
      recordedAt: parsed.recordedAt
        ? new Date(parsed.recordedAt)
        : dto.recordedAt
          ? new Date(dto.recordedAt)
          : new Date(),
      groupId,
      userId,
    });

    // 4. 保存
    const saved = await this.recordRepo.save(record);

    // 5. 检查是否需要关联历史记录（自动完成以前的待办）
    if (parsed.people.length > 0) {
      const relatedPending = await this.recordRepo.findOne({
        where: { status: '待办', userId },
        order: { recordedAt: 'DESC' },
      });
      if (relatedPending) {
        saved.relatedRecordId = relatedPending.id;
        await this.recordRepo.save(saved);
      }
    }

    // 6. AI 检测到借贷语义 → 自动创建借支记录
    if (parsed.loan) {
      try {
        const loan = await this.loansService.create(
          {
            person: parsed.loan.person,
            amount: parsed.loan.amount,
            direction: parsed.loan.direction,
            reason: parsed.loan.reason || undefined,
            linkedRecordId: saved.id,
            recordedAt: saved.recordedAt?.toISOString(),
          },
          userId,
        );
        (saved as any)._loan = { id: loan.id, person: loan.person, amount: loan.amount, direction: loan.direction };
        console.log(`[Loan] 自动创建借支: ${loan.direction === 'lend' ? '借出给' : '向'}${loan.person} ${loan.amount}元`);
      } catch (err) {
        console.warn('[Loan] 自动创建借支失败（不影响主流程）:', (err as Error).message);
      }
    }

    // 7. 附加分组名到返回对象（前端可直接展示）
    (saved as any)._groupName = groupName;

    return saved;
  }

  /**
   * 批量创建记录：智能检测多人/多任务内容 → AI 拆分为多条 → 逐条保存
   * 场景："老张贴砖20平方、老李刷墙、小王搬货" → 自动拆为3条独立记录
   *
   * @returns { records: DayRecord[], isBatch: boolean }
   *   isBatch=true 表示拆分为多条，前端可展示批量确认卡片
   */
  async createBatch(dto: CreateRecordDto, userId: string) {
    // 0. 获取已有分组和常用标签
    const existingGroups = await this.groupsService.findAll(userId);
    const existingGroupNames = existingGroups.groups.map((g) => g.name);
    const tagStats = await this.recordRepo
      .createQueryBuilder('record')
      .select('unnest(record.tags)', 'tag')
      .addSelect('COUNT(*)', 'count')
      .where('record.userId = :userId', { userId })
      .groupBy('tag')
      .orderBy('count', 'DESC')
      .limit(20)
      .getRawMany();
    const existingTags = tagStats.map((r: any) => r.tag);

    // 1. AI 批量解析
    const { records: parsedRecords, isBatch } = await this.aiService.parseBatch(
      dto.content,
      existingGroupNames,
      existingTags,
    );

    // 2. 逐条保存（并行），每条独立匹配分组
    const savedRecords: DayRecord[] = [];
    for (const parsed of parsedRecords) {
      // 匹配分组（逻辑与单条 create 相同）
      let groupId: string | null = null;
      let groupName: string | null = null;
      // 可靠性兜底：关键词优先核对 → AI 没给分组时，用关键词/标签规则再兜底归类 → 语义相似度兜底
      let sg = this.preferKeywordOverFlatAi(parsed.suggestedGroup, dto.content);
      if (!sg) {
        sg = this.aiService.fallbackGroup(dto.content);
      }
      if (!sg) {
        sg = await this.aiService.semanticGroupMatch(dto.content, parsed.tags);
      }
      if (sg) {
        // 优先按 AI 指定的已有分组名精确匹配
        if (!sg.isNew && sg.existingGroupName) {
          const matched = existingGroups.groups.find(
            (g) => g.name === sg!.existingGroupName,
          );
          if (matched) {
            groupId = matched.id;
            groupName = matched.name;
          }
        }
        // 未匹配到已有分组（或 AI 建议新建 / 没给 existingGroupName）→ 按 name 兜底
        if (!groupId && sg.name) {
          const group = await this.groupsService.findOrCreate(
            sg.name,
            userId,
            sg.color,
            sg.description || undefined,
          );
          groupId = group.id;
          groupName = group.name;
        }
      }

      // 最终兜底：若 AI 返回的分组对象无法解析，再跑一次关键词 + 语义
      if (!groupId) {
        const kw = this.aiService.fallbackGroup(dto.content);
        if (kw) {
          const g = await this.groupsService.findOrCreate(
            kw.name,
            userId,
            kw.color,
            kw.description || undefined,
          );
          groupId = g.id;
          groupName = g.name;
        }
      }
      if (!groupId) {
        const sm = await this.aiService.semanticGroupMatch(dto.content, parsed.tags);
        if (sm) {
          const g = await this.groupsService.findOrCreate(
            sm.name,
            userId,
            sm.color,
            sm.description || undefined,
          );
          groupId = g.id;
          groupName = g.name;
        }
      }

      const record = this.recordRepo.create({
        content: dto.content,
        summary: parsed.summary,
        tags: parsed.tags,
        people: parsed.people,
        numericInfo: parsed.numericInfo,
        status: parsed.status,
        mood: parsed.mood ? JSON.stringify(parsed.mood) : null,
        attachments: dto.attachments || [],
        remindAt: parsed.remindAt ? new Date(parsed.remindAt) : null,
        recordedAt: parsed.recordedAt
          ? new Date(parsed.recordedAt)
          : new Date(),
        groupId,
        userId,
      });

      const saved = await this.recordRepo.save(record);

      // AI 检测到借贷语义 → 自动创建借支记录
      if (parsed.loan) {
        try {
          const loan = await this.loansService.create(
            {
              person: parsed.loan.person,
              amount: parsed.loan.amount,
              direction: parsed.loan.direction,
              reason: parsed.loan.reason || undefined,
              linkedRecordId: saved.id,
              recordedAt: saved.recordedAt?.toISOString(),
            },
            userId,
          );
          (saved as any)._loan = { id: loan.id, person: loan.person, amount: loan.amount, direction: loan.direction };
          console.log(`[Loan] 批量中自动创建借支: ${loan.direction === 'lend' ? '借出给' : '向'}${loan.person} ${loan.amount}元`);
        } catch (err) {
          console.warn('[Loan] 自动创建借支失败（不影响主流程）:', (err as Error).message);
        }
      }

      (saved as any)._groupName = groupName;
      savedRecords.push(saved);
    }

    return { records: savedRecords, isBatch };
  }

  /**
   * 语音创建记录：音频 Buffer → 百度 STT 转文字 → AI 解析 → 保存
   * 同时保留原始音频文件到 uploads/voice/ 目录，支持回放
   */
  async createFromVoice(
    audioBuffer: Buffer,
    audioFormat: string,
    userId: string,
  ): Promise<{ records: DayRecord[]; isBatch: boolean }> {
    // 1. 保存原始音频文件
    let voiceUrl: string | null = null;
    try {
      const voiceDir = path.join(__dirname, '..', '..', '..', 'uploads', 'voice');
      if (!fs.existsSync(voiceDir)) {
        fs.mkdirSync(voiceDir, { recursive: true });
      }
      const ext = audioFormat === 'mp3' ? 'mp3' : audioFormat === 'm4a' ? 'm4a' : 'wav';
      const fileName = `${userId}_${Date.now()}.${ext}`;
      const filePath = path.join(voiceDir, fileName);
      fs.writeFileSync(filePath, audioBuffer);
      voiceUrl = `/uploads/voice/${fileName}`;
      console.log(`[Voice] 音频已保存: ${voiceUrl}`);
    } catch (err) {
      console.warn('[Voice] 音频保存失败（不影响主流程）:', (err as Error).message);
    }

    // 2. 语音转文字
    const text = await this.speechService.recognize(audioBuffer, audioFormat);

    if (!text || text.trim().length === 0) {
      throw new Error('未识别到语音内容');
    }

    // 3. 使用批量解析（语音也可能提到多人）
    return this.createBatch(
      {
        content: text.trim(),
        attachments: voiceUrl ? [voiceUrl] : [],
      },
      userId,
    );
  }

  /**
   * 查询记录列表，支持分页、标签筛选、状态筛选、关键词搜索
   */
  async findAll(userId: string, query: QueryRecordDto) {
    const { page = 1, limit = 20, tag, status, keyword, groupId, date } = query;

    const qb = this.recordRepo.createQueryBuilder('record').where('record.userId = :userId', { userId });

    if (status) {
      qb.andWhere('record.status = :status', { status });
    }

    // 标签筛选：数组包含
    if (tag) {
      qb.andWhere(':tag = ANY(record.tags)', { tag });
    }

    // 分组筛选
    if (groupId) {
      qb.andWhere('record.groupId = :groupId', { groupId });
    }

    // 日期筛选：按 YYYY-MM-DD 过滤（服务端精确筛选，支持分页）
    if (date) {
      qb.andWhere("TO_CHAR(record.recordedAt, 'YYYY-MM-DD') = :date", { date });
    }

    // 关键词搜索：在原始内容和摘要中 LIKE
    if (keyword) {
      qb.andWhere('(record.content ILIKE :kw OR record.summary ILIKE :kw)', {
        kw: `%${keyword}%`,
      });
    }

    qb.orderBy('record.recordedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * 查询单条记录
   */
  async findOne(id: string, userId: string): Promise<DayRecord | null> {
    return this.recordRepo.findOne({ where: { id, userId } });
  }

  /**
   * 更新记录：用户手动修改 AI 解析的字段
   */
  async update(id: string, userId: string, dto: UpdateRecordDto): Promise<DayRecord | null> {
    const record = await this.recordRepo.findOne({ where: { id, userId } });
    if (!record) return null;

    Object.assign(record, dto);
    if (dto.recordedAt) {
      record.recordedAt = new Date(dto.recordedAt);
    }

    return this.recordRepo.save(record);
  }

  /**
   * 删除记录
   */
  async remove(id: string, userId: string): Promise<boolean> {
    const result = await this.recordRepo.delete({ id, userId });
    return (result.affected ?? 0) > 0;
  }

  /**
   * 批量删除记录
   */
  async batchRemove(ids: string[], userId: string): Promise<number> {
    if (!ids || ids.length === 0) return 0;
    const result = await this.recordRepo
      .createQueryBuilder()
      .delete()
      .where('id IN (:...ids)', { ids })
      .andWhere('userId = :userId', { userId })
      .execute();
    return result.affected ?? 0;
  }

  /**
   * 获取提醒列表
   * 返回超期（remindAt <= now）和 24h 内到期的未完成记录
   */
  async getReminders(userId: string) {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const reminders = await this.recordRepo
      .createQueryBuilder('record')
      .where('record.userId = :userId', { userId })
      .andWhere('record.remindAt IS NOT NULL')
      .andWhere('(record.status IS NULL OR record.status != :doneStatus)', { doneStatus: '已完成' })
      .orderBy('record.remindAt', 'ASC')
      .getMany();

    const overdue = reminders.filter((r) => r.remindAt && r.remindAt <= now);
    const upcoming = reminders.filter(
      (r) => r.remindAt && r.remindAt > now && r.remindAt <= tomorrow,
    );

    return {
      total: reminders.length,
      overdueCount: overdue.length,
      upcomingCount: upcoming.length,
      overdue,
      upcoming,
    };
  }

  /**
   * 「往日回顾」：随机返回一条 7 天前的历史记录
   * 优先选"同月同日"（往年今日），其次随机选 7 天前的记录
   * 用于首页回忆卡片，促进用户回顾和反思
   */
  async getMemory(userId: string) {
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();

    // 1. 优先：同月同日的历史记录（往年今日，排除今年）
    const sameDayRecords = await this.recordRepo
      .createQueryBuilder('record')
      .where('record.userId = :userId', { userId })
      .andWhere("EXTRACT(MONTH FROM record.recordedAt) = :month", { month })
      .andWhere("EXTRACT(DAY FROM record.recordedAt) = :day", { day })
      .andWhere("EXTRACT(YEAR FROM record.recordedAt) < :year", { year: today.getFullYear() })
      .orderBy('RANDOM()')
      .take(1)
      .getOne();

    if (sameDayRecords) {
      return { record: sameDayRecords, type: 'on-this-day' };
    }

    // 2. 其次：7 天前的随机记录
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    const sevenDaysAgoEnd = new Date(sevenDaysAgo);
    sevenDaysAgoEnd.setHours(23, 59, 59, 999);

    const weekAgoRecord = await this.recordRepo
      .createQueryBuilder('record')
      .where('record.userId = :userId', { userId })
      .andWhere('record.recordedAt >= :start', { start: sevenDaysAgo })
      .andWhere('record.recordedAt <= :end', { end: sevenDaysAgoEnd })
      .orderBy('RANDOM()')
      .take(1)
      .getOne();

    if (weekAgoRecord) {
      return { record: weekAgoRecord, type: 'week-ago' };
    }

    // 3. 兜底：随机选一条 3 天前的记录
    const threeDaysAgo = new Date(today);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const randomRecord = await this.recordRepo
      .createQueryBuilder('record')
      .where('record.userId = :userId', { userId })
      .andWhere('record.recordedAt < :threeDaysAgo', { threeDaysAgo })
      .orderBy('RANDOM()')
      .take(1)
      .getOne();

    if (randomRecord) {
      return { record: randomRecord, type: 'random' };
    }

    return { record: null, type: 'empty' };
  }

  /**
   * 统计概览：总记录数、标签分布、状态分布
   */
  async getStats(userId: string) {
    const total = await this.recordRepo.count({ where: { userId } });

    // 本月记录数
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthCount = await this.recordRepo
      .createQueryBuilder('record')
      .where('record.userId = :userId', { userId })
      .andWhere('record.recordedAt >= :monthStart', { monthStart })
      .getCount();

    // 本周记录数
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() + mondayOffset);
    weekStart.setHours(0, 0, 0, 0);
    const weekCount = await this.recordRepo
      .createQueryBuilder('record')
      .where('record.userId = :userId', { userId })
      .andWhere('record.recordedAt >= :weekStart', { weekStart })
      .getCount();

    // 记录天数
    const daysResult = await this.recordRepo
      .createQueryBuilder('record')
      .select("COUNT(DISTINCT TO_CHAR(record.recordedAt, 'YYYY-MM-DD'))", 'days')
      .where('record.userId = :userId', { userId })
      .getRawOne();
    const daysActive = daysResult ? Number(daysResult.days) : 0;

    // 标签统计
    const tagStats = await this.recordRepo
      .createQueryBuilder('record')
      .select('unnest(record.tags)', 'tag')
      .addSelect('COUNT(*)', 'count')
      .where('record.userId = :userId', { userId })
      .groupBy('tag')
      .orderBy('count', 'DESC')
      .limit(20)
      .getRawMany();

    // 状态分布
    const statusStats = await this.recordRepo
      .createQueryBuilder('record')
      .select('record.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('record.userId = :userId', { userId })
      .andWhere('record.status IS NOT NULL')
      .groupBy('record.status')
      .getRawMany();

    // 人物频率（Top 10）
    const peopleStats = await this.recordRepo
      .createQueryBuilder('record')
      .select('unnest(record.people)', 'person')
      .addSelect('COUNT(*)', 'count')
      .where('record.userId = :userId', { userId })
      .groupBy('person')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany();

    return {
      total,
      monthCount,
      weekCount,
      daysActive,
      topTags: tagStats,
      statusDistribution: statusStats,
      topPeople: peopleStats,
    };
  }

  /**
   * 日历热力图数据：指定年月的每日记录数
   */
  async getCalendar(userId: string, year: number, month: number) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const rows = await this.recordRepo
      .createQueryBuilder('record')
      .select("TO_CHAR(record.recordedAt, 'YYYY-MM-DD')", 'date')
      .addSelect('COUNT(*)', 'count')
      .where('record.userId = :userId', { userId })
      .andWhere('record.recordedAt >= :start', { start })
      .andWhere('record.recordedAt < :end', { end })
      .groupBy('date')
      .getRawMany();

    const map: Record<string, number> = {};
    rows.forEach((r: any) => {
      map[r.date] = Number(r.count);
    });
    return map;
  }

  /**
   * 心情河流：最近 N 天的心情概览
   * 兼容新旧 mood 格式：旧格式为纯文本（开心/平静/...），新格式为 JSON 字符串 {label, tone, intensity}
   */
  async getMoodRiver(userId: string, days: number = 7) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const rows = await this.recordRepo
      .createQueryBuilder('record')
      .select("TO_CHAR(record.recordedAt, 'YYYY-MM-DD')", 'date')
      .addSelect('record.mood', 'mood')
      .addSelect('COUNT(*)', 'count')
      .where('record.userId = :userId', { userId })
      .andWhere('record.recordedAt >= :since', { since })
      .andWhere('record.mood IS NOT NULL')
      .groupBy('date')
      .addGroupBy('record.mood')
      .orderBy('date', 'ASC')
      .getRawMany();

    /** 从 raw mood 值中提取 label（兼容新旧格式） */
    const extractLabel = (raw: string): string => {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.label) return parsed.label;
      } catch { /* 旧格式纯文本 */ }
      return raw;
    };

    // 按日期 + label 聚合：每天取出现次数最多的 mood label
    const dayMap: Record<string, Record<string, { count: number; raw: string }>> = {};
    rows.forEach((r: any) => {
      const label = extractLabel(r.mood);
      if (!dayMap[r.date]) dayMap[r.date] = {};
      if (!dayMap[r.date][label]) dayMap[r.date][label] = { count: 0, raw: r.mood };
      dayMap[r.date][label].count += Number(r.count);
    });

    const result: Array<{ date: string; dominantMood: string; count: number }> = [];
    Object.entries(dayMap).forEach(([date, labelMap]) => {
      let dominantMood = '';
      let maxCount = 0;
      let totalCount = 0;
      Object.entries(labelMap).forEach(([label, info]) => {
        totalCount += info.count;
        if (info.count > maxCount) {
          maxCount = info.count;
          dominantMood = info.raw; // 返回原始 mood 值（JSON 或纯文本），前端统一解析
        }
      });
      result.push({ date, dominantMood, count: totalCount });
    });

    return result;
  }

  /**
   * AI 对话：基于用户记录进行自然语言问答 + 执行操作
   *
   * 核心改进（v3）：AI 不再"只说不做"。
   * - AI 返回结构化 JSON：{ answer, actions[] }
   * - 后端解析 actions，执行真正的数据库操作（更新状态/标签/摘要/创建记录）
   * - 用户说"把那个待办标为完成"→ AI 找到记录 id → 后端执行 update
   *
   * @param question 用户的问题或操作要求
   */
  async chat(userId: string, question: string) {
    // 1. 提取问题关键词 → 搜索相关记录
    const keywords = question
      .replace(/[？?！!，。、]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2)
      .slice(0, 5);

    let relevantRecords: DayRecord[] = [];
    if (keywords.length > 0) {
      const qb = this.recordRepo.createQueryBuilder('record')
        .where('record.userId = :userId', { userId });

      keywords.forEach((kw, i) => {
        qb.orWhere(`(record.content ILIKE :kw${i} OR record.summary ILIKE :kw${i})`, { [`kw${i}`]: `%${kw}%` });
      });

      relevantRecords = await qb
        .orderBy('record.recordedAt', 'DESC')
        .take(30)
        .getMany();
    }

    // 如果关键词没搜到，取最近记录
    if (relevantRecords.length === 0) {
      relevantRecords = await this.recordRepo.find({
        where: { userId },
        order: { recordedAt: 'DESC' },
        take: 30,
      });
    }

    // 2. 构建结构化上下文（带 id，AI 需要 id 来定位操作目标）
    const recordsContext = relevantRecords.map((r) => ({
      id: r.id,
      summary: r.summary ?? undefined,
      content: r.content ?? undefined,
      tags: r.tags ?? undefined,
      people: r.people ?? undefined,
      status: r.status ?? undefined,
      mood: r.mood ?? undefined,
      numericInfo: r.numericInfo ?? undefined,
      recordedAt: r.recordedAt ?? undefined,
    }));

    // 3. 用户概况
    const totalRecords = await this.recordRepo.count({ where: { userId } });
    const allRows = await this.recordRepo
      .createQueryBuilder('record')
      .select("DISTINCT TO_CHAR(record.recordedAt, 'YYYY-MM-DD')", 'date')
      .where('record.userId = :userId', { userId })
      .getRawMany();
    const daysActive = allRows.length;
    const streakData = await this.getStreak(userId);

    // 4. 调用 AI（返回结构化 JSON，含 answer + actions）
    const chatResponse = await this.aiService.chat(question, recordsContext, {
      totalRecords,
      daysActive,
      currentStreak: streakData.currentStreak,
    });

    // 5. 执行 AI 请求的操作（核心：从"只说不做"到"说到做到"）
    const executedActions: Array<{ type: string; recordId?: string; success: boolean; error?: string }> = [];

    for (const action of chatResponse.actions) {
      try {
        switch (action.type) {
          case 'update_status': {
            if (!action.recordId || !action.status) break;
            const record = await this.recordRepo.findOne({ where: { id: action.recordId, userId } });
            if (record) {
              record.status = action.status;
              // 如果标记为已完成，检查是否需要关联到之前提到的记录
              await this.recordRepo.save(record);
              executedActions.push({ type: 'update_status', recordId: action.recordId, success: true });
            } else {
              executedActions.push({ type: 'update_status', recordId: action.recordId, success: false, error: '记录不存在' });
            }
            break;
          }

          case 'update_tags': {
            if (!action.recordId || !action.tags) break;
            const record = await this.recordRepo.findOne({ where: { id: action.recordId, userId } });
            if (record) {
              record.tags = action.tags;
              await this.recordRepo.save(record);
              executedActions.push({ type: 'update_tags', recordId: action.recordId, success: true });
            } else {
              executedActions.push({ type: 'update_tags', recordId: action.recordId, success: false, error: '记录不存在' });
            }
            break;
          }

          case 'update_summary': {
            if (!action.recordId || !action.summary) break;
            const record = await this.recordRepo.findOne({ where: { id: action.recordId, userId } });
            if (record) {
              record.summary = action.summary;
              await this.recordRepo.save(record);
              executedActions.push({ type: 'update_summary', recordId: action.recordId, success: true });
            } else {
              executedActions.push({ type: 'update_summary', recordId: action.recordId, success: false, error: '记录不存在' });
            }
            break;
          }

          case 'add_record': {
            if (!action.summary) break;
            // mood 可能是 MoodInfo 对象或 string，统一转为 JSON 字符串存储
            let moodStr: string | null = null;
            if (action.mood) {
              moodStr = typeof action.mood === 'string' ? action.mood : JSON.stringify(action.mood);
            }
            const entity = this.recordRepo.create({
              content: action.summary,
              summary: action.summary,
              tags: action.tags || [],
              people: action.people || [],
              numericInfo: action.numericInfo || {},
              status: action.status || null,
              mood: moodStr,
              recordedAt: new Date(),
              userId,
            });
            const saved = await this.recordRepo.save(entity);
            executedActions.push({ type: 'add_record', recordId: saved.id, success: true });
            break;
          }

          case 'none':
            // 无操作，跳过
            break;
        }
      } catch (error) {
        executedActions.push({
          type: action.type,
          recordId: action.recordId,
          success: false,
          error: (error as Error).message,
        });
      }
    }

    // 6. 如果执行了操作，把更新的记录重新加入上下文做二次确认
    // （让 AI 的 answer 能引用最新的状态）

    return {
      question,
      answer: chatResponse.answer,
      actions: chatResponse.actions,
      executedCount: executedActions.filter((a) => a.success).length,
      executedActions,
      relevantCount: relevantRecords.length,
      /** 相关记录摘要（供前端展示可点击的记录卡片） */
      relevantRecords: relevantRecords.map((r) => ({
        id: r.id,
        summary: r.summary ?? r.content?.slice(0, 50) ?? '',
        status: r.status ?? null,
        recordedAt: r.recordedAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * AI 总结：生成一段时间的工作回顾
   */
  async summarize(userId: string, period: 'week' | 'month' = 'week') {
    const now = new Date();
    const start = new Date();
    let periodLabel = '';

    if (period === 'week') {
      const dayOfWeek = now.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      start.setDate(now.getDate() + mondayOffset);
      start.setHours(0, 0, 0, 0);
      const endDay = new Date(start);
      endDay.setDate(start.getDate() + 6);
      periodLabel = `本周（${start.toISOString().slice(0, 10)} 至 ${now.toISOString().slice(0, 10)}）`;
    } else {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      periodLabel = `本月（${start.toISOString().slice(0, 10)} 至 ${now.toISOString().slice(0, 10)}）`;
    }

    const records = await this.recordRepo.find({
      where: { userId },
      order: { recordedAt: 'DESC' },
    });

    const periodRecords = records.filter((r) => r.recordedAt >= start && r.recordedAt <= now);

    // 构建统计摘要
    const tagCounts: Record<string, number> = {};
    const peopleCounts: Record<string, number> = {};
    const statuses: Record<string, number> = {};
    const moods: string[] = [];

    periodRecords.forEach((r) => {
      (r.tags || []).forEach((t) => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
      (r.people || []).forEach((p) => { peopleCounts[p] = (peopleCounts[p] || 0) + 1; });
      if (r.status) statuses[r.status] = (statuses[r.status] || 0) + 1;
      if (r.mood) moods.push(r.mood);
    });

    const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v}次)`).join('、');
    const topPeople = Object.entries(peopleCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v}次)`).join('、');
    const doneCount = statuses['已完成'] || 0;
    const pendingCount = statuses['待办'] || 0;
    const followupCount = statuses['待跟进'] || 0;
    const totalStatus = doneCount + pendingCount + followupCount;
    const completionRate = totalStatus > 0 ? Math.round((doneCount / totalStatus) * 100) : 0;

    const recordsSummary = periodRecords.map((r) => {
      const parts = [`[${r.recordedAt.toISOString().slice(0, 10)}] ${r.summary || r.content.slice(0, 30)}`];
      if (r.tags && r.tags.length > 0) parts.push(`标签: ${r.tags.join('、')}`);
      if (r.people && r.people.length > 0) parts.push(`人物: ${r.people.join('、')}`);
      if (r.status) parts.push(`状态: ${r.status}`);
      if (r.mood) parts.push(`心情: ${r.mood}`);
      return parts.join(' | ');
    }).join('\n');

    const summaryText = await this.aiService.summarize(periodLabel, recordsSummary);

    return {
      period: periodLabel,
      recordCount: periodRecords.length,
      topTags,
      topPeople,
      statuses: { 已完成: doneCount, 待办: pendingCount, 待跟进: followupCount },
      completionRate,
      moods: moods.length > 0 ? moods : null,
      summaryText,
    };
  }

  /**
   * 导入预览：将文档文本发送给 AI 解析，返回结构化预览
   * 支持文本文件和图片 OCR 结果
   */
  async previewImport(content: string) {
    if (!content || content.trim().length === 0) {
      throw new Error('导入内容不能为空');
    }

    // 截断过长文本（30K 字符 ≈ 20K tokens，留出响应空间）
    let text = content;
    if (text.length > 30000) {
      console.warn(`导入文本过长(${content.length}字符)，截断至30000字符`);
      text = text.slice(0, 30000);
    }

    const result = await this.aiService.parseDocument(text);
    return {
      documentSummary: result.documentSummary,
      records: result.records,
      recordCount: result.records.length,
    };
  }

  /**
   * 从图片 Buffer 导入：优先使用视觉 AI 直接解析，降级到 OCR
   *
   * 两条路径：
   * - 优先：智谱 GLM-4V 视觉模型 — 一步完成"看懂图片 + 结构化解析"
   * - 降级：百度 OCR → DeepSeek AI 解析 — 需要百度 API 密钥
   */
  async previewImportFromImage(imageBuffer: Buffer) {
    // 推断 MIME 类型（根据文件头魔数）
    let mimeType = 'image/png'; // 默认
    if (imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8) {
      mimeType = 'image/jpeg';
    } else if (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50) {
      mimeType = 'image/png';
    } else if (imageBuffer[0] === 0x42 && imageBuffer[1] === 0x4d) {
      mimeType = 'image/bmp';
    } else if (imageBuffer[0] === 0x52 && imageBuffer[1] === 0x49) {
      mimeType = 'image/webp';
    }

    const imageBase64 = imageBuffer.toString('base64');

    // 方案 1：优先使用通义千问 Qwen-VL 直接解析图片（无需 OCR）
    try {
      const result = await this.aiService.parseImage(imageBase64, mimeType);
      if (result.records && result.records.length > 0) {
        console.log(`图片导入: Qwen-VL 直接解析成功，识别 ${result.records.length} 条记录`);
        return {
          documentSummary: result.documentSummary,
          records: result.records,
          recordCount: result.records.length,
          parseMethod: 'vision-ai', // 标记解析方式
        };
      }
      // 视觉模型没识别到文字 → 降级 OCR
      console.log('图片导入: Qwen-VL 未识别到文字，降级到百度 OCR');
    } catch (error) {
      console.log('图片导入: Qwen-VL 失败，降级到百度 OCR:', (error as Error).message);
    }

    // 方案 2：降级到百度 OCR + AI 解析
    if (!this.ocrService.isConfigured()) {
      throw new Error(
        '图片识别失败。请确认：\n' +
        '1. 图片是否清晰，文字是否可辨认\n' +
        '2. 或在 .env 中配置 QWEN_VL_API_KEY（通义千问视觉模型）或 BAIDU_API_KEY（百度OCR）',
      );
    }

    const ocrText = await this.ocrService.recognize(imageBuffer);
    if (!ocrText || ocrText.trim().length === 0) {
      throw new Error('图片中未识别到文字内容');
    }

    return this.previewImport(ocrText);
  }

  /**
   * 视频导入预览
   * 尝试用 Qwen-VL 视觉模型直接理解视频内容
   * 降级方案：提示用户补充文字说明
   */
  async previewImportFromVideo(videoBuffer: Buffer, mimeType: string) {
    // 方案 1：优先使用通义千问 Qwen-VL 视觉模型（支持视频输入）
    try {
      const videoBase64 = videoBuffer.toString('base64');
      const result = await this.aiService.parseVideo(videoBase64, mimeType);
      if (result.records && result.records.length > 0) {
        console.log(`视频导入: Qwen-VL 解析成功，识别 ${result.records.length} 条记录`);
        return {
          documentSummary: result.documentSummary,
          records: result.records,
          recordCount: result.records.length,
          parseMethod: 'vision-ai-video',
        };
      }
      console.log('视频导入: Qwen-VL 未识别到有效内容');
    } catch (error) {
      console.log('视频导入: Qwen-VL 失败:', (error as Error).message);
    }

    // 方案 2：降级 — 返回提示，让用户补充文字
    return {
      documentSummary: '视频已上传，请补充文字说明录制了什么工作内容',
      records: [],
      recordCount: 0,
      parseMethod: 'pending-manual',
    };
  }

  /**
   * 批量保存：用户审核确认后，一次性保存所有记录 + 自动关联
   */
  async batchSave(dto: BatchSaveDto, userId: string) {
    const now = new Date();

    // 1. 先保存文档摘要记录（作为特殊标记记录）
    const summaryRecord = this.recordRepo.create({
      content: `[导入] ${dto.fileName || '文档导入'}`,
      summary: dto.documentSummary,
      tags: ['导入摘要'],
      people: [],
      numericInfo: {},
      status: null,
      mood: null,
      recordedAt: now,
      userId,
    });
    const savedSummary = await this.recordRepo.save(summaryRecord);

    // 2. 批量创建记录（按顺序分配时间，保持文档中的先后关系）
    const savedRecords: DayRecord[] = [];
    // 分组缓存：避免同一次导入中对同一分组名重复 findOrCreate
    const groupCache = new Map<string, string>();
    for (let i = 0; i < dto.records.length; i++) {
      const item = dto.records[i];
      // 时间分配：优先用 AI 解析的 recordedAt，否则用当前时间减去序号秒
      let recordedAt = now;
      if (item.recordedAt) {
        const parsed = new Date(item.recordedAt);
        if (!isNaN(parsed.getTime())) {
          recordedAt = parsed;
        }
      }
      // 如果多条记录使用同一时间，按序号递减秒数
      if (!item.recordedAt) {
        recordedAt = new Date(now.getTime() - i * 1000);
      }

      // 处理分组：优先用户指定 → AI 建议名（关键词冲突时覆盖）→ 关键词兜底 → 语义兜底
      let groupId: string | null = null;
      let resolvedName: string | null = item.suggestedGroupName || null;
      let resolvedColor = '#4A5C7C';
      // 关键词优先核对：预览给的扁平分组名与关键词冲突时，用关键词覆盖（修 AI 误分）
      if (resolvedName && !resolvedName.includes('/')) {
        const fb = this.aiService.fallbackGroup(item.summary || '');
        if (fb && fb.name !== resolvedName) {
          resolvedName = fb.name;
          resolvedColor = fb.color || '#4A5C7C';
        }
      }
      if (!resolvedName && !item.groupId) {
        // 预览没给分组名时，先用关键词/标签规则兜底，再用语义相似度兜底
        const fb = this.aiService.fallbackGroup(item.summary || '');
        if (fb) {
          resolvedName = fb.name;
          resolvedColor = fb.color || '#4A5C7C';
        } else {
          const sg2 = await this.aiService.semanticGroupMatch(item.summary || '', item.tags || []);
          if (sg2) {
            resolvedName = sg2.name;
            resolvedColor = sg2.color || '#4A5C7C';
          }
        }
      }
      if (item.groupId) {
        groupId = item.groupId;
      } else if (resolvedName) {
        const name = resolvedName;
        if (groupCache.has(name)) {
          groupId = groupCache.get(name) || null;
        } else {
          try {
            const group = await this.groupsService.findOrCreate(name, userId, resolvedColor);
            groupId = group.id;
            groupCache.set(name, groupId);
          } catch {
            // 分组创建失败不影响记录保存
            groupId = null;
          }
        }
      }

      const record = this.recordRepo.create({
        content: item.summary, // 导入的记录以 summary 作为原始内容
        summary: item.summary,
        tags: item.tags || [],
        people: item.people || [],
        numericInfo: item.numericInfo || {},
        status: item.status || null,
        mood: item.mood || null,
        recordedAt,
        groupId,
        userId,
      });
      const saved = await this.recordRepo.save(record);
      savedRecords.push(saved);
    }

    // 3. 自动关联：检查是否有匹配的旧待办/待跟进 → 自动标记为已完成
    let autoCompletedCount = 0;
    for (const saved of savedRecords) {
      if (!saved.people || saved.people.length === 0) continue;

      // 查找同一用户的待办/待跟进记录，且人物有交集
      const pendingRecords = await this.recordRepo
        .createQueryBuilder('record')
        .where('record.userId = :userId', { userId })
        .andWhere('record.status IN (:...statuses)', { statuses: ['待办', '待跟进'] })
        .andWhere('record.id != :selfId', { selfId: saved.id })
        .getMany();

      for (const pending of pendingRecords) {
        const pendingPeople = pending.people || [];
        const hasOverlap = saved.people.some((p: string) => pendingPeople.includes(p));
        if (hasOverlap) {
          // 关联 + 标记完成
          saved.relatedRecordId = pending.id;
          await this.recordRepo.save(saved);

          pending.status = '已完成';
          pending.relatedRecordId = saved.id;
          await this.recordRepo.save(pending);
          autoCompletedCount++;
          break; // 每条新记录只关联一条旧记录
        }
      }
    }

    return {
      savedCount: savedRecords.length,
      savedRecords,
      summaryRecord: savedSummary,
      autoCompletedCount,
    };
  }

  /**
   * 移动记录到指定分组（或取消分组）
   *
   * @param recordId 记录 ID
   * @param groupId 目标分组 ID，null 表示取消分组
   */
  async moveToGroup(recordId: string, userId: string, groupId: string | null): Promise<DayRecord | null> {
    const record = await this.recordRepo.findOne({ where: { id: recordId, userId } });
    if (!record) return null;

    record.groupId = groupId;
    return this.recordRepo.save(record);
  }

  /**
   * CSV 标准导入：解析 CSV 文本，字段映射创建记录，可选 AI 增强
   * CSV 首行为列名（摘要,标签,人物,状态,心情,数值,时间），后续行为数据
   */
  async importCsv(dto: CsvImportDto, userId: string) {
    const rows = this._parseCsv(dto.csvText);
    if (rows.length === 0) {
      throw new Error('CSV 文件中没有数据行');
    }

    // 解析表头，建立列索引映射
    const header = rows[0];
    const colMap: Record<string, number> = {};
    for (let i = 0; i < header.length; i++) {
      colMap[header[i].trim()] = i;
    }

    const dataRows = rows.slice(1);
    const now = new Date();
    const records: DayRecord[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const summary = row[colMap['摘要']] || '';
      if (!summary.trim()) continue; // 跳过空行

      const tags = (row[colMap['标签']] || '').split(/[、,，]/).map(t => t.trim()).filter(Boolean);
      const people = (row[colMap['人物']] || '').split(/[、,，]/).map(p => p.trim()).filter(Boolean);
      const status = row[colMap['状态']] || null;
      const mood = row[colMap['心情']] || null;
      const dateStr = row[colMap['时间']] || null;

      let recordedAt = now;
      if (dateStr) {
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          recordedAt = parsed;
        }
      }
      // 同一批次多条记录递减秒数
      if (!dateStr) {
        recordedAt = new Date(now.getTime() - i * 1000);
      }

      const record = this.recordRepo.create({
        content: summary,
        summary: summary,
        tags: tags,
        people: people,
        numericInfo: {},
        status: status,
        mood: mood,
        recordedAt: recordedAt,
        userId: userId,
      });
      records.push(record);
    }

    if (records.length === 0) {
      throw new Error('未解析出有效记录');
    }

    // 可选：AI 增强（为每条记录补充标签/分组/状态/心情）
    if (dto.enhance) {
      const existingGroups = await this.groupsService.findAll(userId);
      const existingGroupNames = existingGroups.groups.map(g => g.name);
      const groupCache = new Map<string, string>();

      for (const record of records) {
        try {
          const parsed = await this.aiService.parseContent(record.content, existingGroupNames, []);
          // 仅在 AI 有更好建议时覆盖
          if (parsed.tags && parsed.tags.length > 0) {
            record.tags = [...new Set([...record.tags, ...parsed.tags])];
          }
          if (parsed.status && !record.status) {
            record.status = parsed.status;
          }
          if (parsed.mood && !record.mood) {
            record.mood = typeof parsed.mood === 'object'
              ? JSON.stringify(parsed.mood)
              : parsed.mood;
          }
          // 分组处理
          if (parsed.suggestedGroup && !record.groupId) {
            // 关键词优先修正：AI 可能误分（如 火锅→采购），正文关键词覆盖
            const sg = this.preferKeywordOverFlatAi(parsed.suggestedGroup, record.content) || parsed.suggestedGroup;
            const name = sg.name;
            if (groupCache.has(name)) {
              record.groupId = groupCache.get(name) || null;
            } else {
              try {
                const group = await this.groupsService.findOrCreate(name, userId, sg.color || '#4A5C7C');
                record.groupId = group.id;
                groupCache.set(name, group.id);
              } catch {
                // 分组失败不影响记录
              }
            }
          }
        } catch {
          // 单条 AI 增强失败不影响其他
        }
      }
    }

    // 批量保存
    const saved = await this.recordRepo.save(records);

    return {
      success: true,
      savedCount: saved.length,
      message: `成功导入 ${saved.length} 条记录`,
    };
  }

  /**
   * 简单 CSV 解析：支持逗号分隔 + 双引号转义
   */
  private _parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      const cells: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === ',' && !inQuotes) {
          cells.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      cells.push(current.trim());
      rows.push(cells);
    }
    return rows;
  }

  /**
   * 导出记录：CSV 或 Markdown 格式
   */
  async exportRecords(userId: string, format: 'csv' | 'markdown' = 'csv'): Promise<{ format: string; content: string; recordCount: number }> {
    const records = await this.recordRepo.find({
      where: { userId },
      order: { recordedAt: 'DESC' },
    });

    let content: string;
    if (format === 'markdown') {
      const lines: string[] = ['# 活记 · 工作记录导出', '', `导出时间: ${new Date().toISOString().slice(0, 10)}`, `共 ${records.length} 条记录`, ''];
      records.forEach((r, i) => {
        lines.push(`## ${i + 1}. ${r.summary || r.content.slice(0, 40)}`);
        lines.push('');
        if (r.content) lines.push(`> ${r.content.slice(0, 100)}`);
        if (r.tags && r.tags.length > 0) lines.push(`- 标签: ${r.tags.join('、')}`);
        if (r.people && r.people.length > 0) lines.push(`- 人物: ${r.people.join('、')}`);
        if (r.status) lines.push(`- 状态: ${r.status}`);
        if (r.mood) lines.push(`- 心情: ${r.mood}`);
        if (r.recordedAt) lines.push(`- 时间: ${r.recordedAt.toISOString().slice(0, 10)}`);
        lines.push('');
      });
      content = lines.join('\n');
    } else {
      // CSV 格式
      const header = '摘要,标签,人物,状态,心情,数值,时间';
      const rows = records.map((r) => {
        const summary = (r.summary || r.content || '').replace(/"/g, '""');
        const tags = (r.tags || []).join('、');
        const people = (r.people || []).join('、');
        const status = r.status || '';
        const mood = r.mood || '';
        const numeric = r.numericInfo ? JSON.stringify(r.numericInfo).replace(/"/g, '""') : '';
        const date = r.recordedAt ? r.recordedAt.toISOString().slice(0, 10) : '';
        return `"${summary}","${tags}","${people}","${status}","${mood}","${numeric}","${date}"`;
      });
      content = [header, ...rows].join('\n');
    }

    return { format, content, recordCount: records.length };
  }

  /**
   * 纯解析：AI 解析文本内容但不保存到数据库
   * 用于详情页的"重新 AI 解析"功能，避免创建然后删除幻影记录
   */
  async parseOnly(content: string, userId: string) {
    if (!content || content.trim().length === 0) {
      throw new Error('内容不能为空');
    }

    const existingGroups = await this.groupsService.findAll(userId);
    const existingGroupNames = existingGroups.groups.map((g) => g.name);
    // 获取用户常用标签
    const tagStats2 = await this.recordRepo
      .createQueryBuilder('record')
      .select('unnest(record.tags)', 'tag')
      .addSelect('COUNT(*)', 'count')
      .where('record.userId = :userId', { userId })
      .groupBy('tag')
      .orderBy('count', 'DESC')
      .limit(20)
      .getRawMany();
    const existingTags2 = tagStats2.map((r: any) => r.tag);

    const parsed = await this.aiService.parseContent(content.trim(), existingGroupNames, existingTags2);

    return {
      summary: parsed.summary,
      tags: parsed.tags,
      people: parsed.people,
      numericInfo: parsed.numericInfo,
      status: parsed.status,
      mood: parsed.mood ? JSON.stringify(parsed.mood) : null,
      recordedAt: parsed.recordedAt,
      suggestedGroup: parsed.suggestedGroup,
    };
  }

  /**
   * 重命名标签：在所有记录中替换标签名
   */
  async renameTag(userId: string, oldName: string, newName: string): Promise<number> {
    const records = await this.recordRepo
      .createQueryBuilder('record')
      .where('record.userId = :userId', { userId })
      .andWhere(':tag = ANY(record.tags)', { tag: oldName })
      .getMany();

    let updatedCount = 0;
    for (const record of records) {
      const tags = (record.tags || []).map((t) => (t === oldName ? newName : t));
      record.tags = tags;
      await this.recordRepo.save(record);
      updatedCount++;
    }

    return updatedCount;
  }

  /**
   * 删除标签：从所有记录中移除指定标签
   */
  async removeTag(userId: string, tagName: string): Promise<number> {
    const records = await this.recordRepo
      .createQueryBuilder('record')
      .where('record.userId = :userId', { userId })
      .andWhere(':tag = ANY(record.tags)', { tag: tagName })
      .getMany();

    let updatedCount = 0;
    for (const record of records) {
      record.tags = (record.tags || []).filter((t) => t !== tagName);
      await this.recordRepo.save(record);
      updatedCount++;
    }

    return updatedCount;
  }

  /**
   * 删除用户全部记录（危险操作）
   */
  async removeAll(userId: string): Promise<number> {
    const result = await this.recordRepo.delete({ userId });
    return result.affected ?? 0;
  }

  /**
   * 连续记录天数
   */
  async getStreak(userId: string) {
    const rows = await this.recordRepo
      .createQueryBuilder('record')
      .select("DISTINCT TO_CHAR(record.recordedAt, 'YYYY-MM-DD')", 'date')
      .where('record.userId = :userId', { userId })
      .orderBy('date', 'DESC')
      .getRawMany();

    const dates = rows.map((r: any) => r.date);

    // 总记录天数
    const totalDays = dates.length;

    // 计算当前连续天数：从今天往回推
    let currentStreak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      if (dates.includes(ds)) {
        currentStreak++;
      } else if (i === 0) {
        // 今天没记录，从昨天开始算
        continue;
      } else {
        break;
      }
    }

    // 计算最长连续天数
    let longestStreak = 0;
    let tempStreak = 0;
    // 把日期转成时间戳排序，检查连续
    const sortedDates = [...dates].sort();
    for (let i = 0; i < sortedDates.length; i++) {
      if (i === 0) {
        tempStreak = 1;
      } else {
        const prev = new Date(sortedDates[i - 1]);
        const curr = new Date(sortedDates[i]);
        const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          tempStreak++;
        } else {
          tempStreak = 1;
        }
      }
      if (tempStreak > longestStreak) {
        longestStreak = tempStreak;
      }
    }

    return { currentStreak, longestStreak, totalDays };
  }

  /**
   * 「往年今日」：查询同月同日但不同年份的历史记录
   * @param userId 用户 ID
   * @param dateStr ISO date 字符串，如 "2026-07-14"，取月日部分匹配
   * @returns 往年同日记录数组，按年份降序
   */
  async getOnThisDay(userId: string, dateStr: string) {
    const parts = dateStr.split('-');
    const month = parseInt(parts[1]) || new Date().getMonth() + 1;
    const day = parseInt(parts[2]) || new Date().getDate();
    const currentYear = new Date().getFullYear();

    const records = await this.recordRepo
      .createQueryBuilder('record')
      .where('record.userId = :userId', { userId })
      .andWhere('EXTRACT(MONTH FROM record.recordedAt) = :month', { month })
      .andWhere('EXTRACT(DAY FROM record.recordedAt) = :day', { day })
      .andWhere('EXTRACT(YEAR FROM record.recordedAt) < :year', { year: currentYear })
      .orderBy('record.recordedAt', 'DESC')
      .take(20)
      .getMany();

    return { records, date: dateStr, month, day };
  }

  /**
   * 「职业名片」数据画像
   * 汇总用户全部记录的关键指标，用于生成可分享的个人数据名片
   *
   * 包含：总量、连续天数、心情分布、标签云、人物云、状态分布、繁忙月份
   * 不含具体记录内容 → 安全可分享
   */
  async getPortrait(userId: string) {
    const stats = await this.getStats(userId);
    const streak = await this.getStreak(userId);

    // 心情分布（最近 90 天）
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const recentRecords = await this.recordRepo
      .createQueryBuilder('record')
      .where('record.userId = :userId', { userId })
      .andWhere('record.recordedAt >= :start', { start: ninetyDaysAgo })
      .getMany();

    const moodDist: Record<string, number> = { positive: 0, neutral: 0, negative: 0 };
    let moodTotal = 0;
    for (const r of recentRecords) {
      if (r.mood) {
        try {
          const moodObj = typeof r.mood === 'string' ? JSON.parse(r.mood) : r.mood;
          const tone = moodObj.tone || 'neutral';
          moodDist[tone] = (moodDist[tone] || 0) + 1;
          moodTotal++;
        } catch { /* ignore */ }
      }
    }

    // 繁忙月份（最近 12 个月，时间升序）
    const monthStats = await this.recordRepo
      .createQueryBuilder('record')
      .select("TO_CHAR(record.recordedAt, 'YYYY-MM')", 'month')
      .addSelect('COUNT(*)', 'count')
      .where('record.userId = :userId', { userId })
      .groupBy('month')
      .orderBy('month', 'DESC')
      .limit(12)
      .getRawMany();

    const busyMonths = monthStats
      .map((r: any) => ({ month: r.month, count: Number(r.count) }))
      .reverse();

    // 首条记录时间
    const firstRecord = await this.recordRepo
      .createQueryBuilder('record')
      .select('record.recordedAt')
      .where('record.userId = :userId', { userId })
      .orderBy('record.recordedAt', 'ASC')
      .take(1)
      .getOne();

    return {
      totalRecords: stats.total,
      monthCount: stats.monthCount,
      weekCount: stats.weekCount,
      totalDays: stats.daysActive,
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      topTags: stats.topTags.slice(0, 8),
      topPeople: stats.topPeople.slice(0, 8),
      moodDistribution: moodDist,
      moodTotal,
      statusDistribution: stats.statusDistribution,
      busyMonths,
      firstRecordDate: firstRecord?.recordedAt || null,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * 智能整理：对未分组（或全部）记录重新跑 AI 归类，并写入 groupId
   *
   * 触发场景：
   * - 存量记录从未分组过（早期版本只打标签没用上分组）
   * - 用户主动点「智能整理」按钮，把零散记录归到合理分组（含多级 父/子）
   *
   * 可靠性兜底：AI 调用失败或返回 null 时，用 aiService.fallbackGroup
   * 走关键词/标签规则归类，而不是放弃归组。
   *
   * @param userId 用户 ID
   * @param opts.scope 'ungrouped'（默认，仅未分组）| 'all'（全部重跑）
   * @returns 处理统计
   */
  async bulkReclassify(
    userId: string,
    opts?: { scope?: 'ungrouped' | 'all' },
  ): Promise<{ processed: number; grouped: number; skipped: number; byGroup: Record<string, number> }> {
    const scope = opts?.scope || 'ungrouped';

    // 1. 取待整理记录
    const qb = this.recordRepo.createQueryBuilder('record').where('record.userId = :userId', { userId });
    if (scope === 'ungrouped') {
      qb.andWhere('record.groupId IS NULL');
    }
    const records = await qb.orderBy('record.recordedAt', 'DESC').getMany();

    if (records.length === 0) {
      return { processed: 0, grouped: 0, skipped: 0, byGroup: {} };
    }

    // 2. 准备已有分组名 + 常用标签，供 AI 复用
    const existingGroups = await this.groupsService.findAll(userId);
    const existingGroupNames = existingGroups.groups.map((g) => g.name);
    const tagStats = await this.recordRepo
      .createQueryBuilder('record')
      .select('unnest(record.tags)', 'tag')
      .addSelect('COUNT(*)', 'count')
      .where('record.userId = :userId', { userId })
      .groupBy('tag')
      .orderBy('count', 'DESC')
      .limit(20)
      .getRawMany();
    const existingTags = tagStats.map((r: any) => r.tag);

    const byGroup: Record<string, number> = {};
    let processed = 0;
    let grouped = 0;
    let skipped = 0;

    // 3. 逐条重跑归类
    for (const record of records) {
      try {
        const text = record.content || record.summary || '';
        if (!text.trim()) {
          skipped++;
          continue;
        }

        const parsed = await this.aiService.parseContent(text, existingGroupNames, existingTags);
        // AI 没给分组 → 关键词优先核对 → 关键词/标签兜底 → 语义相似度兜底
        let sg = this.preferKeywordOverFlatAi(parsed.suggestedGroup, text);
        if (!sg) {
          sg = this.aiService.fallbackGroup(text);
        }
        if (!sg) {
          sg = await this.aiService.semanticGroupMatch(text, record.tags);
        }
        if (!sg) {
          skipped++;
          continue;
        }

        // 匹配已有分组 或 创建新分组（多级 父/子 由 groupsService 处理）
        let groupId: string | null = null;
        if (!sg.isNew && sg.existingGroupName) {
          const matched = existingGroups.groups.find((g) => g.name === sg!.existingGroupName);
          if (matched) groupId = matched.id;
        }
        if (!groupId) {
          const group = await this.groupsService.findOrCreate(
            sg.name,
            userId,
            sg.color,
            sg.description || undefined,
          );
          groupId = group.id;
        }

        if (groupId) {
          record.groupId = groupId;
          await this.recordRepo.save(record);
          grouped++;
          byGroup[sg.name] = (byGroup[sg.name] || 0) + 1;
        }
        processed++;
      } catch (err) {
        console.warn('[Reclassify] 单条归类失败（跳过）:', (err as Error).message);
        skipped++;
      }
    }

    return { processed, grouped, skipped, byGroup };
  }
}
