#!/usr/bin/env bash
set -euo pipefail

# Copy dev-profile-only assets from outside the Quarto project dir into the
# project tree so `_quarto-dev.yml` can reference them with plain relative
# paths rather than `../` escapes. `dev-clean-assets.sh` undoes the copy.

src="../assets/social/social-card.png"
dst="assets/social/social-card.png"

if [[ -f "${src}" ]]; then
	mkdir -p "$(dirname "${dst}")"
	cp "${src}" "${dst}"
fi
