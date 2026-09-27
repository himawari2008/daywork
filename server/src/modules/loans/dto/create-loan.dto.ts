/**
 * 创建借支记录的 DTO
 */
export class CreateLoanDto {
  /** 借支对象人名 */
  person: string;

  /** 金额（元，正数） */
  amount: number;

  /** 方向：lend=借出 | borrow=借入 */
  direction: 'lend' | 'borrow';

  /** 原因/备注（可选） */
  reason?: string;

  /** 关联的工活记录 ID（可选） */
  linkedRecordId?: string;

  /** 借支发生时间（可选，默认当前时间） */
  recordedAt?: string;
}
