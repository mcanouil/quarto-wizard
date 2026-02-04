--- @module html-utils
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @version 1.0.0
--- @brief HTML-specific utility functions for component rendering
--- @description Provides value conversion, escaping, and element generation for HTML output.

-- ============================================================================
-- MODULE IMPORTS
-- ============================================================================

local utils = require(
  quarto.utils.resolve_path('../_modules/utils.lua'):gsub('%.lua$', '')
)

local M = {}

-- ============================================================================
-- CONSTANTS
-- ============================================================================

--- @type string BEM prefix for component classes
M.BEM_PREFIX = 'mc'

--- @type table<string, string> Colour name mappings to CSS class modifiers
M.COLOUR_CLASSES = {
  info = 'info',
  success = 'success',
  warning = 'warning',
  danger = 'danger',
  caution = 'caution',
  neutral = 'neutral',
  subtle = 'subtle',
  emphasis = 'emphasis',
  accent = 'accent',
  outline = 'outline'
}

--- @type table<string, string> Icon shortcut mappings
M.ICON_SHORTCUTS = {
  up = '↑',
  down = '↓',
  stable = '—'
}

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

--- Build HTML attribute string from a table of key-value pairs.
--- Handles boolean attributes (true = present, false = omitted).
---
--- @param attrs table<string, any> Attribute key-value pairs
--- @return string Space-prefixed attribute string (e.g., ' class="foo" id="bar"')
--- @usage local attr_str = M.build_attributes({class = 'panel', id = 'main'})
M.build_attributes = function(attrs)
  if not attrs or next(attrs) == nil then
    return ''
  end

  local attr_items = {}
  for key, value in pairs(attrs) do
    if value == true then
      -- Boolean attribute (e.g., disabled, hidden)
      table.insert(attr_items, key)
    elseif value and value ~= false then
      -- Standard attribute
      table.insert(attr_items, string.format('%s="%s"', key, utils.escape_attribute(tostring(value))))
    end
  end

  if #attr_items == 0 then
    return ''
  end

  return ' ' .. table.concat(attr_items, ' ')
end

--- Build BEM class name.
--- Constructs a class name following the BEM (Block Element Modifier) convention.
---
--- @param block string The block name (e.g., 'panel')
--- @param element string|nil The element name (e.g., 'header')
--- @param modifier string|nil The modifier name (e.g., 'info')
--- @return string BEM class name (e.g., 'mcanouil-panel__header--info')
--- @usage local cls = M.bem_class('panel', 'header', 'info')
M.bem_class = function(block, element, modifier)
  local class = M.BEM_PREFIX .. '-' .. block
  if element then
    class = class .. '__' .. element
  end
  if modifier then
    class = class .. '--' .. modifier
  end
  return class
end

--- Build multiple BEM class names.
--- Returns space-separated class names for use in class attribute.
---
--- @param block string The block name
--- @param modifiers table|nil Array of modifier names to apply
--- @return string Space-separated class names
--- @usage local cls = M.bem_classes('panel', {'info', 'large'})
M.bem_classes = function(block, modifiers)
  local classes = { M.bem_class(block) }
  if modifiers then
    for _, mod in ipairs(modifiers) do
      if mod and mod ~= '' then
        table.insert(classes, M.bem_class(block, nil, mod))
      end
    end
  end
  return table.concat(classes, ' ')
end

--- Get colour class modifier.
--- Maps colour names to CSS class modifiers.
---
--- @param colour string|nil The colour name (e.g., 'success', 'warning')
--- @return string|nil The CSS class modifier or nil if not found
--- @usage local mod = M.get_colour_modifier('success') -- returns 'success'
M.get_colour_modifier = function(colour)
  local str = utils.to_string(colour)
  if not str or str == '' then return nil end
  return M.COLOUR_CLASSES[str:lower()]
end

--- Get icon character.
--- Maps icon shortcuts to actual characters.
---
--- @param icon string|nil The icon name or character
--- @return string|nil The icon character or the original value if not a shortcut
--- @usage local char = M.get_icon('up') -- returns '↑'
--- @usage local char = M.get_icon('✓') -- returns '✓'
M.get_icon = function(icon)
  local str = utils.to_string(icon)
  if not str or str == '' then return nil end
  return M.ICON_SHORTCUTS[str:lower()] or str
end

--- Build an HTML element.
--- Constructs a complete HTML element with tag, attributes, and content.
---
--- @param tag string The HTML tag name (e.g., 'div', 'span')
--- @param attrs table|nil Attribute key-value pairs
--- @param content string|nil The inner content (can include nested HTML)
--- @param self_closing boolean|nil If true, generates self-closing tag (e.g., <hr />)
--- @return string Complete HTML element string
--- @usage local html = M.build_element('div', {class = 'panel'}, 'Content')
M.build_element = function(tag, attrs, content, self_closing)
  local attr_str = M.build_attributes(attrs or {})
  if self_closing then
    return string.format('<%s%s />', tag, attr_str)
  elseif content then
    return string.format('<%s%s>%s</%s>', tag, attr_str, content, tag)
  else
    return string.format('<%s%s></%s>', tag, attr_str, tag)
  end
end

--- Build a div element with BEM classes.
--- Convenience function for building component div elements.
---
--- @param block string The BEM block name
--- @param element string|nil The BEM element name
--- @param modifier string|nil The BEM modifier name
--- @param attrs table|nil Additional attributes (merged with class)
--- @param content string|nil The inner content
--- @return string Complete div element string
--- @usage local html = M.bem_div('panel', 'header', 'info', {role = 'banner'}, 'Title')
M.bem_div = function(block, element, modifier, attrs, content)
  local classes = M.bem_class(block, element, modifier)
  local merged_attrs = attrs or {}

  -- Merge class attribute
  if merged_attrs.class then
    merged_attrs.class = classes .. ' ' .. merged_attrs.class
  else
    merged_attrs.class = classes
  end

  return M.build_element('div', merged_attrs, content)
end

--- Build a span element with BEM classes.
--- Convenience function for building component span elements.
---
--- @param block string The BEM block name
--- @param element string|nil The BEM element name
--- @param modifier string|nil The BEM modifier name
--- @param attrs table|nil Additional attributes (merged with class)
--- @param content string|nil The inner content
--- @return string Complete span element string
--- @usage local html = M.bem_span('badge', nil, 'success', nil, 'Done')
M.bem_span = function(block, element, modifier, attrs, content)
  local classes = M.bem_class(block, element, modifier)
  local merged_attrs = attrs or {}

  -- Merge class attribute
  if merged_attrs.class then
    merged_attrs.class = classes .. ' ' .. merged_attrs.class
  else
    merged_attrs.class = classes
  end

  return M.build_element('span', merged_attrs, content)
end

-- ============================================================================
-- SHORTCODE UTILITIES
-- ============================================================================

--- Create a shortcode handler for HTML format.
--- Factory function that returns a shortcode handler for a given component.
---
--- @param render_fn function Function that takes (kwargs) and returns HTML string
--- @return function Shortcode handler returning pandoc.RawBlock or pandoc.Null
--- @usage return { ['divider'] = M.create_shortcode_handler(render_divider) }
M.create_shortcode_handler = function(render_fn)
  return function(_args, kwargs, _meta)
    if not quarto.doc.is_format('html') then
      return pandoc.Null()
    end
    local html = render_fn(kwargs)
    return pandoc.RawBlock('html', html)
  end
end

--- Create an inline shortcode handler for HTML format.
--- Factory function for shortcodes that return inline elements.
---
--- @param render_fn function Function that takes (kwargs) and returns HTML string
--- @return function Shortcode handler returning pandoc.RawInline or pandoc.Null
--- @usage return { ['badge'] = M.create_inline_shortcode_handler(render_badge) }
M.create_inline_shortcode_handler = function(render_fn)
  return function(_args, kwargs, _meta)
    if not quarto.doc.is_format('html') then
      return pandoc.Null()
    end
    local html = render_fn(kwargs)
    return pandoc.RawInline('html', html)
  end
end

-- ============================================================================
-- COMPONENT RENDER FUNCTIONS
-- ============================================================================

--- Render a divider component.
--- Generates minimal HTML; CSS handles all visual styling via BEM classes and custom properties.
---
--- @param kwargs table Keyword arguments from shortcode
--- @param config table|nil Configuration with class_prefix and defaults
--- @return string HTML string for the divider
--- @usage local html = M.render_divider({style = 'dashed', width = '80%'}, {class_prefix = ''})
M.render_divider = function(kwargs, config)
  config = config or {}
  local class_prefix = config.class_prefix or ''

  local style = utils.to_string(kwargs.style) or 'solid'
  local label = utils.to_string(kwargs.label)
  local thickness = utils.to_string(kwargs.thickness) or '1pt'
  local width = utils.to_string(kwargs.width) or '50%'

  local base_class = class_prefix .. M.bem_class('divider')
  local mod_class = M.bem_class('divider', nil, style)
  local classes = base_class .. ' ' .. mod_class

  local style_attr = string.format('--divider-thickness: %s; --divider-width: %s;', thickness, width)

  if label then
    -- Divider with label
    local label_html = M.bem_span('divider', 'label', nil, nil, utils.escape_html(label))
    return string.format('<div class="%s" style="%s" role="separator" aria-label="%s">%s</div>',
      classes, style_attr, utils.escape_attribute(label), label_html)
  else
    -- Simple divider
    return string.format('<hr class="%s" style="%s" />',
      classes, style_attr)
  end
end

--- Render a progress bar component.
--- Generates minimal HTML; CSS handles all visual styling via BEM classes and custom properties.
---
--- @param kwargs table Keyword arguments from shortcode
--- @param config table|nil Configuration with class_prefix and defaults
--- @return string HTML string for the progress bar
--- @usage local html = M.render_progress({value = 75, colour = 'success'}, {class_prefix = ''})
M.render_progress = function(kwargs, config)
  config = config or {}
  local class_prefix = config.class_prefix or ''
  local default_height = (config.defaults and config.defaults.progress_height) or '1.5em'

  local value = tonumber(utils.to_string(kwargs.value)) or 0
  local label = utils.to_string(kwargs.label)
  local colour = utils.get_colour(kwargs, 'info')
  local show_value = utils.to_string(kwargs['show-value']) ~= 'false'
  local height = utils.to_string(kwargs.height) or default_height

  -- Handle custom colours (hex, rgb, hsl)
  local modifier = M.get_colour_modifier(colour)
  local custom_colour_style = ''
  if utils.is_custom_colour(colour) then
    modifier = 'custom'
    custom_colour_style = string.format(' --custom-colour: %s;', utils.escape_attribute(colour))
  elseif not modifier then
    modifier = colour
  end

  local base_class = class_prefix .. M.bem_class('progress')
  local mod_class = M.bem_class('progress', nil, modifier)
  local classes = base_class .. ' ' .. mod_class

  local style_attr = string.format('--progress-height: %s;%s', height, custom_colour_style)

  -- Build inner bar
  local bar_style = string.format('width: %d%%;', math.min(100, math.max(0, value)))
  local bar_content = ''
  if show_value then
    bar_content = string.format('<span class="%s">%d%%</span>',
      M.bem_class('progress', 'value'),
      value)
  end
  local bar_html = string.format(
    '<div class="%s" style="%s" role="progressbar" aria-valuenow="%d" aria-valuemin="0" aria-valuemax="100">%s</div>',
    M.bem_class('progress', 'bar'),
    bar_style,
    value,
    bar_content)

  -- Build wrapper
  local wrapper_html = string.format('<div class="%s" style="%s">%s</div>',
    classes, style_attr, bar_html)

  -- Add label if provided
  if label then
    local label_html = string.format('<div class="%s">%s</div>',
      M.bem_class('progress', 'label'),
      utils.escape_html(label))
    return string.format('<div class="%s">%s%s</div>',
      M.bem_class('progress', 'container'),
      label_html,
      wrapper_html)
  end

  return wrapper_html
end

-- ============================================================================
-- MODULE EXPORT
-- ============================================================================

return M
