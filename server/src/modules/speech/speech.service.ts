import { Injectable } from '@nestjs/common';

/**
 * 语音识别服务
 * 调用百度短语音识别 API（免费额度大，中文准确率高）
 *
 * 链路：音频 Buffer → base64 → 百度 ASR → 返回文字
 * 文档：https://ai.baidu.com/tech/speech/asr
 */
@Injectable()
export class SpeechService {
  private readonly apiKey: string;
  private readonly secretKey: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0; // 毫秒时间戳

  constructor() {
    this.apiKey = process.env.BAIDU_API_KEY || '';
    this.secretKey = process.env.BAIDU_SECRET_KEY || '';
  }

  /** 检查百度 API 密钥是否已配置 */
  isConfigured(): boolean {
    return !!(this.apiKey && this.secretKey);
  }

  /**
   * 获取百度 OAuth access_token（带缓存，过期自动刷新）
   */
  private async getAccessToken(): Promise<string> {
    // 缓存未过期直接返回（提前 5 分钟刷新，token 有效期 30 天）
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
    // expires_in 是秒
    this.tokenExpiry = Date.now() + (data.expires_in || 2592000) * 1000;

    return this.accessToken!;
  }

  /**
   * 语音识别：将音频 Buffer 转为文字
   *
   * @param audioBuffer 音频原始数据
   * @param format      音频格式（wav/pcm/m4a 等）
   * @param sampleRate  采样率，默认 16000
   * @returns 识别出来的文字
   */
  async recognize(
    audioBuffer: Buffer,
    format: string = 'wav',
    sampleRate: number = 16000,
  ): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('百度 API 密钥未配置，请在 .env 中设置 BAIDU_API_KEY 和 BAIDU_SECRET_KEY');
    }

    const token = await this.getAccessToken();

    // 百度短语音识别 API
    const url = `https://vop.baidu.com/server_api?dev_pid=1537&cuid=daywork_miniapp&token=${token}`;

    const base64Speech = audioBuffer.toString('base64');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format: format,
        rate: sampleRate,
        channel: 1,
        cuid: 'daywork_miniapp',
        dev_pid: 1537, // 1537 = 普通话(简单句识别)
        speech: base64Speech,
        len: audioBuffer.length, // 原始音频字节数（非 base64 长度）
      }),
    });

    if (!response.ok) {
      throw new Error(`百度 ASR 请求失败: ${response.status}`);
    }

    const data = await response.json();

    if (data.err_no !== 0) {
      throw new Error(`百度 ASR 识别失败: [${data.err_no}] ${data.err_msg}`);
    }

    // result 是数组 ["识别结果1", "识别结果2"]，取第一个
    const results = data.result || [];
    if (results.length === 0) {
      throw new Error('百度 ASR 未识别到任何内容');
    }

    return results[0] as string;
  }
}
