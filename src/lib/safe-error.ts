const PRODUCTION_ERROR_MESSAGE = "An application error occurred";

export function reportApplicationError(context: string, error: unknown): void {
  if (import.meta.env.DEV) {
    console.error(`[${context}]`, error);
    return;
  }

  console.error({ event: "application_error", context, message: PRODUCTION_ERROR_MESSAGE });
}
