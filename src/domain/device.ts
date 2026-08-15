import { Schema } from "effect"

/** Device probing order shared by model adapters and hardware benchmarks. */
export const DEVICE_PRIORITY = ["cuda", "dml", "coreml", "webgpu", "wasm", "cpu"] as const

const DeviceTypeSchema = Schema.Literals(DEVICE_PRIORITY)

/** Available compute device for ONNX model execution. */
export type DeviceType = typeof DeviceTypeSchema.Type
