import type { Node as SyntaxNode } from 'web-tree-sitter';
import { getNodeText, getChildByField } from '../tree-sitter-helpers';
import type { LanguageExtractor, ExtractorContext } from '../tree-sitter-types';
import { scriptRefName } from '../script-refs';

/**
 * Nextflow (DSL2) extractor, on nextflow-io/tree-sitter-nextflow.
 *
 *   - processes, named workflows, and `def` functions extract as functions;
 *     the unnamed entry `workflow { … }` contributes its calls to the file.
 *   - `include { A; B as C } from './modules/x'` → one import node per item
 *     plus a `script:` reference to the module file (`x.nf` or `x/main.nf`).
 *     A call through an alias (`C(...)`) is recorded against the included
 *     name (`B`), so it resolves to the real process.
 *   - a process's `script:`/`stub:` text is scanned for the scripts it runs —
 *     `Rscript x.R`, `python3 ${projectDir}/bin/x.py`, `bash x.sh`, a bare
 *     `bin/` script such as `run_de.R --opts`, and `template 'x.sh'` — each a
 *     `calls` reference to the script FILE (see extraction/script-refs.ts).
 *   - process directives and input/output declarations (`label`, `path`,
 *     `publishDir`, …) are DSL configuration, not calls, and are skipped.
 */

const DEFINITIONS = new Set(['process_definition', 'workflow_definition', 'function_definition']);
const SCRIPT_SECTIONS = new Set(['script_section', 'stub_section']);
const CONFIG_SECTIONS = new Set(['input_section', 'output_section', 'topic_section', 'stage_section']);

/** An interpreter followed by the script it runs, or a script run directly as a command. */
const SCRIPT_RUN =
  /(?:^|[\s;|&(])(?:Rscript|python3?|bash|sh|zsh|perl)\s+(?:-{1,2}[\w-]+(?:=\S+)?\s+)*([^\s;|&()'"]+)|(?:^|[;|&(]\s*|\n\s*)([^\s;|&()'"]+\.(?:R|r|py|sh|pl))(?=\s|$)/g;

/** Script files a process's script text runs. */
export function scriptRunsIn(text: string): string[] {
  const refs: string[] = [];
  SCRIPT_RUN.lastIndex = 0;
  for (let m = SCRIPT_RUN.exec(text); m; m = SCRIPT_RUN.exec(text)) {
    const ref = scriptRefName(m[1] ?? m[2] ?? '');
    if (ref && !refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

function addRef(ctx: ExtractorContext, node: SyntaxNode, referenceName: string, referenceKind: 'calls' | 'imports'): void {
  const fromNodeId = ctx.nodeStack[ctx.nodeStack.length - 1];
  if (!fromNodeId) return;
  ctx.addUnresolvedReference({
    fromNodeId,
    referenceName,
    referenceKind,
    line: node.startPosition.row + 1,
    column: node.startPosition.column,
  });
}

function stringValue(node: SyntaxNode | null, source: string): string | null {
  if (!node || node.type !== 'string') return null;
  return getNodeText(node, source).replace(/^(["'])\1?\1?|(["'])\2?\2?$/g, '');
}

function visitChildren(node: SyntaxNode, ctx: ExtractorContext): void {
  for (const child of node.namedChildren) if (child) ctx.visitNode(child);
}

function extractInclude(node: SyntaxNode, ctx: ExtractorContext): void {
  const source = ctx.source;
  for (const item of node.namedChildren) {
    if (item?.type !== 'include_item') continue;
    const name = getChildByField(item, 'name');
    if (!name) continue;
    const alias = getChildByField(item, 'alias');
    const original = getNodeText(name, source);
    ctx.createNode('import', alias ? getNodeText(alias, source) : original, item, {
      signature: alias ? `${original} as ${getNodeText(alias, source)}` : original,
    });
  }
  const from = stringValue(getChildByField(node, 'source'), source);
  if (!from || !/^\.{1,2}\//.test(from)) return; // plugin includes (`plugin/nf-schema`) name no file
  const ref = scriptRefName(/\.nf$/.test(from) ? from : `${from}.nf`);
  if (ref) addRef(ctx, node, ref, 'imports');
}

/** The included name behind a call through an `include { X as Alias }` alias. */
function aliasedName(callee: string, ctx: ExtractorContext): string | null {
  for (const n of ctx.nodes) {
    if (n.kind === 'import' && n.name === callee && n.signature?.endsWith(` as ${callee}`)) {
      return n.signature.slice(0, -` as ${callee}`.length);
    }
  }
  return null;
}

export const nextflowExtractor: LanguageExtractor = {
  functionTypes: [], // processes, workflows, and functions — handled in visitNode
  classTypes: [],
  methodTypes: [],
  interfaceTypes: [],
  structTypes: [],
  enumTypes: [],
  typeAliasTypes: [],
  importTypes: [], // include declarations — handled in visitNode
  callTypes: ['call_expression', 'command_expression'],
  variableTypes: [],
  nameField: 'name',
  bodyField: 'body',
  paramsField: 'parameters',

  visitNode: (node, ctx) => {
    const source = ctx.source;

    if (node.type === 'include_declaration') {
      extractInclude(node, ctx);
      return true;
    }

    if (DEFINITIONS.has(node.type)) {
      const name = getChildByField(node, 'name');
      if (!name) return false; // entry workflow: calls attach to the file
      const params = getChildByField(node, 'parameters');
      const fn = ctx.createNode('function', getNodeText(name, source), node, {
        signature: params ? getNodeText(params, source) : undefined,
      });
      if (!fn) return true;
      ctx.pushScope(fn.id);
      visitChildren(node, ctx);
      ctx.popScope();
      return true;
    }

    if (CONFIG_SECTIONS.has(node.type)) return true;

    if (SCRIPT_SECTIONS.has(node.type)) {
      for (const ref of scriptRunsIn(getNodeText(node, source))) addRef(ctx, node, ref, 'calls');
      visitChildren(node, ctx); // `template 'x.sh'` and Groovy logic before the script string
      return true;
    }

    if (node.type === 'command_expression' || node.type === 'call_expression') {
      const fn = getChildByField(node, 'function');
      if (fn?.type !== 'identifier') return false;
      const callee = getNodeText(fn, source);
      const args = getChildByField(node, 'arguments');
      if (callee === 'template') {
        const file = stringValue(args?.namedChildren[0] ?? null, source);
        const ref = file ? scriptRefName(`templates/${file}`) : null;
        if (ref) addRef(ctx, node, ref, 'calls');
        return true;
      }
      // Directives inside a process body (`label 'big'`, `publishDir …`).
      if (node.type === 'command_expression' && node.parent?.parent?.type === 'process_definition') return true;
      const original = aliasedName(callee, ctx);
      if (original) {
        addRef(ctx, node, original, 'calls');
        if (args) ctx.visitNode(args);
        return true;
      }
    }

    return false;
  },
};
