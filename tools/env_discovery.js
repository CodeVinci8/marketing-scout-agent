// env_discovery.js — effective n8n configuration discovery for the release path (CONFIG/PREFLIGHT defect, §6).
//
// The original preflight inspected ONLY the current shell environment (process.env), so a production dry-run
// reported required variables as missing even though they were present in the running Docker container or the
// compose env_file. This module discovers the EFFECTIVE configuration the running n8n actually sees, from up to
// four sources, and feeds it to tools/preflight_config.js — without ever printing a secret value.
//
// Sources (MS_ENV_SOURCE):
//   file      — an explicit env file (MS_ENV_FILE, default /opt/n8n/n8n.env) or a compose env_file.
//   container — the running container's effective environment (`docker exec <c> env`).
//   process   — the current shell environment (process.env).
//   auto      — inspect, in order: explicit env file -> compose env_file -> running container -> process env,
//               and compare file vs container so a material disagreement is surfaced.
//
// Safety: secret-ish values are NEVER printed — the human/CLI report shows only SET/MISSING, a safe length, and a
// fingerprint (fp_<sha10>) so two sources can be compared without revealing the value. The in-process effective
// env object (which DOES carry real values) is returned only to the caller so it can be handed to the preflight,
// which itself emits masked verdicts. Pure parse/merge logic is unit-testable; docker is shelled only on demand.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// Keys whose VALUES must never be shown anywhere (only set/length/fingerprint).
const SECRET_KEYS = /token|secret|encryption_key|spreadsheet|user_id|user_ids|password|api_key|webhook_secret/i;

// The configuration keys the release path cares about (non-secret + secret). Drives the comparison report.
const KEYS_OF_INTEREST = [
  // required for inactive deploy
  'MS_SPREADSHEET_ID', 'MS_TELEGRAM_ALLOWED_USER_IDS',
  // n8n Code-node runtime (must be present for the gateway to work)
  'N8N_BLOCK_ENV_ACCESS_IN_NODE', 'NODE_FUNCTION_ALLOW_BUILTIN',
  // activation-critical
  'MS_TELEGRAM_BOT_TOKEN', 'MS_TELEGRAM_WEBHOOK_SECRET', 'PUBLIC_WEBHOOK_BASE_URL', 'WEBHOOK_URL',
  // zero-paid profile flags
  'MS_ENABLE_TELEGRAM', 'MS_ENABLE_EXTERNAL_ACTIONS', 'MS_ENABLE_APIFY', 'MS_ENABLE_FIRECRAWL', 'MS_ENABLE_VK',
  'MS_ENABLE_CLAUDE', 'MS_ENABLE_LLM_PLANNER', 'MS_ENABLE_LLM_SUMMARY', 'MS_REQUIRE_APPROVAL',
  'MS_REQUIRE_SOURCE_HEALTH', 'MS_MONITORING_ENABLED', 'MS_WEEKLY_DIGEST_ENABLED', 'MS_SOURCE_BUDGET_USD',
  'MS_LLM_BUDGET_USD', 'MS_MAX_EXTERNAL_CALLS', 'MS_MAX_SOURCES', 'MS_MAX_ITEMS_PER_SOURCE',
  'MS_SOURCE_ALLOWLIST', 'MS_TIMEZONE', 'MS_REPORT_DATA_MODE'
];

function fp(v) { return v == null || v === '' ? 'fp_none' : 'fp_' + crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 10); }
function isSecretKey(k) { return SECRET_KEYS.test(String(k)); }

// Parse a dotenv-style file body into { KEY: VALUE }. Tolerates `export `, inline `#` comments only when not
// inside quotes, and single/double-quoted values. Returns only the parsed map (no I/O).
function parseEnvFile(text) {
  const env = {};
  for (let raw of String(text == null ? '' : text).split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = line.slice(eq + 1);
    // strip a trailing inline comment only when the value is unquoted
    const q = val.trim()[0];
    if (q === '"' || q === "'") {
      const m = val.trim().match(new RegExp('^' + q + '([^' + q + ']*)' + q));
      val = m ? m[1] : val.trim().slice(1);
    } else {
      const h = val.indexOf(' #');
      if (h >= 0) val = val.slice(0, h);
      val = val.trim();
    }
    env[key] = val;
  }
  return env;
}

// Parse the output of `env` / `docker exec <c> env` (KEY=VALUE per line; values may contain `=`).
function parseEnvCommand(text) {
  const env = {};
  for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
    const eq = raw.indexOf('=');
    if (eq <= 0) continue;
    const key = raw.slice(0, eq);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    env[key] = raw.slice(eq + 1);
  }
  return env;
}

// describe one value for the sanitized report.
function describe(v) {
  const set = !(v == null || v === '');
  return { set: set, length: set ? String(v).length : 0, fingerprint: fp(v) };
}

// Build the sanitized comparison report + the in-memory effective env (real values, NEVER printed by the CLI).
// sources: { file?: {KEY:VAL}, container?: {KEY:VAL}, process?: {KEY:VAL} }  (any subset, in precedence order).
// effective precedence: container > file > process (the container is what n8n actually runs with).
function buildReport(sources, opts) {
  sources = sources || {};
  opts = opts || {};
  const present = {};
  ['container', 'file', 'process'].forEach(s => { if (sources[s]) present[s] = sources[s]; });
  const sourceNames = Object.keys(present);

  const effective = {};
  const effectiveFrom = {};
  // precedence order
  const order = ['container', 'file', 'process'].filter(s => present[s]);
  const allKeys = new Set(KEYS_OF_INTEREST);
  for (const s of order) for (const k of Object.keys(present[s])) allKeys.add(k);
  for (const k of allKeys) {
    for (const s of order) {
      const v = present[s][k];
      if (v != null && v !== '') { effective[k] = v; effectiveFrom[k] = s; break; }
    }
  }

  // per-key comparison across sources (for KEYS_OF_INTEREST only, to keep the report bounded)
  const keys = [];
  const mismatches = [];
  for (const k of KEYS_OF_INTEREST) {
    const perSource = {};
    for (const s of order) perSource[s] = describe(present[s][k]);
    // material disagreement: file and container both set but different fingerprints
    if (present.file && present.container) {
      const fv = present.file[k], cv = present.container[k];
      const fSet = fv != null && fv !== '', cSet = cv != null && cv !== '';
      if (fSet && cSet && fp(fv) !== fp(cv)) mismatches.push({ key: k, secret: isSecretKey(k), file_fp: fp(fv), container_fp: fp(cv) });
    }
    keys.push({
      key: k, secret: isSecretKey(k),
      effective_set: !!(effective[k] != null && effective[k] !== ''),
      effective_source: effectiveFrom[k] || null,
      sources: perSource
    });
  }

  return {
    schema: 'marketing-scout/env-discovery/v1',
    sources_present: sourceNames,
    effective_precedence: order,
    keys: keys,
    mismatches: mismatches,
    agree: mismatches.length === 0,
    effective: effective,          // real values — caller-only; CLI never prints this
    effective_from: effectiveFrom
  };
}

// --- on-demand collectors (I/O; used by the CLI, kept out of the pure path) ---
function readEnvFile(file) {
  try { if (file && fs.existsSync(file)) return parseEnvFile(fs.readFileSync(file, 'utf8')); } catch (e) { void e; }
  return null;
}
// Read the running container env via docker exec (never in dry mode; empty on any failure).
function readContainerEnv(container) {
  if (process.env.MS_N8N_EXEC_DRY === '1') return null;
  if (!container) return null;
  try {
    const out = execFileSync('docker', ['exec', container, 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return parseEnvCommand(out);
  } catch (e) { void e; return null; }
}
// Resolve a compose env_file path (best-effort) for the 'auto' source. Returns the first existing candidate.
function findComposeEnvFile() {
  const candidates = ['/opt/n8n/n8n.env', '/opt/n8n/.env'];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (e) { void e; } }
  return null;
}

// Collect sources per MS_ENV_SOURCE policy and build the report. opts: { source, envFile, container }.
function discover(opts) {
  opts = opts || {};
  const source = opts.source || process.env.MS_ENV_SOURCE || 'auto';
  const envFile = opts.envFile || process.env.MS_ENV_FILE || '';
  const container = opts.container || process.env.MS_N8N_CONTAINER || 'n8n-n8n-1';
  const sources = {};
  const notes = [];

  function addFile(label) {
    const f = envFile || findComposeEnvFile();
    if (f) { const e = readEnvFile(f); if (e) { sources.file = e; notes.push(label + ': ' + path.basename(f) + ' (' + Object.keys(e).length + ' keys)'); return true; } notes.push(label + ': ' + f + ' unreadable'); }
    else notes.push(label + ': no env file found');
    return false;
  }
  function addContainer(label) {
    const e = readContainerEnv(container);
    if (e) { sources.container = e; notes.push(label + ': container ' + container + ' (' + Object.keys(e).length + ' keys)'); return true; }
    notes.push(label + ': container ' + container + ' env unavailable');
    return false;
  }

  if (source === 'file') { addFile('file'); }
  else if (source === 'container') { addContainer('container'); }
  else if (source === 'process') { sources.process = Object.assign({}, process.env); notes.push('process: shell env'); }
  else { // auto
    addFile('auto.file');
    addContainer('auto.container');
    sources.process = Object.assign({}, process.env); notes.push('auto.process: shell env (fallback)');
  }

  const report = buildReport(sources, { source });
  report.requested_source = source;
  report.notes = notes;
  return report;
}

module.exports = {
  parseEnvFile, parseEnvCommand, buildReport, describe, discover, fp, isSecretKey,
  SECRET_KEYS, KEYS_OF_INTEREST
};

// Print a SANITIZED report (no secret values, ever). The effective env object is intentionally omitted.
function printReport(rep) {
  console.log('Environment discovery (requested source: ' + rep.requested_source + ')');
  (rep.notes || []).forEach(n => console.log('  · ' + n));
  console.log('  sources present  : ' + (rep.sources_present.join(', ') || '(none)'));
  console.log('  effective order  : ' + (rep.effective_precedence.join(' > ') || '(none)'));
  for (const k of rep.keys) {
    const eff = k.effective_set ? ('SET via ' + k.effective_source + ' len=' + (k.sources[k.effective_source] ? k.sources[k.effective_source].length : '?')) : 'MISSING';
    console.log('  [' + (k.effective_set ? 'ok ' : '   ') + '] ' + k.key.padEnd(30) + ' ' + eff + (k.secret ? '  (secret: value never shown)' : ''));
  }
  if (rep.mismatches.length) {
    console.log('MATERIAL DISAGREEMENT (env file vs container):');
    rep.mismatches.forEach(m => console.log('  - ' + m.key + ': file=' + m.file_fp + ' container=' + m.container_fp + (m.secret ? ' (secret)' : '')));
  }
  console.log('ENV_SOURCES=' + (rep.sources_present.join(',') || 'none'));
  console.log('ENV_AGREEMENT=' + (rep.agree ? 'PASS' : 'MISMATCH'));
  console.log('ENV_DISCOVERY=' + (rep.sources_present.length ? 'PASS' : 'EMPTY'));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const rep = discover({ source: val('--source'), envFile: val('--env-file'), container: val('--container') });
  if (args.indexOf('--json') >= 0) {
    // JSON output omits the effective real-value map; only the sanitized report is serialized.
    const safe = Object.assign({}, rep); delete safe.effective; delete safe.effective_from;
    console.log(JSON.stringify(safe, null, 2));
  } else {
    printReport(rep);
  }
  // Non-zero only if a material disagreement was found AND --strict was requested.
  const strict = args.indexOf('--strict') >= 0;
  process.exit(strict && !rep.agree ? 1 : 0);
}
