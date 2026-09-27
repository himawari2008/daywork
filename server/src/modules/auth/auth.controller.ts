import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * 认证控制器
 * POST /auth/login — 微信小程序登录
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * 微信小程序登录
   *
   * 请求体：{ code: string }  — wx.login() 返回的临时授权码
   * 响应：{ token: string, openid: string }
   *
   * 小程序端收到 token 后存入 Storage，后续请求携带：
   *   Authorization: Bearer <token>
   */
  @Post('login')
  async login(@Body('code') code: string) {
    if (!code || !code.trim()) {
      throw new HttpException('登录凭证(code)不能为空', HttpStatus.BAD_REQUEST);
    }

    try {
      const result = await this.authService.login(code.trim());
      return {
        success: true,
        token: result.token,
        openid: result.openid,
      };
    } catch (error) {
      const message = (error as Error).message || '登录失败';
      throw new HttpException(
        { success: false, message },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }
}
