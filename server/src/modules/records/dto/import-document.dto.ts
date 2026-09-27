import { IsString, IsOptional } from 'class-validator';

/**
 * 导入文档预览 DTO
 * 用户粘贴文本 → AI 解析预览
 */
export class ImportDocumentDto {
  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  fileName?: string;
}
