import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * 认证守卫
 *
 * 验证请求中的 JWT token，将 userId 挂载到 request 上。
 * 兼容两种认证方式（优先级从高到低）：
 *   1. Authorization: Bearer <jwt>  → 解析 JWT 获取 userId
 *   2. x-user-id: <userId>         → 直接使用（向后兼容旧版）
 *
 * 使用方式：
 *   @UseGuards(AuthGuard)
 *   @Get('profile')
 *   getProfile(@Req() req) {
 *     const userId = req.userId; // AuthGuard 已注入
 *   }
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    // 方式 1：JWT Bearer token
    const authHeader = request.headers['authorization'] as string | undefined;
    if (authHeader) {
      const payload = this.authService.extractAndVerify(authHeader);
      if (payload) {
        request.userId = payload.userId;
        request.openid = payload.openid;
        return true;
      }
    }

    // 方式 2：向后兼容 x-user-id header（开发/过渡阶段）
    const xUserId = request.headers['x-user-id'] as string | undefined;
    if (xUserId) {
      request.userId = xUserId;
      return true;
    }

    // 方式 3：开发环境默认 test-user（仅在未配置微信 AppID 时）
    if (!process.env.WECHAT_APPID || !process.env.WECHAT_SECRET) {
      request.userId = 'test-user';
      return true;
    }

    // 所有方式都失败 → 拒绝访问
    return false;
  }
}

/**
 * 可选认证守卫
 *
 * 与 AuthGuard 相同，但认证失败不拒绝访问（userId 为 null）。
 * 用于需要区分"登录用户"和"匿名用户"的接口。
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    const authHeader = request.headers['authorization'] as string | undefined;
    if (authHeader) {
      const payload = this.authService.extractAndVerify(authHeader);
      if (payload) {
        request.userId = payload.userId;
        request.openid = payload.openid;
        return true;
      }
    }

    const xUserId = request.headers['x-user-id'] as string | undefined;
    if (xUserId) {
      request.userId = xUserId;
      return true;
    }

    // 不拒绝，但 userId 为 null
    request.userId = null;
    return true;
  }
}
