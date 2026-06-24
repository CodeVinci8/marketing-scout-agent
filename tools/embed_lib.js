'use strict';
// embed_lib.js — shared composition helpers for embedding pure n8n/lib modules inside n8n Code nodes.
//
// n8n Code nodes run in a sandbox that cannot require() local files, so generators inline the library
// source. Two composition strategies are supported; pick by whether the node also carries hand-written glue
// that may declare its own helper identifiers:
//
//   * stripCore(src) — strip the leading 'use strict', the trailing module.exports, and local cross-require
//     lines, yielding a bare core whose top-level declarations land DIRECTLY in the node scope. Several libs
//     may be concatenated this way ONLY when their top-level identifiers are disjoint from each other AND
//     from the node glue. This is the legacy gen_stage4 pattern: cheap, but a shared identifier between two
//     embedded sources (or between a source and the glue) is a hard SyntaxError. Byte-identical to the old
//     inline libCore()/engineSource() strippers so it can replace them without changing generated output.
//
//   * isolatedModule(nsVar, strippedCore, exportNames) — wrap a module's STRIPPED core (use stripCore: no
//     'use strict', no module.exports, no local requires) in an IIFE assigned to a private namespace const.
//     The IIFE returns an EXPLICIT object literal of the declared exports (object shorthand, so it never
//     emits a literal `module.exports`), which is then destructured into the node scope. Every private
//     top-level constant of the module (e.g. MS_TZ) stays inside the IIFE and can NEVER collide with the
//     node's glue or another embedded module. This is the safe default when embedding a module alongside
//     glue that declares its own constants — it stops the "Identifier 'MS_TZ' has already been declared"
//     class of defect at its root.
//
// Both helpers are pure string transforms (no I/O) so they are trivially testable offline.

// Remove the trailing `module.exports = { ... };` block (keeps a leading newline so the core ends cleanly).
function stripExports(src) {
  return src.replace(/\nmodule\.exports[\s\S]*$/m, '\n');
}

// Drop `const { a, b } = require('./local');` lines — the dependency is embedded in the same scope.
function stripLocalRequires(src) {
  return src.replace(/^\s*const\s*\{[^}]*\}\s*=\s*require\('\.\/[^']+'\);\s*$/gm, '');
}

// stripCore: byte-identical to the historical gen_stage4 libCore() / QA engineSource() strippers.
function stripCore(src) {
  let s = src.replace(/^'use strict';\s*$/m, '');
  s = s.replace(/module\.exports[\s\S]*$/m, '');
  s = stripLocalRequires(s);
  return s.trim();
}

// isolatedModule: emit an IIFE that returns an explicit object of the declared exports, then destructure
// them into the surrounding node scope. `strippedCore` must already be stripCore()'d (no module.exports).
// `exportNames` MUST be the module's real export keys (deterministic ordering is enforced here by sorting);
// each must be a top-level binding in the core so object shorthand resolves it. Private top-level identifiers
// of the core (e.g. MS_TZ) remain inside the IIFE and cannot leak to the node scope.
function isolatedModule(nsVar, strippedCore, exportNames) {
  if (!/^[A-Za-z_$][\w$]*$/.test(nsVar)) throw new Error('isolatedModule: invalid namespace var: ' + nsVar);
  const names = (exportNames || []).slice().sort();
  if (!names.length) throw new Error('isolatedModule: refusing to embed a module with no exports (' + nsVar + ')');
  const bad = names.filter(function (n) { return !/^[A-Za-z_$][\w$]*$/.test(n); });
  if (bad.length) throw new Error('isolatedModule: invalid export identifier(s): ' + bad.join(', '));
  const core = String(strippedCore).trim();
  if (/\bmodule\.exports\b/.test(core)) throw new Error('isolatedModule: core must be stripped of module.exports first');
  return [
    'const ' + nsVar + ' = (function () {',
    "  'use strict';",
    core,
    '  return { ' + names.join(', ') + ' };',
    '})();',
    'const { ' + names.join(', ') + ' } = ' + nsVar + ';'
  ].join('\n');
}

module.exports = { stripCore, stripExports, stripLocalRequires, isolatedModule };
