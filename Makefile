# Marketing Scout Agent — offline regression ($0, no network, no paid APIs).
.PHONY: test test-js test-wf test-taxonomy help \
	release-help release-discovery release-setup-check release-preflight release-preflight-activate \
	release-core-acceptance release-backup release-restore-validate release-smoke \
	deploy-dry-run deploy-inactive verify-production wf18-gate \
	telegram-prelive telegram-activate telegram-deactivate rollback \
	release-lock-status release-clean

help:
	@echo "make test         # full offline regression (JS suites + workflow validator + lead-scout harness)"
	@echo "make test-js      # semantic + quality-gate + WF16 + intake-gate JS suites"
	@echo "make test-wf      # workflow JSON validator + secret-leak scan"
	@echo "make release-help # the Stage 8 release-core operator interface"

# ---- Stage 8 release-core operator interface (RELEASE-002): one unified, documented path ----
# Mutating/live targets honor dry-run defaults and the WF18 gate; activation is always a separate explicit step.
release-help:
	@echo "Stage 8 release-core operator interface (each step prints machine-readable PASS/FAIL markers):"
	@echo "  make release-discovery        # manifest plan + runtime-id coverage + git state (read-only)"
	@echo "  make release-setup-check      # validate env profile (non-secret) — fail-closed preflight"
	@echo "  make release-preflight        # fail-closed runtime config preflight"
	@echo "  make release-preflight-activate # activation-strict preflight (token/webhook/secret/\$$env/zlib)"
	@echo "  make release-core-acceptance  # offline Stage 8 release-core acceptance (honest markers)"
	@echo "  make release-backup           # backup DRY-RUN (entrypoint-overriding plan; writes nothing)"
	@echo "  make release-restore-validate BACKUP_DIR=/path  # validate a backup is restorable (offline + disposable)"
	@echo "  make release-smoke            # disposable n8n import/reimport/bind/verify (SKIP without docker)"
	@echo "  make deploy-dry-run           # validate + preflight + print the full import/bind plan (no changes)"
	@echo "  make deploy-inactive          # import the 15 runtime workflows INACTIVE + auto-bind (operator)"
	@echo "  make verify-production        # status + binding verification against the live export (operator)"
	@echo "  make wf18-gate                # check the hard WF18 pre-live blocker gate"
	@echo "  make telegram-prelive         # read-only Telegram pre-live checks (getWebhookInfo; activation preflight)"
	@echo "  make telegram-activate        # GATED: publish WF18 + register webhook (separate explicit step)"
	@echo "  make telegram-deactivate / make rollback  # unpublish WF18 + delete webhook"
	@echo "  make release-lock-status / make release-clean"

release-discovery:
	node tools/manifest_lib.js plan-json
	-node tools/runtime_ids.js status
	git status --short || true

release-setup-check:
	node tools/preflight_config.js --json --soft

release-preflight:
	node tools/preflight_config.js

release-preflight-activate:
	node tools/preflight_config.js --for-activation --require-zlib

release-core-acceptance:
	node tests/test_stage8_release_e2e.js

release-backup:
	scripts/backup.sh --dry-run

release-restore-validate:
	scripts/restore_validate.sh --dir "$(BACKUP_DIR)"

release-smoke:
	scripts/n8n_disposable_e2e.sh

deploy-dry-run:
	scripts/deploy_n8n.sh --dry-run

deploy-inactive:
	scripts/deploy_n8n.sh --apply --yes

verify-production:
	scripts/deploy_n8n.sh --status
	scripts/deploy_n8n.sh --verify-bindings

wf18-gate:
	node tools/wf18_activation_gate.js

telegram-prelive:
	node tools/preflight_config.js --for-activation --require-zlib
	scripts/telegram_webhook.sh info

telegram-activate:
	scripts/deploy_n8n.sh --activate-triggers
	scripts/telegram_webhook.sh set --apply

telegram-deactivate:
	scripts/deploy_n8n.sh --deactivate-triggers
	scripts/telegram_webhook.sh delete --apply

rollback: telegram-deactivate

release-lock-status:
	scripts/release_lock.sh status

release-clean:
	rm -rf release-evidence/*.tmp 2>/dev/null || true
	scripts/release_lock.sh status

test:
	node tests/run_all.js

test-js:
	node tests/test_generated_code_compiles.js
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
	node tests/test_stage5_adapters.js
	node tests/test_stage4_contracts.js
	node tests/test_stage4_workflows.js
	node tests/test_stage4_e2e.js
	node tests/test_agent_identity.js
	node tests/test_agent_contracts.js
	node tests/test_agent_workflows.js
	node tests/test_deep_analysis_contracts.js
	node tests/test_deep_analysis_workflows.js
	node tests/test_monitoring.js
	node tests/test_stage7_monitoring_e2e.js
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
	node tests/test_reporting_e2e.js
	node tests/test_stage6_research_e2e.js
	node tests/test_workflow_manifest.js
	node tests/test_binding_tool.js
	node tests/test_deploy_preflight.js
	node tests/test_telegram_commands.js
	node tests/test_attachment_routing.js
	node tests/test_smoke_hardening.js
	node tests/test_sheets_bootstrap.js
	node tests/test_sheets_operations_qa.js
	node tests/test_runtime_ids.js
	node tests/test_release_shell.js
	node tests/test_preflight_strict.js
	node tests/test_release_scripts.js
	node tests/test_reconcile_and_gate.js
	node tests/test_stage8_release_e2e.js
	node tests/test_release_integration.js
	node tests/test_prepare_staged.js

test-wf:
	python3 scripts/validate_workflows.py
