--- @module grid-background
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @version 1.0.0
--- @brief Grid background toggle filter
--- @description Enables a subtle grid background when
---   extensions.mcanouil.grid-background is true (default: false).
---   Injects CSS for both HTML (on body) and Reveal.js (on slide backgrounds).

-- ============================================================================
-- FORMAT CHECK
-- ============================================================================

-- This filter only applies to HTML-based formats (HTML and Reveal.js)
local format_utils = require(
  quarto.utils.resolve_path('../_modules/format-utils.lua'):gsub('%.lua$', '')
)

if not format_utils.is_html_based() then
  return {}
end

-- ============================================================================
-- MODULES
-- ============================================================================

local utils = require(
  quarto.utils.resolve_path('../_modules/utils.lua'):gsub('%.lua$', '')
)

-- ============================================================================
-- CSS TEMPLATES
-- ============================================================================

local CSS_ENABLE_GRID = [[
<style>
/* extensions.mcanouil.grid-background: true */
body {
  --grid-size: 50px;
  --grid-color: color-mix(in srgb, var(--mc-fg) 1.5%, var(--mc-bg));
  background-size: var(--grid-size) var(--grid-size) !important;
  background-image:
    linear-gradient(to right, var(--grid-color) 1px, transparent 1px),
    linear-gradient(to bottom, var(--grid-color) 1px, transparent 1px) !important;
}
.reveal .slide-background::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  --grid-size: 50px;
  --grid-color: color-mix(in srgb, var(--mc-fg) 1.5%, var(--mc-bg));
  background-size: var(--grid-size) var(--grid-size);
  background-image:
    linear-gradient(to right, var(--grid-color) 1px, transparent 1px),
    linear-gradient(to bottom, var(--grid-color) 1px, transparent 1px);
}
</style>
]]

-- ============================================================================
-- FILTER FUNCTIONS
-- ============================================================================

--- Enable grid background when option is true
--- @param meta pandoc.Meta Document metadata
--- @return pandoc.Meta Unmodified metadata
local function Meta(meta)
  local config = utils.get_mcanouil_config(meta, 'grid-background')
  -- Default is false (no grid); inject CSS only when explicitly true
  if config ~= nil and pandoc.utils.stringify(config) == 'true' then
    quarto.doc.add_html_dependency({
      name = 'grid-background-enable',
      version = '1.0.0',
      head = CSS_ENABLE_GRID
    })
  end
  return meta
end

-- ============================================================================
-- FILTER EXPORT
-- ============================================================================

return {
  { Meta = Meta }
}
