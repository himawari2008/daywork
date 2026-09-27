import { IsOptional, IsString, IsArray, IsDateString, IsObject } from 'class-validator';

/**
 * 更新记录的请求体
 * 可修改原始内容（用户手动编辑）、AI 解析字段等
 */
export class UpdateRecordDto {
  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  summary?: string;

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

  @IsOptional()
  isPinned?: boolean;

  /** 提醒时间 ISO 字符串，传 null 表示取消提醒 */
  @IsOptional()
  @IsString()
  remindAt?: string | null;
}
