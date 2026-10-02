# Lab fork

`Abiud/codegraph`, branch `lab`: upstream CodeGraph plus

- R Markdown / Quarto (`.Rmd`, `.Rmarkdown`, `.qmd`) `{r}` chunk indexing,
- shell (bash/zsh/sh), from upstream PR #1912,
- Nextflow DSL2 (`.nf`), on the vendored nextflow-io grammar
  (`docs/grammars/tree-sitter-nextflow.md`),
- Jupyter `.ipynb` code cells (Python and R kernels) and marimo cell calls
  through modules imported in other cells; Python package `__init__.py`
  re-exports followed to their definitions,
- script-file links across languages (`source`, `bash x.sh`, `Rscript x.R`,
  R `source()`, Nextflow `script:` blocks) via the `script-files` resolver.

Pi installs it from this fork's GitHub Releases; nothing is published to npm.

## Release

1. Set the version: `npm version <upstream>-lab.<n> --no-git-tag-version --ignore-scripts`.
2. Commit, then `git tag v<version> && git push origin lab v<version>`.
3. `.github/workflows/lab-release.yml` builds the native kernels and the
   darwin-arm64/x64 and linux-x64/arm64 bundles, runs the test suite against
   the linux-x64 kernel, and publishes a prerelease with the bundles, the npm
   tarballs (`scripts/lab-pack-npm.sh`), `SHA256SUMS`, and build-provenance
   attestations (`gh attestation verify <file> -R Abiud/codegraph`).

## Rebase onto a new upstream release

```bash
git fetch upstream --tags
git rebase --onto v<new> v<old> lab   # v<old> = upstream tag lab was based on
npm ci && npm run build && npx vitest run --project engine
```

Drop the shell commit if upstream has merged shell support.
