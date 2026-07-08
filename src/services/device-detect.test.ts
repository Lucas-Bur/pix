import { pipeline as mockPipeline } from "@huggingface/transformers"
import { Effect } from "effect"
import { describe, expect, test, vi, beforeEach } from "vite-plus/test"

import { ModelLoadError } from "../domain/errors.js"
import { DeviceDetection } from "../domain/ports.js"
import { DeviceDetectionLive } from "./device-detect.js"

vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
  env: { cacheDir: ".pix/cache" },
}))

const mockedPipeline = vi.mocked(mockPipeline)

beforeEach(() => {
  mockedPipeline.mockReset()
})

describe("DeviceDetection", () => {
  test("detect returns 'cuda' when cuda succeeds", () =>
    Effect.gen(function* () {
      mockedPipeline.mockResolvedValue({} as any)

      const detection = yield* DeviceDetection
      const result = yield* detection.detect("test-model", "fp32")

      expect(result).toBe("cuda")
      expect(mockedPipeline).toHaveBeenCalledTimes(1)
      expect(mockedPipeline).toHaveBeenCalledWith("feature-extraction", "test-model", {
        device: "cuda",
        dtype: "fp32",
      })
    }).pipe(Effect.provide(DeviceDetectionLive), Effect.scoped))

  test("detect falls back to 'dml' when cuda fails", () =>
    Effect.gen(function* () {
      mockedPipeline.mockRejectedValueOnce(new Error("cuda not available"))
      mockedPipeline.mockResolvedValue({} as any)

      const detection = yield* DeviceDetection
      const result = yield* detection.detect("test-model", "fp32")

      expect(result).toBe("dml")
      expect(mockedPipeline).toHaveBeenCalledTimes(2)
    }).pipe(Effect.provide(DeviceDetectionLive), Effect.scoped))

  test("detect falls back to 'coreml' when cuda and dml fail", () =>
    Effect.gen(function* () {
      mockedPipeline.mockRejectedValueOnce(new Error("cuda not available"))
      mockedPipeline.mockRejectedValueOnce(new Error("dml not available"))
      mockedPipeline.mockResolvedValue({} as any)

      const detection = yield* DeviceDetection
      const result = yield* detection.detect("test-model", "fp32")

      expect(result).toBe("coreml")
      expect(mockedPipeline).toHaveBeenCalledTimes(3)
    }).pipe(Effect.provide(DeviceDetectionLive), Effect.scoped))

  test("detect falls back to 'cpu' when all GPU devices fail", () =>
    Effect.gen(function* () {
      mockedPipeline.mockRejectedValueOnce(new Error("cuda not available"))
      mockedPipeline.mockRejectedValueOnce(new Error("dml not available"))
      mockedPipeline.mockRejectedValueOnce(new Error("coreml not available"))
      mockedPipeline.mockRejectedValueOnce(new Error("webgpu not available"))
      mockedPipeline.mockRejectedValueOnce(new Error("wasm not available"))
      mockedPipeline.mockResolvedValue({} as any)

      const detection = yield* DeviceDetection
      const result = yield* detection.detect("test-model", "fp32")

      expect(result).toBe("cpu")
      expect(mockedPipeline).toHaveBeenCalledTimes(6)
    }).pipe(Effect.provide(DeviceDetectionLive), Effect.scoped))

  test("detect fails with ModelLoadError when all devices including cpu fail", () =>
    Effect.gen(function* () {
      mockedPipeline.mockRejectedValue(new Error("device not available"))

      const detection = yield* DeviceDetection
      const result = yield* Effect.flip(detection.detect("test-model", "fp32"))

      expect(result).toBeInstanceOf(ModelLoadError)
      expect(result.message).toContain("No device available")
      expect(mockedPipeline).toHaveBeenCalledTimes(6)
    }).pipe(Effect.provide(DeviceDetectionLive), Effect.scoped))

  test("detect error contains cause from last failed device", () =>
    Effect.gen(function* () {
      const cpuError = new Error("cpu failed too")
      mockedPipeline.mockRejectedValue(cpuError)

      const detection = yield* DeviceDetection
      const result = yield* Effect.flip(detection.detect("test-model", "fp32"))

      expect(result).toBeInstanceOf(ModelLoadError)
      expect(result.cause).toBe(cpuError)
    }).pipe(Effect.provide(DeviceDetectionLive), Effect.scoped))

  test("detect uses correct dtype in pipeline options", () =>
    Effect.gen(function* () {
      mockedPipeline.mockResolvedValue({} as any)

      const detection = yield* DeviceDetection
      yield* detection.detect("test-model", "q8")

      expect(mockedPipeline).toHaveBeenCalledWith("feature-extraction", "test-model", {
        device: "cuda",
        dtype: "q8",
      })
    }).pipe(Effect.provide(DeviceDetectionLive), Effect.scoped))

  test("device priority order is cuda → dml → coreml → webgpu → wasm → cpu", () =>
    Effect.gen(function* () {
      mockedPipeline.mockRejectedValueOnce(new Error("fail"))
      mockedPipeline.mockRejectedValueOnce(new Error("fail"))
      mockedPipeline.mockRejectedValueOnce(new Error("fail"))
      mockedPipeline.mockRejectedValueOnce(new Error("fail"))
      mockedPipeline.mockRejectedValueOnce(new Error("fail"))
      mockedPipeline.mockResolvedValue({} as any)

      const detection = yield* DeviceDetection
      yield* detection.detect("test-model", "fp32")

      const calls = mockedPipeline.mock.calls
      expect(calls[0]![2]!.device).toBe("cuda")
      expect(calls[1]![2]!.device).toBe("dml")
      expect(calls[2]![2]!.device).toBe("coreml")
      expect(calls[3]![2]!.device).toBe("webgpu")
      expect(calls[4]![2]!.device).toBe("wasm")
      expect(calls[5]![2]!.device).toBe("cpu")
    }).pipe(Effect.provide(DeviceDetectionLive), Effect.scoped))

  test("detectAll returns all devices when all succeed", () =>
    Effect.gen(function* () {
      mockedPipeline.mockResolvedValue({} as any)

      const detection = yield* DeviceDetection
      const devices = yield* detection.detectAll("test-model", "fp32")

      expect(devices).toEqual(["cuda", "dml", "coreml", "webgpu", "wasm", "cpu"])
      expect(mockedPipeline).toHaveBeenCalledTimes(6)
    }).pipe(Effect.provide(DeviceDetectionLive), Effect.scoped))

  test("detectAll returns only working devices when some fail", () =>
    Effect.gen(function* () {
      mockedPipeline.mockRejectedValueOnce(new Error("cuda unavailable"))
      mockedPipeline.mockRejectedValueOnce(new Error("dml unavailable"))
      mockedPipeline.mockResolvedValue({} as any)

      const detection = yield* DeviceDetection
      const devices = yield* detection.detectAll("test-model", "fp32")

      expect(devices).toEqual(["coreml", "webgpu", "wasm", "cpu"])
    }).pipe(Effect.provide(DeviceDetectionLive), Effect.scoped))

  test("detectAll returns empty array when all devices fail", () =>
    Effect.gen(function* () {
      mockedPipeline.mockRejectedValue(new Error("all fail"))

      const detection = yield* DeviceDetection
      const devices = yield* detection.detectAll("test-model", "fp32")

      expect(devices).toEqual([])
      expect(mockedPipeline).toHaveBeenCalledTimes(6)
    }).pipe(Effect.provide(DeviceDetectionLive), Effect.scoped))

  test("detectAll preserves priority order in results", () =>
    Effect.gen(function* () {
      mockedPipeline.mockResolvedValue({} as any)

      const detection = yield* DeviceDetection
      const devices = yield* detection.detectAll("test-model", "fp32")

      const calls = mockedPipeline.mock.calls
      expect(calls[0]![2]!.device).toBe("cuda")
      expect(calls[1]![2]!.device).toBe("dml")
      expect(calls[2]![2]!.device).toBe("coreml")
      expect(calls[3]![2]!.device).toBe("webgpu")
      expect(calls[4]![2]!.device).toBe("wasm")
      expect(calls[5]![2]!.device).toBe("cpu")
      expect(devices).toEqual(["cuda", "dml", "coreml", "webgpu", "wasm", "cpu"])
    }).pipe(Effect.provide(DeviceDetectionLive), Effect.scoped))
})
