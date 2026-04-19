#!/usr/bin/env bash
set -euo pipefail

# Stage dev-profile assets inside the project so `_quarto-dev.yml` avoids `../` paths.
src="../assets/social/social-card.png"
dst="assets/social/social-card.png"

if [[ -f "${src}" ]]; then
	mkdir -p "$(dirname "${dst}")"
	cp "${src}" "${dst}"
fi
