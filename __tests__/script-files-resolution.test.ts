/**
 * Script-file references across languages: shell `source` / `bash x.sh` /
 * `Rscript x.R` / `./x.sh`, and R `source()` (including `file.path()` paths and
 * Quarto chunks), resolve to the file node of the script they name.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CodeGraph } from '../src';

describe('script-file references', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'script-files-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function write(rel: string, content: string): void {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }

  /** Index the project once and run each query against it. */
  async function query(...sql: string[]): Promise<any[][]> {
    const cg = await CodeGraph.init(dir, { silent: true });
    await cg.indexAll();
    const db = (cg as any).db.db;
    const results = sql.map((q) => db.prepare(q).all());
    cg.destroy();
    return results;
  }

  const FILE_EDGES = `SELECT e.kind kind, s.file_path || ':' || s.name "from", t.file_path "to"
    FROM edges e JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target
    WHERE t.kind = 'file' AND e.kind IN ('calls', 'imports')`;

  it('links shell and R scripts to the files they source or run', async () => {
    write('scripts/env.sh', 'env_name() { echo base; }\n');
    write('scripts/validate.sh', 'check() { :; }\n');
    write('scripts/ci.sh', [
      'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
      'source "$SCRIPT_DIR/env.sh"',
      'run_ci() {',
      '  bash "$ROOT/scripts/validate.sh"',
      '  Rscript steps/de/run.R',
      '  bash "$ROOT/scripts/missing.sh"',
      '}',
    ].join('\n'));
    write('steps/_lib/common.R', 'strip_version <- function(x) sub("\\\\..*", "", x)\n');
    write('steps/de/run.R', 'source(file.path(script_dir, "..", "_lib", "common.R"))\nstrip_version("a.1")\n');
    write('steps/de/report.qmd', [
      '---', 'title: x', '---', '',
      '```{r}', 'source("helpers.R")', '```', '',
      '```r', 'source("shown_only.R")', '```',
    ].join('\n'));
    write('steps/de/helpers.R', 'fmt <- function(x) x\n');
    write('steps/de/shown_only.R', 'z <- 1\n');

    const [edges] = await query(FILE_EDGES);
    expect(edges).toEqual(expect.arrayContaining([
      { kind: 'imports', from: 'scripts/ci.sh:ci.sh', to: 'scripts/env.sh' },
      { kind: 'calls', from: 'scripts/ci.sh:run_ci', to: 'scripts/validate.sh' },
      { kind: 'calls', from: 'scripts/ci.sh:run_ci', to: 'steps/de/run.R' },
      { kind: 'imports', from: 'steps/de/run.R:run.R', to: 'steps/_lib/common.R' },
      { kind: 'imports', from: 'steps/de/report.qmd:report.qmd', to: 'steps/de/helpers.R' },
    ]));
    expect(edges.some((e) => e.to === 'steps/de/shown_only.R')).toBe(false);
    expect(edges.some((e) => e.to.endsWith('missing.sh'))).toBe(false);
  });

  it('links Nextflow modules, processes, and the scripts processes run', async () => {
    write('modules/fastqc/main.nf', [
      'process FASTQC {',
      '    script:',
      '    """',
      '    fastqc_wrapper.sh --in x',
      '    """',
      '}',
    ].join('\n'));
    write('bin/fastqc_wrapper.sh', 'wrap() { :; }\n');
    write('steps/de/run.R', 'run <- function() 1\n');
    write('steps/qc/run.R', 'run <- function() 2\n');
    write('steps/de/main.nf', [
      "include { FASTQC as QC } from '../../modules/fastqc'",
      'process DE {',
      '    script:',
      '    """',
      '    Rscript code/de/run.R --out out',
      '    """',
      '}',
      'workflow DE_FLOW {',
      '    QC(reads)',
      '    DE(code)',
      '}',
    ].join('\n'));

    const [edges, calls] = await query(
      FILE_EDGES,
      `SELECT s.name s, t.name t, t.file_path f FROM edges e JOIN nodes s ON s.id = e.source
       JOIN nodes t ON t.id = e.target WHERE e.kind = 'calls' AND s.name = 'DE_FLOW'`
    );
    expect(edges).toEqual(expect.arrayContaining([
      { kind: 'imports', from: 'steps/de/main.nf:main.nf', to: 'modules/fastqc/main.nf' },
      { kind: 'calls', from: 'steps/de/main.nf:DE', to: 'steps/de/run.R' },
      { kind: 'calls', from: 'modules/fastqc/main.nf:FASTQC', to: 'bin/fastqc_wrapper.sh' },
    ]));

    expect(calls).toEqual(expect.arrayContaining([
      { s: 'DE_FLOW', t: 'FASTQC', f: 'modules/fastqc/main.nf' },
      { s: 'DE_FLOW', t: 'DE', f: 'steps/de/main.nf' },
    ]));
  });
});
