export type ErrorCode =
  | "VALIDATION_ERROR"
  | "CONFIGURATION_ERROR"
  | "DATABASE_UNAVAILABLE"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

type AppErrorOptions = {
  code: ErrorCode;
  statusCode: number;
  expose: boolean;
  cause?: unknown;
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly expose: boolean;

  constructor(message: string, options: AppErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.expose = options.expose;
  }
}

export class ValidationError extends AppError {
  constructor(message = "The request is invalid", cause?: unknown) {
    super(message, {
      code: "VALIDATION_ERROR",
      statusCode: 400,
      expose: true,
      ...(cause === undefined ? {} : { cause }),
    });
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, {
      code: "CONFIGURATION_ERROR",
      statusCode: 500,
      expose: false,
      ...(cause === undefined ? {} : { cause }),
    });
  }
}

export class DatabaseUnavailableError extends AppError {
  constructor(cause?: unknown) {
    super("The database is unavailable", {
      code: "DATABASE_UNAVAILABLE",
      statusCode: 503,
      expose: false,
      ...(cause === undefined ? {} : { cause }),
    });
  }
}

export class NotFoundError extends AppError {
  constructor() {
    super("The requested resource was not found", {
      code: "NOT_FOUND",
      statusCode: 404,
      expose: true,
    });
  }
}

export class InternalError extends AppError {
  constructor(cause?: unknown) {
    super("An unexpected error occurred", {
      code: "INTERNAL_ERROR",
      statusCode: 500,
      expose: false,
      ...(cause === undefined ? {} : { cause }),
    });
  }
}

export type ErrorResponse = {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
  };
};

export function serializeError(
  error: unknown,
  requestId: string,
): {
  statusCode: number;
  body: ErrorResponse;
} {
  const appError = error instanceof AppError ? error : new InternalError(error);
  return {
    statusCode: appError.statusCode,
    body: {
      error: {
        code: appError.code,
        message: appError.expose ? appError.message : publicMessageFor(appError.code),
        requestId,
      },
    },
  };
}

function publicMessageFor(code: ErrorCode): string {
  if (code === "DATABASE_UNAVAILABLE") return "Service temporarily unavailable";
  return "An unexpected error occurred";
}
