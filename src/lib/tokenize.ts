export const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 0)
