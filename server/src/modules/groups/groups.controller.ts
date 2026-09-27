import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Headers,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';

/**
 * 分组控制器
 * RESTful API：/groups
 */
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  /**
   * GET /groups
   * 获取所有分组（含记录数统计）
   */
  @Get()
  findAll(@Headers('x-user-id') userId: string) {
    return this.groupsService.findAll(userId || 'test-user');
  }

  /**
   * GET /groups/:id
   * 获取单个分组
   */
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Headers('x-user-id') userId: string,
  ) {
    const group = await this.groupsService.findOne(id, userId || 'test-user');
    if (!group) {
      throw new HttpException('分组不存在', HttpStatus.NOT_FOUND);
    }
    return group;
  }

  /**
   * POST /groups
   * 创建分组
   */
  @Post()
  create(
    @Body() dto: CreateGroupDto,
    @Headers('x-user-id') userId: string,
  ) {
    if (!dto.name || !dto.name.trim()) {
      throw new HttpException('分组名称不能为空', HttpStatus.BAD_REQUEST);
    }
    return this.groupsService.create(dto, userId || 'test-user');
  }

  /**
   * PATCH /groups/:id
   * 更新分组
   */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateGroupDto,
    @Headers('x-user-id') userId: string,
  ) {
    const group = await this.groupsService.update(id, userId || 'test-user', dto);
    if (!group) {
      throw new HttpException('分组不存在', HttpStatus.NOT_FOUND);
    }
    return group;
  }

  /**
   * DELETE /groups/:id
   * 删除分组（记录变为未分组）
   */
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Headers('x-user-id') userId: string,
  ) {
    const deleted = await this.groupsService.remove(id, userId || 'test-user');
    if (!deleted) {
      throw new HttpException('分组不存在', HttpStatus.NOT_FOUND);
    }
    return { success: true, message: '分组已删除' };
  }
}
