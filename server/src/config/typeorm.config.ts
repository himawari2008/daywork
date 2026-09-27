import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';

// 加载 .env 文件（CLI 环境下 NestJS ConfigModule 不生效）
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * TypeORM CLI 数据源配置
 * 用于生成和运行数据库迁移
 *
 * 使用方式：
 *   npx typeorm-ts-node-commonjs migration:generate src/migrations/InitialSchema -d src/config/typeorm.config.ts
 *   npx typeorm-ts-node-commonjs migration:run -d src/config/typeorm.config.ts
 *   npx typeorm-ts-node-commonjs migration:revert -d src/config/typeorm.config.ts
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'weijiahang',
  password: process.env.DB_PASSWORD || 'weijiahang123',
  database: process.env.DB_DATABASE || 'weijiahang_dev',
  entities: [path.resolve(__dirname, '../**/*.entity{.ts,.js}')],
  migrations: [path.resolve(__dirname, '../migrations/*{.ts,.js}')],
  synchronize: false, // CLI 模式下永远关闭 synchronize
  logging: true,
});
