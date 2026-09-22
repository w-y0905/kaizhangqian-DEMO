#!/usr/bin/env bash
# 开张前 · P0 一键验证：单元测试 + 端到端（mock 上游）
set -e
cd "$(dirname "$0")/.."
echo "== 1. 单元测试 =="
node --test test/schema.test.cjs test/calc.test.cjs test/trial.test.cjs test/limit.test.cjs test/kb.test.cjs
echo
echo "== 2. 端到端验证（无需真实 API）=="
node scripts/verify-p0.mjs
