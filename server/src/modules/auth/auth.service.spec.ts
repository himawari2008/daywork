/**
 * AuthService 单元测试
 *
 * 测试范围：
 * - JWT 签发与验证
 * - 无效/过期 token 拒绝
 * - Authorization header 解析
 * - 开发模式 mock 登录
 */
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeAll(() => {
    // 设置开发环境（不配置微信 AppID，触发 mock 登录模式）
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    delete process.env.WECHAT_APPID;
    delete process.env.WECHAT_SECRET;
    service = new AuthService();
  });

  describe('signToken + verifyToken', () => {
    it('签发并验证有效 token', () => {
      const openid = 'test-openid-123';
      const token = service.signToken(openid);

      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT 三段式

      const payload = service.verifyToken(token);
      expect(payload).toBeTruthy();
      expect(payload!.openid).toBe(openid);
      expect(payload!.userId).toBe(openid);
    });

    it('无效 token 返回 null', () => {
      expect(service.verifyToken('invalid-token')).toBeNull();
      expect(service.verifyToken('')).toBeNull();
      expect(service.verifyToken('header.payload.signature')).toBeNull();
    });

    it('不同 secret 签发的 token 验证失败', () => {
      const token = service.signToken('test-openid');

      // 用不同的 secret 验证
      process.env.JWT_SECRET = 'different-secret';
      const otherService = new AuthService();
      const payload = otherService.verifyToken(token);
      expect(payload).toBeNull();

      // 恢复
      process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    });

    it('openid 包含特殊字符时签名验证正常', () => {
      const openid = 'oTest_abc-123.XYZ';
      const token = service.signToken(openid);
      const payload = service.verifyToken(token);
      expect(payload!.openid).toBe(openid);
    });
  });

  describe('extractAndVerify', () => {
    it('正确从 Authorization header 提取并验证', () => {
      const openid = 'header-test-openid';
      const token = service.signToken(openid);

      const payload = service.extractAndVerify(`Bearer ${token}`);
      expect(payload).toBeTruthy();
      expect(payload!.openid).toBe(openid);
    });

    it('无效 header 格式返回 null', () => {
      expect(service.extractAndVerify(undefined)).toBeNull();
      expect(service.extractAndVerify('')).toBeNull();
      expect(service.extractAndVerify('NotBearer token')).toBeNull();
      expect(service.extractAndVerify('bearer token')).toBeNull(); // 大小写敏感
    });

    it('header 格式正确但 token 无效返回 null', () => {
      expect(service.extractAndVerify('Bearer invalid-token')).toBeNull();
    });
  });

  describe('login (开发模式)', () => {
    it('未配置微信 AppID 时使用 mock 登录', async () => {
      const result = await service.login('test-code-abc');
      expect(result.token).toBeTruthy();
      expect(result.openid).toContain('dev_');
      expect(result.openid).toContain('test-code-abc');

      // 验证返回的 token 可用
      const payload = service.verifyToken(result.token);
      expect(payload!.openid).toBe(result.openid);
    });

    it('每次 mock 登录生成不同的 openid', async () => {
      const result1 = await service.login('code1');
      const result2 = await service.login('code2');
      expect(result1.openid).not.toBe(result2.openid);
    });
  });
});
