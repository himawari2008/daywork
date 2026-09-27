import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

/**
 * JWT Payload — 存储在 token 中的用户标识
 */
export interface JwtPayload {
  /** 微信 openid（唯一用户标识） */
  openid: string;
  /** 用户在本系统的内部 ID（可能是 openid 本身或映射后的 UUID） */
  userId: string;
}

/**
 * 微信 code2session 响应
 */
interface WechatSession {
  openid: string;
  session_key: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

/**
 * 认证服务
 * 微信小程序登录 → JWT 令牌签发与验证
 *
 * 流程：
 * 1. 小程序端 wx.login() 获取临时 code
 * 2. 后端用 code 换取 openid + session_key（微信 code2session）
 * 3. 后端签发 JWT（含 openid），返回给小程序
 * 4. 小程序后续请求携带 JWT（Authorization: Bearer <token>）
 * 5. 后端中间件/守卫验证 JWT，提取 userId
 */
@Injectable()
export class AuthService {
  private readonly jwtSecret: string;
  private readonly appId: string;
  private readonly appSecret: string;

  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'daywork-dev-secret-change-in-production';
    this.appId = process.env.WECHAT_APPID || '';
    this.appSecret = process.env.WECHAT_SECRET || '';
  }

  /**
   * 微信小程序登录
   * @param code wx.login() 返回的临时授权码
   * @returns JWT token + 用户信息
   */
  async login(code: string): Promise<{ token: string; openid: string }> {
    // 开发环境降级：没有配置微信 AppID 时使用 mock 登录
    if (!this.appId || !this.appSecret) {
      console.warn('[Auth] 微信 AppID/Secret 未配置，使用开发模式登录');
      const mockOpenid = `dev_${code}_${Date.now()}`;
      const token = this.signToken(mockOpenid);
      return { token, openid: mockOpenid };
    }

    // 正式：调用微信 code2session 接口换取 openid
    const session = await this.code2session(code);

    if (!session || !session.openid) {
      throw new Error('微信登录失败：无法获取用户标识');
    }

    const token = this.signToken(session.openid);
    return { token, openid: session.openid };
  }

  /**
   * 签发 JWT
   * @param openid 微信 openid
   * @returns JWT 字符串，有效期 7 天
   */
  signToken(openid: string): string {
    const payload: JwtPayload = {
      openid,
      userId: openid, // 当前阶段 userId = openid，后续可映射到内部 UUID
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: '7d',
      issuer: 'daywork',
    });
  }

  /**
   * 验证 JWT 并返回 payload
   * @param token JWT 字符串
   * @returns 解析后的 payload，无效则返回 null
   */
  verifyToken(token: string): JwtPayload | null {
    try {
      const payload = jwt.verify(token, this.jwtSecret, {
        issuer: 'daywork',
      }) as JwtPayload;

      // 基本校验
      if (!payload.openid || !payload.userId) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * 从 Authorization header 中提取并验证 token
   * @param authHeader Authorization header 值，如 "Bearer xxx"
   * @returns 解析后的 payload，无效则返回 null
   */
  extractAndVerify(authHeader: string | undefined): JwtPayload | null {
    if (!authHeader) return null;

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      // 兼容旧版 x-user-id header（直接传 userId）
      return null;
    }

    return this.verifyToken(parts[1]);
  }

  /**
   * 调用微信 code2session 接口
   * 文档：https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html
   */
  private async code2session(code: string): Promise<WechatSession> {
    const url =
      `https://api.weixin.qq.com/sns/jscode2session?` +
      `appid=${this.appId}` +
      `&secret=${this.appSecret}` +
      `&js_code=${code}` +
      `&grant_type=authorization_code`;

    try {
      const response = await fetch(url);
      const data = (await response.json()) as WechatSession;

      if (data.errcode && data.errcode !== 0) {
        console.error(`[Auth] 微信 code2session 失败: [${data.errcode}] ${data.errmsg}`);
        throw new Error(`微信登录失败: ${data.errmsg || '未知错误'}`);
      }

      return data;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('微信登录失败')) {
        throw error;
      }
      console.error('[Auth] 微信 code2session 网络错误:', (error as Error).message);
      throw new Error('微信登录失败：网络错误，请稍后重试');
    }
  }
}
