export type ErrorCode =
  | "VALIDATION_ERROR"
  | "CONFIGURATION_ERROR"
  | "DATABASE_UNAVAILABLE"
  | "EMAIL_DELIVERY_FAILED"
  | "UNAUTHENTICATED"
  | "SELLER_NOT_APPROVED"
  | "STAFF_PERMISSION_REQUIRED"
  | "STAFF_REAUTH_REQUIRED"
  | "STAFF_RECENT_AUTH_REQUIRED"
  | "STAFF_REVIEW_DISABLED"
  | "MEDIA_UPLOAD_DISABLED"
  | "CATALOG_ACTIVATION_DISABLED"
  | "SELLER_COMMERCE_DISABLED"
  | "SELLER_ORDER_ACTIONS_DISABLED"
  | "MEDIA_STORAGE_UNAVAILABLE"
  | "ORIGIN_NOT_ALLOWED"
  | "CONFLICT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "PAYMENT_ALREADY_IN_PROGRESS"
  | "PAYMENT_IN_PROGRESS"
  | "MPESA_NOT_AVAILABLE"
  | "PAYMENT_PROVIDER_UNAVAILABLE"
  | "PAYMENT_REQUIRES_REVIEW"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
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

export class EmailDeliveryError extends AppError {
  constructor(cause?: unknown) {
    super("Authentication email delivery failed", {
      code: "EMAIL_DELIVERY_FAILED",
      statusCode: 503,
      expose: false,
      ...(cause === undefined ? {} : { cause }),
    });
  }
}

export class UnauthenticatedError extends AppError {
  constructor() {
    super("Authentication is required", {
      code: "UNAUTHENTICATED",
      statusCode: 401,
      expose: true,
    });
  }
}

export class SellerNotApprovedError extends AppError {
  constructor() {
    super("An approved seller application is required", {
      code: "SELLER_NOT_APPROVED",
      statusCode: 403,
      expose: true,
    });
  }
}

export class StaffPermissionRequiredError extends AppError {
  constructor() {
    super("Staff permission is required", {
      code: "STAFF_PERMISSION_REQUIRED",
      statusCode: 403,
      expose: true,
    });
  }
}

export class StaffReauthRequiredError extends AppError {
  constructor() {
    super("Please sign in again before accessing staff operations", {
      code: "STAFF_REAUTH_REQUIRED",
      statusCode: 403,
      expose: true,
    });
  }
}

export class StaffRecentAuthRequiredError extends AppError {
  constructor() {
    super("Please sign in again before performing review actions", {
      code: "STAFF_RECENT_AUTH_REQUIRED",
      statusCode: 403,
      expose: true,
    });
  }
}

export class StaffReviewDisabledError extends AppError {
  constructor() {
    super("Review actions are currently disabled", {
      code: "STAFF_REVIEW_DISABLED",
      statusCode: 503,
      expose: true,
    });
  }
}

export class MediaUploadDisabledError extends AppError {
  constructor() {
    super("Product media uploads are currently disabled", {
      code: "MEDIA_UPLOAD_DISABLED",
      statusCode: 503,
      expose: true,
    });
  }
}

export class CatalogActivationDisabledError extends AppError {
  constructor() {
    super("Catalog activation is currently disabled", {
      code: "CATALOG_ACTIVATION_DISABLED",
      statusCode: 503,
      expose: true,
    });
  }
}

export class SellerCommerceDisabledError extends AppError {
  constructor() {
    super("Seller commerce is currently disabled", {
      code: "SELLER_COMMERCE_DISABLED",
      statusCode: 503,
      expose: true,
    });
  }
}

export class SellerOrderActionsDisabledError extends AppError {
  constructor() {
    super("Seller order actions are currently disabled", {
      code: "SELLER_ORDER_ACTIONS_DISABLED",
      statusCode: 503,
      expose: true,
    });
  }
}

export class MediaStorageUnavailableError extends AppError {
  constructor(cause?: unknown) {
    super("Product media is temporarily unavailable", {
      code: "MEDIA_STORAGE_UNAVAILABLE",
      statusCode: 503,
      expose: true,
      ...(cause === undefined ? {} : { cause }),
    });
  }
}

export class OriginNotAllowedError extends AppError {
  constructor() {
    super("The request origin is not allowed", {
      code: "ORIGIN_NOT_ALLOWED",
      statusCode: 403,
      expose: true,
    });
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, {
      code: "CONFLICT",
      statusCode: 409,
      expose: true,
    });
  }
}

export class IdempotencyKeyReusedError extends AppError {
  constructor() {
    super("The idempotency key was already used for a different order request", {
      code: "IDEMPOTENCY_KEY_REUSED",
      statusCode: 409,
      expose: true,
    });
  }
}

export class PaymentAlreadyInProgressError extends AppError {
  constructor() {
    super("A payment is already in progress for this order", {
      code: "PAYMENT_ALREADY_IN_PROGRESS",
      statusCode: 409,
      expose: true,
    });
  }
}

export class PaymentInProgressError extends AppError {
  constructor() {
    super("This order cannot be cancelled while payment confirmation is pending", {
      code: "PAYMENT_IN_PROGRESS",
      statusCode: 409,
      expose: true,
    });
  }
}

export class MpesaNotAvailableError extends AppError {
  constructor() {
    super("M-Pesa payments are not currently available", {
      code: "MPESA_NOT_AVAILABLE",
      statusCode: 503,
      expose: true,
    });
  }
}

export class PaymentProviderUnavailableError extends AppError {
  constructor(cause?: unknown) {
    super("M-Pesa is temporarily unavailable", {
      code: "PAYMENT_PROVIDER_UNAVAILABLE",
      statusCode: 503,
      expose: true,
      ...(cause === undefined ? {} : { cause }),
    });
  }
}

export class PaymentRequiresReviewError extends AppError {
  constructor() {
    super("Payment confirmation requires review", {
      code: "PAYMENT_REQUIRES_REVIEW",
      statusCode: 409,
      expose: true,
    });
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(cause?: unknown) {
    super("The request payload is too large", {
      code: "PAYLOAD_TOO_LARGE",
      statusCode: 413,
      expose: true,
      ...(cause === undefined ? {} : { cause }),
    });
  }
}

export class RateLimitError extends AppError {
  constructor() {
    super("Too many requests", {
      code: "RATE_LIMITED",
      statusCode: 429,
      expose: true,
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
  if (code === "DATABASE_UNAVAILABLE" || code === "EMAIL_DELIVERY_FAILED") {
    return "Service temporarily unavailable";
  }
  return "An unexpected error occurred";
}
