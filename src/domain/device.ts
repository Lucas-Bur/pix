/** Available compute devices for ONNX model execution. */
export type DeviceType = "cuda" | "dml" | "coreml" | "webgpu" | "wasm" | "cpu"

/** Device probing order shared by model adapters and hardware benchmarks. */
export const DEVICE_PRIORITY: readonly DeviceType[] = [
  "cuda",
  "dml",
  "coreml",
  "webgpu",
  "wasm",
  "cpu",
]
