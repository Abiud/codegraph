/**
 * References to project script FILES — `source lib.sh`, `bash scripts/x.sh`,
 * `Rscript "$ROOT/steps/run.R"`, R's `source("helpers.R")`, a Nextflow
 * process's `script:` block — rather than to symbols.
 *
 * Extractors emit these as unresolved refs named `script:<path tail>`; the
 * `script-files` framework resolver maps the tail to an indexed file node.
 * The prefix keeps a file name such as `helpers.R` from name-matching the
 * same-named import nodes, so an unresolvable path yields no edge at all.
 */

export const SCRIPT_REF_PREFIX = 'script:';

/** Extensions of files a script reference may name. */
const SCRIPT_EXTENSIONS = /\.(?:sh|bash|zsh|r|py|nf|pl|rb|jl)$/i;

/**
 * Reduce a script-path argument to the project-relative tail it names, or
 * null when it is not a static path to a script file.
 *
 *   ./lib/common.sh                    -> lib/common.sh
 *   "$SCRIPT_DIR/environment_meta.sh"  -> environment_meta.sh
 *   ${projectDir}/bin/run_de.R         -> bin/run_de.R
 *   '$ROOT'/scripts/x.sh               -> scripts/x.sh
 *
 * Everything up to the last variable expansion (`$X`, `${X}`, `$(…)`) is a
 * runtime location and is dropped; a path still containing an expansion,
 * whitespace, or a glob after that is dynamic and rejected.
 */
export function scriptPathTail(raw: string): string | null {
  let text = raw.trim().replace(/["']/g, '');
  const expansion = /\$(?:\{[^}]*\}|\([^)]*\)|[A-Za-z_][A-Za-z0-9_]*)\/?/g;
  let lastEnd = -1;
  for (let m = expansion.exec(text); m; m = expansion.exec(text)) lastEnd = m.index + m[0].length;
  if (lastEnd >= 0) text = text.slice(lastEnd);
  text = text.replace(/^(?:\.\/)+/, '').replace(/^\/+/, '');
  if (!text || /[\s$*?[\]{}()`;|&<>]/.test(text)) return null;
  if (!SCRIPT_EXTENSIONS.test(text)) return null;
  return text;
}

/** The unresolved-reference name for a script path argument, or null. */
export function scriptRefName(raw: string): string | null {
  const tail = scriptPathTail(raw);
  return tail ? SCRIPT_REF_PREFIX + tail : null;
}
