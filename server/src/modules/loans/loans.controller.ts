import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { LoansService } from './loans.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';

/**
 * 借支控制器
 * RESTful API：/loans
 */
@Controller('loans')
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  /**
   * POST /loans
   * 新增一笔借支
   */
  @Post()
  create(
    @Body() dto: CreateLoanDto,
    @Headers('x-user-id') userId: string,
  ) {
    if (!dto.person || !dto.person.trim()) {
      throw new HttpException('借支对象不能为空', HttpStatus.BAD_REQUEST);
    }
    if (!dto.amount || dto.amount <= 0) {
      throw new HttpException('金额必须大于 0', HttpStatus.BAD_REQUEST);
    }
    return this.loansService.create(dto, userId || 'test-user');
  }

  /**
   * GET /loans
   * 查询所有借支（支持按人物 + 状态筛选）
   */
  @Get()
  findAll(
    @Query('person') person: string,
    @Query('status') status: 'pending' | 'repaid',
    @Headers('x-user-id') userId: string,
  ) {
    return this.loansService.findAll(userId || 'test-user', person, status);
  }

  /**
   * GET /loans/summary
   * 按人物汇总：净余额一览（静态路由，必须在 :id 之前）
   */
  @Get('summary')
  getSummary(@Headers('x-user-id') userId: string) {
    return this.loansService.getSummary(userId || 'test-user');
  }

  /**
   * DELETE /loans/all
   * 删除全部借支（危险操作，静态路由，必须在 :id 之前）
   */
  @Delete('all')
  async removeAll(@Headers('x-user-id') userId: string) {
    const count = await this.loansService.removeAll(userId || 'test-user');
    return { deletedCount: count };
  }

  /**
   * GET /loans/:id
   * 查询单条借支
   */
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Headers('x-user-id') userId: string,
  ) {
    const loan = await this.loansService.findOne(id, userId || 'test-user');
    if (!loan) throw new HttpException('借支记录不存在', HttpStatus.NOT_FOUND);
    return loan;
  }

  /**
   * PATCH /loans/:id
   * 更新借支（修改金额/标记还款）
   */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateLoanDto,
    @Headers('x-user-id') userId: string,
  ) {
    const loan = await this.loansService.update(id, userId || 'test-user', dto);
    if (!loan) throw new HttpException('借支记录不存在', HttpStatus.NOT_FOUND);
    return loan;
  }

  /**
   * DELETE /loans/:id
   * 删除单条借支
   */
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Headers('x-user-id') userId: string,
  ) {
    const deleted = await this.loansService.remove(id, userId || 'test-user');
    if (!deleted) throw new HttpException('借支记录不存在', HttpStatus.NOT_FOUND);
    return { deleted: true };
  }
}
