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
	node tests/test_ci_workflow.js

test-wf:
	python3 scripts/validate_workflows.py
