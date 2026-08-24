# Changelog

## [0.27.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.26.0...pix-v0.27.0) (2026-08-24)


### Features

* improve CLI usability and validation ([dc98365](https://github.com/Lucas-Bur/pix/commit/dc98365d055a35b24fa9786e2a97b44b378bab71))
* respect hierarchical gitignore rules ([98621de](https://github.com/Lucas-Bur/pix/commit/98621de1524758ff9ff8cf7adfaea0200f76b990))


### Bug Fixes

* provide command layers on leaves, not namespaces ([cb43f5d](https://github.com/Lucas-Bur/pix/commit/cb43f5d74819549b57eab8c79dad11cbc96698d3))

## [0.26.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.25.0...pix-v0.26.0) (2026-08-06)


### Features

* add NDCG benchmark metrics ([2d261f8](https://github.com/Lucas-Bur/pix/commit/2d261f8a665c38c4c5ad8af21b9b5c68a8fd560f))
* add sparse-aware embedding benchmark ([753f861](https://github.com/Lucas-Bur/pix/commit/753f8610a98c902579d05c76c3c9f91e77ebf874))
* harden benchmark candidate promotion ([24f728c](https://github.com/Lucas-Bur/pix/commit/24f728c49daa8ab0094930cbbe86a4c179fda974))


### Bug Fixes

* address benchmark worker review feedback ([93406db](https://github.com/Lucas-Bur/pix/commit/93406dbb2bf8d88221aa2884fe1da6b4439ed999))
* address NDCG review findings ([90a8388](https://github.com/Lucas-Bur/pix/commit/90a83885a37d211b9f6ccb9ae71737f72ad458bb))
* address PR 178 review findings ([58077f6](https://github.com/Lucas-Bur/pix/commit/58077f64a780d39522b9d1e9b39aa349a5239b8f))
* address remaining PR 178 review findings ([4c6011b](https://github.com/Lucas-Bur/pix/commit/4c6011b7f197f8402030a6f488db252687969d4d))
* bundle Effect SQL with shared runtime ([d3ab76d](https://github.com/Lucas-Bur/pix/commit/d3ab76d39fb31044f80097928f4b5ac534a1f9ea))
* harden NDCG benchmark selection ([e0a4ffc](https://github.com/Lucas-Bur/pix/commit/e0a4ffc4bc6a71d20f5e54d3bae857a48b0d8ac0))
* honor model limits in retrieval benchmark ([c4efb05](https://github.com/Lucas-Bur/pix/commit/c4efb05e15b228b45141f5d0232fb86e141e76ef))
* make indexing token-aware ([4d1cf6e](https://github.com/Lucas-Bur/pix/commit/4d1cf6eda256bcbf659a64d4063d6e7e084f2bec))
* preserve semantic AST chunk boundaries ([33b493a](https://github.com/Lucas-Bur/pix/commit/33b493aca4c49b8f715a0541c84cfc952af76540))
* require persisted chunk token metadata ([df27dd1](https://github.com/Lucas-Bur/pix/commit/df27dd1a94fcc49801057249b6de91a9fea0724e))
* stream large AST parser inputs ([d2aa00f](https://github.com/Lucas-Bur/pix/commit/d2aa00f3e8d566d4d4d088ddaf8c7f2e69ea7b07))
* support large tree-sitter sources ([280492b](https://github.com/Lucas-Bur/pix/commit/280492b896b8ef57539d292ce76b6e6acbce3064))


### Performance Improvements

* add shared router candidate queue ([d3409ee](https://github.com/Lucas-Bur/pix/commit/d3409eee68f99cb67bb6fbb14855746eb8d8ee37))
* parallelize benchmark candidate search ([cf53cdb](https://github.com/Lucas-Bur/pix/commit/cf53cdbd89d7f82cc38f2cc63b299b0fa85a7af0))
* parallelize complete router jobs ([57a8108](https://github.com/Lucas-Bur/pix/commit/57a8108199632899454a74887a899c60f8c10a5a))
* persist retrieval benchmark cache ([8ab77d7](https://github.com/Lucas-Bur/pix/commit/8ab77d7998e3ce12023c8a8b1f7f4a550eb9c991))
* record benchmark pool timings ([ee4b866](https://github.com/Lucas-Bur/pix/commit/ee4b8664d50429b6f34122cc0ef9b9c3ec8a4cf0))
* restore selectable successive halving search ([9dc5305](https://github.com/Lucas-Bur/pix/commit/9dc53057f57abc3e7f95ca0e2615874d090ef68c))

## [0.25.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.24.0...pix-v0.25.0) (2026-08-04)


### Features

* add evidence-based fusion profiles ([44d9e6f](https://github.com/Lucas-Bur/pix/commit/44d9e6f8160231763c8842fa4367faf6d5baff57))
* add explicit production retrieval profiles ([ef9be6c](https://github.com/Lucas-Bur/pix/commit/ef9be6cc6470447056b7b59a35a3570afae04d3f))
* promote DBSF evidence router configuration ([f83affe](https://github.com/Lucas-Bur/pix/commit/f83affef3965047cc8a7880735456eebf0dfab32))


### Bug Fixes

* address OneDrive cache review feedback ([983906c](https://github.com/Lucas-Bur/pix/commit/983906c33d3e7403f1fafa96bac522b87b8eeef6))
* align benchmark guardrails with production router ([b2f63c2](https://github.com/Lucas-Bur/pix/commit/b2f63c2287baeae05a30c5c41b80896db9f0563c))
* keep production schema surface minimal ([3896d75](https://github.com/Lucas-Bur/pix/commit/3896d75173731b9997ecb49993698cf92b892599))
* make benchmark guardrail failures explicit ([42f2a5f](https://github.com/Lucas-Bur/pix/commit/42f2a5f2a18e88bd470d9e50cd603285751602e7))
* remove unused production profile export ([ab5e3be](https://github.com/Lucas-Bur/pix/commit/ab5e3bef03b67c55df3b4650ca7b6cff0995a8df))
* use local model cache for OneDrive projects ([841181a](https://github.com/Lucas-Bur/pix/commit/841181a2e5211c3614906cd02b0ea41bcb939c2a))


### Performance Improvements

* cache benchmark fusion rankings ([e000b81](https://github.com/Lucas-Bur/pix/commit/e000b81afbec489edb31042b9b0f8ba355ccc61e))

## [0.24.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.23.0...pix-v0.24.0) (2026-08-03)


### Features

* add dense confidence and BGE full benchmark ([e515b67](https://github.com/Lucas-Bur/pix/commit/e515b679a59c9dc8eb67dd7c2b3ac782827fd935))
* add dense confidence and BGE full benchmark ([c3f7595](https://github.com/Lucas-Bur/pix/commit/c3f75954ec27740da22a6cc98f54971fa8fe0ad4))
* add pairwise agreement routing ([da72413](https://github.com/Lucas-Bur/pix/commit/da724133ffd8684f547993fbde64e67541fcdf34))
* add pairwise agreement routing ([e68bfb9](https://github.com/Lucas-Bur/pix/commit/e68bfb986434a5cde48ea80fc93dd46d06b95adb))
* add query term coverage routing ([8debf06](https://github.com/Lucas-Bur/pix/commit/8debf06d520c98d8404bf3f2b5b8ef2def62dfcb))
* add query term coverage routing ([e0e5d48](https://github.com/Lucas-Bur/pix/commit/e0e5d4848e7774b6d4609dda7c496cd2adf308de))
* add retrieval quality benchmark ([a8fdd92](https://github.com/Lucas-Bur/pix/commit/a8fdd926932171d9493f8c8a582e9d463ff8b692))
* add retrieval quality benchmark ([f6b90d8](https://github.com/Lucas-Bur/pix/commit/f6b90d8c7fa024f8c3341d0f1f9de344bfa701eb))
* add score geometry routing ([b8a41e7](https://github.com/Lucas-Bur/pix/commit/b8a41e775faecbb237d98c4530b3111d8536e801))
* add score geometry routing ([08fc524](https://github.com/Lucas-Bur/pix/commit/08fc524e47a22c17fd1b9c61528c1049880113c1))
* benchmark sparse retrieval channel ([0a39089](https://github.com/Lucas-Bur/pix/commit/0a3908960c976bce72d3e8a56b2c6782a697ed08))
* compare normalized score fusion ([e05a11f](https://github.com/Lucas-Bur/pix/commit/e05a11f0783a42ec6cd63cd4d7a31cf768712cc3))
* compare normalized score fusion ([41133ea](https://github.com/Lucas-Bur/pix/commit/41133ead5e3ab7e01d9ef3d194dc5ee14a9323ab))
* enrich MCP tool metadata ([22590f2](https://github.com/Lucas-Bur/pix/commit/22590f246cd6a9a73ab861f95e63ee8b12d93373))
* integrate learned sparse retrieval ([b61382f](https://github.com/Lucas-Bur/pix/commit/b61382f8f8d973af0e993c21baad1ded619f67ba))
* integrate learned sparse retrieval ([5fd852c](https://github.com/Lucas-Bur/pix/commit/5fd852ca1955b93f7a9d6e65e579ef4eae4b7265))
* require positive dynamic router bases ([e4c8d6e](https://github.com/Lucas-Bur/pix/commit/e4c8d6ec656261487446e550870029343b93a3dc))
* require positive dynamic router bases ([40f97a6](https://github.com/Lucas-Bur/pix/commit/40f97a671dac648010537f34616147c0a11d335b))
* route dynamic weights through DBSF ([4d266de](https://github.com/Lucas-Bur/pix/commit/4d266de744a5c3ccc5000738ff0e0a2153e8a3f1))
* route dynamic weights through DBSF ([8aa758f](https://github.com/Lucas-Bur/pix/commit/8aa758ff1216111644c53dcee3d5a6a90f029c0e))
* use symmetric evidence weighting ([c4ffa5d](https://github.com/Lucas-Bur/pix/commit/c4ffa5d2189f72f2d1cd23e193ce5b28835ca776))
* use symmetric evidence weighting ([c24883a](https://github.com/Lucas-Bur/pix/commit/c24883a2c27b22529c45ec26b001da507e67de68))


### Bug Fixes

* address CodeRabbit review findings ([21cf75b](https://github.com/Lucas-Bur/pix/commit/21cf75b16ffdef71f5142b0d093559c469eae966))
* address retrieval benchmark review feedback ([c00d44b](https://github.com/Lucas-Bur/pix/commit/c00d44b064aa23b5175a59f2b4b804f9e0352363))


### Performance Improvements

* add benchmark timing telemetry ([928eddd](https://github.com/Lucas-Bur/pix/commit/928eddd62fca573114c4db380c4684be7221f924))
* add benchmark timing telemetry ([e40f32d](https://github.com/Lucas-Bur/pix/commit/e40f32d4c28599a48a7e532b6f6c8ce80ddfb11b))
* add objective-aware retrieval baseline ([d8ea2ee](https://github.com/Lucas-Bur/pix/commit/d8ea2eee65ac43c95a655698aafdc32bbb8142e3))
* add objective-aware retrieval baseline ([0c05bc2](https://github.com/Lucas-Bur/pix/commit/0c05bc28a044ac6fd93a6ff522822a7a9dffc041))
* add successive halving router search ([2f92428](https://github.com/Lucas-Bur/pix/commit/2f9242891a199f377daddc12e4761702285798bc))
* add successive halving router search ([1754725](https://github.com/Lucas-Bur/pix/commit/17547252c85be4991a0cbb6e99c8d34505977d20))
* broaden evidence router search ([a24e57a](https://github.com/Lucas-Bur/pix/commit/a24e57a955de16b6fdb1bc38ae1c8865700ffd94))
* broaden evidence router search ([abeff67](https://github.com/Lucas-Bur/pix/commit/abeff67a1107b01c1b5b3048ea7c1b411363c7a8))

## [0.23.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.22.0...pix-v0.23.0) (2026-07-24)


### Features

* add Effect MCP server ([98b612e](https://github.com/Lucas-Bur/pix/commit/98b612e75bc2a63693693b75a184745c64c441ab))


### Bug Fixes

* address MCP review findings ([284c7aa](https://github.com/Lucas-Bur/pix/commit/284c7aa55c061753d75c004f6aa6638ee4e00380))

## [0.22.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.21.0...pix-v0.22.0) (2026-07-21)


### Features

* replace flat-file index with SQLite ([adb7bdc](https://github.com/Lucas-Bur/pix/commit/adb7bdcc5ba43a828de2ab1351c97376a145c825))


### Bug Fixes

* address SQLite review findings ([9b5ba93](https://github.com/Lucas-Bur/pix/commit/9b5ba93ad8c919c2a66fc143afebc78df5c66eaf))
* allow better-sqlite3 native build ([738d958](https://github.com/Lucas-Bur/pix/commit/738d958f6dbc16b9b8e1fbe88ac74102e5daf8b5))

## [0.21.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.20.1...pix-v0.21.0) (2026-07-15)


### Features

* add AST-aware semantic chunking ([61b560a](https://github.com/Lucas-Bur/pix/commit/61b560a996311c3c0c57db84a698935d9fd5ac34))
* add incremental self-refreshing index ([09a7da8](https://github.com/Lucas-Bur/pix/commit/09a7da8d9c9a75ac1d84437f10023a418b444f52))
* add query copy and aliases ([53e25e4](https://github.com/Lucas-Bur/pix/commit/53e25e40408b8081db7fd308de369056fb71380e))
* extract Python and Rust identifiers ([263fd53](https://github.com/Lucas-Bur/pix/commit/263fd534acd7cb85d4a69f2b3f981e921d214e8e))


### Bug Fixes

* address all CodeRabbit review comments on PR [#144](https://github.com/Lucas-Bur/pix/issues/144) ([d7baf5b](https://github.com/Lucas-Bur/pix/commit/d7baf5b315c8e3fb784dc9c2f70a9d3bb254896d))
* address incremental index review findings ([87c09d3](https://github.com/Lucas-Bur/pix/commit/87c09d381f11d4c265fe3229a2a392f8823cf2fe))
* extract Python value and type bindings ([b9f5ed1](https://github.com/Lucas-Bur/pix/commit/b9f5ed12cf3853e3ce12d93ed16002696f951377))
* preserve detached AST comments ([7e09c0f](https://github.com/Lucas-Bur/pix/commit/7e09c0f50873a6245565cb2ca19fa7ef92db717f))

## [0.20.1](https://github.com/Lucas-Bur/pix/compare/pix-v0.20.0...pix-v0.20.1) (2026-07-01)


### Bug Fixes

* **indexer:** use global chunk index for identifier extraction ([77aa146](https://github.com/Lucas-Bur/pix/commit/77aa14606ee9a074a88067f98cf85c26e4e1f4ab))

## [0.20.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.19.0...pix-v0.20.0) (2026-06-30)


### Code Refactoring

* include tests in fallow, restore validation scripts, drop clack generic, reduce type casts ([ae36f61](https://github.com/Lucas-Bur/pix/commit/ae36f6100adbd7dddd0d7a49130d8ced55bd41e4))

## [0.19.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.18.2...pix-v0.19.0) (2026-06-30)


### Features

* **indexer:** extract identifiers per chunk and persist with index ([1585fc0](https://github.com/Lucas-Bur/pix/commit/1585fc04925ab9562ef8a2082d54e887d0fb0309))
* **parsing:** add extension registry as single source of truth ([22d40b4](https://github.com/Lucas-Bur/pix/commit/22d40b430d381ecfd9c0aa5c0efcfb6c35c78c8c))
* **parsing:** add extractIdentifiers walker for tree-sitter ASTs ([fb4e860](https://github.com/Lucas-Bur/pix/commit/fb4e8600612e355415ce81fd92837caa0bee04f9))
* **parsing:** add Identifier domain type and TypeScript mapKind ([464fc1e](https://github.com/Lucas-Bur/pix/commit/464fc1e9414115935e1e46569e8f1c7b2aa3a900))
* **parsing:** add splitCamelCase for identifier constituent extraction ([11c6a41](https://github.com/Lucas-Bur/pix/commit/11c6a417cf14604f673ed71a4b32bbd97c9c5c40))
* **query:** add identity and camelCase channels to RRF fusion ([e71efc3](https://github.com/Lucas-Bur/pix/commit/e71efc38f291b67833c39bed09c9550e7a770161))
* **retrieval:** add buildIdentifierIndex pure function ([0d0ceae](https://github.com/Lucas-Bur/pix/commit/0d0ceae930c1f7c2d9ba6df6769cd7080a84a1cf))
* **retrieval:** add identity and camelCase scoring channels ([7df9e05](https://github.com/Lucas-Bur/pix/commit/7df9e05d9b304ef73cc6ceb7866a9f2711c034a2))
* **services:** add IdentifierExtractor port and live layer ([e98149f](https://github.com/Lucas-Bur/pix/commit/e98149fb59f95db7390549761e97ee1b26feec1d))
* **services:** dispatch parser by file extension in IdentifierExtractor ([e23b0eb](https://github.com/Lucas-Bur/pix/commit/e23b0eb66eefe1df4394bd923f64610932159f9e))
* **services:** persist identifier index in .pix/identifiers.json ([fe5687f](https://github.com/Lucas-Bur/pix/commit/fe5687fc759614ef66754c3dbdcb59ccc588ffa9))


### Bug Fixes

* **bm25:** use unique-token count for chunk length ([5207490](https://github.com/Lucas-Bur/pix/commit/5207490196c2aabf09ab4747c78973a24d3328f8)), closes [#128](https://github.com/Lucas-Bur/pix/issues/128)
* **retrieval:** harden identifier index, dedup camelcase hits, filter empty RRF channels ([3282dd9](https://github.com/Lucas-Bur/pix/commit/3282dd9453788992d7d3447c7866d00d38a4609c))
* **tests:** respect skipExtensions, assert chunk content, narrow skipProcessor ([7eec0f5](https://github.com/Lucas-Bur/pix/commit/7eec0f567f79301ca2ea940a3921933db6690ff1))

## [0.18.2](https://github.com/Lucas-Bur/pix/compare/pix-v0.18.1...pix-v0.18.2) (2026-06-29)


### Performance Improvements

* split layers per-command for 16x faster startup ([255f20e](https://github.com/Lucas-Bur/pix/commit/255f20e1ccdf485c50bd3f4de455629a4d8441f4))

## [0.18.1](https://github.com/Lucas-Bur/pix/compare/pix-v0.18.0...pix-v0.18.1) (2026-06-26)


### Bug Fixes

* address CodeRabbit findings from v4 migration ([ba503b2](https://github.com/Lucas-Bur/pix/commit/ba503b2b118a2212c4068550f83e9d36a4586376))
* apply remaining CodeRabbit fixes ([d225864](https://github.com/Lucas-Bur/pix/commit/d22586421581bcdeabb9edf458aa1a9a0b2e8ab7))

## [0.18.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.17.1...pix-v0.18.0) (2026-06-25)


### Features

* add rank + rel score to search output, idiomatic fuseResults channels ([28f8afe](https://github.com/Lucas-Bur/pix/commit/28f8afedcd2e09aefe530fd31627e6a4fa18b057))


### Performance Improvements

* lazy-load transformers, restructure layers with Layer.suspend ([23ef3e9](https://github.com/Lucas-Bur/pix/commit/23ef3e94ea2872f1edfc1ee49c0d778529297b99))

## [0.17.1](https://github.com/Lucas-Bur/pix/compare/pix-v0.17.0...pix-v0.17.1) (2026-06-23)


### Bug Fixes

* normalize paths for --ignore-path/--only-path on Windows; add pix retrieval guide to AGENTS.md ([a9490b6](https://github.com/Lucas-Bur/pix/commit/a9490b6fd2e41f3334ff1976538dd69f88c24f51))

## [0.17.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.16.0...pix-v0.17.0) (2026-06-23)


### Features

* config heal command + ModelRegistry port ([1caa370](https://github.com/Lucas-Bur/pix/commit/1caa370f3ddeccd895b1102616c3284f356dcabd))
* minChunkChars config, pix init model prompt, model mismatch check ([4ca3ee8](https://github.com/Lucas-Bur/pix/commit/4ca3ee8b104cf099434f5faa6aa78bf26c478746))


### Bug Fixes

* address CodeRabbit review — alignment guard, prototype pollution, test assertions ([17280cc](https://github.com/Lucas-Bur/pix/commit/17280ccc85cba6291c5478d4a8789e77b192a552))
* remove dead vector-codec, fix jina q4 query, harden error reporting ([5380e14](https://github.com/Lucas-Bur/pix/commit/5380e14354e909270e47c87c690e464c581adba7))
* remove fp16 and q4 from MODEL_REGISTRY — verified broken/missing ([cb9ae3f](https://github.com/Lucas-Bur/pix/commit/cb9ae3f1c2f75f5ba3a5b19ace015160c7dfc92a))

## [0.16.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.15.0...pix-v0.16.0) (2026-06-22)


### Features

* add d.table() to Display service, move table formatting out of bench domain ([cb5715c](https://github.com/Lucas-Bur/pix/commit/cb5715c52fd159ad82a553521cecee5784e0d40a))
* add duration column to benchmark table and fix progress stop message ([a9dac38](https://github.com/Lucas-Bur/pix/commit/a9dac3853bd710be8efe9b328b768ffb553168bc))
* add pix bench command ([e2aaab1](https://github.com/Lucas-Bur/pix/commit/e2aaab18ad20bbb7634236b4cf89b86b46dc62c2))
* extract device detection service and fix auto resolution ([8ff0e4d](https://github.com/Lucas-Bur/pix/commit/8ff0e4d50bd25cfc62fa084a87a9f7ce34440bbd))
* implement --apply flag and final bench cleanup ([ba2a69f](https://github.com/Lucas-Bur/pix/commit/ba2a69fcdd51619dfb3b22495e9e9ce11325146d))
* implement cold-start and warm-path measurement pipeline ([285be81](https://github.com/Lucas-Bur/pix/commit/285be81dab1e50cb0acf7caf4a4f343005ed3cf8))
* implement corpus preparation for benchmark ([12831e5](https://github.com/Lucas-Bur/pix/commit/12831e587f7bcfea3aa9ae3db6c086f661bdce5d))
* log available devices before benchmark starts ([a83935b](https://github.com/Lucas-Bur/pix/commit/a83935bf14e954c7dd42682681363ea27e5c317d))
* refine bench output - clack corners, structured recs, failed device handling ([c1e335c](https://github.com/Lucas-Bur/pix/commit/c1e335cd15bd876abb757b32ad34df2ef0bf471f))
* scaffold pix bench command with flags and domain types ([9f42685](https://github.com/Lucas-Bur/pix/commit/9f426859b5e00c7f3083c3f094275a815b69e331))


### Bug Fixes

* benchmark only available devices, not all devices with fallback ([54506a0](https://github.com/Lucas-Bur/pix/commit/54506a0010b47f37f20001d4ace5ef93c4aa8164))
* correct benchLayer test helper type annotations ([771925c](https://github.com/Lucas-Bur/pix/commit/771925caf4e41f8655bd859a987aa3ce7af5fedd))
* device detection returning extractor function instead of device name ([38043ca](https://github.com/Lucas-Bur/pix/commit/38043caab140bff6475b07aaf237a1294446e5b1))
* replace toF32 with documented cast for tensor data ([37448e2](https://github.com/Lucas-Bur/pix/commit/37448e20061dc265af3a7151ea98c1abbc999052))
* three bench issues - cold start, --apply opt-in, progress, device list ([a21c59c](https://github.com/Lucas-Bur/pix/commit/a21c59c39565a083a9dc2aae42e032141e165eba))
* use structured BenchRecommendation type instead of string protocol ([e6bde6f](https://github.com/Lucas-Bur/pix/commit/e6bde6fb751d57ae690040321b65851c0bd8dc29))

## [0.15.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.14.0...pix-v0.15.0) (2026-05-18)


### Features

* hybrid search with BM25 + RRF fusion ([4614928](https://github.com/Lucas-Bur/pix/commit/461492871cee9baec47641556fa824dc10ae40a8))


### Bug Fixes

* address CodeRabbit review comments ([d764463](https://github.com/Lucas-Bur/pix/commit/d7644639621320399015e943fcedbdb5604a5907))
* preserve original error if storeAbort fails in index-project ([48fa0f0](https://github.com/Lucas-Bur/pix/commit/48fa0f079aabc43126508fd04426e7376720b029))

## [0.14.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.13.0...pix-v0.14.0) (2026-05-18)


### Features

* add dtype tracking infrastructure — index-meta.json, VectorDecoder, cosine similarity ([cbb79a8](https://github.com/Lucas-Bur/pix/commit/cbb79a82d50c18f7dbaa1290a16e6d69b755b2a7))
* add structured file logging to Display service ([7212ca5](https://github.com/Lucas-Bur/pix/commit/7212ca52ae6ecd9f36314e049d950afb92229d54))
* vector codec length validation, shape checks, codec tests ([2a3edce](https://github.com/Lucas-Bur/pix/commit/2a3edceb65333a4dc844883117ad377f0f3c4ebe))


### Bug Fixes

* align JsonDisplay log shapes with ClackDisplay and add contract tests ([4b45bfa](https://github.com/Lucas-Bur/pix/commit/4b45bfab25a75e20613934aa365ae9ceac64b6bb))
* balance spinner start/stop logs by moving start log after nested guard ([39d7cbc](https://github.com/Lucas-Bur/pix/commit/39d7cbc5ac37c66c3273682c0cfee21ad015e969))
* correctness — NaN clamp guard, fs.exists error mapping, batchSize clamping ([ff314fb](https://github.com/Lucas-Bur/pix/commit/ff314fbfb440e504d7c4e1267bf193746cc1629f))
* encode only Float32Array view bytes using Buffer.from offset/length ([378f4fd](https://github.com/Lucas-Bur/pix/commit/378f4fde581142bedc7916ea49f703e5508c262d))
* fail fast on missing/corrupted index-meta.json instead of silent fallback ([b4c560e](https://github.com/Lucas-Bur/pix/commit/b4c560eb181461c95e465cfff5ec1a26a328c93a))
* log updateInteractive in ClackDisplay, stop events on failure in JsonDisplay ([50d790b](https://github.com/Lucas-Bur/pix/commit/50d790bada9f98ee01b6cbdd53138532e5f3d945))
* make buildContentFields private to eliminate dead export ([08925d7](https://github.com/Lucas-Bur/pix/commit/08925d724403ac708f9770ffcbf8e56209fff773))
* reorder storeCommit to write metadata before data files ([53f39fc](https://github.com/Lucas-Bur/pix/commit/53f39fcd8fcf8192a22e737d393a4d8a70f7421f))
* restore manually-verified dtypes in MODEL_REGISTRY ([171dec7](https://github.com/Lucas-Bur/pix/commit/171dec70f9374df8f67f3de283d68e9ca45b079b))
* test robustness — isolate FS per test, harden JSON assertions, realistic embedder stub ([d33860e](https://github.com/Lucas-Bur/pix/commit/d33860e1e178f4cbbf25cd07fc7c488d2bdef713))
* use Effect.die for unreachable dtype path instead of Effect.fail ([e6061a8](https://github.com/Lucas-Bur/pix/commit/e6061a8b6cda1160cfef9c1bad87396919c5d6e3))
* **vector-store deepening:** remove dead PathFilter export, fix makeOnlyFilter logic, add tests ([afafe69](https://github.com/Lucas-Bur/pix/commit/afafe69ad314c9bffb9bb15af2fec71b9f00f9ff))
* verify query dims match index dims, remove dead export EMBEDDING_DTYPES, reduce test dupes ([3559254](https://github.com/Lucas-Bur/pix/commit/3559254afab8720593145f6eabf05e9708455a61))


### Performance Improvements

* precompute ignore matcher in path-filter.ts ([f417bf3](https://github.com/Lucas-Bur/pix/commit/f417bf3bf064d923066b46d5a52ee2c1241b532e))

## [0.13.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.12.0...pix-v0.13.0) (2026-05-16)


### Features

* add Effect Schema validation for Config and Chunk data ([181432a](https://github.com/Lucas-Bur/pix/commit/181432a0c319ba348bdffbc6e39324c5b5890d9c))
* validate config/chunk at write boundaries + deepMerge utility ([99d73c3](https://github.com/Lucas-Bur/pix/commit/99d73c39124469b143a75b35a64257bcb0560650))


### Bug Fixes

* address CodeRabbit comments — JSDoc, provide scope, combine chunk stats, extract helpers ([5d28b42](https://github.com/Lucas-Bur/pix/commit/5d28b42011ad561da5b033b9ca23961936163668))
* address remaining CodeRabbit comments — table examples, malformed-line tests ([39ea71f](https://github.com/Lucas-Bur/pix/commit/39ea71f7fb0571403580f9bfb549a51220e57219))
* flow ChunkValidationError through return types instead of Effect.logWarning ([d7513af](https://github.com/Lucas-Bur/pix/commit/d7513af56baae091766e7b7f4afd41380f8eda17))
* wire up ChunkValidationError in vector-store search and getStatus ([32d818a](https://github.com/Lucas-Bur/pix/commit/32d818a71e34119c9c46220ac5da48648d2d47fb))

## [0.12.0](https://github.com/Lucas-Bur/pix/compare/pix-v0.11.0...pix-v0.12.0) (2026-05-16)


### Features

* implement issues 79, 80, 89, 90, 91 ([3b341d4](https://github.com/Lucas-Bur/pix/commit/3b341d408f7eead9efc7f9cf4c4f564b79860e34))


### Bug Fixes

* address code review findings ([2556bff](https://github.com/Lucas-Bur/pix/commit/2556bff434065a31d2944d6bd9939fbc8cb2802c))
* address CodeRabbit review - boundary types, topK validation, test coverage ([d2c694f](https://github.com/Lucas-Bur/pix/commit/d2c694f85eecb15c63f5b2c5755802c42c69ae3b))
* vector-store search complexity, Float32Array bounds, context normalization ([da5f0db](https://github.com/Lucas-Bur/pix/commit/da5f0dbc536342b069f8192eb4bb3ac6a903d205))

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
