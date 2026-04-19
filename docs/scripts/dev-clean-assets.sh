#!/usr/bin/env bash
set -euo pipefail

# Undo dev-copy-assets.sh so the working tree stays clean post-render.
dst="assets/social/social-card.png"

if [[ -f "${dst}" ]]; then
	rm -f "${dst}"
	dir="$(dirname "${dst}")"
	if [[ -d "${dir}" ]]; then
		rmdir "${dir}" 2>/dev/null || true
	fi
fi
