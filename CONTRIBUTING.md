# Contributing to pix

## Development workflow

### Branching

Feature branches off `main`, PR back in. Simple GitHub Flow.

```powershell
git checkout -b feat/describe-your-change
# make changes, commit
git push -u origin feat/describe-your-change
# open a PR on GitHub
```

`main` is protected — direct pushes are blocked. All changes flow through PRs.

### Commits

Use [Conventional Commits](https://www.conventionalcommits.org/). Prefix determines version bump:

| Prefix                                         | Semver                | Example                          |
| ---------------------------------------------- | --------------------- | -------------------------------- |
| `feat:`                                        | minor (0.1.0 → 0.2.0) | `feat: add incremental indexing` |
| `fix:`                                         | patch (0.1.0 → 0.1.1) | `fix: handle empty config file`  |
| `feat!:` or `BREAKING CHANGE:`                 | major (0.x.x → 1.0.0) | `feat!: drop Node 20 support`    |
| `docs:`, `chore:`, `refactor:`, `test:`, `ci:` | no bump               | `docs: update API reference`     |

### Quality gates

Every PR runs automatically (see `.github/workflows/ci.yml`):

| Step                       | Tool                 | Blocks merge?      |
| -------------------------- | -------------------- | ------------------ |
| Format + lint + type-check | `vp check`           | Yes                |
| Tests                      | `vp test --coverage` | Yes                |
| Build                      | `vp run build`       | Yes                |
| Code quality audit         | `vpx fallow audit`   | No (informational) |

Run locally before pushing:

```powershell
vp run ci
```

Branch protection requires PR + CI green before merging.

### PR review

[CodeRabbit](https://coderabbit.ai) reviews every PR automatically. Review comments appear inline on the diff.

### Merging

- **Single-commit branch**: Squash and merge
- **Multi-commit branch**: Rebase and merge (keeps history linear)

## Release process

### Automatic (release-please)

1. Push/merge commits to `main`
2. [release-please](https://github.com/googleapis/release-please) scans conventional commits
3. If there are unreleased changes, it opens a **release PR** with:
   - Updated `CHANGELOG.md`
   - Bumped version in `package.json`
4. Merge the release PR → git tag + GitHub Release created
5. Release triggers `publish.yml` → builds and runs `npm publish`

No manual version bumping. No manual changelog. You control timing — merge the release PR when ready.

### Manual (emergency)

```powershell
npm version patch  # or minor | major
npm publish
```

## Tools

| Tool                                          | Purpose                                      |
| --------------------------------------------- | -------------------------------------------- |
| [Vite+](https://viteplus.dev)                 | Build, lint, format, test (`vp`, `vpx`)      |
| [Effect](https://effect.website)              | Runtime, CLI framework, dependency injection |
| [Vitest](https://vitest.dev)                  | Test runner                                  |
| [Fallow](https://github.com/fallow-rs/fallow) | Dead code, duplication, complexity analysis  |

## Architecture

See [CONTEXT.md](./CONTEXT.md) for domain glossary and [docs/adr/](./docs/adr/) for architecture decisions.
