import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Loan } from './entities/loan.entity';
import { CreateLoanDto } from './dto/create-loan.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';

/**
 * 借支服务
 * 管理借入/借出记录，按人物汇总净余额，支持还款标记。
 */
@Injectable()
export class LoansService {
  constructor(
    @InjectRepository(Loan)
    private readonly loanRepo: Repository<Loan>,
  ) {}

  /** 新增一笔借支 */
  async create(dto: CreateLoanDto, userId: string): Promise<Loan> {
    const loan = this.loanRepo.create({
      person: dto.person,
      amount: dto.amount,
      direction: dto.direction,
      reason: dto.reason || null,
      status: 'pending',
      linkedRecordId: dto.linkedRecordId || null,
      recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
      userId,
    });
    return this.loanRepo.save(loan);
  }

  /** 查询用户所有借支（支持按对象筛选 + 状态筛选） */
  async findAll(
    userId: string,
    person?: string,
    status?: 'pending' | 'repaid',
  ): Promise<Loan[]> {
    const qb = this.loanRepo
      .createQueryBuilder('loan')
      .where('loan.userId = :userId', { userId })
      .orderBy('loan.recordedAt', 'DESC');

    if (person) {
      qb.andWhere('loan.person = :person', { person });
    }
    if (status) {
      qb.andWhere('loan.status = :status', { status });
    }

    return qb.getMany();
  }

  /** 按人物汇总：净余额 = 借出总和 - 借入总和 */
  async getSummary(userId: string) {
    const loans = await this.loanRepo
      .createQueryBuilder('loan')
      .where('loan.userId = :userId', { userId })
      .andWhere('loan.status = :status', { status: 'pending' })
      .getMany();

    // 按人物分组汇总
    const personMap: Record<
      string,
      { person: string; lendTotal: number; borrowTotal: number; net: number; count: number }
    > = {};

    for (const loan of loans) {
      if (!personMap[loan.person]) {
        personMap[loan.person] = {
          person: loan.person,
          lendTotal: 0,
          borrowTotal: 0,
          net: 0,
          count: 0,
        };
      }
      const entry = personMap[loan.person];
      if (loan.direction === 'lend') {
        entry.lendTotal += Number(loan.amount);
        entry.net += Number(loan.amount);
      } else {
        entry.borrowTotal += Number(loan.amount);
        entry.net -= Number(loan.amount);
      }
      entry.count++;
    }

    // net > 0 = 别人欠我，net < 0 = 我欠别人
    const summary = Object.values(personMap)
      .map((e) => ({
        ...e,
        lendTotal: Math.round(e.lendTotal * 100) / 100,
        borrowTotal: Math.round(e.borrowTotal * 100) / 100,
        net: Math.round(e.net * 100) / 100,
      }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

    return { summary, totalPending: loans.length };
  }

  /** 查询单条借支 */
  async findOne(id: string, userId: string): Promise<Loan | null> {
    return this.loanRepo.findOne({ where: { id, userId } });
  }

  /** 更新借支（标记还款、修改金额等） */
  async update(id: string, userId: string, dto: UpdateLoanDto): Promise<Loan | null> {
    const loan = await this.loanRepo.findOne({ where: { id, userId } });
    if (!loan) return null;

    if (dto.amount !== undefined) loan.amount = dto.amount;
    if (dto.direction) loan.direction = dto.direction;
    if (dto.reason !== undefined) loan.reason = dto.reason;
    if (dto.linkedRecordId !== undefined) loan.linkedRecordId = dto.linkedRecordId;

    // 标记还款
    if (dto.status === 'repaid' && loan.status !== 'repaid') {
      loan.status = 'repaid';
      loan.repaidAt = new Date();
    } else if (dto.status === 'pending') {
      loan.status = 'pending';
      loan.repaidAt = null;
    }

    return this.loanRepo.save(loan);
  }

  /** 删除借支 */
  async remove(id: string, userId: string): Promise<boolean> {
    const result = await this.loanRepo.delete({ id, userId });
    return (result.affected ?? 0) > 0;
  }

  /** 删除用户全部借支（危险操作） */
  async removeAll(userId: string): Promise<number> {
    const result = await this.loanRepo.delete({ userId });
    return result.affected ?? 0;
  }
}
