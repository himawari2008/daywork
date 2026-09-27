import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  UseInterceptors,
  UploadedFile,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as iconv from 'iconv-lite';
import { RecordsService } from './records.service';
import { CreateRecordDto } from './dto/create-record.dto';
import { UpdateRecordDto } from './dto/update-record.dto';
import { QueryRecordDto } from './dto/query-record.dto';
import { ImportDocumentDto } from './dto/import-document.dto';
import { BatchSaveDto } from './dto/batch-save.dto';
import { CsvImportDto } from './dto/csv-import.dto';

/**
 * 记录控制器
 * RESTful API：/records
 * 注意：静态路由（stats/calendar/mood-river/streak）必须在 :id 之前
 */
@Controller('records')
export class RecordsController {
  constructor(private readonly recordsService: RecordsService) {}

  /**
   * POST /records/voice
   * 语音创建记录：上传音频文件 → ASR转文字 → AI解析 → 保存（支持批量拆分）
   */
  @Post('voice')
  @UseInterceptors(FileInterceptor('audio'))
  async createFromVoice(
    @UploadedFile() file: any,
    @Headers('x-user-id') userId: string,
  ) {
    if (!file || !file.buffer || file.size === 0) {
      return { success: false, message: '未收到音频文件' };
    }

    const mimeToFormat: Record<string, string> = {
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/wave': 'wav',
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/mp4': 'm4a',
      'audio/aac': 'm4a',
    };
    const audioFormat = mimeToFormat[file.mimetype] || 'wav';

    try {
      return await this.recordsService.createFromVoice(
        file.buffer,
        audioFormat,
        userId || 'test-user',
      );
    } catch (error) {
      const message = (error as Error).message || '语音识别失败';
      throw new HttpException(
        { success: false, message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * POST /records
   * 创建一条记录（核心流程：说话 → AI解析 → 保存）
   */
  @Post()
  create(
    @Body() dto: CreateRecordDto,
    @Headers('x-user-id') userId: string,
  ) {
    return this.recordsService.create(dto, userId || 'test-user');
  }

  /**
   * POST /records/batch
   * 批量创建记录：智能检测多人/多任务 → 自动拆分为多条
   * 场景："老张贴砖20平方、老李刷墙、小王搬货" → 3条独立记录
   */
  @Post('batch')
  createBatch(
    @Body() dto: CreateRecordDto,
    @Headers('x-user-id') userId: string,
  ) {
    return this.recordsService.createBatch(dto, userId || 'test-user');
  }

  /**
   * GET /records
   * 查询记录列表，支持分页、标签筛选、状态筛选、关键词搜索
   */
  @Get()
  findAll(
    @Query() query: QueryRecordDto,
    @Headers('x-user-id') userId: string,
  ) {
    return this.recordsService.findAll(userId || 'test-user', query);
  }

  // ============================================
  // 静态路由 — 必须在 :id 之前定义
  // ============================================

  /**
   * GET /records/reminders
   * 获取当前用户的待提醒记录（超期 + 24h内到期）
   */
  @Get('reminders')
  getReminders(@Headers('x-user-id') userId: string) {
    return this.recordsService.getReminders(userId || 'test-user');
  }

  /**
   * GET /records/memory
   * 「往日回顾」：随机返回一条历史记录，用于首页回忆卡片
   */
  @Get('memory')
  getMemory(@Headers('x-user-id') userId: string) {
    return this.recordsService.getMemory(userId || 'test-user');
  }

  /**
   * GET /records/on-this-day
   * 「往年今日」：查询同月同日但不同年份的历史记录
   */
  @Get('on-this-day')
  getOnThisDay(
    @Query('date') date: string,
    @Headers('x-user-id') userId: string,
  ) {
    return this.recordsService.getOnThisDay(userId || 'test-user', date || new Date().toISOString().slice(0, 10));
  }

  /**
   * GET /records/stats
   * 获取统计概览
   */
  @Get('stats')
  getStats(@Headers('x-user-id') userId: string) {
    return this.recordsService.getStats(userId || 'test-user');
  }

  /**
   * GET /records/calendar
   * 日历热力图数据：指定年月的每日记录数
   */
  @Get('calendar')
  getCalendar(
    @Query('year') year: string,
    @Query('month') month: string,
    @Headers('x-user-id') userId: string,
  ) {
    const y = parseInt(year) || new Date().getFullYear();
    const m = parseInt(month) || new Date().getMonth() + 1;
    return this.recordsService.getCalendar(userId || 'test-user', y, m);
  }

  /**
   * GET /records/mood-river
   * 心情河流：最近 N 天的心情概览
   */
  @Get('mood-river')
  getMoodRiver(
    @Query('days') days: string,
    @Headers('x-user-id') userId: string,
  ) {
    const d = parseInt(days) || 7;
    return this.recordsService.getMoodRiver(userId || 'test-user', d);
  }

  /**
   * GET /records/streak
   * 连续记录天数
   */
  @Get('streak')
  getStreak(@Headers('x-user-id') userId: string) {
    return this.recordsService.getStreak(userId || 'test-user');
  }

  /**
   * GET /records/portrait
   * 「职业名片」数据画像：汇总全部指标，用于生成可分享的个人数据名片
   */
  @Get('portrait')
  getPortrait(@Headers('x-user-id') userId: string) {
    return this.recordsService.getPortrait(userId || 'test-user');
  }

  /**
   * POST /records/chat
   * AI 对话：基于用户记录进行自然语言问答
   */
  @Post('chat')
  chat(
    @Body('question') question: string,
    @Headers('x-user-id') userId: string,
  ) {
    if (!question || !question.trim()) {
      throw new HttpException('问题不能为空', HttpStatus.BAD_REQUEST);
    }
    return this.recordsService.chat(userId || 'test-user', question.trim());
  }

  /**
   * POST /records/summary
   * AI 总结：生成周报/月报
   */
  @Post('summary')
  summarize(
    @Body('period') period: 'week' | 'month',
    @Headers('x-user-id') userId: string,
  ) {
    return this.recordsService.summarize(userId || 'test-user', period || 'week');
  }

  /**
   * POST /records/import/preview
   * 导入预览：用户粘贴文本 → AI 解析预览
   */
  @Post('import/preview')
  async importPreview(
    @Body() dto: ImportDocumentDto,
  ) {
    return this.recordsService.previewImport(dto.content);
  }

  /**
   * POST /records/import/preview/file
   * 导入预览：上传文件（文本或图片）→ AI 解析预览
   * 文本文件直接读取；图片先 OCR 再解析
   */
  @Post('import/preview/file')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  }))
  async importPreviewFile(
    @UploadedFile() file: any,
  ) {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new HttpException('未收到文件', HttpStatus.BAD_REQUEST);
    }

    const mime = file.mimetype || '';
    const imageMimes = ['image/jpeg', 'image/png', 'image/bmp', 'image/webp'];
    const videoMimes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/mpeg'];

    let content: string;
    let isImage = false;
    let isVideo = false;

    if (imageMimes.includes(mime)) {
      // 图片：OCR 识别文字
      isImage = true;
      try {
        const result = await this.recordsService.previewImportFromImage(file.buffer);
        return { ...result, fileName: file.originalname, isImage: true };
      } catch (error) {
        const message = (error as Error).message || '图片识别失败';
        throw new HttpException(
          { success: false, message, isImage: true },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }

    if (videoMimes.includes(mime)) {
      // 视频：尝试视觉 AI 理解或提取音频→ASR
      isVideo = true;
      try {
        const result = await this.recordsService.previewImportFromVideo(file.buffer, mime);
        return { ...result, fileName: file.originalname, isVideo: true };
      } catch (error) {
        const message = (error as Error).message || '视频识别失败';
        throw new HttpException(
          { success: false, message, isVideo: true },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }

    // 文本文件：直接读取，自动检测编码
    try {
      content = file.buffer.toString('utf-8');
      // 简单检测：如果 UTF-8 解码后包含大量乱码字符，尝试 GBK
      const garbledCount = (content.match(/[�\x00-\x08\x0b\x0c\x0e-\x1f]/g) || []).length;
      if (garbledCount > content.length * 0.05) {
        // 可能是 GBK/GB2312 编码，尝试用 GBK 重新解码
        content = iconv.decode(file.buffer, 'gbk');
        console.log('文件编码: 检测到非 UTF-8，已用 GBK 解码');
      }
    } catch {
      throw new HttpException('无法读取文件内容，请确认文件编码为 UTF-8 或 GBK', HttpStatus.BAD_REQUEST);
    }

    if (content.trim().length === 0) {
      throw new HttpException('文件内容为空', HttpStatus.BAD_REQUEST);
    }

    const result = await this.recordsService.previewImport(content);
    return { ...result, fileName: file.originalname, isImage: false };
  }

  /**
   * POST /records/import/csv
   * CSV 标准导入：字段映射（不靠 AI 猜），可选 AI 增强
   */
  @Post('import/csv')
  async importCsv(
    @Body() dto: CsvImportDto,
    @Headers('x-user-id') userId: string,
  ) {
    if (!dto.csvText || !dto.csvText.trim()) {
      throw new HttpException('CSV 内容不能为空', HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.recordsService.importCsv(dto, userId || 'test-user');
    } catch (error) {
      const message = (error as Error).message || 'CSV 导入失败';
      throw new HttpException({ success: false, message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * POST /records/import/save
   * 导入保存：用户审核确认后批量保存
   */
  @Post('import/save')
  async importSave(
    @Body() dto: BatchSaveDto,
    @Headers('x-user-id') userId: string,
  ) {
    return this.recordsService.batchSave(dto, userId || 'test-user');
  }

  /**
   * POST /records/parse
   * 纯解析：AI 解析文本但不保存，用于详情页重新解析
   */
  @Post('parse')
  async parseOnly(
    @Body('content') content: string,
    @Headers('x-user-id') userId: string,
  ) {
    if (!content || !content.trim()) {
      throw new HttpException('内容不能为空', HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.recordsService.parseOnly(content, userId || 'test-user');
    } catch (error) {
      const message = (error as Error).message || 'AI 解析失败';
      throw new HttpException({ success: false, message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * POST /records/reclassify
   * 智能整理：对未分组（或全部）记录重新 AI 归类并写入分组
   * 前端「智能整理」按钮调用，也用于存量记录启动自动归类
   * @body { scope?: 'ungrouped' | 'all' }
   */
  @Post('reclassify')
  async reclassify(
    @Body('scope') scope: 'ungrouped' | 'all',
    @Headers('x-user-id') userId: string,
  ) {
    const result = await this.recordsService.bulkReclassify(userId || 'test-user', {
      scope: scope || 'ungrouped',
    });
    return result;
  }

  /**
   * GET /records/export
   * 导出记录：CSV 或 Markdown 格式
   */
  @Get('export')
  async exportRecords(
    @Query('format') format: string,
    @Headers('x-user-id') userId: string,
  ) {
    const fmt = format === 'markdown' ? 'markdown' : 'csv';
    const result = await this.recordsService.exportRecords(userId || 'test-user', fmt);
    return result;
  }

  /**
   * DELETE /records/all
   * 删除用户全部记录（危险操作）
   */
  @Delete('all')
  async removeAll(@Headers('x-user-id') userId: string) {
    const deletedCount = await this.recordsService.removeAll(userId || 'test-user');
    return { deletedCount };
  }

  /**
   * PATCH /records/tags/rename
   * 重命名标签：在所有记录中替换标签名
   */
  @Patch('tags/rename')
  async renameTag(
    @Body('oldName') oldName: string,
    @Body('newName') newName: string,
    @Headers('x-user-id') userId: string,
  ) {
    if (!oldName || !newName || !oldName.trim() || !newName.trim()) {
      throw new HttpException('标签名不能为空', HttpStatus.BAD_REQUEST);
    }
    const updatedCount = await this.recordsService.renameTag(userId || 'test-user', oldName.trim(), newName.trim());
    return { updatedCount, oldName, newName };
  }

  /**
   * POST /records/tags/remove
   * 删除标签：从所有记录中移除
   */
  @Post('tags/remove')
  async removeTag(
    @Body('tagName') tagName: string,
    @Headers('x-user-id') userId: string,
  ) {
    if (!tagName || !tagName.trim()) {
      throw new HttpException('标签名不能为空', HttpStatus.BAD_REQUEST);
    }
    const updatedCount = await this.recordsService.removeTag(userId || 'test-user', tagName.trim());
    return { updatedCount, tagName };
  }

  // ============================================
  // 动态路由 — :id 必须在静态路由之后
  // ============================================

  /**
   * GET /records/:id
   * 查询单条记录
   */
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Headers('x-user-id') userId: string,
  ) {
    return this.recordsService.findOne(id, userId || 'test-user');
  }

  /**
   * PATCH /records/:id
   * 修改记录（用户手动修正 AI 解析结果）
   */
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRecordDto,
    @Headers('x-user-id') userId: string,
  ) {
    return this.recordsService.update(id, userId || 'test-user', dto);
  }

  /**
   * PATCH /records/:id/group
   * 移动记录到指定分组（或取消分组）
   */
  @Patch(':id/group')
  async moveToGroup(
    @Param('id') id: string,
    @Body('groupId') groupId: string | null,
    @Headers('x-user-id') userId: string,
  ) {
    const record = await this.recordsService.moveToGroup(id, userId || 'test-user', groupId || null);
    if (!record) {
      throw new HttpException('记录不存在', HttpStatus.NOT_FOUND);
    }
    return record;
  }

  /**
   * DELETE /records/:id
   * 删除记录
   */
  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Headers('x-user-id') userId: string,
  ) {
    return this.recordsService.remove(id, userId || 'test-user');
  }

  /**
   * DELETE /records/batch
   * 批量删除记录 — 必须在 :id 之前注册为静态路由，但 NestJS 按定义顺序匹配
   * 使用 POST 方法避免与 :id 冲突
   */
  @Post('batch-delete')
  async batchRemove(
    @Body('ids') ids: string[],
    @Headers('x-user-id') userId: string,
  ) {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      throw new HttpException('ids 不能为空', HttpStatus.BAD_REQUEST);
    }
    const deletedCount = await this.recordsService.batchRemove(ids, userId || 'test-user');
    return { deletedCount };
  }
}
