import { Module, Global } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

/**
 * 认证模块（全局）
 *
 * 提供：
 * - AuthService: JWT 签发与验证（可跨模块注入）
 * - AuthGuard / OptionalAuthGuard: 请求认证守卫
 * - POST /auth/login: 微信小程序登录端点
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
