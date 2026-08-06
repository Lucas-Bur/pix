import crypto from "node:crypto"

import { Data, Effect, Layer } from "effect"
import type Parser from "tree-sitter"

import type { Chunk } from "../domain/chunk.js"
import { DEFAULT_CONFIG } from "../domain/config.js"
import type { InferenceError, ModelLoadError, TokenLimitError } from "../domain/errors.js"
import { OversizedChunkError } from "../domain/errors.js"
import { ConfigStore, Chunker, type ChunkingOptions } from "../domain/ports.js"
import { getExtension } from "../lib/config/extension.js"
import { parseTreeSitterSource } from "../lib/parsing/tree-sitter.js"
import { buildExtensionRegistry } from "../lib/registry.js"
import { ConfigStoreLive } from "./config-store.js"

// Intentionally local: this normalizes foreign tree-sitter throws and is fully eliminated by the
// line fallback below. Moving implementation-only errors into domain/errors.ts would expose a
// failure callers cannot observe or handle.
class AstChunkingError extends Data.TaggedError("AstChunkingError")<{
  readonly file: string
  readonly cause: unknown
}> {}

interface Range {
  readonly start: number
  readonly end: number
}

type ChunkingError = ModelLoadError | InferenceError | TokenLimitError

const chunkId = (file: string, location: string): string =>
  crypto.createHash("sha1").update(`${file}:${location}`).digest("hex").slice(0, 12)

const lineStartOffsets = (content: string): readonly number[] => {
  const offsets = [0]
  for (let index = 0; index < content.length; index++) {
    if (content[index] === "\n") offsets.push(index + 1)
  }
  return offsets
}

const lineIndexAtOffset = (offsets: readonly number[], offset: number): number => {
  let low = 0
  let high = offsets.length - 1
  let result = 0
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (offsets[middle]! <= offset) {
      result = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return result
}

const rangeChunk = (
  file: string,
  source: string,
  start: number,
  end: number,
  baseOffset: number,
  baseLine: number,
  lineStarts: readonly number[],
  idx: number,
): Chunk => {
  const text = source.slice(start, end)
  const startLine = baseLine + lineIndexAtOffset(lineStarts, start)
  const endLine =
    baseLine +
    lineIndexAtOffset(lineStarts, end) -
    (end > start && source[end - 1] === "\n" ? 1 : 0)

  return {
    id: chunkId(file, `${baseOffset + start}:${baseOffset + end}`),
    idx,
    file,
    startLine,
    endLine: Math.max(startLine, endLine),
    startOffset: baseOffset + start,
    endOffset: baseOffset + end,
    text,
  }
}

const buildLineRanges = (content: string): readonly Range[] => {
  if (content.length === 0) return []
  const ranges: Range[] = []
  let start = 0
  for (let index = 0; index < content.length; index++) {
    if (content[index] !== "\n") continue
    ranges.push({ start, end: index + 1 })
    start = index + 1
  }
  if (start < content.length) ranges.push({ start, end: content.length })
  return ranges
}

const commentsAttachedTo = (
  comments: readonly Parser.SyntaxNode[],
  node: Parser.SyntaxNode,
): readonly Parser.SyntaxNode[] => {
  const lastComment = comments[comments.length - 1]
  if (lastComment === undefined || node.startPosition.row - lastComment.endPosition.row > 1) {
    return []
  }
  return comments
}

const collectAstUnits = (root: Parser.SyntaxNode): readonly (readonly Parser.SyntaxNode[])[] => {
  const units: Parser.SyntaxNode[][] = []
  let leadingComments: readonly Parser.SyntaxNode[] = []

  for (const node of root.namedChildren) {
    if (node.type.includes("comment")) {
      const previous = leadingComments[leadingComments.length - 1]
      if (previous !== undefined && node.startPosition.row - previous.endPosition.row > 1) {
        units.push([...leadingComments])
        leadingComments = [node]
      } else {
        leadingComments = [...leadingComments, node]
      }
      continue
    }

    const attachedComments = commentsAttachedTo(leadingComments, node)
    if (leadingComments.length > 0 && attachedComments.length === 0) {
      units.push([...leadingComments])
    }
    units.push([...attachedComments, node])
    leadingComments = []
  }

  if (leadingComments.length > 0) units.push([...leadingComments])

  return units
}

const makeAstChunk = (
  nodes: readonly Parser.SyntaxNode[],
  idx: number,
  file: string,
  content: string,
): Chunk => {
  const firstNode = nodes[0]!
  const lastNode = nodes[nodes.length - 1]!
  const startLine = firstNode.startPosition.row + 1
  const endLine = lastNode.endPosition.row + 1
  const startOffset = firstNode.startIndex
  const endOffset = lastNode.endIndex

  return {
    id: chunkId(file, `${startOffset}:${endOffset}`),
    idx,
    file,
    startLine,
    endLine,
    startOffset,
    endOffset,
    text: content.slice(startOffset, endOffset),
  }
}

const safeBoundaryCharacter = (character: string): boolean =>
  /[\s.,;:!?()[\]{}<>+\-*/=|&%]/u.test(character)

const codePointOffsets = (text: string): readonly number[] => {
  const offsets = [0]
  let offset = 0
  for (const character of text) {
    offset += character.length
    offsets.push(offset)
  }
  return offsets
}

const countRange = (source: string, range: Range, options: ChunkingOptions) =>
  options.countTokens(source.slice(range.start, range.end))

const findLongestSafePrefixEffect = (
  source: string,
  start: number,
  end: number,
  options: ChunkingOptions,
  fullCount: number,
): Effect.Effect<number | null, ChunkingError> => {
  const text = source.slice(start, end)
  const offsets = codePointOffsets(text)

  return Effect.gen(function* () {
    if (fullCount <= options.maxTokens) return end

    let low = 1
    let high = offsets.length - 1
    let largest = 0
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const candidateEnd = offsets[middle]!
      const count = yield* options.countTokens(text.slice(0, candidateEnd))
      if (count <= options.maxTokens) {
        largest = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }

    if (largest === 0) return null
    for (let index = largest; index > 0; index--) {
      const boundary = offsets[index]!
      const previous = text[boundary - 1]
      if (previous !== undefined && safeBoundaryCharacter(previous)) {
        return start + boundary
      }
    }
    return null
  })
}

const reportOversized = (
  file: string,
  source: string,
  range: Range,
  baseOffset: number,
  baseLine: number,
  actualTokens: number,
  options: ChunkingOptions,
  lineStarts: readonly number[],
): Effect.Effect<void> => {
  const chunk = rangeChunk(
    file,
    source,
    range.start,
    range.end,
    baseOffset,
    baseLine,
    lineStarts,
    0,
  )
  const error = new OversizedChunkError({
    message: `Cannot safely split ${file}:${chunk.startLine}-${chunk.endLine}; ${actualTokens} tokens exceed the limit of ${options.maxTokens}`,
    file,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    model: "dense+sparse",
    actualTokens,
    limit: options.maxTokens,
  })
  return options.onDiagnostic({
    kind: "skipped-chunk",
    file: error.file,
    startLine: error.startLine,
    endLine: error.endLine,
    model: error.model,
    actualTokens: error.actualTokens,
    limit: error.limit,
    message: error.message,
  })
}

const splitLongRange = (
  file: string,
  source: string,
  range: Range,
  baseOffset: number,
  baseLine: number,
  options: ChunkingOptions,
  lineStarts: readonly number[],
): Effect.Effect<readonly Range[], ChunkingError> =>
  Effect.gen(function* () {
    const result: Range[] = []
    let start = range.start

    while (start < range.end) {
      const remaining: Range = { start, end: range.end }
      const remainingTokens = yield* countRange(source, remaining, options)
      if (remainingTokens <= options.maxTokens) {
        result.push(remaining)
        break
      }

      const next = yield* findLongestSafePrefixEffect(
        source,
        start,
        range.end,
        options,
        remainingTokens,
      )
      if (next === null || next <= start) {
        yield* reportOversized(
          file,
          source,
          remaining,
          baseOffset,
          baseLine,
          remainingTokens,
          options,
          lineStarts,
        )
        break
      }
      result.push({ start, end: next })
      start = next
    }

    return result
  })

const astSegments = (root: Parser.SyntaxNode, length: number): readonly Range[] => {
  let node = root
  while (
    node.namedChildren.length === 1 &&
    node.namedChildren[0]!.startIndex === node.startIndex &&
    node.namedChildren[0]!.endIndex === node.endIndex
  ) {
    node = node.namedChildren[0]!
  }

  const children = node.namedChildren.filter((child) => child.namedChildren.length > 0)
  if (children.length === 0) return []

  const nodeStart = Math.max(0, node.startIndex)
  const nodeEnd = Math.min(length, node.endIndex)
  if (children.length === 1) {
    const nested = astSegments(children[0]!, length)
    if (nested.length < 2) return []
    return nested.map((segment, index) => ({
      start: index === 0 ? nodeStart : segment.start,
      end: index === nested.length - 1 ? nodeEnd : segment.end,
    }))
  }

  const segments: Range[] = []
  let cursor = nodeStart
  for (const child of children) {
    const end = Math.min(length, child.endIndex)
    if (end <= cursor) continue
    segments.push({ start: cursor, end })
    cursor = end
  }
  if (segments.length > 0 && cursor < nodeEnd) {
    const last = segments[segments.length - 1]!
    segments[segments.length - 1] = { start: last.start, end: nodeEnd }
  }

  return segments.length === 1 && segments[0]!.start === 0 && segments[0]!.end === length
    ? []
    : segments
}

const packRanges = (
  source: string,
  ranges: readonly Range[],
  options: ChunkingOptions,
): Effect.Effect<readonly Range[], ChunkingError> =>
  Effect.gen(function* () {
    if (ranges.length === 0) return []
    const packed: Range[] = []
    let current = ranges[0]!

    for (const next of ranges.slice(1)) {
      if (next.start !== current.end) {
        packed.push(current)
        current = next
        continue
      }
      const candidate = { start: current.start, end: next.end }
      const count = yield* countRange(source, candidate, options)
      if (count > options.maxTokens) {
        packed.push(current)
        current = next
      } else {
        current = candidate
      }
    }

    packed.push(current)
    return packed
  })

const splitOversizedRange = (
  file: string,
  source: string,
  range: Range,
  baseOffset: number,
  baseLine: number,
  parser: Parser,
  options: ChunkingOptions,
  lineStarts: readonly number[],
  depth = 0,
): Effect.Effect<readonly Range[], ChunkingError> =>
  Effect.gen(function* () {
    const tokens = yield* countRange(source, range, options)
    if (tokens <= options.maxTokens) return [range]

    if (depth < 32) {
      const tree = yield* Effect.try({
        try: () => parseTreeSitterSource(parser, source.slice(range.start, range.end)),
        catch: (cause) => new AstChunkingError({ file, cause }),
      }).pipe(Effect.catch(() => Effect.succeed(null)))
      if (tree !== null && !tree.rootNode.hasError) {
        const segments = astSegments(tree.rootNode, range.end - range.start).map((segment) => ({
          start: range.start + segment.start,
          end: range.start + segment.end,
        }))
        if (segments.length > 0) {
          const split: Range[] = []
          for (const segment of segments) {
            split.push(
              ...(yield* splitOversizedRange(
                file,
                source,
                segment,
                baseOffset,
                baseLine,
                parser,
                options,
                lineStarts,
                depth + 1,
              )),
            )
          }
          return yield* packRanges(source, split, options)
        }
      }
    }

    const lines = buildLineRanges(source.slice(range.start, range.end)).map((line) => ({
      start: range.start + line.start,
      end: range.start + line.end,
    }))
    if (lines.length > 1) {
      const result: Range[] = []
      let current: Range | null = null
      for (const line of lines) {
        const lineTokens = yield* countRange(source, line, options)
        if (lineTokens > options.maxTokens) {
          if (current !== null) {
            result.push(current)
            current = null
          }
          result.push(
            ...(yield* splitLongRange(
              file,
              source,
              line,
              baseOffset,
              baseLine,
              options,
              lineStarts,
            )),
          )
        } else if (current === null) {
          current = line
        } else {
          const candidate: Range = { start: current.start, end: line.end }
          const candidateTokens = yield* countRange(source, candidate, options)
          if (candidateTokens > options.maxTokens) {
            result.push(current)
            current = line
          } else {
            current = candidate
          }
        }
      }
      if (current !== null) result.push(current)
      return result
    }

    return yield* splitLongRange(file, source, range, baseOffset, baseLine, options, lineStarts)
  })

const splitAstChunk = (
  parser: Parser,
  chunk: Chunk,
  options: ChunkingOptions,
): Effect.Effect<readonly Chunk[], ChunkingError> =>
  Effect.gen(function* () {
    const range = { start: 0, end: chunk.text.length }
    const lineStarts = lineStartOffsets(chunk.text)
    const ranges = yield* splitOversizedRange(
      chunk.file,
      chunk.text,
      range,
      chunk.startOffset,
      chunk.startLine,
      parser,
      options,
      lineStarts,
    )
    return ranges.map((part, idx) =>
      rangeChunk(
        chunk.file,
        chunk.text,
        part.start,
        part.end,
        chunk.startOffset,
        chunk.startLine,
        lineStarts,
        idx,
      ),
    )
  })

const applyLineOverlap = (
  source: string,
  ranges: readonly Range[],
  overlapLines: number,
  options: ChunkingOptions,
  lineStarts: readonly number[],
): Effect.Effect<readonly Range[], ChunkingError> =>
  Effect.gen(function* () {
    if (overlapLines <= 0 || ranges.length < 2) return ranges
    const result: Range[] = []

    for (let index = 0; index < ranges.length; index++) {
      const range = ranges[index]!
      if (index === 0) {
        result.push(range)
        continue
      }
      const startLine = lineStarts.findIndex((offset) => offset >= range.start)
      let candidate = range.start
      for (let line = Math.max(0, startLine - overlapLines); line < startLine; line++) {
        const possible = lineStarts[line]!
        if (possible >= range.start) continue
        const count = yield* countRange(source, { start: possible, end: range.end }, options)
        if (count > options.maxTokens) continue
        candidate = possible
        break
      }
      result.push({ start: candidate, end: range.end })
    }
    return result
  })

const buildTokenLineChunks = (
  file: string,
  content: string,
  options: ChunkingOptions,
): Effect.Effect<readonly Chunk[], ChunkingError> =>
  Effect.gen(function* () {
    const lineStarts = lineStartOffsets(content)
    const lines = buildLineRanges(content)
    const ranges: Range[] = []
    let index = 0

    while (index < lines.length) {
      const first = lines[index]!
      const firstTokens = yield* countRange(content, first, options)
      if (firstTokens > options.maxTokens) {
        ranges.push(...(yield* splitLongRange(file, content, first, 0, 1, options, lineStarts)))
        index++
        continue
      }

      let current = first
      index++
      while (index < lines.length) {
        const candidate = { start: current.start, end: lines[index]!.end }
        const tokens = yield* countRange(content, candidate, options)
        if (tokens > options.maxTokens) break
        current = candidate
        index++
      }
      ranges.push(current)
    }

    const overlapped = yield* applyLineOverlap(
      content,
      ranges,
      options.overlapLines,
      options,
      lineStarts,
    )
    return overlapped.map((range, idx) =>
      rangeChunk(file, content, range.start, range.end, 0, 1, lineStarts, idx),
    )
  })

const buildStructuralChunks = (
  file: string,
  content: string,
  parser: Parser | null,
): Effect.Effect<readonly Chunk[]> => {
  const lineStarts = lineStartOffsets(content)
  const wholeFile = (): readonly Chunk[] =>
    content.length === 0 ? [] : [rangeChunk(file, content, 0, content.length, 0, 1, lineStarts, 0)]

  return Effect.try({
    try: () => {
      if (parser === null) {
        return wholeFile()
      }
      const tree = parseTreeSitterSource(parser, content)
      if (tree === null || tree.rootNode.hasError) {
        return wholeFile()
      }
      return collectAstUnits(tree.rootNode).map((unit, idx) =>
        makeAstChunk(unit, idx, file, content),
      )
    },
    catch: (cause) => new AstChunkingError({ file, cause }),
  }).pipe(Effect.catch(() => Effect.succeed(wholeFile())))
}

const buildAstChunks = (
  parser: Parser,
  file: string,
  content: string,
  options: ChunkingOptions,
): Effect.Effect<readonly Chunk[], ChunkingError> =>
  Effect.gen(function* () {
    const tree = yield* Effect.try({
      try: () => parseTreeSitterSource(parser, content),
      catch: (cause) => new AstChunkingError({ file, cause }),
    }).pipe(
      Effect.catchTag("AstChunkingError", (error) =>
        options
          .onDiagnostic({
            kind: "parser-fallback",
            file,
            message: `AST parser failed; token-aware line fallback used (${String(error.cause)})`,
          })
          .pipe(Effect.as(null)),
      ),
    )

    if (tree === null || tree.rootNode.hasError) {
      if (tree !== null && tree.rootNode.hasError) {
        yield* options.onDiagnostic({
          kind: "parser-fallback",
          file,
          message: "AST contains syntax errors; token-aware line fallback used",
        })
      }
      return yield* buildTokenLineChunks(file, content, options)
    }

    const units = collectAstUnits(tree.rootNode)
    const chunks: Chunk[] = []
    let current: Parser.SyntaxNode[] = []

    const flush = Effect.gen(function* () {
      if (current.length === 0) return
      const chunk = makeAstChunk(current, chunks.length, file, content)
      const tokens = yield* options.countTokens(chunk.text)
      if (tokens <= options.maxTokens) {
        chunks.push(chunk)
      } else {
        chunks.push(...(yield* splitAstChunk(parser, chunk, options)))
      }
      current = []
    })

    for (const unit of units) {
      const candidate = [...current, ...unit]
      const candidateChunk = makeAstChunk(candidate, chunks.length, file, content)
      const candidateTokens = yield* options.countTokens(candidateChunk.text)
      if (current.length > 0 && candidateTokens > options.maxTokens) {
        yield* flush
        current = [...unit]
      } else {
        current = candidate
      }
    }
    yield* flush

    return chunks
  })

const buildLineChunks = (
  file: string,
  content: string,
  options?: ChunkingOptions,
): Effect.Effect<readonly Chunk[], ChunkingError> => {
  if (options !== undefined) return buildTokenLineChunks(file, content, options)
  const lineStarts = lineStartOffsets(content)
  return Effect.succeed(
    content.length === 0 ? [] : [rangeChunk(file, content, 0, content.length, 0, 1, lineStarts, 0)],
  )
}

const buildParserlessChunks = (
  file: string,
  content: string,
  options: ChunkingOptions,
): Effect.Effect<readonly Chunk[], ChunkingError> =>
  Effect.gen(function* () {
    yield* options.onDiagnostic({
      kind: "parser-fallback",
      file,
      message: "No AST parser is registered; token-aware line fallback used",
    })
    return yield* buildLineChunks(file, content, options)
  })

const make = Effect.gen(function* () {
  const configStore = yield* ConfigStore

  const config = yield* configStore
    .readConfig()
    .pipe(Effect.catch(() => Effect.succeed(DEFAULT_CONFIG)))
  const registry = buildExtensionRegistry(config.skipExtensions)

  const chunkText = (
    text: string,
    file: string,
    options?: ChunkingOptions,
  ): Effect.Effect<readonly Chunk[], ChunkingError> =>
    chunkTextWithRegistry(text, file, registry, options)

  return { chunkText } as const
})

/** Chunk source text using an explicit extension registry without reading project state. */
export const chunkTextWithRegistry = (
  text: string,
  file: string,
  registry: ReturnType<typeof buildExtensionRegistry>,
  options?: ChunkingOptions,
): Effect.Effect<readonly Chunk[], ChunkingError> => {
  if (text === "") return Effect.succeed([])

  const parser = registry[getExtension(file)]?.parser ?? null
  if (options === undefined) return buildStructuralChunks(file, text, parser)
  if (parser === null) return buildParserlessChunks(file, text, options)

  return buildAstChunks(parser, file, text, options).pipe(
    Effect.map((chunks) => chunks.map((chunk, idx) => ({ ...chunk, idx }))),
  )
}

export const ChunkerBase = Layer.effect(Chunker, make)

export const ChunkerLive = Layer.provideMerge(ChunkerBase, ConfigStoreLive)
