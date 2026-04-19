#!/usr/bin/env bash
set -euo pipefail

# Remove dev-profile-only assets that `dev-copy-assets.sh` brought in so the
# working tree stays clean after `quarto render --profile dev`.

dst="assets/social/social-card.png"

if [[ -f "${dst}" ]]; then
	rm -f "${dst}"
	# Remove the containing directory if it's now empty.
	dir="$(dirname "${dst}")"
	if [[ -d "${dir}" ]]; then
		rmdir "${dir}" 2>/dev/null || true
	fi
fi
