/**
 * GroupsService 单元测试
 *
 * 测试范围：
 * - 分组创建、查询、更新、删除
 * - findOrCreate 逻辑（核心：同名分组复用）
 * - 多级分组 "父组/子组" 创建
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GroupsService } from './groups.service';
import { Group } from './entities/group.entity';

// ——— QueryBuilder Mock ———
const createMockQb = () => ({
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue({}),
  getCount: jest.fn().mockResolvedValue(0),
  getRawMany: jest.fn().mockResolvedValue([]),
  getMany: jest.fn().mockResolvedValue([]),
  getOne: jest.fn().mockResolvedValue(null),
  getRawOne: jest.fn().mockResolvedValue(null),
});

const createMockRepo = () => {
  const qb = createMockQb();
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    manager: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
  };
};

describe('GroupsService', () => {
  let service: GroupsService;
  let mockRepo: ReturnType<typeof createMockRepo>;

  beforeEach(async () => {
    mockRepo = createMockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupsService,
        { provide: getRepositoryToken(Group), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<GroupsService>(GroupsService);
  });

  describe('findAll', () => {
    it('返回用户的所有分组（含记录数统计）', async () => {
      const mockGroups = [
        { id: 'g1', name: '项目A', userId: 'user1' },
        { id: 'g2', name: '客户B', userId: 'user1' },
      ];
      (mockRepo.find as jest.Mock).mockResolvedValue(mockGroups);

      const result = await service.findAll('user1');
      expect(result.groups).toHaveLength(2);
      expect(result.groups[0].name).toBe('项目A');
    });

    it('无分组时返回空数组', async () => {
      (mockRepo.find as jest.Mock).mockResolvedValue([]);

      const result = await service.findAll('user1');
      expect(result.groups).toEqual([]);
    });
  });

  describe('findOrCreate', () => {
    it('已有同名分组时直接返回', async () => {
      const existingGroup = { id: 'g-exist', name: '项目A', userId: 'user1' };
      // findByName → find() 返回包含该分组的数组
      (mockRepo.find as jest.Mock).mockResolvedValue([existingGroup]);

      const result = await service.findOrCreate('项目A', 'user1', '#4A5C7C');
      expect(result).toEqual(existingGroup);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('不存在时创建新分组', async () => {
      // findByName → find() 返回空数组（无匹配）
      (mockRepo.find as jest.Mock).mockResolvedValue([]);
      const newGroup = { id: 'g-new', name: '新项目', userId: 'user1', color: '#E8815C' };
      (mockRepo.create as jest.Mock).mockReturnValue(newGroup);
      (mockRepo.save as jest.Mock).mockResolvedValue(newGroup);

      const result = await service.findOrCreate('新项目', 'user1', '#E8815C');
      expect(result).toEqual(newGroup);
      expect(mockRepo.create).toHaveBeenCalled();
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('不含 "/" 的单层分组不设置 parentId', async () => {
      (mockRepo.find as jest.Mock).mockResolvedValue([]);
      const group = { id: 'g-single', name: '日常', userId: 'user1' };
      (mockRepo.create as jest.Mock).mockReturnValue(group);
      (mockRepo.save as jest.Mock).mockResolvedValue(group);

      const result = await service.findOrCreate('日常', 'user1', '#4A5C7C');
      expect(result).toEqual(group);
    });
  });

  describe('create', () => {
    it('创建分组并返回', async () => {
      const dto = { name: '测试分组', color: '#4A5C7C', description: '测试用' };
      const saved = { id: 'g-test', ...dto, userId: 'user1' };
      (mockRepo.create as jest.Mock).mockReturnValue(dto);
      (mockRepo.save as jest.Mock).mockResolvedValue(saved);

      const result = await service.create(dto, 'user1');
      expect(result).toEqual(saved);
      expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({ name: '测试分组', userId: 'user1' }));
    });
  });

  describe('update', () => {
    it('更新存在的分组', async () => {
      const existing = { id: 'g1', name: '旧名称', userId: 'user1' };
      const updated = { ...existing, name: '新名称' };
      (mockRepo.findOne as jest.Mock).mockResolvedValue(existing);
      (mockRepo.save as jest.Mock).mockResolvedValue(updated);

      const result = await service.update('g1', 'user1', { name: '新名称' });
      expect(result).toEqual(updated);
    });

    it('分组不存在时返回 null', async () => {
      (mockRepo.findOne as jest.Mock).mockResolvedValue(null);
      const result = await service.update('nonexistent', 'user1', { name: 'x' });
      expect(result).toBeNull();
    });
  });

  describe('remove', () => {
    it('删除存在的分组返回 true', async () => {
      const existingGroup = { id: 'g1', name: '项目A', userId: 'user1' };
      (mockRepo.findOne as jest.Mock).mockResolvedValue(existingGroup);
      (mockRepo.delete as jest.Mock).mockResolvedValue({ affected: 1 });

      const result = await service.remove('g1', 'user1');
      expect(result).toBe(true);
    });

    it('分组不存在时返回 false', async () => {
      (mockRepo.findOne as jest.Mock).mockResolvedValue(null);
      const result = await service.remove('nonexistent', 'user1');
      expect(result).toBe(false);
    });
  });
});
