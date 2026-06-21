# n8n version pinning (QA-010)

The Stage 1/2 acceptance run was performed against **n8n 2.23.3** (verified image id
`sha256:c0c39b1ca69d43f736bc65f8ddd70972a8989f736e8a4b6a075823f98cc48a23`, bundled `node v24.15.0`). A silent
floating-tag upgrade (`:latest`) can change runtime behavior — for example the CLI activation/publication
semantics (QA-012) and the Code-node sandbox (QA-005) — so production should pin the exact tested tag.

The tested version is the single source of truth in the manifest:

```bash
node tools/manifest_lib.js n8n-version   # -> 2.23.3
```

## What we ship (templates — not the live file)

* `ops/n8n/docker-compose.pinned.example.yml` — a compose **template** pinned to `n8nio/n8n:2.23.3` with
  `NODE_FUNCTION_ALLOW_BUILTIN=zlib` already set. It is an example; it does **not** overwrite `/opt/n8n/docker-compose.yml`.
* `scripts/check_n8n_runtime.sh` — a **read-only** checker (below).

No image **digest** is hard-pinned in the template on purpose: a digest is registry/architecture-specific and
hard-pinning an "invented" one would be wrong. Instead the checker compares the **running image id** to the tested
one at deploy time.

## Checker

```bash
scripts/check_n8n_runtime.sh                       # inspects /opt/n8n/docker-compose.yml + running container
scripts/check_n8n_runtime.sh --compose <file> --container <name>
```

It reports: configured image reference, configured tag, running n8n version, running image id, the tested repo
version + tested image id, a floating-tag warning, and version/image mismatches. It is read-only — it never edits
the compose file or any container.

* A **floating tag** (`:latest`, or no explicit tag) is treated as **UNSAFE** and the checker exits non-zero,
  unless explicitly overridden with `MS_ALLOW_FLOATING_N8N_IMAGE=true` (then it is downgraded to a warning).
* A pinned tag that differs from `2.23.3` is reported as a non-fatal `VERSION_MISMATCH_WARNING`.
* If docker or a running container is unavailable, the container checks are `OPTIONAL_CHECK_SKIPPED` (never a
  false PASS).

## Operator-only recommendation (do NOT auto-apply)

The live `/opt/n8n/docker-compose.yml` is **not** modified by this repo. When you are ready to pin, an operator
should change the image line by hand:

```diff
 services:
   n8n:
-    image: n8nio/n8n:latest
+    image: n8nio/n8n:2.23.3     # pin the tested version (see docs/N8N_VERSION_PINNING.md)
     environment:
+      - NODE_FUNCTION_ALLOW_BUILTIN=zlib   # required for the XLSX writer (QA-005)
```

then recreate the container through your normal ops process. Review against
`ops/n8n/docker-compose.pinned.example.yml` first. Upgrading n8n later should be a deliberate, tested step:
bump the tag, re-run `make test` and the disposable smokes, and re-confirm the CLI semantics in QA-012.
