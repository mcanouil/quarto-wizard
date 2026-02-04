--- @module code-window-filter
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @version 1.0.0
--- @brief Post-quarto filter for code-window styling in HTML/Reveal.js
--- @description Runs AFTER Quarto processes annotations to avoid interference.

-- ============================================================================
-- MODULE IMPORTS
-- ============================================================================

local format_utils = require(
  quarto.utils.resolve_path('../_modules/format-utils.lua'):gsub('%.lua$', '')
)

local code_window = require(
  quarto.utils.resolve_path('../_modules/code-window.lua'):gsub('%.lua$', '')
)

-- ============================================================================
-- GLOBAL STATE
-- ============================================================================

local CURRENT_FORMAT = nil
local CODE_WINDOW_CONFIG = nil

-- ============================================================================
-- FILTER FUNCTIONS
-- ============================================================================

--- Load configuration from document metadata.
function Meta(meta)
  CURRENT_FORMAT = format_utils.get_format()
  CODE_WINDOW_CONFIG = code_window.get_config(meta)
  return meta
end

--- Process CodeBlock elements with code-window styling.
--- Runs after Quarto has processed code annotations.
function CodeBlock(block)
  if not CURRENT_FORMAT then
    return block
  end

  -- Only process for HTML/Reveal.js formats
  -- Typst is handled at pre-quarto in components.lua
  if CURRENT_FORMAT ~= 'html' and CURRENT_FORMAT ~= 'revealjs' then
    return block
  end

  if not CODE_WINDOW_CONFIG or not CODE_WINDOW_CONFIG.enabled then
    return block
  end

  return code_window.process_html(block, CODE_WINDOW_CONFIG)
end

-- ============================================================================
-- FILTER EXPORTS
-- ============================================================================

return {
  { Meta = Meta },
  { CodeBlock = CodeBlock }
}
