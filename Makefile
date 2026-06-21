# Marketing Scout Agent — offline regression ($0, no network, no paid APIs).
.PHONY: test test-js test-wf test-taxonomy help

help:
	@echo "make test         # full offline regression (JS suites + workflow validator + lead-scout harness)"
	@echo "make test-js      # semantic + quality-gate + WF16 + intake-gate JS suites"
	@echo "make test-wf      # workflow JSON validator + secret-leak scan"

test:
	node tests/run_all.js

test-js:
	node tests/test_taxonomy.js
	node tests/test_semantic_contract.js
	node tests/test_quality_gate.js
	node tests/test_wf16_node.js
	node tests/test_intake_gates.js
	node tests/test_report_gate.js
	node tests/test_lineage_e2e.js
	node tests/test_wf04_processed.js
	node tests/test_wf04_accounting.js
	node tests/test_wf05_classify.js
	node tests/test_wf09_searchcard.js
	node tests/test_wf06_processed.js
	node tests/test_wf07_cost.js
	node tests/test_wf09_multiquery.js
	node tests/test_wf10_source_health.js
	node tests/test_wf12_closure.js
	node tests/test_wf16_runtime_searchcards.js
	node tests/test_wf09_actor_input.js
	node tests/test_lineage_contract.js
	node tests/test_website_pipeline.js
	node tests/test_stage3_gates.js
	node tests/test_stage4_contracts.js
	node tests/test_stage4_workflows.js
	node tests/test_stage4_e2e.js
	node tests/test_agent_contracts.js
	node tests/test_agent_workflows.js
	node tests/test_deep_analysis_contracts.js
	node tests/test_deep_analysis_workflows.js
	node tests/test_monitoring.js
	node tests/test_agent_e2e.js
	node tests/test_release_audit.js
	node tests/test_release_e2e.js
	node tests/test_ci_workflow.js
	node tests/test_report_export.js
	node tests/test_xlsx_writer.js
	node tests/test_report_charts.js
	node tests/test_evidence.js
	node tests/test_report_compare.js
	node tests/test_report_filter.js
	node tests/test_refresh_policy.js
	node tests/test_scope_preview.js
	node tests/test_progress_tracker.js
	node tests/test_weekly_digest.js
	node tests/test_reporting_workflows.js
	node tests/test_vk_collector.js
	node tests/test_sheets_contracts.js
	node tests/test_url_safety.js

test-wf:
	python3 scripts/validate_workflows.py
