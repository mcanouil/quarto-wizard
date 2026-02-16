#!/bin/bash
# Package the VS Code extension with .vscodeignore + additional exclusions

set -e

TEMP_IGNORE=$(mktemp)
trap "rm -f '${TEMP_IGNORE}'" EXIT

# Start with .vscodeignore
cat .vscodeignore > "${TEMP_IGNORE}"

# Add additional exclusions (workspace symlinks, etc.)
cat >> "${TEMP_IGNORE}" << 'EOF'
.beads
.claude
EOF

npx @vscode/vsce package --pre-release --ignoreFile "${TEMP_IGNORE}" "$@"

VSIX=$(find . -maxdepth 1 -name '*.vsix' -print0 | xargs -0 stat -f '%m %N' | sort -rn | head -1 | cut -d' ' -f2-)
if [ -n "${VSIX}" ]; then
  code --install-extension "${VSIX}"
fi
