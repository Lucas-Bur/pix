/** Check whether an unknown worker message has one of the expected protocol types. */
export const hasWorkerMessageType = (
  message: unknown,
  types: readonly string[],
): message is { readonly type: string } => {
  if (typeof message !== "object" || message === null || !("type" in message)) return false
  return typeof message.type === "string" && types.includes(message.type)
}
