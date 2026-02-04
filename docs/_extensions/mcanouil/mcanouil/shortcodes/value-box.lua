--- @module value-box
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @version 1.0.0
--- @brief Format-agnostic value-box shortcode
--- @description Provides {{< value-box >}} shortcode for rendering value displays
--- across HTML, Reveal.js, and Typst formats.

-- ============================================================================
-- MODULE IMPORTS
-- ============================================================================

local format_utils = require(
  quarto.utils.resolve_path('../_modules/format-utils.lua'):gsub('%.lua$', '')
)
local shortcode_renderers = require(
  quarto.utils.resolve_path('../_modules/shortcode-renderers.lua'):gsub('%.lua$', '')
)
local typst_utils = require(
  quarto.utils.resolve_path('../_modules/typst-utils.lua'):gsub('%.lua$', '')
)

-- ============================================================================
-- SHORTCODE HANDLER
-- ============================================================================

--- @type table<string, function> Shortcode handlers
return {
  ['value-box'] = function(_args, kwargs, _meta)
    local format = format_utils.get_format()

    if format == 'typst' then
      -- Typst rendering
      return pandoc.RawBlock('typst', typst_utils.build_shortcode_function_call('mcanouil-value-box', kwargs))
    elseif format == 'html' or format == 'revealjs' then
      -- HTML-based rendering
      local config = format_utils.get_config()
      return pandoc.RawBlock('html', shortcode_renderers.render_value_box(kwargs, config))
    end

    return pandoc.Null()
  end
}
