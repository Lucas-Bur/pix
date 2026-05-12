const errorCodes: Record<string, string> = {
  ConfigError: "CONFIG_MISSING",
  PlatformError: "PLATFORM_ERROR",
}

const messageFromError = (error: unknown): string => {
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message)
  }
  return "Unknown error"
}

const codeFromError = (error: unknown): string => {
  if (error && typeof error === "object" && "_tag" in error) {
    const tag = String((error as { _tag: unknown })._tag)
    return errorCodes[tag] ?? "UNKNOWN"
  }
  return "UNKNOWN"
}

export const formatError = (error: unknown): string =>
  JSON.stringify({
    error: true,
    code: codeFromError(error),
    message: messageFromError(error),
  })
