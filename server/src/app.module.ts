import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { databaseConfig } from './config/database.config';
import { RecordsModule } from './modules/records/records.module';
import { AiModule } from './modules/ai/ai.module';
import { GroupsModule } from './modules/groups/groups.module';
import { LoansModule } from './modules/loans/loans.module';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [
    // 加载 .env 环境变量
    ConfigModule.forRoot({ isGlobal: true }),
    // 数据库连接
    TypeOrmModule.forRoot(databaseConfig),
    // 静态文件服务：上传的音频/图片文件
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',
    }),
    // 认证模块（全局）
    AuthModule,
    // 业务模块
    RecordsModule,
    AiModule,
    GroupsModule,
    LoansModule,
  ],
})
export class AppModule {}
