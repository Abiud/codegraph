/**
 * `script:` file references for R's `source()` calls. The `script-files`
 * framework's extract hook runs this on the raw source, so the native-kernel
 * and wasm parse paths get the same references.
 *
 *   source("helpers.R")                                  -> script:helpers.R
 *   source(file.path(script_dir, "..", "_lib", "x.R"))   -> script:../_lib/x.R
 *   source(here::here("R", "utils.R"))                   -> script:R/utils.R
 *
 * In `file.path()`/`here()`, every argument before the last string literal
 * that is not itself a literal is a runtime directory, so only the trailing
 * literal segments form the path tail.
 */

import type { UnresolvedRef } from '../resolution/types';
import { blankNonRChunks } from './languages/r';
import { scriptRefName } from './script-refs';

const SOURCE_CALL = /(?<![\w.$])(?:base::)?(?:source|sys\.source)\s*\(\s*/g;
const PATH_BUILDER = /^(?:file\.path|(?:here::)?here|fs::path|paste0)\s*\(/;
const STRING = /^(["'])((?:\\.|(?!\1).)*)\1$/;

/** Split a call's argument list text at top-level commas. */
function splitArgs(text: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) {
        args.push(text.slice(start, i).trim());
        return args;
      }
      depth--;
    } else if (c === ',' && depth === 0) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  return args;
}

/** The path a `source()` first argument names, with `$X` standing for a runtime directory. */
function sourcePath(argText: string): string | null {
  const literal = STRING.exec(argText);
  if (literal) return literal[2]!;
  const builder = PATH_BUILDER.exec(argText);
  if (!builder || argText.startsWith('paste0')) return null;
  const parts = splitArgs(argText.slice(builder[0].length)).filter((a) => !/^\w+\s*=/.test(a));
  return parts.map((p) => STRING.exec(p)?.[2] ?? '$X').join('/');
}

/** One `imports` reference per static `source()` path, attributed to the file. */
export function rSourceScriptRefs(filePath: string, source: string): UnresolvedRef[] {
  const refs: UnresolvedRef[] = [];
  const code = blankNonRChunks(source, filePath);
  SOURCE_CALL.lastIndex = 0;
  for (let m = SOURCE_CALL.exec(code); m; m = SOURCE_CALL.exec(code)) {
    const lineStart = code.lastIndexOf('\n', m.index) + 1;
    if (code.slice(lineStart, m.index).includes('#')) continue; // commented out
    const first = splitArgs(code.slice(m.index + m[0].length))[0];
    const path = first ? sourcePath(first) : null;
    const name = path ? scriptRefName(path) : null;
    if (!name) continue;
    refs.push({
      fromNodeId: `file:${filePath}`,
      referenceName: name,
      referenceKind: 'imports',
      line: code.slice(0, m.index).split('\n').length,
      column: m.index - lineStart,
      filePath,
      language: 'r',
    });
  }
  return refs;
}
