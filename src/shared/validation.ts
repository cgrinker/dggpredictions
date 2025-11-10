import { ZodError, type ZodTypeAny } from 'zod';
import { err, ok, type Result } from './result.js';
import type { ErrorPayload } from './types/errors.js';

export class SchemaValidationError extends Error {
  public readonly issues: ReturnType<typeof formatZodError>;

  constructor(message: string, error: ZodError) {
    super(message);
    this.name = 'SchemaValidationError';
    this.issues = formatZodError(error);
  }

  toErrorPayload(): ErrorPayload {
    return {
      code: 'VALIDATION_FAILED',
      message: this.message,
      details: { issues: this.issues },
    };
  }
}

export const formatZodError = (error: ZodError) =>
  error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));

export const parseWith = <TSchema extends ZodTypeAny>(
  schema: TSchema,
  data: unknown,
  message = 'Validation failed.',
): Result<ReturnType<TSchema['parse']>, SchemaValidationError> => {
  const result = schema.safeParse(data);
  if (!result.success) {
    return err(new SchemaValidationError(message, result.error));
  }
  return ok(result.data as ReturnType<TSchema['parse']>);
};

export const ensureValid = <TSchema extends ZodTypeAny>(
  schema: TSchema,
  data: unknown,
  message = 'Validation failed.',
): ReturnType<TSchema['parse']> => {
  const result = parseWith(schema, data, message);
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
};
