import { Option } from "effect"
import { Argument, Flag } from "effect/unstable/cli"

import { NonNegativeIntSchema, PositiveIntSchema } from "../domain/numeric.js"
import { QUERY_DEFAULTS, QueryOptionsSchema } from "../domain/query.js"
import { PRODUCTION_PROFILE_NAMES } from "../domain/retrieval.js"
import { NonEmptyTextSchema } from "../domain/text.js"

const DEFAULT_TOP_K = QUERY_DEFAULTS.top
const DEFAULT_CONTEXT_LINES = QUERY_DEFAULTS.contextLines

type QueryOptionName = keyof typeof QueryOptionsSchema.Type

/** Query flags that may be saved in an alias. */
export const queryAliasFlags = {
  top: Flag.integer("top").pipe(
    Flag.withAlias("n"),
    Flag.withMetavar("COUNT"),
    Flag.withDescription("Override the maximum result count; values are clamped to 1-100"),
    Flag.optional,
  ),
  contextLines: Flag.integer("context-lines").pipe(
    Flag.withSchema(NonNegativeIntSchema),
    Flag.withMetavar("LINES"),
    Flag.withDescription("Source lines to include before and after each result"),
    Flag.optional,
  ),
  ignorePath: Flag.string("ignore-path").pipe(
    Flag.withMetavar("PATTERN"),
    Flag.withDescription("Exclude a gitignore-style path pattern; may be repeated"),
    Flag.atLeast(0),
  ),
  onlyPath: Flag.string("only-path").pipe(
    Flag.withMetavar("PATTERN"),
    Flag.withDescription("Search only a gitignore-style path pattern; may be repeated"),
    Flag.atLeast(0),
  ),
  maxCharacters: Flag.integer("max-characters").pipe(
    Flag.withSchema(PositiveIntSchema),
    Flag.withMetavar("COUNT"),
    Flag.withDescription("Maximum characters across the complete response"),
    Flag.optional,
  ),
  noContent: Flag.boolean("content").pipe(
    Flag.withDefault(true),
    Flag.map((content) => !content),
    Flag.withDescription(
      "Include source text in results (default: enabled; disable with --no-content)",
    ),
  ),
  profile: Flag.choice("profile", PRODUCTION_PROFILE_NAMES).pipe(
    Flag.withAlias("p"),
    Flag.withMetavar("PROFILE"),
    Flag.withDescription("Retrieval profile (runtime default: compatibility)"),
    Flag.optional,
  ),
} satisfies Record<QueryOptionName, unknown>

/** CLI flags accepted by `pix run`. */
export const queryAliasRunFlags = {
  ...queryAliasFlags,
  noContent: Flag.boolean("content").pipe(
    Flag.optional,
    Flag.map(Option.map((content) => !content)),
    Flag.withDescription("Override whether results include source text; disable with --no-content"),
  ),
  copy: Flag.boolean("copy").pipe(
    Flag.withAlias("c"),
    Flag.withDescription("Copy all returned results to the system clipboard"),
  ),
}

/** CLI flags accepted by `pix query`. */
const queryCommandRetrievalFlags = {
  top: Flag.integer("top").pipe(
    Flag.withAlias("n"),
    Flag.withMetavar("COUNT"),
    Flag.withDescription("Maximum result count; values are clamped to 1-100 (default: 5)"),
    Flag.withDefault(DEFAULT_TOP_K),
  ),
  contextLines: Flag.integer("context-lines").pipe(
    Flag.withSchema(NonNegativeIntSchema),
    Flag.withMetavar("LINES"),
    Flag.withDescription("Source lines before and after each result (default: 0)"),
    Flag.withDefault(DEFAULT_CONTEXT_LINES),
  ),
  ignorePath: queryAliasFlags.ignorePath,
  onlyPath: queryAliasFlags.onlyPath,
  maxCharacters: queryAliasFlags.maxCharacters,
  noContent: queryAliasFlags.noContent,
  profile: queryAliasFlags.profile,
} satisfies Record<QueryOptionName, unknown>

/** CLI config accepted by `pix query`. */
export const queryCommandConfig = {
  queryText: Argument.string("query").pipe(
    Argument.withSchema(NonEmptyTextSchema),
    Argument.withMetavar("QUERY"),
    Argument.withDescription("Concept, behavior, file, or symbol to locate"),
  ),
  ...queryCommandRetrievalFlags,
  copy: queryAliasRunFlags.copy,
}
