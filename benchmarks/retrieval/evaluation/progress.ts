/** Report one benchmark progress milestone on stderr so long runs stay observable. */
export const reportBenchmarkProgress = (message: string): void => {
  process.stderr.write(`[retrieval benchmark] ${message}\n`)
}
