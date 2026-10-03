import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { ERROR_CODES, type ApiErrorBody } from '@clinic/shared';
import { AppError } from '../lib/errors';

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      } satisfies ApiErrorBody);
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION,
          message: 'Some fields need attention',
          details: error.validation.map((issue) => ({
            path: issue.instancePath.replace(/^\//, '').split('/').filter(Boolean),
            message: issue.message,
          })),
        },
      } satisfies ApiErrorBody);
    }

    if (error.statusCode === 429) {
      return reply.status(429).send({
        error: { code: ERROR_CODES.RATE_LIMITED, message: 'Too many requests. Please slow down.' },
      } satisfies ApiErrorBody);
    }

    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.status(error.statusCode).send({
        error: { code: ERROR_CODES.VALIDATION, message: 'The request could not be processed' },
      } satisfies ApiErrorBody);
    }

    // Log only the error shape; database errors can carry row values in `detail`.
    request.log.error(
      { err: { name: error.name, message: error.message, code: error.code, stack: error.stack } },
      'Unhandled error',
    );
    return reply.status(500).send({
      error: { code: ERROR_CODES.INTERNAL, message: 'Something went wrong. Please try again.' },
    } satisfies ApiErrorBody);
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      error: { code: ERROR_CODES.NOT_FOUND, message: 'Not found' },
    } satisfies ApiErrorBody);
  });
}
