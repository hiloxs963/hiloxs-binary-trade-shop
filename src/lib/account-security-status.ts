export type AccountSecurityStatus = { enrolled: boolean; backupCodesRemaining: number };

/**
 * Null when the API does not offer account-security management (it answers 404 until it is
 * deployed), the session is gone, the request fails, or the body is not what was expected: the page
 * then shows nothing new. A newer frontend must never show a control the API cannot serve.
 */
export async function loadAccountSecurityStatus(
  send: () => Promise<Response>,
): Promise<AccountSecurityStatus | null> {
  try {
    const response = await send();
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<AccountSecurityStatus>;
    if (typeof body.enrolled !== "boolean" || typeof body.backupCodesRemaining !== "number") {
      return null;
    }
    return { enrolled: body.enrolled, backupCodesRemaining: body.backupCodesRemaining };
  } catch {
    return null;
  }
}
