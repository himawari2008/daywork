import {
  IsString,
  IsArray,
  IsOptional,
  IsObject,
  IsDateString,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 批量保存 — 单条记录 DTO
 */
export class BatchRecordDto {
  @IsString()
  summary: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  people?: string[];

  @IsOptional()
  @IsObject()
  numericInfo?: Record<string, any>;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  mood?: string;

  @IsOptional()
  @IsDateString()
  recordedAt?: string;

  /** 用户指定的分组 ID（已从下拉列表选择） */
  @IsOptional()
  @IsString()
  groupId?: string | null;

  /** AI 建议的分组名（前端未选分组时，后端据此 findOrCreate） */
  @IsOptional()
  @IsString()
  suggestedGroupName?: string | null;
}

/**
 * 批量保存 — 请求体 DTO
 * 用户在审核页确认后提交
 */
export class BatchSaveDto {
  @IsString()
  documentSummary: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchRecordDto)
  @ArrayMinSize(1)
  records: BatchRecordDto[];

  @IsOptional()
  @IsString()
  fileName?: string;
}
