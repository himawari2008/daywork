import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 活记核心实体：一条记录
 *
 * 数据模型不做预设字段。AI 根据内容动态识别：
 * - 时间、人物、标签、数值、状态、附件
 * - 不是所有记录都有金额，不是所有记录都有状态
 * - 是什么就存什么
 */
@Entity('records')
export class DayRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 用户说的/打的原始内容 */
  @Column('text')
  content: string;

  /** AI 一句话概括 */
  @Column('text', { nullable: true })
  summary: string | null;

  /** AI 动态生成的标签，如 ["工作","装修","张三"] */
  @Column('text', { array: true, default: [] })
  tags: string[];

  /** AI 提取的人名 */
  @Column('text', { array: true, default: [] })
  people: string[];

  /** AI 关联的历史记录 ID */
  @Column('uuid', { nullable: true })
  @Index()
  relatedRecordId: string | null;

  /** 所属分组 ID（AI 自动归类，可手动修改），为空 = 未分组 */
  @Column('uuid', { nullable: true })
  @Index()
  groupId: string | null;

  /**
   * AI 提取的数值信息，JSON 自由格式
   * 例如：{ "金额": 800, "截止日期": "2026-07-07", "时长": "2小时" }
   */
  @Column('jsonb', { nullable: true })
  numericInfo: Record<string, any> | null;

  /** AI 判断的状态：待办 / 已完成 / 待跟进 / null */
  @Column('text', { nullable: true })
  status: string | null;

  /** AI 识别的心情：JSON字符串 {label, tone, intensity}，开放式自由描述 */
  @Column('text', { nullable: true })
  mood: string | null;

  /** 是否置顶 */
  @Column('boolean', { default: false })
  isPinned: boolean;

  /** 提醒时间：用户为记录设置的提醒，到达时间后首页醒目展示，为空则不提醒 */
  @Column('timestamptz', { nullable: true })
  @Index()
  remindAt: Date | null;

  /** 附件 URL 列表（照片/语音） */
  @Column('text', { array: true, default: [] })
  attachments: string[];

  /** 用户认定的记录时间，AI 从内容中识别或默认当前时间 */
  @Column('timestamptz')
  @Index()
  recordedAt: Date;

  /** 微信 openid（MVP 阶段可用简单标识） */
  @Column('text')
  @Index()
  userId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
