#!/usr/bin/env bash
# The quality gate for the agent team. Run from anywhere inside a checkout or worktree.
#
#   .claude/check.sh [base]     base defaults to HEAD (compare uncommitted work with it)
#
# Tests and the build must pass. Lint is checked only on the files changed since <base>, and the
# rule is "no new problems": a file may not have more eslint/ruff errors than it had at <base>, a
# new file must have none, and a file that was ruff-formatted must stay formatted. The repo
# already has lint debt, which this doesn't count against you.
set -uo pipefail

BASE="${1:-HEAD}"
ROOT="$(git rev-parse --show-toplevel)"
UI="$ROOT/pixel-perfect-capture"
BACKEND="$ROOT/core/backend"
FAIL=0
pass() { printf '  \033[32mpass\033[0m %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAIL=1; }

cd "$ROOT"
CHANGED=$( { git diff --name-only "$BASE" --diff-filter=ACMR; git ls-files --others --exclude-standard; } | sort -u)

# Worktrees have no node_modules; borrow the main checkout's.
if [ ! -d "$UI/node_modules" ]; then
  MAIN="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
  if [ -d "$MAIN/pixel-perfect-capture/node_modules" ]; then
    ln -s "$MAIN/pixel-perfect-capture/node_modules" "$UI/node_modules"
  else
    (cd "$UI" && npm install --silent)
  fi
fi

echo "UI"
(cd "$UI" && npm test --silent >/tmp/check-ui-test.log 2>&1) && pass "tests" || { fail "tests (see /tmp/check-ui-test.log)"; tail -30 /tmp/check-ui-test.log; }
(cd "$UI" && npm run build --silent >/tmp/check-ui-build.log 2>&1) && pass "build" || { fail "build (see /tmp/check-ui-build.log)"; tail -30 /tmp/check-ui-build.log; }

count_eslint() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).reduce((n,f)=>n+f.errorCount,0))}catch{console.log(0)}})'; }
for f in $(echo "$CHANGED" | grep -E '^pixel-perfect-capture/src/.*\.(ts|tsx)$' | grep -v routeTree.gen.ts); do
  [ -f "$f" ] || continue
  rel="${f#pixel-perfect-capture/}"
  now=$(cd "$UI" && npx eslint -f json "$rel" 2>/dev/null | count_eslint)
  if git cat-file -e "$BASE:$f" 2>/dev/null; then
    was=$(cd "$UI" && git show "$BASE:$f" | npx eslint -f json --stdin --stdin-filename "$rel" 2>/dev/null | count_eslint)
  else
    was=0
  fi
  [ "$now" -le "$was" ] && pass "eslint $rel ($was → $now errors)" || { fail "eslint $rel ($was → $now errors)"; (cd "$UI" && npx eslint "$rel" | tail -20); }
done

echo "Backend"
count_ruff() { python3 -c 'import json,sys
try: print(len(json.load(sys.stdin)))
except Exception: print(0)'; }
PY=$(echo "$CHANGED" | grep -E '^core/backend/.*\.py$')
for f in $PY; do
  [ -f "$f" ] || continue
  rel="${f#core/backend/}"
  (cd "$BACKEND" && python3 -m py_compile "$rel") || fail "syntax $rel"
  now=$(cd "$BACKEND" && uvx ruff check --output-format json "$rel" 2>/dev/null | count_ruff)
  if git cat-file -e "$BASE:$f" 2>/dev/null; then
    was=$(cd "$BACKEND" && git show "$BASE:$f" | uvx ruff check --output-format json --stdin-filename "$rel" - 2>/dev/null | count_ruff)
    git show "$BASE:$f" | (cd "$BACKEND" && uvx ruff format --check --stdin-filename "$rel" - >/dev/null 2>&1) && was_fmt=1 || was_fmt=0
  else
    was=0; was_fmt=1
  fi
  [ "$now" -le "$was" ] && pass "ruff $rel ($was → $now errors)" || { fail "ruff $rel ($was → $now errors)"; (cd "$BACKEND" && uvx ruff check "$rel" | tail -20); }
  if [ "$was_fmt" = 1 ]; then
    (cd "$BACKEND" && uvx ruff format --check "$rel" >/dev/null 2>&1) && pass "format $rel" || fail "format $rel (run: uvx ruff format $rel)"
  fi
done
if [ -n "$PY" ]; then
  (cd "$BACKEND" && uv run python -c "import main" >/tmp/check-be-import.log 2>&1) && pass "backend imports" || { fail "backend imports (see /tmp/check-be-import.log)"; tail -20 /tmp/check-be-import.log; }
fi
if [ -d "$BACKEND/tests" ]; then
  (cd "$BACKEND" && uv run --with pytest --with pytest-asyncio pytest -q >/tmp/check-be-test.log 2>&1) && pass "backend tests" || { fail "backend tests (see /tmp/check-be-test.log)"; tail -30 /tmp/check-be-test.log; }
fi

[ "$FAIL" = 0 ] && echo "ALL CHECKS PASSED" || { echo "CHECKS FAILED"; exit 1; }
