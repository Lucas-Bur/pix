import crypto from "node:crypto"

import { Data, Effect, Layer, Option } from "effect"
import type Parser from "tree-sitter"

import type { Chunk } from "../domain/chunk.js"
import type { Config } from "../domain/config.js"
import { DEFAULT_CONFIG } from "../domain/config.js"
import { ConfigStore, Chunker } from "../domain/ports.js"
import { getExtension } from "../lib/config/extension.js"
import { buildExtensionRegistry } from "../lib/registry.js"
import { ConfigStoreLive } from "./config-store.js"

// Intentionally local: this normalizes foreign tree-sitter throws and is fully eliminated by the
// line fallback below. Moving implementation-only errors into domain/errors.ts would expose a
// failure callers cannot observe or handle.
class AstChunkingError extends Data.TaggedError("AstChunkingError")<{
  readonly file: string
  readonly cause: unknown
}> {}

const chunkId = (file: string, location: string): string =>
  crypto.createHash("sha1").update(`${file}:${location}`).digest("hex").slice(0, 12)

const lineStartOffsets = (content: string): readonly number[] => {
  const offsets = [0]
  for (let index = 0; index < content.length; index++) {
    if (content[index] === "\n") offsets.push(index + 1)
  }
  return offsets
}

const endOffsetForLine = (
  endLine: number,
  lines: readonly string[],
  offsets: readonly number[],
  contentLength: number,
): number => (endLine < lines.length ? offsets[endLine]! - 1 : contentLength)

const buildLineChunks = (file: string, content: string, config: Config): Chunk[] => {
  const lines = content.split("\n")
  const offsets = lineStartOffsets(content)
  const chunks: Chunk[] = []

  let idx = 0
  let startLine = 1

  while (startLine <= lines.length) {
    const endLine = Math.min(startLine + config.chunkLines - 1, lines.length)
    const chunkLines = lines.slice(startLine - 1, endLine)
    const text = chunkLines.join("\n")

    if (text.length >= config.minChunkChars) {
      chunks.push({
        id: chunkId(file, String(startLine)),
        idx,
        file,
        startLine,
        endLine,
        startOffset: offsets[startLine - 1]!,
        endOffset: endOffsetForLine(endLine, lines, offsets, content.length),
        text,
      })
      idx++
    }

    startLine += config.chunkLines - config.overlapLines
  }

  return chunks
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

const makeAstChunk = (
  nodes: readonly Parser.SyntaxNode[],
  idx: number,
  file: string,
  lines: readonly string[],
  offsets: readonly number[],
  contentLength: number,
): Chunk => {
  const firstNode = nodes[0]
  const lastNode = nodes[nodes.length - 1]
  const startLine = firstNode.startPosition.row + 1
  const endLine = lastNode.endPosition.row + 1
  const location = [
    firstNode.startPosition.row,
    firstNode.startPosition.column,
    lastNode.endPosition.row,
    lastNode.endPosition.column,
  ].join(":")

  return {
    id: chunkId(file, location),
    idx,
    file,
    startLine,
    endLine,
    startOffset: offsets[startLine - 1]!,
    endOffset: endOffsetForLine(endLine, lines, offsets, contentLength),
    text: lines.slice(startLine - 1, endLine).join("\n"),
  }
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

const packAstUnits = (
  units: readonly (readonly Parser.SyntaxNode[])[],
  maxLines: number,
): readonly (readonly Parser.SyntaxNode[])[] => {
  const groups: Parser.SyntaxNode[][] = []
  let current: Parser.SyntaxNode[] = []

  for (const unit of units) {
    const candidate = [...current, ...unit]
    const firstNode = candidate[0]
    const lastNode = candidate[candidate.length - 1]
    const lineSpan = lastNode.endPosition.row - firstNode.startPosition.row + 1

    if (current.length > 0 && lineSpan > maxLines) {
      groups.push(current)
      current = [...unit]
    } else {
      current = candidate
    }
  }

  if (current.length > 0) groups.push(current)
  return groups
}

const collectAstChunks = (
  tree: Parser.Tree,
  file: string,
  content: string,
  config: Config,
): Option.Option<readonly Chunk[]> => {
  if (tree.rootNode.hasError) return Option.none()

  const lines = content.split("\n")
  const offsets = lineStartOffsets(content)
  const groups = packAstUnits(collectAstUnits(tree.rootNode), config.chunkLines)
  const chunks = groups.map((nodes, idx) =>
    makeAstChunk(nodes, idx, file, lines, offsets, content.length),
  )

  return chunks.length === 0 ? Option.none() : Option.some(chunks)
}

const buildAstChunks = (
  parser: Parser,
  file: string,
  content: string,
  config: Config,
): Effect.Effect<Option.Option<readonly Chunk[]>, AstChunkingError> =>
  Effect.try({
    try: () => {
      const tree: Parser.Tree | null = parser.parse(content)
      return tree === null ? Option.none() : collectAstChunks(tree, file, content, config)
    },
    catch: (cause) => new AstChunkingError({ file, cause }),
  })

const make = Effect.gen(function* () {
  const configStore = yield* ConfigStore

  const config = yield* configStore
    .readConfig()
    .pipe(Effect.catch(() => Effect.succeed(DEFAULT_CONFIG)))
  const registry = buildExtensionRegistry(config.skipExtensions)

  const chunkText = (text: string, file: string): Effect.Effect<readonly Chunk[]> => {
    if (text === "") return Effect.succeed([])

    const parser = registry[getExtension(file)]?.parser
    if (parser == null) return Effect.succeed(buildLineChunks(file, text, config))

    return buildAstChunks(parser, file, text, config).pipe(
      Effect.map(Option.getOrElse(() => buildLineChunks(file, text, config))),
      Effect.catch(() => Effect.succeed(buildLineChunks(file, text, config))),
    )
  }

  return { chunkText } as const
})

export const ChunkerBase = Layer.effect(Chunker, make)

export const ChunkerLive = Layer.provideMerge(ChunkerBase, ConfigStoreLive)
