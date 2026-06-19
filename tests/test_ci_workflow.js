// test_ci_workflow.js — structural validation of the offline-regression GitHub Actions workflow.
// Ensures CI runs on pull_request + push:main, pins stable Node/Python, runs `make test`, uses no
// repository secrets, and keeps the secret-leak / active-workflow guards. ($0, no network.)
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert');

const p = path.join(__dirname, '..', '.github', 'workflows', 'regression.yml');
A.section('CI — workflow file present');
A.ok('.github/workflows/regression.yml exists', fs.existsSync(p));
const y = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';

A.section('CI — triggers');
A.ok('runs on pull_request', /\bpull_request\b/.test(y));
A.ok('runs on push to main', /push:\s*[\s\S]*branches:\s*\[main\]/.test(y));

A.section('CI — stable toolchain');
A.ok('pins a stable Node version', /setup-node@v\d/.test(y) && /node-version:\s*"?\d+"?/.test(y));
A.ok('pins a stable Python version', /setup-python@v\d/.test(y) && /python-version:\s*"?\d+\.\d+"?/.test(y));

A.section('CI — runs the offline regression and guards');
A.ok('runs `make test`', /make test/.test(y));
A.ok('has a secret-leak scan step', /[Ss]ecret-leak scan/.test(y));
A.ok('asserts no active workflow committed', /active.*true/.test(y));

A.section('CI — uses NO repository secrets / no external calls');
A.ok('does not reference ${{ secrets.* }}', !/\$\{\{\s*secrets\./.test(y));
A.ok('contents: read permissions only', /permissions:\s*[\s\S]*contents:\s*read/.test(y));

A.report('ci-workflow');
