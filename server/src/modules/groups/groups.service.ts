import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Group } from './entities/group.entity';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';

/**
 * 分组服务
 * 管理 AI 智能分组：创建/更新/删除/查询分组，以及分组统计
 */
@Injectable()
export class GroupsService {
  constructor(
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
  ) {}

  /**
   * 获取用户所有分组（含记录数统计）
   * 排序：置顶优先 → sortOrder 降序 → 名称字母序
   * 子分组嵌套在父分组的 children 数组中
   */
  async findAll(userId: string) {
    const groups = await this.groupRepo.find({
      where: { userId, isActive: true },
      order: { isPinned: 'DESC', sortOrder: 'DESC', name: 'ASC' },
    });

    // 获取每个分组的记录数（通过原生查询统计）
    const counts: Record<string, number> = {};
    if (groups.length > 0) {
      const groupIds = groups.map((g) => g.id);
      const countRows = await this.groupRepo.manager
        .createQueryBuilder()
        .select('record.groupId', 'groupId')
        .addSelect('COUNT(*)', 'count')
        .from('records', 'record')
        .where('record.groupId IN (:...groupIds)', { groupIds })
        .andWhere('record.userId = :userId', { userId })
        .groupBy('record.groupId')
        .getRawMany();

      countRows.forEach((r: any) => {
        counts[r.groupId] = Number(r.count);
      });
    }

    // 获取未分组记录数
    const ungroupedCount = await this.groupRepo.manager
      .createQueryBuilder()
      .from('records', 'record')
      .where('record.userId = :userId', { userId })
      .andWhere('record.groupId IS NULL')
      .getCount();

    // 构建树形结构：一级分组 + 嵌套子分组
    const groupMap = new Map<string, any>();
    groups.forEach((g) => {
      groupMap.set(g.id, {
        ...g,
        recordCount: counts[g.id] || 0,
        children: [] as any[],
      });
    });

    const roots: any[] = [];
    groupMap.forEach((g) => {
      if (g.parentId && groupMap.has(g.parentId)) {
        groupMap.get(g.parentId).children.push(g);
      } else {
        roots.push(g);
      }
    });

    return {
      groups: roots,
      ungroupedCount,
    };
  }

  /**
   * 查询子分组
   */
  async findChildren(parentId: string, userId: string): Promise<Group[]> {
    return this.groupRepo.find({
      where: { parentId, userId, isActive: true },
      order: { sortOrder: 'DESC', name: 'ASC' },
    });
  }

  /**
   * 获取单个分组详情
   */
  async findOne(id: string, userId: string): Promise<Group | null> {
    return this.groupRepo.findOne({ where: { id, userId } });
  }

  /**
   * 创建分组
   */
  async create(dto: CreateGroupDto, userId: string): Promise<Group> {
    const group = this.groupRepo.create({
      ...dto,
      userId,
    });
    return this.groupRepo.save(group);
  }

  /**
   * 更新分组
   */
  async update(id: string, userId: string, dto: UpdateGroupDto): Promise<Group | null> {
    const group = await this.groupRepo.findOne({ where: { id, userId } });
    if (!group) return null;

    Object.assign(group, dto);
    return this.groupRepo.save(group);
  }

  /**
   * 删除分组（记录变为未分组）
   */
  async remove(id: string, userId: string): Promise<boolean> {
    const group = await this.groupRepo.findOne({ where: { id, userId } });
    if (!group) return false;

    // 将该分组下的所有记录设为未分组
    await this.groupRepo.manager
      .createQueryBuilder()
      .update('records')
      .set({ groupId: null })
      .where('groupId = :groupId', { groupId: id })
      .andWhere('userId = :userId', { userId })
      .execute();

    await this.groupRepo.delete({ id, userId });
    return true;
  }

  /**
   * AI 根据文本内容建议分组
   * 检查是否有名称匹配的已有分组
   *
   * @param suggestedName AI 建议的分组名
   * @returns 匹配到的分组 或 null
   */
  async findByName(suggestedName: string, userId: string): Promise<Group | null> {
    // 模糊匹配：分组名包含建议名 或 建议名包含分组名
    const groups = await this.groupRepo.find({ where: { userId, isActive: true } });

    // 精确匹配优先
    const exact = groups.find(
      (g) => g.name === suggestedName || suggestedName.includes(g.name) || g.name.includes(suggestedName),
    );

    return exact || null;
  }

  /**
   * 获取或创建分组（AI 自动归类用）
   * 支持多级分组：name 中使用 "/" 分隔父子组
   * 例如 "项目采购/3号馆B区" → 父组 "项目采购"，子组 "3号馆B区"
   */
  async findOrCreate(
    name: string,
    userId: string,
    color?: string,
    description?: string,
  ): Promise<Group> {
    // 处理多级分组：用 "/" 分隔
    const parts = name.split('/').map((p) => p.trim()).filter(Boolean);

    if (parts.length >= 2) {
      // 有多级：先确保父组存在，再创建子组
      const parentName = parts[0];
      const childName = parts.slice(1).join('/'); // 支持 "A/B/C" → 父=A，子="B/C"

      const parent = await this.findByName(parentName, userId);
      const parentGroup = parent || await this.create(
        { name: parentName, color: color || this._randomGroupColor() },
        userId,
      );

      // 在父组下查找子组
      const siblings = await this.findChildren(parentGroup.id, userId);
      const existingChild = siblings.find(
        (s) => s.name === childName || childName.includes(s.name) || s.name.includes(childName),
      );
      if (existingChild) return existingChild;

      // 创建子组
      return this.create(
        {
          name: childName,
          color: color || this._randomGroupColor(),
          description: description || undefined,
          parentId: parentGroup.id,
        } as any,
        userId,
      );
    }

    // 单级分组：原有逻辑
    const existing = await this.findByName(name, userId);
    if (existing) return existing;

    return this.create(
      {
        name,
        color: color || this._randomGroupColor(),
        description: description || undefined,
      },
      userId,
    );
  }

  /**
   * 生成一个柔和的随机分组颜色
   * 在暖色系统中选取 8 种预设色之一
   */
  private _randomGroupColor(): string {
    const colors = [
      '#E8815C', // 珊瑚
      '#4A5C7C', // 深蓝
      '#6EA880', // 暖绿
      '#C8A060', // 琥珀
      '#8B7EC8', // 淡紫
      '#D4B860', // 暖金
      '#5C9EAD', // 青蓝
      '#C0808B', // 玫瑰
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}
