--- @module html-wrapper
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @version 1.0.0
--- @brief Wrapper generation utilities for HTML component rendering
--- @description Handles building HTML wrappers and extracting content from Pandoc elements

-- ============================================================================
-- MODULE IMPORTS
-- ============================================================================

local html_utils = require(
  quarto.utils.resolve_path('../_modules/html-utils.lua'):gsub('%.lua$', '')
)
local utils = require(
  quarto.utils.resolve_path('../_modules/utils.lua'):gsub('%.lua$', '')
)

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Use shared attributes_to_table from utils module
local attributes_to_table = utils.attributes_to_table

--- Extract first heading from element content and set as title attribute.
--- If the first element is a Header, extracts its text as title and removes it from content.
--- @param el pandoc.Div Element with content
--- @param attrs table Attributes table to modify
--- @return nil Modifies el.content and attrs in place
local function extract_first_heading_as_title(el, attrs)
  if not attrs['title'] and #el.content > 0 then
    local first_elem = el.content[1]
    -- Check if first element is a header
    if first_elem.t == 'Header' then
      -- Extract header text as title
      attrs['title'] = pandoc.utils.stringify(first_elem.content)
      -- Remove header from content
      local new_content = {}
      for i = 2, #el.content do
        table.insert(new_content, el.content[i])
      end
      el.content = new_content
    end
  end
end

--- Render Pandoc content to HTML string.
--- @param content table Pandoc content (list of blocks or inlines)
--- @return string HTML string representation
local function render_content_to_html(content)
  if not content or #content == 0 then
    return ''
  end
  -- Render content as HTML
  local doc = pandoc.Pandoc(content)
  local html = pandoc.write(doc, 'html')
  return html
end

--- Build opening HTML tag with BEM classes and attributes.
--- @param block string The BEM block name
--- @param attrs table Element attributes
--- @param extra_attrs table|nil Additional HTML attributes
--- @return string Opening HTML tag
local function build_opening_tag(block, attrs, extra_attrs)
  local modifier = html_utils.get_colour_modifier(attrs.style or attrs.colour)
  local class = html_utils.bem_classes(block, modifier and { modifier } or nil)

  local html_attrs = extra_attrs or {}
  html_attrs.class = class

  -- Add role for accessibility if appropriate
  if block == 'panel' or block == 'executive-summary' then
    html_attrs.role = html_attrs.role or 'region'
  end

  -- Add aria-label if title is provided
  if attrs.title then
    html_attrs['aria-label'] = attrs.title
  end

  return string.format('<div%s>', html_utils.build_attributes(html_attrs))
end

--- Build closing HTML tag.
--- @return string Closing div tag
local function build_closing_tag()
  return '</div>'
end

-- ============================================================================
-- COMPONENT RENDERERS
-- ============================================================================

--- Render panel header with optional icon and title.
--- @param block string The BEM block name
--- @param attrs table Attributes with title and icon
--- @return string|nil HTML string for header or nil if no title
local function render_header(block, attrs)
  if not attrs.title then
    return nil
  end

  local icon_html = ''
  if attrs.icon then
    local icon_char = html_utils.get_icon(attrs.icon)
    icon_html = html_utils.bem_span(block, 'icon', nil, { ['aria-hidden'] = 'true' }, utils.escape_html(icon_char))
  end

  local title_html = html_utils.bem_span(block, 'title', nil, nil, utils.escape_html(attrs.title))

  return html_utils.bem_div(block, 'header', nil, nil, icon_html .. title_html)
end

--- Render content wrapper.
--- @param block string The BEM block name
--- @param content string The HTML content
--- @return string HTML string for content wrapper
local function render_content_wrapper(block, content)
  return html_utils.bem_div(block, 'content', nil, nil, content)
end

-- ============================================================================
-- HANDLER FACTORIES
-- ============================================================================

--- Create handler for wrapped content components (e.g., panel, executive-summary).
--- @param block string The BEM block name
--- @param extract_title boolean Whether to extract first heading as title
--- @param extra_attrs table|nil Additional HTML attributes for the wrapper
--- @return function Handler function taking (div, config) and returning table
local function create_wrapped_handler(block, extract_title, extra_attrs)
  return function(div, _config)
    local attrs = attributes_to_table(div)
    if extract_title then
      extract_first_heading_as_title(div, attrs)
    end

    -- Build wrapper opening tag
    local opening = build_opening_tag(block, attrs, extra_attrs)

    -- Build header if title exists
    local header = render_header(block, attrs)

    -- Build result
    local result = { pandoc.RawBlock('html', opening) }

    if header then
      table.insert(result, pandoc.RawBlock('html', header))
    end

    -- Add content wrapper opening
    table.insert(result,
      pandoc.RawBlock('html', string.format('<div class="%s">', html_utils.bem_class(block, 'content'))))

    -- Add original content
    for _, item in ipairs(div.content) do
      table.insert(result, item)
    end

    -- Close content wrapper and main wrapper
    table.insert(result, pandoc.RawBlock('html', '</div>'))
    table.insert(result, pandoc.RawBlock('html', build_closing_tag()))

    return result
  end
end

--- Create handler for atomic components (no content, only attributes).
--- @param render_fn function Function that takes attrs and returns HTML string
--- @return function Handler function taking (div, config) and returning pandoc.RawBlock
local function create_atomic_handler(render_fn)
  return function(div, _config)
    local attrs = attributes_to_table(div)
    local html = render_fn(attrs)
    return pandoc.RawBlock('html', html)
  end
end

-- ============================================================================
-- MODULE EXPORTS
-- ============================================================================

return {
  attributes_to_table = attributes_to_table,
  extract_first_heading_as_title = extract_first_heading_as_title,
  render_content_to_html = render_content_to_html,
  build_opening_tag = build_opening_tag,
  build_closing_tag = build_closing_tag,
  render_header = render_header,
  render_content_wrapper = render_content_wrapper,
  create_wrapped_handler = create_wrapped_handler,
  create_atomic_handler = create_atomic_handler
}
