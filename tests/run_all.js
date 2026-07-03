// run_all.js — Stage C Hardening offline regression entrypoint ($0, no network, no paid APIs).
// Runs every JS suite + the Python workflow validator + the legacy Lead Scout harness. Usage:
//   node tests/run_all.js     (or)     make test
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const JS_SUITES = [
  // --- Release gate: every generated/committed n8n Code node must parse (catches the MS_TZ-class collision) ---
  ['generated-code-compiles', 'test_generated_code_compiles.js'],
  ['taxonomy', 'test_taxonomy.js'],
  ['semantic-contract', 'test_semantic_contract.js'],
  ['quality-gate', 'test_quality_gate.js'],
  ['wf16-node', 'test_wf16_node.js'],
  ['intake-gates', 'test_intake_gates.js'],
  // --- Stage C Closure Patch 2 workflow-level suites ---
  ['report-gate', 'test_report_gate.js'],
  ['lineage-e2e', 'test_lineage_e2e.js'],
  ['wf04-processed', 'test_wf04_processed.js'],
  ['wf04-accounting', 'test_wf04_accounting.js'],
  ['wf05-classify', 'test_wf05_classify.js'],
  ['wf09-searchcard', 'test_wf09_searchcard.js'],
  ['wf06-processed', 'test_wf06_processed.js'],
  ['wf07-cost', 'test_wf07_cost.js'],
  ['wf09-multiquery', 'test_wf09_multiquery.js'],
  ['wf10-source-health', 'test_wf10_source_health.js'],
  ['wf12-closure', 'test_wf12_closure.js'],
  // --- Stage C Runtime Patch 4: first real WF09 -> WF16 live execution regression ---
  ['wf16-runtime-searchcards', 'test_wf16_runtime_searchcards.js'],
  // --- Stage C Runtime Patch 5: WF09 Apify actor-input regression (string startUrls, query origin) ---
  ['wf09-actor-input', 'test_wf09_actor_input.js'],
  // --- Stage 3 closure: canonical identity/lineage contract + WF16 boolean fidelity ---
  ['lineage-contract', 'test_lineage_contract.js'],
  // --- Stage 3 closure: WF04 -> WF16 -> WF08 website source quality & analysis pipeline ---
  ['website-pipeline', 'test_website_pipeline.js'],
  // --- Stage 3 closure: production analysis/aggregation/reporting gates (WF05/06/08/09/10/12) ---
  ['stage3-gates', 'test_stage3_gates.js'],
  // --- Stage 5: guarded provider adapter contract (real runAdapter path + parsers + cost + acceptance) ---
  ['stage5-adapters', 'test_stage5_adapters.js'],
  // --- Stage 4: single-user Telegram agent MVP (libs + generated WF17-20) ---
  ['stage4-contracts', 'test_stage4_contracts.js'],
  ['stage4-workflows', 'test_stage4_workflows.js'],
  // --- DEC-161: WF18 rearchitecture — REAL n8n graph (fail-closed ingress + dispatcher + plan binding) ---
  ['wf18-real-topology', 'test_wf18_real_topology.js'],
  ['stage4-e2e', 'test_stage4_e2e.js'],
  ['stage4-freepath', 'test_stage4_freepath.js'],
  // --- Conversational agent: charter, intent router, bounded memory, sources ---
  ['agent-identity', 'test_agent_identity.js'],
  ['agent-contracts', 'test_agent_contracts.js'],
  ['agent-workflows', 'test_agent_workflows.js'],
  // --- Deep competitor analysis + conversation-aware orchestration reuse ---
  ['deep-analysis-contracts', 'test_deep_analysis_contracts.js'],
  ['deep-analysis-workflows', 'test_deep_analysis_workflows.js'],
  // --- Proactive delivery + scheduled tracked-source monitoring (WF23) ---
  ['monitoring', 'test_monitoring.js'],
  // --- Stage 7: change classification + digest + outbox retry/dead-letter + stalled detection + cleanup ---
  ['stage7-monitoring-e2e', 'test_stage7_monitoring_e2e.js'],
  ['agent-e2e', 'test_agent_e2e.js'],
  // --- Release hardening: n8n topology/trigger audit + persistence + delivery proof + full E2E ---
  ['release-audit', 'test_release_audit.js'],
  ['release-e2e', 'test_release_e2e.js'],
  ['ci-workflow', 'test_ci_workflow.js'],
  // --- Reporting UX phase: scoped CSV/XLSX/chart exports ---
  ['report-export', 'test_report_export.js'],
  ['xlsx-writer', 'test_xlsx_writer.js'],
  ['report-charts', 'test_report_charts.js'],
  // --- Reporting UX phase: evidence / compare / filtering / smart refresh ---
  ['evidence', 'test_evidence.js'],
  ['report-compare', 'test_report_compare.js'],
  ['report-filter', 'test_report_filter.js'],
  ['refresh-policy', 'test_refresh_policy.js'],
  // --- Reporting UX phase: scope/cost preview + progress UX + weekly digest ---
  ['scope-preview', 'test_scope_preview.js'],
  ['progress-tracker', 'test_progress_tracker.js'],
  ['weekly-digest', 'test_weekly_digest.js'],
  // --- Reporting UX phase: real n8n workflow integration (WF24 export/delivery, WF25 digest, WF19/WF20 wiring) ---
  ['reporting-workflows', 'test_reporting_workflows.js'],
  // --- Sources: bounded VK public-community collector (lib + WF26 + WF23 integration), fully offline ---
  ['vk-collector', 'test_vk_collector.js'],
  // --- Storage: sheets contract validator + runtime content auditor + before/after verifier + retention ---
  ['sheets-contracts', 'test_sheets_contracts.js'],
  // --- Safety: SSRF defense + prompt-injection guard + honest Telegram channel capability ---
  ['url-safety', 'test_url_safety.js'],
  // --- Capstone: full offline conversational E2E (request->preview->report->exports->VK->digest->audit) ---
  ['reporting-e2e', 'test_reporting_e2e.js'],
  // --- Stage 6: raw-records -> research_pipeline -> report -> real XLSX -> Telegram -> linked follow-up ---
  ['stage6-research-e2e', 'test_stage6_research_e2e.js'],
  // --- QA Stage 1/2 repair package (QA-001..QA-012) ---
  ['workflow-manifest', 'test_workflow_manifest.js'],
  ['binding-tool', 'test_binding_tool.js'],
  ['deploy-preflight', 'test_deploy_preflight.js'],
  ['telegram-commands', 'test_telegram_commands.js'],
  ['attachment-routing', 'test_attachment_routing.js'],
  ['smoke-hardening', 'test_smoke_hardening.js'],
  // --- Stage 3 Google Sheets staging bootstrap (resolver + pure planner + generated QA workflow) ---
  ['sheets-bootstrap', 'test_sheets_bootstrap.js'],
  // --- Stage 3C Google Sheets OPERATIONS acceptance (pure engine + generated manual QA workflow) ---
  ['sheets-operations-qa', 'test_sheets_operations_qa.js'],
  // --- Product timezone: Europe/Moscow system-timestamp helper (RFC3339 +03:00 / Russian display) ---
  ['ms-time', 'test_ms_time.js'],
  // --- Stage 8 release core: operator-local workflow id resolver (fail-closed, idempotent, sanitized) ---
  ['runtime-ids', 'test_runtime_ids.js'],
  // --- Stage 8 release core: shell safety + docker-only n8n execution abstraction (host/docker/dry/guard) ---
  ['release-shell', 'test_release_shell.js'],
  // --- Stage 8 release core: strict preflight (token/$env/tz/report-mode/webhook/secret + cross-field invariants) ---
  ['preflight-strict', 'test_preflight_strict.js'],
  // --- Stage 8 release core: operator scripts (backup/restore/webhook/lock) + sanitized release evidence ---
  ['release-scripts', 'test_release_scripts.js'],
  // --- Stage 8 release core: workflow/credential reconciliation (exact-name) + hard WF18 activation gate ---
  ['reconcile-and-gate', 'test_reconcile_and_gate.js'],
  // --- CRED-002: Docker-safe non-decrypted credential export — fails closed on every error path ---
  ['credential-export', 'test_credential_export.js'],
  // --- Stage 8 release core: end-to-end acceptance harness emitting honest §21 markers (CORE PASS; live PENDING) ---
  ['stage8-release-e2e', 'test_stage8_release_e2e.js'],
  // --- Stage 8 release INTEGRATION: ordered fail-closed planner + env discovery wired into the deploy path ---
  ['release-integration', 'test_release_integration.js'],
  // --- Stage 8 release INTEGRATION: staged workflow + credential reconciliation before import ---
  ['prepare-staged', 'test_prepare_staged.js'],
  // --- Stage 8 production discovery: status/inventory/check-config/binding-count (STATUS-001/CHECKCONFIG-001/etc) ---
  ['status-discovery', 'test_status_discovery.js'],
  // --- Stage 8 REAL shell entrypoints: clean-env sweep (no unbound vars; BLOCKER A) + host-stub credential-audit/dry-run ---
  ['deploy-entrypoints', 'test_deploy_entrypoints.js'],
  // --- OBS-001 / REPORT-001 REAL entrypoints: workflow-scoped WF18 credential metric + deferred-plan aggregate verdict ---
  ['obs-report-entrypoints', 'test_obs_report_entrypoints.js'],
  // --- Ingress: loopback path-filter reverse proxy exposes ONLY POST <webhook>; editor/REST/API are 404 (TELEGRAM-001) ---
  ['ingress-proxy', 'test_ingress_proxy.js'],
  // --- SHEETS-RATELIMIT-001: storm-free window-crossing Sheets retry + bounded exponential-jitter backoff ---
  ['sheets-retry-policy', 'test_sheets_retry_policy.js'],
  // --- Stage 4 runtime acceptance: offline validation of the disposable runtime fixtures (RUNTIME-ACCEPTANCE-001) ---
  ['runtime-acceptance', 'test_runtime_acceptance.js'],
  // --- DOCKER-COPY-PERM-001: copy-IN stays readable by the n8n runtime user under a restrictive umask (077) ---
  ['docker-copy-perms', 'test_docker_copy_perms.js'],
  // --- Stage 5/6/7 REAL committed-graph topology audit (adapters/sources, reporting, scheduled monitor/digest) ---
  ['stage567-topology', 'test_stage567_topology.js'],
  // --- CLAUDE-ENDPOINT-001: every runtime Claude node targets the aiprimetech gateway (never api.anthropic.com) ---
  ['claude-endpoint', 'test_claude_endpoint.js'],
  // --- RELEASE-SOURCE-PARITY-001: the content-parity verifier (prod export vs staged canonical) ---
  ['source-parity', 'test_source_parity.js'],
  // --- SHEETS-READ-AMPLIFICATION-001: bounded batchGet read projection + WF18 request budget ---
  ['sheets-access', 'test_sheets_access.js'],
  ['wf18-sheets-budget', 'test_wf18_sheets_budget.js'],
  // --- GOOGLE-HTTP-CREDENTIAL-001: batchGet predefined-cred durability (reconcile can't strip httpNode/scopes) ---
  ['google-http-credential', 'test_google_http_credential.js'],
  ['idempotency-persist', 'test_idempotency_persist.js'],
  // --- IDEMP-001: atomic append-then-verify claim (concurrent-safe without N8N_CONCURRENCY=1) ---
  ['idempotency-claim', 'test_idempotency_claim.js'],
  // --- UX-RU-001: single humanized Russian approval message, no internal enums, zero-source fail-closed ---
  ['plan-render-ru', 'test_plan_render_ru.js'],
  ['ux-messages-ru', 'test_ux_messages_ru.js'],
  ['llm-ru-guard', 'test_llm_ru_guard.js'],
];

let failed = 0;
const summary = [];

function runNode(file) {
  try {
    const out = execFileSync('node', [path.join(__dirname, file)], { encoding: 'utf8' });
    const m = out.match(/(\d+) passed, (\d+) failed/);
    process.stdout.write(out);
    const pass = m ? m[1] : '?', fl = m ? m[2] : '?';
    const ok = m && m[2] === '0';
    if (!ok) failed++;
    return [pass, fl, ok ? 'PASS' : 'FAIL'];
  } catch (e) {
    process.stdout.write((e.stdout || '') + '\n  (exit non-zero)\n');
    failed++;
    return ['?', '?', 'FAIL'];
  }
}

for (const [label, file] of JS_SUITES) {
  const [p, f, st] = runNode(file);
  summary.push([label, p, f, st]);
}

// Python workflow validator
try {
  const out = execFileSync('python3', [path.join(__dirname, '..', 'scripts', 'validate_workflows.py')], { encoding: 'utf8' });
  process.stdout.write(out);
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const ok = m && m[2] === '0';
  if (!ok) failed++;
  summary.push(['validate_workflows.py', m ? m[1] : '?', m ? m[2] : '?', ok ? 'PASS' : 'FAIL']);
} catch (e) {
  process.stdout.write((e.stdout || '') + '\n  (python validator exit non-zero)\n');
  failed++;
  summary.push(['validate_workflows.py', '?', '?', 'FAIL']);
}

// Sheets contract validator (static: every workflow Sheets node targets a declared tab; no drift).
try {
  const out = execFileSync('node', [path.join(__dirname, '..', 'tools', 'validate_sheet_contracts.js')], { encoding: 'utf8' });
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const ok = m && m[2] === '0';
  if (!ok) { failed++; process.stdout.write(out); }
  summary.push(['validate_sheet_contracts', m ? m[1] : '?', m ? m[2] : '?', ok ? 'PASS' : 'FAIL']);
} catch (e) {
  process.stdout.write((e.stdout || '') + '\n  (sheet contract validator exit non-zero)\n');
  failed++;
  summary.push(['validate_sheet_contracts', '?', '?', 'FAIL']);
}

// Stage 3 sheets bootstrap: contract resolver + generated QA workflow must be drift-free.
try {
  execFileSync('node', [path.join(__dirname, '..', 'n8n', 'lib', 'sheets_contract_resolver.js')], { encoding: 'utf8' });
  execFileSync('node', [path.join(__dirname, '..', 'tools', 'gen_sheets_bootstrap_workflow.js'), '--check'], { encoding: 'utf8' });
  summary.push(['sheets_bootstrap_gen (drift)', 'ok', '0', 'PASS']);
} catch (e) {
  process.stdout.write((e.stdout || '') + (e.stderr || '') + '\n  (sheets bootstrap resolver/generator drift)\n');
  failed++;
  summary.push(['sheets_bootstrap_gen (drift)', '?', '?', 'FAIL']);
}

// Stage 3C sheets operations acceptance: generated manual QA workflow must be drift-free.
try {
  execFileSync('node', [path.join(__dirname, '..', 'tools', 'gen_sheets_operations_qa_workflow.js'), '--check'], { encoding: 'utf8' });
  summary.push(['sheets_ops_qa_gen (drift)', 'ok', '0', 'PASS']);
} catch (e) {
  process.stdout.write((e.stdout || '') + (e.stderr || '') + '\n  (sheets operations QA generator drift)\n');
  failed++;
  summary.push(['sheets_ops_qa_gen (drift)', '?', '?', 'FAIL']);
}

// Legacy Lead Scout harness (WF12/13/14) — must remain green.
try {
  const out = execFileSync('node', [path.join(__dirname, '..', 'n8n', 'fixtures', 'lead_scout', 'run_all.js')], { encoding: 'utf8' });
  const m = out.match(/ALL SUITES PASS/);
  if (!m) failed++;
  summary.push(['lead_scout (WF12/13/14)', m ? 'all' : '?', m ? '0' : '?', m ? 'PASS' : 'FAIL']);
} catch (e) {
  failed++;
  summary.push(['lead_scout (WF12/13/14)', '?', '?', 'FAIL']);
}

console.log('\n================ STAGE C HARDENING — REGRESSION SUMMARY ================');
for (const [label, p, f, st] of summary) {
  console.log('  [' + st + ']  ' + String(label).padEnd(26) + '  passed=' + p + ' failed=' + f);
}
console.log('  ' + (failed ? failed + ' SUITE(S) FAILED' : 'ALL SUITES PASS') + '   (external calls=0, live cost=$0)');
process.exit(failed ? 1 : 0);
