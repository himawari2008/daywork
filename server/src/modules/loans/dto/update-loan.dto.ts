/**
 * 更新借支记录的 DTO
 */
export class UpdateLoanDto {
  /** 金额（元，正数） */
  amount?: number;

  /** 方向 */
  direction?: 'lend' | 'borrow';

  /** 原因/备注 */
  reason?: string;

  /** 状态：pending=未还 | repaid=已还 */
  status?: 'pending' | 'repaid';

  /** 还款时间（标记 repaid 时自动设置） */
  repaidAt?: string;

  /** 关联的工活记录 ID */
  linkedRecordId?: string;
}
