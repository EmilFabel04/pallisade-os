#!/usr/bin/env bash
# Mutation-testing harness.
#
# Applies a find/replace to a single source file, runs that file's paired
# *.test.ts, and reports whether a test died. A SURVIVED mutant means the
# check the mutation broke was never exercised by the test suite — the test
# passed against broken code, which is exactly the failure mode this repo
# has been burned by more than once (see the STATUS docs).
#
#   ./scripts/mutate.sh src/lib/agents/spec.ts 'CAPABILITY_GROUPS' 'AGENT_SURFACES'
#
# The file is restored unconditionally via an EXIT trap: a crashed vitest
# worker, a Ctrl-C, or `set -e` aborting mid-script all still leave the tree
# clean, because the trap fires whenever this shell exits, for any reason.
set -euo pipefail

if [ $# -ne 3 ]; then
  echo "usage: $0 <file> <find> <replace>" >&2
  exit 2
fi

FILE=$1
FIND=$2
REPLACE=$3
TEST="${FILE%.ts}.test.ts"

if [ ! -f "$FILE" ]; then
  echo "error: $FILE does not exist" >&2
  exit 2
fi

if [ ! -f "$TEST" ]; then
  echo "error: $TEST does not exist -- nothing to run this mutant against" >&2
  exit 2
fi

if [ -f "$FILE.bak" ]; then
  echo "error: $FILE.bak already exists -- a previous run may have crashed" >&2
  echo "       before restoring. Inspect it by hand; refusing to clobber it." >&2
  exit 2
fi

# Fail loudly if the pattern isn't even present, rather than silently running
# the *unmutated* file's tests and reporting a false SURVIVED.
BEFORE_MATCHES=$(grep -c -F -- "$FIND" "$FILE" || true)
if [ "${BEFORE_MATCHES:-0}" -eq 0 ]; then
  echo "error: pattern not found in $FILE -- nothing would be mutated" >&2
  echo "       (grep -F -- '$FIND' '$FILE')" >&2
  exit 2
fi
if [ "$BEFORE_MATCHES" -gt 1 ]; then
  echo "warning: pattern matches $BEFORE_MATCHES lines in $FILE -- all will be mutated" >&2
fi

cp "$FILE" "$FILE.bak"
trap 'mv -f "$FILE.bak" "$FILE"' EXIT

perl -pi -e "s/\Q$FIND\E/$REPLACE/g" "$FILE"

if cmp -s "$FILE" "$FILE.bak"; then
  echo "error: substitution ran but produced no change in $FILE" >&2
  exit 2
fi

if npx vitest run "$TEST" >/dev/null 2>&1; then
  echo "SURVIVED: $FIND -> $REPLACE in $FILE"
  exit 1
else
  echo "killed:   $FIND -> $REPLACE in $FILE"
fi
