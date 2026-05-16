/**
 * Check if a platform error has a specific `reason` string (e.g. "BadResource" for disk full,
 * "NotFound" for missing files). Platform errors from @effect/platform include a `reason` property
 * that categorizes the failure.
 */
export const isPlatformReason = (cause: unknown, reason: string): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "reason" in cause &&
  String((cause as { reason: unknown }).reason) === reason
