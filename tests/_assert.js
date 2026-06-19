// _assert.js — tiny zero-dependency assertion kit for the Stage C offline regression suites.
'use strict';
const RESULTS = [];
function ok(label, cond, detail) { RESULTS.push({ ok: !!cond, label, detail }); return !!cond; }
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  RESULTS.push({ ok: okk, label, detail: okk ? undefined : ('got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)) });
  return okk;
}
function includes(label, arr, val) { return ok(label, Array.isArray(arr) && arr.indexOf(val) >= 0, 'arr=' + JSON.stringify(arr) + ' missing=' + JSON.stringify(val)); }
function section(title) { RESULTS.push({ section: title }); }
function report(title) {
  let pass = 0, fail = 0;
  const lines = ['\n===== ' + title + ' ====='];
  for (const r of RESULTS) {
    if (r.section) { lines.push('\n-- ' + r.section + ' --'); continue; }
    if (r.ok) { pass++; lines.push('  PASS  ' + r.label); }
    else { fail++; lines.push('  FAIL  ' + r.label + (r.detail ? ('\n        ' + r.detail) : '')); }
  }
  lines.push('\n  ' + title + ': ' + pass + ' passed, ' + fail + ' failed');
  console.log(lines.join('\n'));
  process.exit(fail ? 1 : 0);
}
module.exports = { ok, eq, includes, section, report };
