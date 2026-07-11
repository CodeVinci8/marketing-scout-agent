'use strict';
// test_deterministic_run.js — DETERMINISTIC-RUN-001: WF20 may accept a caller override that forces the paid LLM
// features OFF (fail-safe direction ONLY) so a bounded/deterministic orchestration run never touches the Stage-F
// Claude endpoint. The override can NEVER enable an LLM feature and NEVER weakens the allowlist / budgets /
// approval / any fail-closed gate.
const A = require('./_assert');
const CFG = require('../n8n/lib/agent_config.js');

const LLM_ENV = { MS_SPREADSHEET_ID: 'S', MS_TELEGRAM_ALLOWED_USER_IDS: '111', MS_ENABLE_CLAUDE: 'true', MS_ENABLE_LLM_SUMMARY: 'true', MS_ENABLE_LLM_ANALYSIS: 'true', MS_ENABLE_EXTERNAL_ACTIONS: 'true', MS_ENABLE_TELEGRAM_COLLECTOR: 'true', MS_SOURCE_ALLOWLIST: 'website,telegram', MS_MAX_EXTERNAL_CALLS: '25', MS_SOURCE_BUDGET_USD: '5' };

A.section('resolveConfig — baseline: prod-like env has LLM summary + analysis ON');
const base = CFG.resolveConfig(LLM_ENV);
A.eq('summary on', base.enable_llm_summary, true);
A.eq('analysis on', base.enable_llm_analysis, true);
A.eq('claude on', base.enable_claude, true);

A.section('override forces LLM OFF (fail-safe) without touching any other gate');
const det = CFG.resolveConfig(LLM_ENV, { enable_llm_summary: false, enable_llm_analysis: false });
A.eq('summary forced off', det.enable_llm_summary, false);
A.eq('analysis forced off', det.enable_llm_analysis, false);
A.eq('claude master switch UNCHANGED (still true)', det.enable_claude, true);
A.eq('allowlist UNCHANGED', det.source_allowlist.join(','), 'website,telegram');
A.eq('external-actions UNCHANGED', det.enable_external_actions, true);
A.eq('source budget UNCHANGED', det.source_budget_usd, 5);
A.eq('max external calls UNCHANGED', det.effective_max_external_calls, 25);
A.eq('approval requirement UNCHANGED (fail-closed default)', det.require_approval, true);
A.eq('source-health requirement UNCHANGED', det.require_source_health, true);

A.section('the override cannot FAIL OPEN — a would-be enable is neutralized when claude is off');
const noClaude = CFG.resolveConfig({ MS_SPREADSHEET_ID: 'S', MS_TELEGRAM_ALLOWED_USER_IDS: '111' }, { enable_llm_summary: true, enable_llm_analysis: true });
A.eq('summary stays off (no claude)', noClaude.enable_llm_summary, false);
A.eq('analysis stays off (no claude)', noClaude.enable_llm_analysis, false);

A.section('WF20 Resolve Agent Config wires the fail-safe override (generator drift-proof)');
const gen = require('../tools/gen_stage4_workflows.js');
function node(file, name) { const w = (gen.generated || []).find(g => g.file === file).workflow; return w.nodes.find(n => n.name === name); }
const cfgNode = node('20_agent_orchestrator.json', 'Resolve Agent Config');
const js = cfgNode.parameters.jsCode;
A.ok('reads caller input', /callerInput\(\)/.test(js));
A.ok('maps enable_llm_summary ONLY in the false direction', /String\(__ci\.enable_llm_summary\)==='false'/.test(js) && js.indexOf("__ci.enable_llm_summary)==='true'") < 0);
A.ok('maps enable_llm_analysis ONLY in the false direction', /String\(__ci\.enable_llm_analysis\)==='false'/.test(js) && js.indexOf("__ci.enable_llm_analysis)==='true'") < 0);
A.ok('passes overrides to resolveConfig', /resolveConfig\(__env,__ov\)/.test(js));
const trig = node('20_agent_orchestrator.json', 'When Called by Agent');
const inputs = (trig.parameters.workflowInputs.values || []).map(v => v.name);
A.ok('trigger declares enable_llm_summary input', inputs.indexOf('enable_llm_summary') >= 0);
A.ok('trigger declares enable_llm_analysis input', inputs.indexOf('enable_llm_analysis') >= 0);

A.report('deterministic-run');
