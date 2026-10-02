/**
 * Jupyter notebooks (`.ipynb`) as source code.
 *
 * A notebook is JSON whose code cells hold source as an array of strings, one
 * JSON line per source line in the format Jupyter, JupyterLab, and VS Code
 * write (`"source": [ "x = 1\n", "f(x)" ]`). `notebookCodeView` turns that
 * file into code for the Python or R extractor WITHOUT moving any line: each
 * code-cell source line is replaced by its decoded text padded with spaces to
 * the JSON line's length, and every other line (JSON structure, markdown cells,
 * outputs) becomes spaces. Line numbers and line start offsets therefore point
 * into the `.ipynb` file itself, for the native kernel and wasm paths alike.
 *
 * A cell whose source is one JSON string (`"source": "x = f()"`) is used when
 * that string is a single line. Skipped: IPython magics and shell escapes
 * (`%matplotlib`, `!pip`, and whole `%%bash`-style cell magics), multi-line
 * single-string sources, and notebooks that are not laid out one source line per JSON line (minified) —
 * those yield no code rather than wrong positions.
 */

import type { Language } from '../types';

const NOTEBOOK_PATH = /\.ipynb$/i;
const SOURCE_KEY = /^\s*"source":\s*\[\s*$/;
const ARRAY_END = /^\s*\]\s*,?\s*$/;
const STRING_LINE = /^\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/;
const INLINE_SOURCE = /^\s*"source":\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/;

function decode(escaped: string): string | null {
  try {
    return JSON.parse(`"${escaped}"`) as string;
  } catch {
    return null;
  }
}

export function isNotebookPath(filePath: string | undefined): boolean {
  return !!filePath && NOTEBOOK_PATH.test(filePath);
}

interface NotebookJson {
  cells?: Array<{ cell_type?: string; source?: string | string[] }>;
  metadata?: { kernelspec?: { language?: string }; language_info?: { name?: string } };
}

function parseNotebook(source: string): NotebookJson | null {
  try {
    const nb = JSON.parse(source) as NotebookJson;
    return nb && typeof nb === 'object' && Array.isArray(nb.cells) ? nb : null;
  } catch {
    return null;
  }
}

/** The notebook's kernel language when it is one CodeGraph extracts (Python or R). */
export function notebookLanguage(source: string): Language | null {
  const nb = parseNotebook(source);
  if (!nb) return null;
  const lang = (nb.metadata?.kernelspec?.language ?? nb.metadata?.language_info?.name ?? 'python').toLowerCase();
  if (lang === 'python') return 'python';
  if (lang === 'r') return 'r';
  return null;
}

/** UTF-8 bytes beyond one per UTF-16 unit — equal for two strings when padding keeps both lengths aligned. */
function nonAsciiExcess(text: string): number {
  return Buffer.byteLength(text, 'utf8') - text.length;
}

export function notebookCodeView(source: string, filePath?: string): string {
  if (!isNotebookPath(filePath)) return source;
  const lines = source.split('\n');
  const out = lines.map((line) => line.replace(/[^\r]/g, ' '));
  const nb = parseNotebook(source);
  if (!nb?.cells) return out.join('\n');

  // Each cell source in file order — an array, or an inline string — as the
  // JSON line index and decoded text of each element.
  const arrays: Array<Array<{ index: number; text: string }>> = [];
  let current: Array<{ index: number; text: string }> | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r$/, '');
    if (!current) {
      if (SOURCE_KEY.test(line)) current = [];
      const inline = INLINE_SOURCE.exec(line);
      const text = inline ? decode(inline[1]!) : null;
      if (text) arrays.push([{ index: i, text }]);
      continue;
    }
    if (ARRAY_END.test(line)) {
      arrays.push(current);
      current = null;
      continue;
    }
    const m = STRING_LINE.exec(line);
    const text = m ? decode(m[1]!) : null;
    if (text === null) return out.join('\n'); // not one string per line: unsupported layout
    current.push({ index: i, text });
  }

  // Cells with an empty source have no source line of their own.
  const sourced = nb.cells.filter((c) => (Array.isArray(c.source) ? c.source.length > 0 : !!c.source));
  if (sourced.length !== arrays.length) return out.join('\n');

  sourced.forEach((cell, n) => {
    const elements = arrays[n]!;
    const expected = Array.isArray(cell.source) ? cell.source : [cell.source!];
    if (elements.length !== expected.length || elements.some((e, k) => e.text !== expected[k])) return;
    if (cell.cell_type !== 'code') return;
    if (/^\s*%%/.test(elements[0]?.text ?? '')) return; // cell magic: not kernel code
    for (const { index, text } of elements) {
      const code = text.replace(/\r?\n$/, '');
      if (/[\n\r]/.test(code) || /^\s*[%!]/.test(code)) continue;
      const raw = lines[index]!.replace(/\r$/, '');
      if (nonAsciiExcess(code) !== nonAsciiExcess(raw)) continue; // a \uXXXX escape would shift offsets
      out[index] = code + ' '.repeat(raw.length - code.length) + (lines[index]!.endsWith('\r') ? '\r' : '');
    }
  });
  return out.join('\n');
}
