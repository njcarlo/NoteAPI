import { ERROR_CODES, type ErrorCode } from '@clinic/shared';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what = 'Record') => new AppError(404, ERROR_CODES.NOT_FOUND, `${what} not found`);
export const forbidden = () =>
  new AppError(403, ERROR_CODES.FORBIDDEN, 'You do not have access to this resource');
export const unauthenticated = () =>
  new AppError(401, ERROR_CODES.UNAUTHENTICATED, 'Please sign in to continue');
export const conflict = (message: string) => new AppError(409, ERROR_CODES.CONFLICT, message);
export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, ERROR_CODES.VALIDATION, message, details);

/** Postgres unique-violation check without surfacing the offending values. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pg = (error as { cause?: unknown })?.cause ?? error;
  const { code, constraint_name } = (pg ?? {}) as { code?: string; constraint_name?: string };
  return code === '23505' && (!constraint || constraint_name === constraint);
}
