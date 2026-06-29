import { BenchProjectLive } from "../application/bench-project.js"
import { commandLayer } from "./command-layer.js"
import { FullInfraLayer } from "./full-infra-layer.js"

/** Layer for `pix bench`: `BenchProject` use case + full infra. */
export const BenchLayer = commandLayer(BenchProjectLive, FullInfraLayer)
