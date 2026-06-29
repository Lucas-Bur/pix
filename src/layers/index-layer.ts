import { IndexProjectLive } from "../application/index-project.js"
import { commandLayer } from "./command-layer.js"
import { FullInfraLayer } from "./full-infra-layer.js"

/** Layer for `pix index`: `IndexProject` use case + full infra. */
export const IndexLayer = commandLayer(IndexProjectLive, FullInfraLayer)
