import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private redisClient!: Redis;
  private publisherClient!: Redis;
  private subscriberClient!: Redis;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379/0';
    this.logger.log(`Connecting to Redis at: ${redisUrl}`);
    
    const clientOptions = {
      maxRetriesPerRequest: null,
      retryStrategy(times: number) {
        return 5000;
      },
    };

    this.redisClient = new Redis(redisUrl, clientOptions);
    this.publisherClient = new Redis(redisUrl, clientOptions);
    this.subscriberClient = new Redis(redisUrl, clientOptions);

    this.redisClient.on('error', (err) => {
      this.logger.error('Redis main client connection error:', err);
    });

    this.publisherClient.on('error', (err) => {
      this.logger.error('Redis publisher client connection error:', err);
    });

    this.subscriberClient.on('error', (err) => {
      this.logger.error('Redis subscriber client connection error:', err);
    });
  }

  async onModuleDestroy() {
    this.logger.log('Disconnecting from Redis...');
    await Promise.all([
      this.redisClient.quit(),
      this.publisherClient.quit(),
      this.subscriberClient.quit(),
    ]);
  }

  get client(): Redis {
    return this.redisClient;
  }

  get publisher(): Redis {
    return this.publisherClient;
  }

  get subscriber(): Redis {
    return this.subscriberClient;
  }
}
