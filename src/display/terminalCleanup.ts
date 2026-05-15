/**
 * Terminal cleanup for abrupt exits.
 *
 * @clack/prompts' spinner and taskLog call stdin.setRawMode(true) and hide
 * the cursor via escape sequences. When the process is killed by a signal
 * handler that calls process.exit() directly, clack's own cleanup is
 * bypassed and the terminal is left in raw mode with the cursor hidden.
 *
 * Registering a process 'exit' listener that restores these guarantees the
 * terminal is always left in a usable state.
 */

/** Escape sequence to show the cursor (DECTCEM). */
export const SHOW_CURSOR = "\x1b[?25h"

/**
 * Creates a synchronous exit handler that restores terminal state. Extracted as a pure function so
 * it can be unit-tested without side effects.
 */
export const makeTerminalCleanupHandler =
  (
    stdin: { isTTY?: boolean; setRawMode?: (raw: boolean) => void },
    stdout: { isTTY?: boolean; write: (data: string) => boolean },
  ) =>
  (): void => {
    if (stdin.isTTY && stdin.setRawMode) {
      try {
        stdin.setRawMode(false)
      } catch {
        // Best-effort — may fail if stdin is already closed
      }
    }
    // Only write ANSI escape sequences to interactive terminals.
    // Writing to piped/redirected stdout would corrupt machine-readable output (e.g. --json mode).
    if (stdout.isTTY) {
      try {
        stdout.write(SHOW_CURSOR)
      } catch {
        // Best-effort — may fail if stdout is already closed
      }
    }
  }

/**
 * Registers the terminal cleanup handler on process 'exit'. Call once at program startup
 * (index.ts).
 */
export const setupTerminalCleanup = (): void => {
  process.on("exit", makeTerminalCleanupHandler(process.stdin, process.stdout))
}
