import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as path from 'path';

/**
 * 数据库连接配置
 * 本地 PostgreSQL 17 + PostGIS 3.6
 *
 * synchronize 策略：
 * - development（默认）：true — 自动同步实体到数据库，方便快速迭代
 * - production：false — 必须通过 migration 管理数据库变更
 */
export const databaseConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'weijiahang',
  password: process.env.DB_PASSWORD || 'weijiahang123',
  database: process.env.DB_DATABASE || 'weijiahang_dev',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [path.resolve(__dirname, '../migrations/*{.ts,.js}')],
  synchronize: process.env.NODE_ENV !== 'production',
  logging: process.env.NODE_ENV === 'development',
};
