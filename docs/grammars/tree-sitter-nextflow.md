# tree-sitter-nextflow.wasm — provenance & rebuild

`src/extraction/wasm/tree-sitter-nextflow.wasm` is built, unmodified, from
[nextflow-io/tree-sitter-nextflow](https://github.com/nextflow-io/tree-sitter-nextflow)
(MIT, v0.4.0) at commit `ce9bc46efb870a7214aac774f3a3f06cf90d9afe`
(2026-09-23). ABI 15; `scripts/add-lang/check-grammar.mjs` passes (20/20
clean parses in a multi-grammar runtime).

SHA-256 of the committed build:
`9bd2d7239ea9554ec55824f9f437c675e4b18456872d42b5d6f0f3807e53eb33`
(Emscripten builds are not byte-reproducible across emsdk versions; rebuild
and re-check rather than comparing hashes).

## Rebuild

```bash
git clone https://github.com/nextflow-io/tree-sitter-nextflow
cd tree-sitter-nextflow
git checkout ce9bc46efb870a7214aac774f3a3f06cf90d9afe
npm install --no-save tree-sitter-cli@0.25.10   # the CLI the other vendored grammars use
npx tree-sitter generate
npx tree-sitter build --wasm -o tree-sitter-nextflow.wasm   # needs emscripten or Docker
cp tree-sitter-nextflow.wasm <codegraph>/src/extraction/wasm/
node <codegraph>/scripts/add-lang/check-grammar.mjs \
  <codegraph>/src/extraction/wasm/tree-sitter-nextflow.wasm path/to/main.nf
```

The extractor (`src/extraction/languages/nextflow.ts`) covers `.nf` files
only; `nextflow.config` files are not indexed.
