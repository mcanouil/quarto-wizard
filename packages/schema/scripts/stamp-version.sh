#!/usr/bin/env bash
# @license MIT
# @copyright 2026 Mickaël Canouil
# @author Mickaël Canouil
#
# Stamp a version on the Lua reference validator and open its changelog
# section. The format of the `@version` tag and the shape of the `Unreleased`
# heading are known here, and nowhere else outside the tests.

set -euo pipefail

if [ "$#" -ne 1 ]; then
	echo "usage: stamp-version.sh <version>" >&2
	exit 2
fi

VERSION="$1"

if ! [[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
	echo "The version must be MAJOR.MINOR.PATCH. Read: ${VERSION}" >&2
	exit 2
fi

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MODULE="${HERE}/../src/validation/schema.lua"
CHANGELOG="${HERE}/../CHANGELOG.md"

# Both files are written beside themselves first and moved into place at the
# end, so a refusal on the second one leaves no tree with the version stamped
# and the changelog unopened.
trap 'rm -f "${MODULE}.new" "${CHANGELOG}.new"' EXIT

# The first tag alone, and the same whole-line shape that `readModuleVersion`
# in the test helper reads. A substitution over the file would rewrite a
# second tag in the LuaDoc of an inner function too.
if ! awk -v stamp="--- @version ${VERSION}" '
  !done && /^---[ \t]*@version[ \t]+[0-9]+\.[0-9]+\.[0-9]+[ \t]*$/ {print stamp; done = 1; next}
  {print}
  END {exit done ? 0 : 1}
' "${MODULE}" >"${MODULE}.new"; then
	echo "No @version tag in ${MODULE}." >&2
	exit 1
fi

# The first heading alone, matched in full, and a new empty `Unreleased`
# section left above it. An entry is written as a sentence, so a match on the
# word would rewrite one that carries it in its prose.
if ! awk -v heading="## ${VERSION}" '
  !done && $0 == "## Unreleased" {print; print ""; print heading; done = 1; next}
  {print}
  END {exit done ? 0 : 1}
' "${CHANGELOG}" >"${CHANGELOG}.new"; then
	echo "No \"## Unreleased\" heading in ${CHANGELOG}." >&2
	exit 1
fi

mv "${MODULE}.new" "${MODULE}"
mv "${CHANGELOG}.new" "${CHANGELOG}"
