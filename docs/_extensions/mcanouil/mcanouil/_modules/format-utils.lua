--- @module format-utils
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @version 1.0.0
--- @brief Format detection and configuration utilities
--- @description Provides format detection and configuration for multi-format shortcodes and filters.

local M = {}

-- ============================================================================
-- FORMAT CONFIGURATIONS
-- ============================================================================

--- @class FormatConfig
--- @field class_prefix string Extra class prefix (e.g., 'reveal-component ')
--- @field defaults table Format-specific defaults

--- Configuration for HTML format
M.HTML_CONFIG = {
  class_prefix = '',
  defaults = {
    columns = '3',
    horizontal = false,
    progress_height = '1.5em'
  }
}

--- Configuration for Reveal.js format
M.REVEALJS_CONFIG = {
  class_prefix = 'reveal-component ',
  defaults = {
    columns = '2',
    horizontal = true,
    progress_height = '1.2em'
  }
}

--- Configuration for Typst format (placeholder for consistency)
M.TYPST_CONFIG = {
  class_prefix = '',
  defaults = {}
}

-- ============================================================================
-- FORMAT DETECTION
-- ============================================================================

--- Detect the current output format.
--- @return string|nil Format name ('html', 'revealjs', 'typst') or nil if unknown
function M.get_format()
  if quarto.doc.is_format('typst') then
    return 'typst'
  elseif quarto.doc.is_format('revealjs') then
    return 'revealjs'
  elseif quarto.doc.is_format('html') then
    return 'html'
  end
  return nil
end

--- Get configuration for the current format.
--- @return FormatConfig|nil Configuration table or nil if format unknown
function M.get_config()
  local format = M.get_format()
  if format == 'html' then
    return M.HTML_CONFIG
  elseif format == 'revealjs' then
    return M.REVEALJS_CONFIG
  elseif format == 'typst' then
    return M.TYPST_CONFIG
  end
  return nil
end

--- Check if current format is HTML-based (HTML or Reveal.js).
--- @return boolean True if HTML or Reveal.js format
function M.is_html_based()
  return quarto.doc.is_format('html') or quarto.doc.is_format('revealjs')
end

--- Check if current format is Typst.
--- @return boolean True if Typst format
function M.is_typst()
  return quarto.doc.is_format('typst')
end

-- ============================================================================
-- MODULE EXPORT
-- ============================================================================

return M
