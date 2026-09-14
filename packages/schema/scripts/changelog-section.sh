#!/usr/bin/env bash
# @license MIT
# @copyright 2026 Mickaël Canouil
# @author Mickaël Canouil
#
# Print the body of one section of a changelog, and refuse a section that
# carries no entry. The release workflow reads it twice: once to refuse a
# bump of an empty `Unreleased` section, and once to take the release notes
# of the version it publishes.

set -euo pipefail

if [ "$#" -ne 2 ]; then
	echo "usage: changelog-section.sh <changelog> <heading>" >&2
	exit 2
fi

CHANGELOG="$1"
HEADING="$2"

if [ ! -f "${CHANGELOG}" ]; then
	echo "No changelog at ${CHANGELOG}." >&2
	exit 1
fi

# The whole line, and not the word. An entry is written as a sentence, so its
# prose can carry the heading text, and a match on the word alone would read
# that entry as the start of a section.
BODY=$(awk -v heading="## ${HEADING}" '
  $0 == heading {found = 1; next}
  /^## / && found {found = 0}
  found
' "${CHANGELOG}")

# A section holding nothing but blank lines is refused here. A heading renamed
# over one publishes a release with an empty body, which nobody can correct
# once the release is immutable.
if [ -z "${BODY//[[:space:]]/}" ]; then
	echo "No entries under a \"## ${HEADING}\" heading in ${CHANGELOG}." >&2
	exit 1
fi

printf '%s\n' "${BODY}"
