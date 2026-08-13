import { expect, it } from "@effect/vitest"
import { Cause, Effect, Exit, Fiber, Layer, Queue, Ref, Sink, Stream } from "effect"
import * as Stdio from "effect/Stdio"
import * as McpProtocol from "effect/unstable/ai/McpProtocol"
import * as McpSchema from "effect/unstable/ai/McpSchema"
import * as McpServer from "effect/unstable/ai/McpServer"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import { RpcSerialization } from "effect/unstable/rpc"
import * as RpcClient from "effect/unstable/rpc/RpcClient"

import { indexFixtures, indexSeed } from "../../tests/test-utils/command.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { GetStatus } from "../application/get-status.js"
import { IndexProject } from "../application/index-project.js"
import { QueryProject } from "../application/query-project.js"
import { QueryAliasStore } from "../domain/ports.js"
import { PixMcpToolsLive, pixMcpStdioLayer } from "./server.js"

const defaultApplicationLayer = testLayer({
  contents: {
    ...indexFixtures,
    ".pix/aliases.json": JSON.stringify({ docs: { queryText: "test", options: {} } }),
  },
  indexSeed,
})

const makeTestClient = <E>(
  applicationLayer: Layer.Layer<IndexProject | QueryProject | GetStatus | QueryAliasStore, E>,
) =>
  Effect.gen(function* () {
    const serverLayer = PixMcpToolsLive.pipe(
      Layer.provide(
        McpServer.layerHttp({
          name: "pix",
          version: "test",
          path: "/mcp",
          protocols: [McpProtocol.v2025_06_18],
        }),
      ),
      Layer.provide(applicationLayer),
    )
    const { dispose, handler } = HttpRouter.toWebHandler(serverLayer, { disableLogger: true })
    yield* Effect.addFinalizer(() => Effect.promise(dispose))

    let sessionId: string | null = null
    const customFetch: typeof fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      request.headers.set("Accept", "application/json, text/event-stream")
      request.headers.set("MCP-Protocol-Version", "2025-06-18")
      if (sessionId !== null) request.headers.set("Mcp-Session-Id", sessionId)
      const response = await handler(request)
      sessionId = response.headers.get("Mcp-Session-Id") ?? sessionId
      return response
    }
    const clientLayer = RpcClient.layerProtocolHttp({ url: "http://localhost/mcp" }).pipe(
      Layer.provideMerge(Layer.merge(FetchHttpClient.layer, RpcSerialization.layerJsonRpc())),
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, customFetch)),
    )
    const client = yield* RpcClient.make(McpSchema.ClientRpcs).pipe(Effect.provide(clientLayer))
    yield* client.initialize({
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "pix-test", version: "1.0.0" },
    })
    return client
  })

it.effect("the MCP server initializes and exposes the shared query tool", () =>
  Effect.gen(function* () {
    const client = yield* makeTestClient(defaultApplicationLayer)
    const tools = yield* client["tools/list"](undefined)

    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "query",
      "status",
      "index",
      "alias_list",
      "alias_add",
      "alias_remove",
      "alias_run",
    ])
  }),
)

it.effect("the MCP query tool publishes guidance and parameter descriptions", () =>
  Effect.gen(function* () {
    const client = yield* makeTestClient(defaultApplicationLayer)
    const tools = yield* client["tools/list"](undefined)
    const queryTool = tools.tools.find((tool) => tool.name === "query")

    expect(queryTool?.description).toContain("Semantic discovery search")
    expect(queryTool?.description).toContain("noContent=true")
    expect(queryTool?.annotations).toMatchObject({
      title: "Semantic Repository Discovery",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    })
    expect(queryTool?.inputSchema).toMatchObject({
      properties: {
        queryText: {
          description: expect.stringContaining("Natural-language description"),
        },
      },
    })
    expect(queryTool?.inputSchema).toHaveProperty(
      "properties.noContent.anyOf.0.description",
      expect.stringContaining("without loading source text"),
    )
    expect(queryTool?.inputSchema).toHaveProperty(
      "properties.profile.anyOf.0.description",
      expect.stringContaining("production retrieval profile"),
    )
  }),
)

it.effect("the MCP query tool returns the shared structured response", () =>
  Effect.gen(function* () {
    const client = yield* makeTestClient(defaultApplicationLayer)
    const response = yield* client["tools/call"]({
      name: "query",
      arguments: { queryText: "test", top: 1, noContent: true },
    })

    expect(response.isError).not.toBe(true)
    expect(response.structuredContent).toMatchObject({
      indexRefresh: { kind: "none" },
      results: [{ file: expect.any(String), text: null }],
    })
  }),
)

it.effect("the MCP query tool reports invalid shared request parameters", () =>
  Effect.gen(function* () {
    const client = yield* makeTestClient(defaultApplicationLayer)
    const exit = yield* Effect.exit(
      client["tools/call"]({
        name: "query",
        arguments: { top: 1 },
      }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  }),
)

it.effect("the MCP status tool returns structured index metadata", () =>
  Effect.gen(function* () {
    const client = yield* makeTestClient(defaultApplicationLayer)
    const response = yield* client["tools/call"]({ name: "status", arguments: {} })

    expect(response.isError).not.toBe(true)
    expect(response.structuredContent).toMatchObject({
      chunks: 2,
      files: 2,
      model: "Xenova/all-MiniLM-L6-v2",
    })
  }),
)

it.effect("the MCP index tool returns the shared structured refresh result", () =>
  Effect.gen(function* () {
    const client = yield* makeTestClient(defaultApplicationLayer)
    const response = yield* client["tools/call"]({ name: "index", arguments: {} })

    expect(response.isError).not.toBe(true)
    expect(response.structuredContent).toMatchObject({
      success: true,
      refresh: "none",
      status: { chunks: 2, files: 2 },
    })
  }),
)

it.effect("the MCP alias_list tool returns saved aliases", () =>
  Effect.gen(function* () {
    const client = yield* makeTestClient(defaultApplicationLayer)
    const response = yield* client["tools/call"]({ name: "alias_list", arguments: {} })

    expect(response.isError).not.toBe(true)
    expect(response.structuredContent).toEqual([{ name: "docs", queryText: "test", options: {} }])
  }),
)

it.effect("the MCP alias_add tool persists a shared query request", () =>
  Effect.gen(function* () {
    const client = yield* makeTestClient(defaultApplicationLayer)
    const added = yield* client["tools/call"]({
      name: "alias_add",
      arguments: { name: "architecture", queryText: "hexagonal ports", top: 3 },
    })
    const listed = yield* client["tools/call"]({ name: "alias_list", arguments: {} })

    expect(added.isError).not.toBe(true)
    expect(added.structuredContent).toEqual({
      name: "architecture",
      queryText: "hexagonal ports",
      options: { top: 3 },
    })
    expect(listed.structuredContent).toEqual([
      { name: "architecture", queryText: "hexagonal ports", options: { top: 3 } },
      { name: "docs", queryText: "test", options: {} },
    ])
  }),
)

it.effect("the MCP alias_remove tool removes a saved alias", () =>
  Effect.gen(function* () {
    const client = yield* makeTestClient(defaultApplicationLayer)
    const removed = yield* client["tools/call"]({
      name: "alias_remove",
      arguments: { name: "docs" },
    })
    const listed = yield* client["tools/call"]({ name: "alias_list", arguments: {} })

    expect(removed.isError).not.toBe(true)
    expect(removed.structuredContent).toEqual({ removed: "docs" })
    expect(listed.structuredContent).toEqual([])
  }),
)

it.effect("the MCP alias_run tool executes the saved query with shared overrides", () =>
  Effect.gen(function* () {
    const client = yield* makeTestClient(defaultApplicationLayer)
    const response = yield* client["tools/call"]({
      name: "alias_run",
      arguments: { aliasName: "docs", top: 1, noContent: true },
    })

    expect(response.isError).not.toBe(true)
    expect(response.structuredContent).toMatchObject({
      indexRefresh: { kind: "none" },
      results: [{ text: null }],
    })
  }),
)

it.effect("the stdio MCP server stops when its host closes stdin", () =>
  Effect.gen(function* () {
    const stdin = yield* Queue.make<Uint8Array, Cause.Done<void>>()
    const stdout = yield* Queue.make<string | Uint8Array, Cause.Done<void>>()
    const stdioLayer = Stdio.layerTest({
      stdin: Stream.fromQueue(stdin),
      stdout: () => Sink.fromQueue(stdout),
    })
    const serverLayer = pixMcpStdioLayer("test").pipe(
      Layer.provide(testLayer({ contents: indexFixtures, indexSeed })),
      Layer.provide(stdioLayer),
    )
    const fiber = yield* Layer.launch(serverLayer).pipe(Effect.forkChild)

    yield* Queue.end(stdin)
    const exit = yield* Fiber.await(fiber)

    expect(Exit.hasInterrupts(exit)).toBe(true)
  }),
)

it.live("the MCP server serializes overlapping query executions", () =>
  Effect.gen(function* () {
    const active = yield* Ref.make(0)
    const maximum = yield* Ref.make(0)
    const indexLayer = Layer.succeed(IndexProject, {
      index: () =>
        Effect.gen(function* () {
          const current = yield* Ref.updateAndGet(active, (value) => value + 1)
          yield* Ref.update(maximum, (value) => Math.max(value, current))
          yield* Effect.sleep("25 millis")
          yield* Ref.update(active, (value) => value - 1)
          return {
            success: true,
            refresh: "none",
            status: {
              chunks: 0,
              files: 0,
              totalLines: 0,
              byteSize: 0,
              validationErrors: [],
            },
            durationMs: 0,
            cacheHits: 0,
            cacheMisses: 0,
            reusedFiles: 0,
            processedFiles: 0,
            diagnostics: [],
          } as const
        }),
    })
    const queryLayer = Layer.succeed(QueryProject, {
      queryProject: () => Effect.succeed({ results: [], validationErrors: [] }),
    })
    const statusLayer = Layer.succeed(GetStatus, {
      getStatus: () =>
        Effect.succeed({
          chunks: 0,
          files: 0,
          model: "",
          lastIndex: 0,
          totalLines: 0,
          byteSize: 0,
          validationErrors: [],
          diagnostics: [],
        }),
    })
    const aliasLayer = Layer.succeed(QueryAliasStore, {
      save: (name, queryText, options) => Effect.succeed({ name, queryText, options }),
      list: () => Effect.succeed([]),
      get: (name) => Effect.die(new Error(`Unexpected alias read: ${name}`)),
      remove: () => Effect.void,
    })
    const client = yield* makeTestClient(
      Layer.mergeAll(indexLayer, queryLayer, statusLayer, aliasLayer),
    )

    yield* Effect.all(
      [
        client["tools/call"]({ name: "query", arguments: { queryText: "first" } }),
        client["tools/call"]({ name: "query", arguments: { queryText: "second" } }),
      ],
      { concurrency: "unbounded" },
    )

    expect(yield* Ref.get(maximum)).toBe(1)
  }),
)
