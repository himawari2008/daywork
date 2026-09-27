/**
 * CSV 标准导入 DTO
 * 结构化数据导入：字段已由 CSV 列指定，AI 可选增强
 */
export class CsvImportDto {
  /** CSV 文本内容（完整 CSV 文件内容） */
  csvText: string;

  /** 是否启用 AI 增强（标签/分组/状态/心情） */
  enhance?: boolean;
}
