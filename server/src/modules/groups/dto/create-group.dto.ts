import { IsString, IsOptional, IsBoolean, IsNumber, MaxLength } from 'class-validator';

/**
 * 创建分组 DTO
 */
export class CreateGroupDto {
  @IsString()
  @MaxLength(20)
  name: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @IsString()
  parentId?: string | null;
}
