/** Returned by the new API when the second factor must be re-verified; the console prompts inline. */
export const STEP_UP_REQUIRED_CODE = "STAFF_STEP_UP_REQUIRED";

/**
 * Returned by the previous API, which is what is live until the new API is deployed (the
 * frontend deploys first). It cannot be fixed by a step-up, so it is never prompted for: callers
 * keep showing their existing "sign in again" message.
 */
export const LEGACY_RECENT_AUTH_CODE = "STAFF_RECENT_AUTH_REQUIRED";

export function isStepUpRequiredCode(code: string | undefined): boolean {
  return code === STEP_UP_REQUIRED_CODE;
}

export function isLegacyRecentAuthCode(code: string | undefined): boolean {
  return code === LEGACY_RECENT_AUTH_CODE;
}

/** True when the API refused with the new step-up code. Reads a clone, so the body stays usable. */
export async function responseNeedsStepUp(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  try {
    const body = (await response.clone().json()) as { error?: { code?: string } };
    return isStepUpRequiredCode(body.error?.code);
  } catch {
    return false;
  }
}

/**
 * Sends a request; if the result says a step-up is needed, asks the user once and retries the
 * identical request exactly once. The retry's outcome is returned as-is, so a second
 * "step-up required" never loops. A cancelled or failed prompt returns the original result.
 */
export async function sendWithStepUp<R>(
  send: () => Promise<R>,
  options: {
    needsStepUp: (result: R) => Promise<boolean>;
    prompt: (() => Promise<boolean>) | null;
  },
): Promise<R> {
  const first = await send();
  if (!options.prompt || !(await options.needsStepUp(first))) return first;
  const verified = await options.prompt();
  return verified ? send() : first;
}

/**
 * Several requests can fail for the same stale window at once (a queue and its detail pane).
 * Share one prompt among them: everyone waits on the same answer instead of stacking dialogs.
 */
export function createStepUpCoordinator(open: () => Promise<boolean>): () => Promise<boolean> {
  let inFlight: Promise<boolean> | null = null;
  return () => {
    inFlight ??= open().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

export function describeStepUpError(error: { status: number; code: string }): {
  message: string;
  sessionEnded: boolean;
} {
  // A wrong code is also a 401, so the code decides: only an unauthenticated 401 means the
  // session is gone (revoked after repeated failures, or expired).
  if (error.code === "INVALID_SECOND_FACTOR_CODE") {
    return { message: "That code is incorrect. Try again.", sessionEnded: false };
  }
  if (error.status === 401) {
    return {
      message: "Your session ended after too many incorrect codes. Sign in again.",
      sessionEnded: true,
    };
  }
  if (error.status === 429) {
    return { message: "Too many attempts. Wait a few minutes and try again.", sessionEnded: false };
  }
  if (error.code === "STAFF_REAUTH_REQUIRED") {
    return { message: "Please sign in again to continue.", sessionEnded: true };
  }
  return { message: "The code could not be verified.", sessionEnded: false };
}
