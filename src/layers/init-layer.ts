import { InitProjectLive } from "../application/init-project.js"
import { commandLayer } from "./command-layer.js"
import { ConfigLayer } from "./config-layer.js"

/** Layer for `pix init`: `InitProject` use case + `ConfigStore` infra. */
export const InitLayer = commandLayer(InitProjectLive, ConfigLayer)
