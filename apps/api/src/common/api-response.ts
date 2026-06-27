import { randomUUID } from 'crypto';

/**
 * Standard API success response envelope.
 *
 * All endpoints return this shape so clients have a predictable contract.
 * Example:
 * {
 *   "success": true,
 *   "data": { ... },
 *   "meta": { "page": 1, "total": 42 }
 * }
 */
export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

/**
 * Standard API error response envelope.
 *
 * Example:
 * {
 *   "success": false,
 *   "requestId": "550e8400-e29b-41d4-a716-446655440000",
 *   "error": {
 *     "code": "TOURNAMENT_NOT_FOUND",
 *     "message": "Tournament with id xyz does not exist",
 *     "details": []
 *   }
 * }
 */
export interface ApiErrorResponse {
  success: false;
  requestId: string;
  error: {
    code: string;
    message: string;
    details?: unknown[];
  };
}

/** Helper to build a success envelope */
export function ok<T>(data: T, meta?: Record<string, unknown>): ApiResponse<T> {
  return { success: true, data, ...(meta ? { meta } : {}) };
}

/** Helper to build an error envelope */
export function err(
  code: string,
  message: string,
  details?: unknown[],
  requestId?: string,
): ApiErrorResponse {
  return {
    success: false,
    requestId: requestId || randomUUID(),
    error: { code, message, ...(details ? { details } : {}) },
  };
}
