import { CliConfig, GlobalFlag } from "effect/unstable/cli"

/** Effect CLI runner configuration exposed by pix. */
export const PixCliConfig = CliConfig.make({
  builtIns: [GlobalFlag.Help, GlobalFlag.Version, GlobalFlag.Wizard, GlobalFlag.Completions],
})
