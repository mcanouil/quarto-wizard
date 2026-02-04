--- @module component-renderers
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @version 1.0.0
--- @brief Shared component renderers for HTML-based formats
--- @description Provides parameterised renderer functions for div/span components.

-- ============================================================================
-- MODULE IMPORTS
-- ============================================================================

local html_utils = require(
  quarto.utils.resolve_path('../_modules/html-utils.lua'):gsub('%.lua$', '')
)
local utils = require(
  quarto.utils.resolve_path('../_modules/utils.lua'):gsub('%.lua$', '')
)
local wrapper = require(
  quarto.utils.resolve_path('../_modules/html-wrapper.lua'):gsub('%.lua$', '')
)

local M = {}

-- ============================================================================
-- CONFIGURATION
-- ============================================================================

--- @class FormatConfig
--- @field class_prefix string Extra class prefix (e.g., 'reveal-component ')
--- @field defaults table Format-specific defaults

--- Default configuration for HTML format
M.HTML_CONFIG = {
  class_prefix = '',
  defaults = {
    columns = '3',
    horizontal = false
  }
}

--- Default configuration for Reveal.js format
M.REVEALJS_CONFIG = {
  class_prefix = 'reveal-component ',
  defaults = {
    columns = '2',
    horizontal = true
  }
}

-- ============================================================================
-- COMPONENT RENDERERS
-- ============================================================================

--- Render a panel component.
--- @param div pandoc.Div The div element
--- @param config FormatConfig|nil Configuration options
--- @return table List of pandoc elements
M.render_panel = function(div, config)
  config = config or M.HTML_CONFIG
  local class_prefix = config.class_prefix or ''

  local attrs = wrapper.attributes_to_table(div)
  wrapper.extract_first_heading_as_title(div, attrs)

  local style = attrs.style or 'subtle'
  local modifier = html_utils.get_colour_modifier(style)
  local base_class = html_utils.bem_class('panel')
  local mod_class = modifier and html_utils.bem_class('panel', nil, modifier) or ''

  local classes = class_prefix .. base_class
  if mod_class ~= '' then
    classes = classes .. ' ' .. mod_class
  end

  -- Build header
  local header_html = ''
  if attrs.title then
    local icon_html = ''
    if attrs.icon then
      local icon_char = html_utils.get_icon(attrs.icon)
      icon_html = html_utils.bem_span('panel', 'icon', nil, { ['aria-hidden'] = 'true' },
        utils.escape_html(icon_char)) .. ' '
    end
    local title_html = html_utils.bem_span('panel', 'title', nil, nil, utils.escape_html(attrs.title))
    header_html = html_utils.bem_div('panel', 'header', nil, nil, icon_html .. title_html)
  end

  -- Build wrapper
  local wrapper_attrs = {
    class = classes,
    role = 'region'
  }
  if attrs.title then
    wrapper_attrs['aria-label'] = attrs.title
  end

  local result = { pandoc.RawBlock('html', string.format('<div%s>', html_utils.build_attributes(wrapper_attrs))) }

  if header_html ~= '' then
    table.insert(result, pandoc.RawBlock('html', header_html))
  end

  -- Content wrapper
  table.insert(result,
    pandoc.RawBlock('html', string.format('<div class="%s">', html_utils.bem_class('panel', 'content'))))

  for _, item in ipairs(div.content) do
    table.insert(result, item)
  end

  table.insert(result, pandoc.RawBlock('html', '</div></div>'))

  return result
end

--- Render an executive summary component.
--- @param div pandoc.Div The div element
--- @param config FormatConfig|nil Configuration options
--- @return table List of pandoc elements
M.render_executive_summary = function(div, config)
  config = config or M.HTML_CONFIG
  local class_prefix = config.class_prefix or ''

  local attrs = wrapper.attributes_to_table(div)
  wrapper.extract_first_heading_as_title(div, attrs)

  local title = attrs.title or 'Executive Summary'
  local show_brackets = attrs['show-corner-brackets'] == 'true'

  local base_class = class_prefix .. html_utils.bem_class('executive-summary')

  -- Build brackets
  local brackets_html = ''
  if show_brackets then
    brackets_html = html_utils.bem_div('executive-summary', 'brackets', nil, { ['aria-hidden'] = 'true' }, '')
  end

  -- Build title
  local title_html = string.format('<h2 class="%s">%s</h2>',
    html_utils.bem_class('executive-summary', 'title'),
    utils.escape_html(title))

  -- Separator
  local separator_html = string.format('<hr class="%s" />',
    html_utils.bem_class('executive-summary', 'separator'))

  local wrapper_attrs = {
    class = base_class,
    role = 'region',
    ['aria-label'] = title
  }

  local result = { pandoc.RawBlock('html', string.format('<div%s>', html_utils.build_attributes(wrapper_attrs))) }

  if brackets_html ~= '' then
    table.insert(result, pandoc.RawBlock('html', brackets_html))
  end

  table.insert(result, pandoc.RawBlock('html', title_html))
  table.insert(result, pandoc.RawBlock('html', separator_html))

  -- Content wrapper
  table.insert(result,
    pandoc.RawBlock('html', string.format('<div class="%s">', html_utils.bem_class('executive-summary', 'content'))))

  for _, item in ipairs(div.content) do
    table.insert(result, item)
  end

  table.insert(result, pandoc.RawBlock('html', '</div></div>'))

  return result
end

--- Render a single card.
--- @param div pandoc.Div The card div element
--- @param config FormatConfig|nil Configuration options
--- @return table List of pandoc elements
M.render_card = function(div, config)
  config = config or M.HTML_CONFIG

  local attrs = wrapper.attributes_to_table(div)
  wrapper.extract_first_heading_as_title(div, attrs)

  local style = attrs.style or 'subtle'
  local modifier = html_utils.get_colour_modifier(style) or style
  local base_class = html_utils.bem_class('card')
  local mod_class = html_utils.bem_class('card', nil, modifier)

  local classes = base_class .. ' ' .. mod_class

  -- Check for custom colour
  local style_attr = ''
  if attrs.colour then
    style_attr = string.format(' style="--card-accent: %s;"', utils.escape_attribute(attrs.colour))
  end

  local result = { pandoc.RawBlock('html', string.format('<div class="%s"%s>', classes, style_attr)) }

  -- Header with title
  if attrs.title then
    local header_html = string.format('<div class="%s"><h3 class="%s">%s</h3></div>',
      html_utils.bem_class('card', 'header'),
      html_utils.bem_class('card', 'title'),
      utils.escape_html(attrs.title))
    table.insert(result, pandoc.RawBlock('html', header_html))
  end

  -- Body content
  table.insert(result, pandoc.RawBlock('html', string.format('<div class="%s">', html_utils.bem_class('card', 'body'))))

  -- Process content, separating footer
  -- Supports both explicit .card-footer divs and HorizontalRule (---) separator
  local footer_content = {}
  local body_content = {}
  local found_hr = false

  for _, item in ipairs(div.content) do
    if item.t == 'Div' and item.classes and item.classes:includes('card-footer') then
      -- Explicit card-footer div
      for _, footer_item in ipairs(item.content) do
        table.insert(footer_content, footer_item)
      end
    elseif item.t == 'HorizontalRule' then
      -- HorizontalRule marks start of footer section
      found_hr = true
    elseif found_hr then
      -- Content after HorizontalRule goes to footer
      table.insert(footer_content, item)
    else
      -- Content before HorizontalRule goes to body
      table.insert(body_content, item)
    end
  end

  for _, item in ipairs(body_content) do
    table.insert(result, item)
  end

  table.insert(result, pandoc.RawBlock('html', '</div>'))

  -- Footer if present
  if #footer_content > 0 then
    table.insert(result,
      pandoc.RawBlock('html', string.format('<div class="%s">', html_utils.bem_class('card', 'footer'))))
    for _, item in ipairs(footer_content) do
      table.insert(result, item)
    end
    table.insert(result, pandoc.RawBlock('html', '</div>'))
  end

  table.insert(result, pandoc.RawBlock('html', '</div>'))

  return result
end

--- Render a card grid component.
--- @param div pandoc.Div The div element
--- @param config FormatConfig|nil Configuration options
--- @return table List of pandoc elements
M.render_card_grid = function(div, config)
  config = config or M.HTML_CONFIG
  local class_prefix = config.class_prefix or ''
  local default_columns = config.defaults and config.defaults.columns or '3'

  local attrs = wrapper.attributes_to_table(div)
  local columns = attrs.columns or default_columns

  local grid_class = class_prefix .. html_utils.bem_class('card-grid')
  local style_attr = string.format('--card-columns: %s;', columns)

  local result = { pandoc.RawBlock('html', string.format('<div class="%s" style="%s">', grid_class, style_attr)) }

  -- Process child divs as cards
  for _, item in ipairs(div.content) do
    if item.t == 'Div' and item.classes and item.classes:includes('card') then
      local card_html = M.render_card(item, config)
      for _, block in ipairs(card_html) do
        table.insert(result, block)
      end
    else
      table.insert(result, item)
    end
  end

  table.insert(result, pandoc.RawBlock('html', '</div>'))

  return result
end

--- Render a badge span.
--- @param span pandoc.Span The span element
--- @param config FormatConfig|nil Configuration options
--- @return pandoc.RawInline The rendered badge
M.render_badge = function(span, config)
  config = config or M.HTML_CONFIG

  local attrs = wrapper.attributes_to_table(span)
  local content = pandoc.utils.stringify(span.content)

  local colour = attrs.colour or attrs.color or 'neutral'
  local modifier = html_utils.get_colour_modifier(colour) or colour
  local base_class = html_utils.bem_class('badge')
  local mod_class = html_utils.bem_class('badge', nil, modifier)
  local classes = base_class .. ' ' .. mod_class

  local icon_html = ''
  if attrs.icon then
    local icon_char = html_utils.get_icon(attrs.icon)
    icon_html = html_utils.bem_span('badge', 'icon', nil, { ['aria-hidden'] = 'true' }, utils.escape_html(icon_char)) ..
    ' '
  end

  local text_html = html_utils.bem_span('badge', 'text', nil, nil, utils.escape_html(content))

  local html = string.format('<span class="%s">%s%s</span>', classes, icon_html, text_html)

  return pandoc.RawInline('html', html)
end

-- ============================================================================
-- MODULE EXPORT
-- ============================================================================

return M
