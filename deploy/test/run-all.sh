#!/usr/bin/env bash
# Runs every deploy/test/*.test.sh and fails if any of them fails.
#
#   bash deploy/test/run-all.sh
#
# Each suite runs in its own bash process, so one suite's state cannot leak
# into the next, and every suite runs even after an earlier one fails.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
failed=()
ran=0
for t in "$HERE"/*.test.sh; do
  [ -e "$t" ] || continue
  ran=$((ran + 1))
  echo "=== $(basename "$t")"
  if bash "$t"; then
    echo "=== $(basename "$t"): ok"
  else
    echo "=== $(basename "$t"): FAILED"
    failed+=("$(basename "$t")")
  fi
done

if [ "$ran" -eq 0 ]; then
  echo "no test suites found in $HERE"; exit 1
fi
if [ "${#failed[@]}" -gt 0 ]; then
  echo "FAILED: ${failed[*]}"; exit 1
fi
echo "all $ran suite(s) passed"
