--- @module typst-wrapper
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @version 1.0.0
--- @brief Wrapper generation utilities for typst-markdown filter
--- @description Handles building Typst function calls and block wrappers

-- ============================================================================
-- MODULE IMPORTS
-- ============================================================================

local typst_utils = require(
  quarto.utils.resolve_path('../_modules/typst-utils.lua'):gsub('%.lua$', '')
)
local utils = require(
  quarto.utils.resolve_path('../_modules/utils.lua'):gsub('%.lua$', '')
)

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Use shared attributes_to_table from utils module
local attributes_to_table = utils.attributes_to_table

--- Build Typst attribute string from a table of key-value pairs
--- @param attrs table Attribute key-value pairs
--- @return string Comma-separated Typst attribute string (e.g., "key1: value1, key2: value2")
local function build_attribute_string(attrs)
  local attr_items = {}
  for key, value in pairs(attrs) do
    table.insert(attr_items, string.format('%s: %s', key, typst_utils.typst_value(value)))
  end
  return table.concat(attr_items, ', ')
end

--- Extract first heading from element content and set as title attribute
--- If the first element is a Header, extracts its text as title and removes it from content
--- @param el pandoc.Div Element with content
--- @param attrs table Attributes table to modify
--- @return nil Modifies el.content and attrs in place
local function extract_first_heading_as_title(el, attrs)
  if not attrs['title'] and #el.content > 0 then
    local first_elem = el.content[1]
    -- Check if first element is a header
    if first_elem.t == 'Header' then
      -- Extract header text as title
      attrs['title'] = utils.stringify(first_elem.content)
      -- Remove header from content
      local new_content = {}
      for i = 2, #el.content do
        table.insert(new_content, el.content[i])
      end
      el.content = new_content
    end
  end
end

--- Build Typst function call with optional attributes
--- @param wrapper_name string The wrapper function name (e.g., 'mcanouil-aside')
--- @param content string The content to wrap
--- @param attributes table|nil Optional attributes to pass
--- @param arguments boolean Whether to pass attributes
--- @return string Typst function call
local function build_function_call(wrapper_name, content, attributes, arguments)
  if arguments and attributes and next(attributes) ~= nil then
    local attr_string = build_attribute_string(attributes)
    return string.format('#%s(%s)[%s]', wrapper_name, attr_string, content)
  else
    return string.format('#%s[%s]', wrapper_name, content)
  end
end

--- Build Typst block wrappers with optional attributes for Div/Table elements
--- @param config table Configuration with wrapper and arguments fields
--- @param attrs table Element attributes
--- @return string, string Opening and closing wrappers
local function build_typst_block_wrappers(config, attrs)
  local has_attributes = next(attrs) ~= nil
  local include_attributes = config.arguments or has_attributes

  if include_attributes and has_attributes then
    local attr_string = build_attribute_string(attrs)
    return string.format('#%s(%s)[', config.wrapper, attr_string), ']'
  else
    return string.format('#%s[', config.wrapper), ']'
  end
end

--- Build Typst function call for atomic components (no content wrapping)
--- @param config table Configuration with wrapper field
--- @param attrs table Element attributes
--- @return pandoc.RawBlock Typst code block
local function build_atomic_function_call(config, attrs)
  local has_attributes = next(attrs) ~= nil
  if has_attributes then
    local attr_string = build_attribute_string(attrs)
    return pandoc.RawBlock('typst', string.format('#%s(%s)[]', config.wrapper, attr_string))
  else
    return pandoc.RawBlock('typst', string.format('#%s[]', config.wrapper))
  end
end

--- Build wrapped content for components that contain child elements
--- @param div pandoc.Div Div element with content
--- @param config table Configuration with wrapper field
--- @param extract_title boolean Whether to extract first heading as title
--- @return table List of pandoc elements (opening wrapper, content, closing wrapper)
local function build_wrapped_content(div, config, extract_title)
  local attrs = attributes_to_table(div)
  if extract_title then
    extract_first_heading_as_title(div, attrs)
  end
  local opening, closing = build_typst_block_wrappers(config, attrs)
  local result = { pandoc.RawBlock('typst', opening) }
  for _, item in ipairs(div.content) do
    table.insert(result, item)
  end
  table.insert(result, pandoc.RawBlock('typst', closing))
  return result
end

-- ============================================================================
-- HANDLER FACTORIES
-- ============================================================================

--- Create handler for atomic components (no content, only attributes)
--- @return function Handler function taking (div, config) and returning pandoc.RawBlock
local function create_atomic_handler()
  return function(div, config)
    local attrs = attributes_to_table(div)
    return build_atomic_function_call(config, attrs)
  end
end

--- Create handler for wrapped content components
--- @param extract_title boolean Whether to extract first heading as title
--- @return function Handler function taking (div, config) and returning table
local function create_wrapped_handler(extract_title)
  return function(div, config)
    return build_wrapped_content(div, config, extract_title)
  end
end

-- ============================================================================
-- MODULE EXPORTS
-- ============================================================================

return {
  attributes_to_table = attributes_to_table,
  typst_value = typst_utils.typst_value,
  extract_first_heading_as_title = extract_first_heading_as_title,
  build_function_call = build_function_call,
  build_typst_block_wrappers = build_typst_block_wrappers,
  build_atomic_function_call = build_atomic_function_call,
  build_wrapped_content = build_wrapped_content,
  create_atomic_handler = create_atomic_handler,
  create_wrapped_handler = create_wrapped_handler
}
