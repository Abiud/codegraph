/**
 * Script-file references: links `script:<path>` refs (see
 * `extraction/script-refs.ts`) to the indexed file they name.
 *
 * Shell `source`/`bash x.sh`/`Rscript x.R`, R `source("helpers.R")`, and
 * Nextflow `script:` blocks name files by path, often behind a runtime
 * directory variable. Running a script in another language is a real
 * cross-language call, so this resolves as a framework (whose `calls` results
 * may cross the language-family gate) rather than through name matching.
 */

import * as path from 'path';
import type { FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef } from '../types';
import { SCRIPT_REF_PREFIX } from '../../extraction/script-refs';
import { rSourceScriptRefs } from '../../extraction/r-source-refs';
import { detectLanguage } from '../../extraction/grammars';

const basenameIndexes = new WeakMap<ResolutionContext, Map<string, string[]>>();

function basenameIndex(context: ResolutionContext): Map<string, string[]> {
  let index = basenameIndexes.get(context);
  if (!index) {
    index = new Map();
    for (const f of context.getAllFiles()) {
      const base = f.split('/').pop() ?? '';
      const bucket = index.get(base);
      if (bucket) bucket.push(f);
      else index.set(base, [f]);
    }
    basenameIndexes.set(context, index);
  }
  return index;
}

function sharedPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** The indexed file a script path tail names, preferring the referrer's directory. */
export function resolveScriptFile(tail: string, fromFile: string, context: ResolutionContext): string | null {
  const besideReferrer = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), tail));
  if (!besideReferrer.startsWith('../') && context.fileExists(besideReferrer)) return besideReferrer;
  const clean = tail.replace(/^(?:\.\.\/)+/, '');
  const candidates = (basenameIndex(context).get(clean.split('/').pop() ?? '') ?? []).filter(
    (f) => f === clean || f.endsWith('/' + clean)
  );
  if (candidates.length === 0) return null;
  candidates.sort((x, y) => sharedPrefix(y, fromFile) - sharedPrefix(x, fromFile));
  return candidates[0] ?? null;
}

export const scriptFilesResolver: FrameworkResolver = {
  name: 'script-files',
  languages: ['shell', 'r'],

  detect: () => true,

  claimsReference: (name) => name.startsWith(SCRIPT_REF_PREFIX),

  // R's `source()` paths are scanned here, not in the R extractor, because the
  // native kernel parses R and only framework extract hooks run on its output.
  extract(filePath, content) {
    if (detectLanguage(filePath) !== 'r') return { nodes: [], references: [] };
    return { nodes: [], references: rSourceScriptRefs(filePath, content) };
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (!ref.referenceName.startsWith(SCRIPT_REF_PREFIX)) return null;
    const file = resolveScriptFile(ref.referenceName.slice(SCRIPT_REF_PREFIX.length), ref.filePath, context);
    if (!file || file === ref.filePath) return null;
    const fileNode = context.getNodesInFile(file).find((n) => n.kind === 'file');
    if (!fileNode) return null;
    return { original: ref, targetNodeId: fileNode.id, confidence: 0.95, resolvedBy: 'file-path' };
  },
};
