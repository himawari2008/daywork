import { Injectable } from '@nestjs/common';

/**
 * 图片文字识别服务（OCR）
 * 调用百度通用文字识别 API — 用于导入图片（聊天截图、手写笔记等）
 *
 * 链路：图片 Buffer → base64 → 百度 OCR → 返回文字
 * 与 SpeechService 共用同一套百度 API Key/Secret
 * 文档：https://ai.baidu.com/tech/ocr/general
 */
@Injectable()
export class OcrService {
  private readonly apiKey: string;
  private readonly secretKey: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    this.apiKey = process.env.BAIDU_API_KEY || '';
    this.secretKey = process.env.BAIDU_SECRET_KEY || '';
  }

  /** 检查百度 API 密钥是否已配置（排除占位符值） */
  isConfigured(): boolean {
    const isPlaceholder =
      this.apiKey.startsWith('your_') || this.apiKey === '' ||
      this.secretKey.startsWith('your_') || this.secretKey === '';
    return !!(this.apiKey && this.secretKey && !isPlaceholder);
  }

  /**
   * 获取百度 OAuth access_token（带缓存）
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry - 300000) {
      return this.accessToken;
    }

    const url =
      `https://aip.baidubce.com/oauth/2.0/token?` +
      `grant_type=client_credentials` +
      `&client_id=${this.apiKey}` +
      `&client_secret=${this.secretKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`百度 OAuth 失败: ${response.status}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`百度 OAuth 错误: ${data.error_description || data.error}`);
    }

    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in || 2592000) * 1000;

    return this.accessToken!;
  }

  /**
   * 图片文字识别：将图片 Buffer 转为文字
   *
   * @param imageBuffer 图片原始数据（支持 jpg/png/bmp）
   * @returns 识别出的所有文字（多行合并）
   */
  async recognize(imageBuffer: Buffer): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('百度 API 密钥未配置，请在 .env 中设置 BAIDU_API_KEY 和 BAIDU_SECRET_KEY');
    }

    const token = await this.getAccessToken();

    // 百度通用文字识别（高精度版）
    const url = `https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic?access_token=${token}`;

    // 图片 base64 编码，URL-encode
    const base64Image = imageBuffer.toString('base64');
    const body = `image=${encodeURIComponent(base64Image)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) {
      throw new Error(`百度 OCR 请求失败: ${response.status}`);
    }

    const data = await response.json();

    if (data.error_code) {
      throw new Error(`百度 OCR 失败: [${data.error_code}] ${data.error_msg}`);
    }

    // words_result 是 [{words: "文字行1"}, {words: "文字行2"}, ...]
    const wordsResult = data.words_result || [];
    if (wordsResult.length === 0) {
      throw new Error('图片中未识别到文字');
    }

    // 合并所有文字行，保留换行结构
    return wordsResult.map((item: any) => item.words).join('\n');
  }

  /**
   * 判断文件是否为图片类型
   */
  isImageMime(mimeType: string): boolean {
    const imageTypes = ['image/jpeg', 'image/png', 'image/bmp', 'image/webp', 'image/jpg'];
    return imageTypes.includes(mimeType);
  }
}
