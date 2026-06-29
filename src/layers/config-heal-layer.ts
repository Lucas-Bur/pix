import { NodeServices } from "@effect/platform-node"
import { Layer } from "effect"

import { ConfigLayer } from "./config-layer.js"

export const ConfigHealLayer = Layer.merge(ConfigLayer, NodeServices.layer)
