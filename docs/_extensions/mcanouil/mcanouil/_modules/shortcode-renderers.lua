--- @module shortcode-renderers
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @version 1.0.0
--- @brief Shared shortcode renderers for HTML-based formats
--- @description Provides parameterised renderer functions for shortcode components.

-- ============================================================================
-- MODULE IMPORTS
-- ============================================================================

local html_utils = require(
  quarto.utils.resolve_path('../_modules/html-utils.lua'):gsub('%.lua$', '')
)
local utils = require(
  quarto.utils.resolve_path('../_modules/utils.lua'):gsub('%.lua$', '')
)

local M = {}

-- ============================================================================
-- HELPER FUNCTIONS (aliases to utils module)
-- ============================================================================

local to_string = utils.to_string
local is_custom_colour = utils.is_custom_colour

-- ============================================================================
-- CONFIGURATION
-- ============================================================================

--- @class ShortcodeConfig
--- @field class_prefix string Extra class prefix (e.g., 'reveal-component ')
--- @field defaults table Format-specific defaults

--- Default configuration for HTML format
M.HTML_CONFIG = {
  class_prefix = '',
  defaults = {
    progress_height = '1.5em'
  }
}

--- Default configuration for Reveal.js format
M.REVEALJS_CONFIG = {
  class_prefix = 'reveal-component ',
  defaults = {
    progress_height = '1.2em'
  }
}

-- ============================================================================
-- SHORTCODE RENDERERS
-- ============================================================================

--- Render a value box component.
--- @param kwargs table Keyword arguments from shortcode
--- @param config ShortcodeConfig|nil Configuration options
--- @return string HTML string for the value box
M.render_value_box = function(kwargs, config)
  config = config or M.HTML_CONFIG
  local class_prefix = config.class_prefix or ''

  local value = to_string(kwargs.value) or '0'
  local unit = to_string(kwargs.unit)
  local label = to_string(kwargs.label) or ''
  local icon = to_string(kwargs.icon)
  local colour = utils.get_colour(kwargs, 'info')

  -- Handle custom colours (hex, rgb, hsl)
  local modifier = html_utils.get_colour_modifier(colour)
  local style_attr = ''
  if is_custom_colour(colour) then
    modifier = 'custom'
    style_attr = string.format(' style="--custom-colour: %s;"', utils.escape_attribute(colour))
  elseif not modifier then
    modifier = colour
  end

  local base_class = class_prefix .. html_utils.bem_class('value-box')
  local mod_class = html_utils.bem_class('value-box', nil, modifier)
  local classes = base_class .. ' ' .. mod_class

  -- Build value display
  local value_html = html_utils.bem_span('value-box', 'number', nil, nil, utils.escape_html(value))

  -- Add unit if provided
  if unit then
    value_html = value_html .. html_utils.bem_span('value-box', 'unit', nil, nil, utils.escape_html(unit))
  end

  -- Add icon if provided
  local icon_html = ''
  if icon then
    local icon_char = html_utils.get_icon(icon)
    icon_html = html_utils.bem_span('value-box', 'icon', nil, { ['aria-hidden'] = 'true' },
      utils.escape_html(icon_char))
  end

  -- Build value row
  local value_row_html = html_utils.bem_div('value-box', 'value', nil, nil, value_html .. icon_html)

  -- Build label
  local label_html = html_utils.bem_div('value-box', 'label', nil, nil, utils.escape_html(label))

  -- Build wrapper
  local aria_label = label .. ': ' .. value
  if unit then
    aria_label = aria_label .. unit
  end

  return string.format('<div class="%s"%s role="figure" aria-label="%s">%s%s</div>',
    classes,
    style_attr,
    utils.escape_attribute(aria_label),
    value_row_html,
    label_html)
end

--- Render a badge component.
--- @param kwargs table Keyword arguments from shortcode
--- @param config ShortcodeConfig|nil Configuration options
--- @return string HTML string for the badge
M.render_badge = function(kwargs, config)
  config = config or M.HTML_CONFIG

  local text = to_string(kwargs.text) or to_string(kwargs[1]) or ''
  local colour = utils.get_colour(kwargs, 'neutral')
  local icon = to_string(kwargs.icon)

  local modifier = html_utils.get_colour_modifier(colour) or colour
  local base_class = html_utils.bem_class('badge')
  local mod_class = html_utils.bem_class('badge', nil, modifier)
  local classes = base_class .. ' ' .. mod_class

  local icon_html = ''
  if icon then
    local icon_char = html_utils.get_icon(icon)
    icon_html = html_utils.bem_span('badge', 'icon', nil, { ['aria-hidden'] = 'true' }, utils.escape_html(icon_char)) ..
        ' '
  end

  local text_html = html_utils.bem_span('badge', 'text', nil, nil, utils.escape_html(text))

  return string.format('<span class="%s">%s%s</span>', classes, icon_html, text_html)
end

-- ============================================================================
-- MODULE EXPORT
-- ============================================================================

return M
