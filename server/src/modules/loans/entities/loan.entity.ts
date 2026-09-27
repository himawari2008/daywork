import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 活记 · 借支记录
 *
 * 工人/工头间的借支管理：谁借了多少钱、为什么、还了没。
 * 按人物汇总净余额，结算时自动计算抵扣。
 *
 * 场景：
 * - "借给老李500块买材料" → direction='lend', person='老李', amount=500
 * - "跟老李借了300" → direction='borrow', person='老李', amount=300
 * - 结算时：总工钱 - 净借支 = 实付金额
 */
@Entity('loans')
export class Loan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 借支对象（人名），与 records.people 对齐 */
  @Column('text')
  @Index()
  person: string;

  /** 金额（元，正数） */
  @Column('decimal', { precision: 12, scale: 2 })
  amount: number;

  /** 方向：lend=借出（我借给别人）| borrow=借入（别人借给我） */
  @Column('text')
  direction: 'lend' | 'borrow';

  /** 借支原因/备注 */
  @Column('text', { nullable: true })
  reason: string | null;

  /** 状态：pending=未还 | repaid=已还 */
  @Column('text', { default: 'pending' })
  status: 'pending' | 'repaid';

  /** 还款时间（status=repaid 时填写） */
  @Column('timestamptz', { nullable: true })
  repaidAt: Date | null;

  /** 关联的工作记录 ID（这笔借支对应的工活结算） */
  @Column('uuid', { nullable: true })
  linkedRecordId: string | null;

  /** 借支发生时间 */
  @Column('timestamptz', { default: () => 'NOW()' })
  recordedAt: Date;

  @Column('text')
  @Index()
  userId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
