import { SetMetadata } from '@nestjs/common';

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

export const RATE_LIMIT_METADATA_KEY = 'rate_limit_config';

/**
 * Decorates an endpoint to apply rate limiting.
 * @param limit Max number of requests allowed in the window.
 * @param windowMs Time window in milliseconds.
 */
export const RateLimit = (limit: number, windowMs: number) =>
  SetMetadata(RATE_LIMIT_METADATA_KEY, { limit, windowMs });
