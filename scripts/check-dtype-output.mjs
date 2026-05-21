import { pipeline } from "@huggingface/transformers"

const TEST_TEXT = "Hello world, this is a test sentence for embeddings."
const MODEL = "Xenova/all-MiniLM-L6-v2"
const DTYPE = process.argv[2] ?? "fp32"

console.log(`Testing dtype: ${DTYPE}`)
console.log(`Model: ${MODEL}`)

try {
  const extractor = await pipeline("feature-extraction", MODEL, {
    device: "cpu",
    dtype: DTYPE,
  })

  const tensor = await extractor(TEST_TEXT, { pooling: "mean", normalize: false })

  console.log(`tensor.type: ${tensor.type}`)
  console.log(`tensor.data constructor: ${tensor.data.constructor.name}`)
  console.log(`tensor.dims: [${tensor.dims.join(", ")}]`)
  console.log(`tensor.data.length: ${tensor.data.length}`)
  console.log(`First 5 values: ${Array.from(tensor.data.slice(0, 5)).join(", ")}`)
} catch (e) {
  console.error(`Error with dtype ${DTYPE}:`, e)
}
