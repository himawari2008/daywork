import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 活记 · 智能分组
 *
 * AI 根据记录内容自动创建分组，也可手动管理。
 * 每条记录可选归属一个分组，分组出现于侧抽屉导航。
 *
 * 设计参考：钉钉 ONE 智能分组 + Apple Notes 文件夹
 */
@Entity('groups')
export class Group {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 分组名称，如 "项目A"、"跟老张"、"装修采购" */
  @Column('text')
  name: string;

  /** 分组颜色（HEX），AI 根据内容语义自动分配 */
  @Column('text', { nullable: true })
  color: string | null;

  /** 图标标识：'project' | 'person' | 'money' | 'doc' | 'default' */
  @Column('text', { default: 'default' })
  icon: string;

  /** AI 生成的分组描述（一句话） */
  @Column('text', { nullable: true })
  description: string | null;

  /** 是否在侧抽屉置顶显示 */
  @Column('boolean', { default: false })
  isPinned: boolean;

  /** 是否活跃（AI 可自动归档不活跃分组） */
  @Column('boolean', { default: true })
  isActive: boolean;

  /** 排序权重（数值越大越靠前） */
  @Column('int', { default: 0 })
  sortOrder: number;

  /** 父分组 ID，为空 = 一级分组。支持两级分组：父组/子组 */
  @Column('uuid', { nullable: true })
  @Index()
  parentId: string | null;

  @Column('text')
  @Index()
  userId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
