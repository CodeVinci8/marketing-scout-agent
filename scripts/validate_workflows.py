#!/usr/bin/env python3
"""validate_workflows.py — Stage C Hardening offline workflow validator.

Checks (no network, no paid APIs):
  1. Every n8n workflow JSON parses and has the expected envelope (name/nodes/connections).
  2. Required nodes exist for the hardened workflows (WF16 scoring node, etc.).
  3. No secret/token/credential value leakage patterns in committed workflow JSON or config.
  4. config/taxonomy.json is internally consistent (routes/entities/aliases resolve to canonical sets).
  5. No active=true workflow is committed (must stay false until operator activation).

Exit code 0 = all pass, 1 = failures. Usage: python3 scripts/validate_workflows.py
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WF_DIR = os.path.join(ROOT, "n8n", "workflows")
CONFIG = os.path.join(ROOT, "config", "taxonomy.json")

passed = 0
failed = 0
notes = []


def check(label, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        notes.append("  FAIL  %s%s" % (label, ("  -> " + detail) if detail else ""))


# Secret leakage: look for assigned real-looking secrets, NOT the safe placeholders the repo uses.
SECRET_PATTERNS = [
    (re.compile(r"sk-ant-[A-Za-z0-9_\-]{8,}"), "anthropic key"),
    (re.compile(r"apify_api_[A-Za-z0-9]{8,}"), "apify token"),
    (re.compile(r"fc-[A-Za-z0-9]{20,}"), "firecrawl key"),
    (re.compile(r"AIza[A-Za-z0-9_\-]{20,}"), "google api key"),
    (re.compile(r"\b\d{6,}:[A-Za-z0-9_\-]{30,}\b"), "telegram bot token"),
    (re.compile(r"xox[baprs]-[A-Za-z0-9\-]{10,}"), "slack token"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "private key"),
]
# Known SAFE placeholders that must NOT trigger leak detection.
SAFE = ["PASTE_", "_PLACEHOLDER", "YOUR_", "<", "xxxx", "example"]


def scan_secrets(path, text):
    for rx, name in SECRET_PATTERNS:
        for m in rx.finditer(text):
            frag = m.group(0)
            if any(s.lower() in frag.lower() for s in SAFE):
                continue
            check("no %s leak in %s" % (name, os.path.basename(path)), False, frag[:18] + "...")


def validate_workflows():
    files = sorted(f for f in os.listdir(WF_DIR) if f.endswith(".json"))
    check("workflow dir non-empty", len(files) > 0)
    parsed = 0
    for f in files:
        p = os.path.join(WF_DIR, f)
        raw = open(p, encoding="utf-8").read()
        try:
            wf = json.loads(raw)
            parsed += 1
        except Exception as e:
            check("parse " + f, False, str(e))
            continue
        check(f + " has name", isinstance(wf.get("name"), str) and wf["name"])
        check(f + " has nodes[]", isinstance(wf.get("nodes"), list) and len(wf["nodes"]) > 0)
        check(f + " has connections{}", isinstance(wf.get("connections"), dict))
        check(f + " active=false (not committed active)", wf.get("active") is False)
        # node names unique
        names = [n.get("name") for n in wf.get("nodes", [])]
        check(f + " unique node names", len(names) == len(set(names)))
        # connection targets exist
        nameset = set(names)
        ok_conn = True
        for src, conn in wf.get("connections", {}).items():
            for outs in conn.get("main", []):
                for c in (outs or []):
                    if c.get("node") not in nameset:
                        ok_conn = False
        check(f + " connections reference existing nodes", ok_conn)
        scan_secrets(p, raw)
    notes.append("  ..%d workflow JSON files parsed" % parsed)
    return parsed


def validate_wf16():
    p = os.path.join(WF_DIR, "16_source_quality_gate_health_score.json")
    check("WF16 file present", os.path.exists(p))
    if not os.path.exists(p):
        return
    wf = json.load(open(p, encoding="utf-8"))
    names = [n["name"] for n in wf["nodes"]]
    for req in ["Set WF16 Config", "Build Source Health", "Final Summary Output"]:
        check("WF16 has '%s'" % req, req in names)
    has_append = any(n.get("type") == "n8n-nodes-base.googleSheets" and n["parameters"].get("operation") == "append"
                     and n["parameters"].get("sheetName", {}).get("value") == "source_health" for n in wf["nodes"])
    check("WF16 appends source_health tab", has_append)
    has_http = any(n.get("type") == "n8n-nodes-base.httpRequest" for n in wf["nodes"])
    check("WF16 has NO external API node", not has_http)


def validate_taxonomy():
    check("config/taxonomy.json present", os.path.exists(CONFIG))
    if not os.path.exists(CONFIG):
        return
    raw = open(CONFIG, encoding="utf-8").read()
    scan_secrets(CONFIG, raw)
    tx = json.loads(raw)
    rt, et, sv, vr = tx["record_type"], tx["entity_type"], tx["service"], tx["valid_routes"]
    for k, v in tx["route_map"].items():
        check("route_map[%s] in valid_routes" % k, v in vr, v)
    for k, v in tx["entity_for_record_type"].items():
        check("entity_for_record_type[%s] in entity_type" % k, v in et)
    for k, v in tx["record_type_aliases"].items():
        check("record alias %s resolves" % k, v in rt)
    for k, v in tx["service_aliases"].items():
        check("service alias %s resolves" % k, v in sv)
    # every record_type has a route + entity
    for t in rt:
        check("record_type %s routed" % t, t in tx["route_map"])
        check("record_type %s has entity" % t, t in tx["entity_for_record_type"])


def main():
    validate_workflows()
    validate_wf16()
    validate_taxonomy()
    print("\n===== validate_workflows.py =====")
    for n in notes:
        print(n)
    print("\n  %d passed, %d failed" % (passed, failed))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
