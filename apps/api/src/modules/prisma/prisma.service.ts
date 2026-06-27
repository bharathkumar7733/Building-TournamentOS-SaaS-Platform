import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private static pool: Pool;
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not defined.');
    }

    if (!PrismaService.pool) {
      PrismaService.pool = new Pool({ connectionString });
    }

    const adapter = new PrismaPg(PrismaService.pool);
    super({ adapter });
  }

  async onModuleInit() {
    // Run connection asynchronously in the background so NestJS startup is not blocked.
    this.$connect()
      .then(() => {
        this.logger.log('Database connection established successfully.');
      })
      .catch((err) => {
        this.logger.error(
          'Failed to connect to PostgreSQL database. Database operations will fail, but the server is running.',
          err,
        );
      });
  }

  async onModuleDestroy() {
    await this.$disconnect();
    // In dev hot-reload, we might keep the pool open or close it. Close it on destroy.
    await PrismaService.pool.end();
  }
}
