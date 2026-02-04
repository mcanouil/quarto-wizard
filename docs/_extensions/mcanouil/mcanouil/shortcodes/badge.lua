--- @module badge
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @version 1.0.0
--- @brief Format-agnostic badge shortcode
--- @description Provides {{< badge >}} shortcode for rendering inline badges
--- for HTML and Reveal.js formats. Returns Null for Typst (badges use span syntax).

-- ============================================================================
-- MODULE IMPORTS
-- ============================================================================

local format_utils = require(
  quarto.utils.resolve_path('../_modules/format-utils.lua'):gsub('%.lua$', '')
)
local shortcode_renderers = require(
  quarto.utils.resolve_path('../_modules/shortcode-renderers.lua'):gsub('%.lua$', '')
)

-- ============================================================================
-- SHORTCODE HANDLER
-- ============================================================================

--- @type table<string, function> Shortcode handlers
return {
  ['badge'] = function(_args, kwargs, _meta)
    local format = format_utils.get_format()

    if format == 'html' or format == 'revealjs' then
      -- HTML-based rendering
      local config = format_utils.get_config()
      return pandoc.RawInline('html', shortcode_renderers.render_badge(kwargs, config))
    end

    -- Typst uses [text]{.badge} span syntax, not a shortcode
    return pandoc.Null()
  end
}
