import { Module } from '@nestjs/common';
import { SpeechService } from './speech.service';
import { OcrService } from './ocr.service';

/**
 * 语音 & 图像识别模块
 * 封装百度 ASR + OCR 服务，供 Records 模块调用
 */
@Module({
  providers: [SpeechService, OcrService],
  exports: [SpeechService, OcrService],
})
export class SpeechModule {}
