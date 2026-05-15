# Changelog

## [0.11.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.10.0...pix-v0.11.0) (2026-05-15)


### Features

* add CLI flags, timer, progress bar, and grouped skipped display ([1fe4297](https://github.com/Lucas-Bur/pix/commit/1fe4297e4911950d14c9a110568a8646469c9ea1))
* add embedder.batchSize config and remove internal BATCH_SIZE loop ([3aa6df0](https://github.com/Lucas-Bur/pix/commit/3aa6df0b3a292746464f477272e3e2ecf4fe7179))
* add embedder.batchSize to config with default 16 ([8a29900](https://github.com/Lucas-Bur/pix/commit/8a29900c4eaf653387c4be1467807f6b9a5de04a))
* add ignoreGitignore config and update ignoredPaths defaults ([9a2a0b4](https://github.com/Lucas-Bur/pix/commit/9a2a0b4102be08bfb62a61aca2d491860aa3b5a1))
* add VectorStore lifecycle methods (storeBegin/Batch/Commit/Abort) ([601ce30](https://github.com/Lucas-Bur/pix/commit/601ce30985604976ccdac39f24215f537ee6415a))
* emit single JSON object on stdout for --json mode ([316a982](https://github.com/Lucas-Bur/pix/commit/316a982ae8a2a0f1b5b7355818a3475c23d0681b))
* rewrite index pipeline to Effect Stream topology ([072310e](https://github.com/Lucas-Bur/pix/commit/072310eaf1f48d7a8d694d43484d41287d19cb23))
* split index pipeline into chunk phase + embed phase with progress bar ([1ce28f8](https://github.com/Lucas-Bur/pix/commit/1ce28f84dcaa9403edd3450894e92c07e934d942))


### Bug Fixes

* address CodeRabbit nitpicks (JSDoc, Effect.void, pipe flattening, gitignore ternary, remove unused refs) ([7ad46a6](https://github.com/Lucas-Bur/pix/commit/7ad46a6abe6d34e3ff170d9c03b1795c512da55f))
* address CodeRabbit review comments ([c3d9869](https://github.com/Lucas-Bur/pix/commit/c3d9869b232b0b6d19df8251cb0ea01c9450c4fe))
* show timer after progress bar completes ([e38c6fb](https://github.com/Lucas-Bur/pix/commit/e38c6fbdbe7f453c3cb816ef219b17a27193c2f5))
* spinner shows final summary message instead of initial text ([881abc0](https://github.com/Lucas-Bur/pix/commit/881abc0aa12904badb932f4c95f94bb42ac8a4c9))
* validate positive values for --batch-size and --chunk-concurrency CLI options ([38e0bae](https://github.com/Lucas-Bur/pix/commit/38e0bae84b8aa645c8f9ba606d1f3e55212cfdaf))

## [0.10.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.9.1...pix-v0.10.0) (2026-05-15)


### Features

* add ignoredPaths config with gitignore-style patterns ([2f47687](https://github.com/Lucas-Bur/pix/commit/2f47687e448540c70406864606a95bc2197e9421)), closes [#43](https://github.com/Lucas-Bur/pix/issues/43)
* content extraction pipeline with processor map ([80ff42c](https://github.com/Lucas-Bur/pix/commit/80ff42cbed58cb5d7afc5200ab3192785b433eb9)), closes [#43](https://github.com/Lucas-Bur/pix/issues/43)


### Bug Fixes

* address remaining CodeRabbit comments ([a4a487a](https://github.com/Lucas-Bur/pix/commit/a4a487a98284a3a9669ac8987c823518ea44d061)), closes [#43](https://github.com/Lucas-Bur/pix/issues/43)

## [0.9.1](https://github.com/Lucas-Bur/pix/compare/pix-v0.9.0...pix-v0.9.1) (2026-05-15)


### Bug Fixes

* address CodeRabbit review comments on PR [#73](https://github.com/Lucas-Bur/pix/issues/73) ([53c6c25](https://github.com/Lucas-Bur/pix/commit/53c6c25637c81bd0e54523ceeab34a11a3757fd5))

## [0.9.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.8.0...pix-v0.9.0) (2026-05-15)


### Features

* auto-init on index when no config exists ([860e152](https://github.com/Lucas-Bur/pix/commit/860e152ef4cfbcdf5038b81437d44e9963d1b54b))

## [0.8.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.7.0...pix-v0.8.0) (2026-05-14)


### Features

* add model registry and EmbedderConfig to domain layer ([b3a6d5d](https://github.com/Lucas-Bur/pix/commit/b3a6d5d0bcd7540a85d9370cf7ee337e2c3a29f4))
* embedder reads config via ConfigStore, validates against model registry ([076898e](https://github.com/Lucas-Bur/pix/commit/076898eb949e84ffd0e35c986f57382beac82cd0))


### Bug Fixes

* fall back to cpu when auto/dml device fails to load embedding model ([3d6ebed](https://github.com/Lucas-Bur/pix/commit/3d6ebedccc227e852e3b50a50348feba9037ca8d))

## [0.7.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.6.0...pix-v0.7.0) (2026-05-14)


### Features

* add domain error types and update port signatures ([3285c07](https://github.com/Lucas-Bur/pix/commit/3285c07bab7cfdfeb111420829a81c7c5d101995))
* refactor CLI commands and error formatting with typed errors ([e9124b9](https://github.com/Lucas-Bur/pix/commit/e9124b99908187b496478a10b07827911d13ca77))
* update adapters, services, and port signatures with typed errors ([1895ee5](https://github.com/Lucas-Bur/pix/commit/1895ee55ad9be5b5c86f2ba7a046a5c50cfab2b8))


### Bug Fixes

* bound chunking concurrency + map makeDirectory DiskFullError ([3d471b9](https://github.com/Lucas-Bur/pix/commit/3d471b95c746b1ea55375aba1499f85f0bf30aa6))
* clamp chunkConcurrency with Math.max(1, ...) + add tests ([d28d9f3](https://github.com/Lucas-Bur/pix/commit/d28d9f3194c8b105e5595bd757d2fa10b21e8ce4))
* narrow GetStatus error type — config errors are swallowed ([ec75c3d](https://github.com/Lucas-Bur/pix/commit/ec75c3d9aa9a6c428423fbb66bba418d5868b830))

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
