import { IsString, IsOptional, IsArray, IsDateString } from 'class-validator';

/**
 * 创建记录的请求体
 * 用户只需提供 content（说的话/打的字），其余由 AI 填充
 */
export class CreateRecordDto {
  @IsString()
  content: string;

  @IsOptional()
  @IsDateString()
  recordedAt?: string; // 用户手动指定时间，默认服务端取当前时间

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachments?: string[];
}
