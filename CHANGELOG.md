# Changelog

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
* opt into Node 24 on Actions runner to suppress deprecation warnings ([9a3a15e](https://github.com/Lucas-Bur/pix/commit/9a3a15ee7b2f35a6f6e016105110102a81e1a317))
* use fallow directly instead of vpx in ci script for Windows compat ([74a3c64](https://github.com/Lucas-Bur/pix/commit/74a3c64c93e7ab3f430aacb967de186718018fdc))
