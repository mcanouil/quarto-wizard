--- @module divider
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @version 1.0.0
--- @brief Format-agnostic divider shortcode
--- @description Provides {{< divider >}} shortcode for rendering decorative dividers
--- across HTML, Reveal.js, and Typst formats.

-- ============================================================================
-- MODULE IMPORTS
-- ============================================================================

local format_utils = require(
  quarto.utils.resolve_path('../_modules/format-utils.lua'):gsub('%.lua$', '')
)
local html_utils = require(
  quarto.utils.resolve_path('../_modules/html-utils.lua'):gsub('%.lua$', '')
)
local typst_utils = require(
  quarto.utils.resolve_path('../_modules/typst-utils.lua'):gsub('%.lua$', '')
)

-- ============================================================================
-- SHORTCODE HANDLER
-- ============================================================================

--- @type table<string, function> Shortcode handlers
return {
  ['divider'] = function(_args, kwargs, _meta)
    local format = format_utils.get_format()

    if format == 'typst' then
      -- Typst rendering
      return pandoc.RawBlock('typst', typst_utils.build_shortcode_function_call('mcanouil-divider', kwargs))
    elseif format == 'html' or format == 'revealjs' then
      -- HTML-based rendering
      local config = format_utils.get_config()
      return pandoc.RawBlock('html', html_utils.render_divider(kwargs, config))
    end

    return pandoc.Null()
  end
}
