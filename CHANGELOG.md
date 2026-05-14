# Changelog

## [0.6.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.5.3...pix-v0.6.0) (2026-05-14)


### Features

* **tests:** add memoryFsLayer + extend testLayer with configStore, vectorStore, cleanStore ([#51](https://github.com/Lucas-Bur/pix/issues/51)) ([b59e031](https://github.com/Lucas-Bur/pix/commit/b59e03191c478da86f3ccd03c31fcb5da81dae9f))


### Bug Fixes

* address CodeRabbit review — CONTEXT.md docs, clamping assertions, swapped fixtures ([f634308](https://github.com/Lucas-Bur/pix/commit/f634308aa4e5589aec8ae36b42a620097ec4b50b))

## [0.5.3](https://github.com/Lucas-Bur/pix/compare/pix-v0.5.2...pix-v0.5.3) (2026-05-13)


### Bug Fixes

* read model from config.json, rename getStats to getStatus ([#41](https://github.com/Lucas-Bur/pix/issues/41)) ([124787c](https://github.com/Lucas-Bur/pix/commit/124787cee1716fccf4ed86eeb35a332a4d5ddd6f))

## [0.5.2](https://github.com/Lucas-Bur/pix/compare/pix-v0.5.1...pix-v0.5.2) (2026-05-13)


### Bug Fixes

* skip CodeRabbit review for autorelease PRs via labels filter ([#34](https://github.com/Lucas-Bur/pix/issues/34)) ([27b4d66](https://github.com/Lucas-Bur/pix/commit/27b4d66cd484ff0c8244c6904932e9e077a32970))

## [0.5.1](https://github.com/Lucas-Bur/pix/compare/pix-v0.5.0...pix-v0.5.1) (2026-05-13)


### Bug Fixes

* add ignore_usernames for release-please and bot PRs, expand CodeRabbit config with path filters, path instructions, and tool selectivity ([#34](https://github.com/Lucas-Bur/pix/issues/34)) ([6eb31b1](https://github.com/Lucas-Bur/pix/commit/6eb31b18fc022dd46133928216ad3b4c5c611abe))
* narrow coderabbit CI rule — only quality-gate commands must use vp run ([#34](https://github.com/Lucas-Bur/pix/issues/34)) ([5e6615f](https://github.com/Lucas-Bur/pix/commit/5e6615f29f1e0ef3b4b0189dce9ed49190c0baaa))
* remove vertical slices rule from coderabbit test instructions (AI cannot verify TDD order) ([#34](https://github.com/Lucas-Bur/pix/issues/34)) ([cce7dc3](https://github.com/Lucas-Bur/pix/commit/cce7dc37b8e2ddc9ed3249b908d7c48c5ef93bfd))

## [0.5.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.4.0...pix-v0.5.0) (2026-05-12)


### Features

* add integration tests with effect-memfs, replace fast-glob, use Console.log in CLI handlers ([#42](https://github.com/Lucas-Bur/pix/issues/42)) ([a66fede](https://github.com/Lucas-Bur/pix/commit/a66fede5cabfe61712b8912608b6b3209e34e18e))

## [0.4.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.3.0...pix-v0.4.0) (2026-05-12)


### Features

* wire composition root, add error handling, fix FileSystem.Info.size cast ([53afaab](https://github.com/Lucas-Bur/pix/commit/53afaab3791bef6ec82932c01c4c6e2cc7a75363))


### Bug Fixes

* remove duplicate error log in index-cmd, fix missed Number cast in vector-store ([eb19204](https://github.com/Lucas-Bur/pix/commit/eb19204421bf8e53003f580e3c16128c96069ca1))
* replace catchAll with tapError in commands to preserve exit code ([286c9da](https://github.com/Lucas-Bur/pix/commit/286c9da657952a3540b637b76d350bf50001835c))
* revert showBuiltIns, keep showTypes only in CliConfig ([2fab868](https://github.com/Lucas-Bur/pix/commit/2fab86856b00074b5e3074bbf4b0e268f24e0f7c))
* suppress CLI built-in options, remove duplicate log, enforce LF via .gitattributes ([a2cf780](https://github.com/Lucas-Bur/pix/commit/a2cf780f4f8edb7bd5ae59fdf7c3b3be004d1223))
* suppress placeholder warnings in JSON mode ([70108a7](https://github.com/Lucas-Bur/pix/commit/70108a7aec4c036600413c766a393b5fef1d3e72))

## [0.3.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.2.1...pix-v0.3.0) (2026-05-12)


### Features

* add pix reset command ([433afe2](https://github.com/Lucas-Bur/pix/commit/433afe20b75bbca9cfb741504e88199b0e1b778d))


### Bug Fixes

* address PR review feedback ([829277c](https://github.com/Lucas-Bur/pix/commit/829277c7253379b8247b6052ce4f49071b0a8821))

## [0.2.1](https://github.com/Lucas-Bur/pix/compare/pix-v0.2.0...pix-v0.2.1) (2026-05-12)


### Bug Fixes

* switch release-please back to GITHUB_TOKEN until PAT is set up ([fbaa5bd](https://github.com/Lucas-Bur/pix/commit/fbaa5bde5dadf3300bb859cba3ef734cbe40462d))
* use RELEASE_PLEASE_TOKEN with GITHUB_TOKEN fallback for release-please ([4237cc2](https://github.com/Lucas-Bur/pix/commit/4237cc2194688327ef26a11e4cf6633c87bb6827))

## [0.2.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.1.0...pix-v0.2.0) (2026-05-11)


### Features

* add Chunker service with sliding window implementation ([361fa23](https://github.com/Lucas-Bur/pix/commit/361fa2355154c1982f4e7aea4b4584b7e8df8b2c))
* add ci and test:coverage scripts, align CONTRIBUTING.md ([d24c76f](https://github.com/Lucas-Bur/pix/commit/d24c76f24856084eab70f0e44def03e5fc0abaec))
* add CI/CD pipeline with release-please, CodeRabbit, and coverage badges ([f3e0f43](https://github.com/Lucas-Bur/pix/commit/f3e0f43916c5499549ec26f8ddc6b8d49bfaefcb))
* add MockScannerLive for unit testing ([0619005](https://github.com/Lucas-Bur/pix/commit/0619005eb6f3e7c4444367fb1bcd9bace370a713))
* add pix query E2E vertical slice ([0cea99f](https://github.com/Lucas-Bur/pix/commit/0cea99f219d717d03a25de87373d76a5ad3e28b8)), closes [#16](https://github.com/Lucas-Bur/pix/issues/16)
* hexagonal architecture foundation (TDD [#11](https://github.com/Lucas-Bur/pix/issues/11)) ([5595fb1](https://github.com/Lucas-Bur/pix/commit/5595fb196d80074546456dfa7dd56fa604274b61))
* implement OnnxEmbedderLive with @huggingface/transformers ([a5d0613](https://github.com/Lucas-Bur/pix/commit/a5d0613dce90b705921d1961e568ab7c8f86e4b4))
* output JSON error on index failure with --json flag ([d457514](https://github.com/Lucas-Bur/pix/commit/d45751404f156996908bfff98c5a9e8e3bb11d98))
* pix init E2E vertical slice (TDD [#12](https://github.com/Lucas-Bur/pix/issues/12)) ([2834f8e](https://github.com/Lucas-Bur/pix/commit/2834f8e477a7cf884195b4e523d1257fbf71c2a5))
* pix init end-to-end (TDD) ([4164b10](https://github.com/Lucas-Bur/pix/commit/4164b103d7be1eacbe8c5d28c52ce70da3e884ec))
* pix status E2E vertical slice ([#13](https://github.com/Lucas-Bur/pix/issues/13)) ([9e8a5b1](https://github.com/Lucas-Bur/pix/commit/9e8a5b1a594dd5c27422b9920201ddeeeb01cd14))


### Bug Fixes

* add --base main to fallow audit in CI ([cb44a19](https://github.com/Lucas-Bur/pix/commit/cb44a190937a158d2655dcbaeedf98fae53b1a92))
* address CodeRabbit review — fork guard, manifest, token, badge alt text ([79ffaec](https://github.com/Lucas-Bur/pix/commit/79ffaec05f03f0bc61b2b9a2766ce0bbba35caf2))
* align local pre-push command in CONTRIBUTING.md with CI gates ([95b5abc](https://github.com/Lucas-Bur/pix/commit/95b5abc2de9c9e7b3d70dfe03afeb59248202566))
* fetch full git history so fallow audit can compare against main ([21ef9ad](https://github.com/Lucas-Bur/pix/commit/21ef9adc9649b6a3d867d9bd26cdb7b60c2e0be4))
* ignore CHANGELOG.md from formatting so release-please PRs pass CI ([6c4c2ab](https://github.com/Lucas-Bur/pix/commit/6c4c2abef205a33f9d8765e78cb61a1db31dbdbb))
* opt into Node 24 on Actions runner to suppress deprecation warnings ([9a3a15e](https://github.com/Lucas-Bur/pix/commit/9a3a15ee7b2f35a6f6e016105110102a81e1a317))
* use fallow directly instead of vpx in ci script for Windows compat ([74a3c64](https://github.com/Lucas-Bur/pix/commit/74a3c64c93e7ab3f430aacb967de186718018fdc))
* use oxfmt ignorePatterns in vite.config.ts instead of .prettierignore ([fecfbd8](https://github.com/Lucas-Bur/pix/commit/fecfbd8f1b4ff8610ef7ceab33be7ac1dd5e5c00))
