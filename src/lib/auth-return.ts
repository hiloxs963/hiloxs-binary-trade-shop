export const AUTH_RETURN_PATHS = ["/checkout", "/my-orders", "/sell-with-us", "/staff"] as const;

export type AuthReturnPath = (typeof AUTH_RETURN_PATHS)[number];

export function parseAuthReturnPath(value: unknown): AuthReturnPath | undefined {
  return typeof value === "string" && AUTH_RETURN_PATHS.includes(value as AuthReturnPath)
    ? (value as AuthReturnPath)
    : undefined;
}
