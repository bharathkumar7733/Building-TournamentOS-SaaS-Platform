import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { ApiErrorResponse } from '../api-response';

/**
 * GlobalExceptionFilter
 *
 * Intercepts ALL unhandled exceptions and formats them as the standard
 * { success: false, error: { code, message, details }, requestId } envelope.
 *
 * A unique requestId is generated for every error response to enable
 * support ticket tracing without exposing server internals.
 *
 * Mapping:
 *   HttpException            → preserved status + NestJS message
 *   Prisma P2025             → 404 NOT_FOUND
 *   Prisma P2002             → 409 CONFLICT (unique constraint)
 *   Zod ValidationError      → 422 VALIDATION_ERROR
 *   Everything else          → 500 INTERNAL_SERVER_ERROR
 *
 * All 5xx errors are logged with full stack trace for observability.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const requestId = randomUUID();
    const { status, code, message, details } = this.resolve(exception);

    if (status >= 500) {
      this.logger.error(
        `[${request.method}] ${request.url} → ${status} ${code}: ${message} (requestId=${requestId})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiErrorResponse = {
      success: false,
      requestId,
      error: { code, message, ...(details ? { details } : {}) },
    };

    response.status(status).json(body);
  }

  private resolve(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: unknown[];
  } {
    // NestJS HttpException (including ValidationPipe errors)
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const status = exception.getStatus();

      if (typeof res === 'object' && res !== null) {
        const obj = res as Record<string, unknown>;
        const message =
          typeof obj['message'] === 'string'
            ? obj['message']
            : Array.isArray(obj['message'])
              ? (obj['message'] as string[]).join(', ')
              : exception.message;

        const code = this.statusToCode(status);
        const details = Array.isArray(obj['message'])
          ? (obj['message'] as unknown[])
          : undefined;

        return { status, code, message, details };
      }

      return {
        status,
        code: this.statusToCode(status),
        message: exception.message,
      };
    }

    // Prisma known errors
    if (this.isPrismaError(exception)) {
      const prismaCode = (exception as { code: string }).code;

      if (prismaCode === 'P2025') {
        return {
          status: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: 'The requested resource does not exist.',
        };
      }

      if (prismaCode === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          code: 'CONFLICT',
          message: 'A resource with this identifier already exists.',
        };
      }
    }

    // Generic / unknown
    const message =
      exception instanceof Error ? exception.message : 'Internal server error';

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message,
    };
  }

  private isPrismaError(e: unknown): boolean {
    return (
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      typeof (e as Record<string, unknown>)['code'] === 'string' &&
      (e as Record<string, unknown>)['code']!.toString().startsWith('P')
    );
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'VALIDATION_ERROR',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_SERVER_ERROR',
      502: 'BAD_GATEWAY',
      503: 'SERVICE_UNAVAILABLE',
    };
    return map[status] ?? 'ERROR';
  }
}
