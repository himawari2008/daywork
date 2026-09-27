import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 查询记录列表的请求参数
 */
export class QueryRecordDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  tag?: string; // 按标签筛选

  @IsOptional()
  @IsString()
  status?: string; // 按状态筛选

  @IsOptional()
  @IsString()
  keyword?: string; // 关键词搜索（MVP 用 LIKE，V2 用 AI 语义搜索）

  @IsOptional()
  @IsString()
  groupId?: string; // 按分组筛选

  @IsOptional()
  @IsString()
  date?: string; // 按日期筛选（YYYY-MM-DD），用于"今天"视图
}
