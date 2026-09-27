import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 全局路径前缀
  app.setGlobalPrefix('api');

  // 请求体校验
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // 自动剔除 DTO 未定义的字段
      transform: true, // 自动类型转换
    }),
  );

  // CORS：允许小程序请求
  app.enableCors();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`活记 API 已启动 → http://localhost:${port}/api`);
}
bootstrap();
