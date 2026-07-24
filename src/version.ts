import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

/** Current pix package version. */
export const VERSION = (require("../package.json") as { version: string }).version
