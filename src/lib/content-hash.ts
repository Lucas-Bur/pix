import crypto from "node:crypto"

/** Return a stable SHA-256 identity for source or exact embedding input text. */
export const contentHash = (text: string): string =>
  crypto.createHash("sha256").update(text).digest("hex")
