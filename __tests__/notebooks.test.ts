/**
 * Jupyter notebooks (.ipynb) and marimo notebooks, against the fixture project
 * in fixtures/notebooks:
 *
 *   src/labkit/          src-layout package; __init__.py re-exports plots/stats
 *   tests/               `import labkit as lk; lk.volcano(...)`
 *   notebooks/marimo_report.py   marimo app — cells receive `lk` as a parameter
 *   notebooks/analysis.ipynb     Python kernel: magics, outputs, markdown,
 *                                a single-string cell, a %%bash cell
 *   notebooks/r_analysis.ipynb   R kernel: source() + function + call
 *   notebooks/julia.ipynb        unsupported kernel → skipped
 *   notebooks/minified.ipynb     one-line JSON → no code, no crash
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CodeGraph } from '../src';
import { detectLanguage, initGrammars, loadAllGrammars } from '../src/extraction/grammars';
import { extractFromSource } from '../src/extraction/tree-sitter';
import { notebookCodeView } from '../src/extraction/notebook';

const fixtureDir = path.join(__dirname, 'fixtures', 'notebooks');
const read = (rel: string) => fs.readFileSync(path.join(fixtureDir, rel), 'utf8');

beforeAll(async () => {
  await initGrammars();
  await loadAllGrammars();
});

describe('Jupyter notebook extraction', () => {
  it('detects the kernel language', () => {
    expect(detectLanguage('notebooks/analysis.ipynb', read('notebooks/analysis.ipynb'))).toBe('python');
    expect(detectLanguage('notebooks/r_analysis.ipynb', read('notebooks/r_analysis.ipynb'))).toBe('r');
    expect(detectLanguage('notebooks/julia.ipynb', read('notebooks/julia.ipynb'))).toBe('unknown');
    expect(detectLanguage('notebooks/analysis.ipynb')).toBe('python');
  });

  it('keeps every line at its original length and position', () => {
    const source = read('notebooks/analysis.ipynb');
    const view = notebookCodeView(source, 'analysis.ipynb');
    const src = source.split('\n');
    const out = view.split('\n');
    expect(out).toHaveLength(src.length);
    out.forEach((line, i) => {
      expect(line.length).toBe(src[i]!.length);
      expect(Buffer.byteLength(line)).toBe(Buffer.byteLength(src[i]!));
    });
    expect(out[38]!.trimEnd()).toBe('def label(gene):');
    expect(out[39]!.trimEnd()).toBe('    return f"{gene} (µ)"');
    expect(notebookCodeView('x = 1\n', 'plain.py')).toBe('x = 1\n');
  });

  it('extracts code cells only, at their .ipynb line numbers', () => {
    const result = extractFromSource('notebooks/analysis.ipynb', read('notebooks/analysis.ipynb'));
    const label = result.nodes.find((n) => n.kind === 'function' && n.name === 'label');
    expect(label?.startLine).toBe(39);
    const calls = result.unresolvedReferences.filter((r) => r.referenceKind === 'calls');
    const lineOf = (name: string) => calls.filter((r) => r.referenceName === name).map((r) => r.line).sort((a, b) => a - b);
    expect(lineOf('fit_model')).toEqual([42]);
    expect(lineOf('lk.volcano')).toEqual([43, 75]); // second: the single-string cell
    expect(lineOf('lk.heatmap')).toEqual([55]); // not the markdown cell (9) or the output (34)
    expect(lineOf('label')).toEqual([44]);
    const names = calls.map((r) => r.referenceName);
    for (const absent of ['should_not_index', 'pip', 'install', 'bash']) expect(names).not.toContain(absent);
    const imports = result.nodes.filter((n) => n.kind === 'import').map((n) => n.name);
    expect(imports).toEqual(expect.arrayContaining(['labkit']));
  });

  it('extracts R-kernel notebooks with the R extractor', () => {
    const result = extractFromSource('notebooks/r_analysis.ipynb', read('notebooks/r_analysis.ipynb'));
    const fn = result.nodes.find((n) => n.kind === 'function' && n.name === 'plot_qc');
    expect(fn?.language).toBe('r');
    expect(fn?.startLine).toBe(19);
    const call = result.unresolvedReferences.find((r) => r.referenceName === 'summarize_counts');
    expect(call?.fromNodeId).toBe(fn?.id);
    expect(call?.line).toBe(20);
  });

  it('yields no code for a minified notebook', () => {
    const result = extractFromSource('notebooks/minified.ipynb', read('notebooks/minified.ipynb'));
    expect(result.nodes.filter((n) => n.kind !== 'file')).toEqual([]);
    expect(result.unresolvedReferences).toEqual([]);
  });
});

describe('notebook and package resolution', () => {
  let dir: string;
  let cg: CodeGraph | undefined;
  type Edge = { kind: string; from: string; to: string };
  let edges: Edge[];

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notebooks-'));
    fs.cpSync(fixtureDir, dir, { recursive: true });
    cg = await CodeGraph.init(dir, { silent: true });
    await cg.indexAll();
    edges = (cg as any).db.db
      .prepare(
        `SELECT e.kind kind, s.file_path || ':' || s.name || ':' || s.start_line "from",
                t.file_path || ':' || t.name "to"
         FROM edges e JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target
         WHERE e.kind IN ('calls', 'imports') AND s.file_path <> t.file_path`
      )
      .all();
  });

  afterEach(() => {
    cg?.close();
    cg = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('follows a package __init__.py re-export to the definition', () => {
    expect(edges).toContainEqual({ kind: 'calls', from: 'tests/test_labkit.py:test_volcano:4', to: 'src/labkit/plots.py:volcano' });
  });

  it('links marimo cells to the module another cell imported', () => {
    expect(edges).toEqual(expect.arrayContaining([
      { kind: 'calls', from: 'notebooks/marimo_report.py:_:17', to: 'src/labkit/stats.py:fit_model' },
      { kind: 'calls', from: 'notebooks/marimo_report.py:_:23', to: 'src/labkit/plots.py:volcano' },
    ]));
  });

  it('links Python notebook cells to package code', () => {
    const fromNotebook = edges
      .filter((e) => e.from.startsWith('notebooks/analysis.ipynb:') && e.kind === 'calls')
      .map((e) => e.to);
    expect(fromNotebook).toEqual(expect.arrayContaining([
      'src/labkit/plots.py:volcano',
      'src/labkit/plots.py:heatmap',
      'src/labkit/stats.py:fit_model',
    ]));
    expect(edges.some((e) => e.from.startsWith('notebooks/analysis.ipynb:') && e.to.startsWith('scripts/qc.sh'))).toBe(false);
  });

  it('links R notebook cells to sourced R files and their functions', () => {
    expect(edges).toEqual(expect.arrayContaining([
      { kind: 'imports', from: 'notebooks/r_analysis.ipynb:r_analysis.ipynb:1', to: 'R/helpers.R:helpers.R' },
      { kind: 'calls', from: 'notebooks/r_analysis.ipynb:plot_qc:19', to: 'R/helpers.R:summarize_counts' },
    ]));
  });

  it('indexes neither the Julia nor the minified notebook as code', () => {
    expect(edges.some((e) => /notebooks\/(julia|minified)\.ipynb/.test(e.from))).toBe(false);
  });
});
