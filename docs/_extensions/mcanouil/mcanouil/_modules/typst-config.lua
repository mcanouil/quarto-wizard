--- @module typst-config
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @version 1.0.0
--- @brief Configuration parsing and validation for typst-markdown filter
--- @description Handles loading and merging built-in and user-provided element mappings

-- ============================================================================
-- MODULE IMPORTS
-- ============================================================================

local utils = require(
  quarto.utils.resolve_path('../_modules/utils.lua'):gsub('%.lua$', '')
)

-- ============================================================================
-- CONSTANTS
-- ============================================================================

--- @type string Extension name for logging
local EXTENSION_NAME = 'typst-markdown'

--- @type string Section name under extensions.mcanouil
local SECTION_NAME = 'typst-markdown'

-- ============================================================================
-- BUILT-IN MAPPINGS
-- ============================================================================

--- Get built-in element mappings.
--- Returns the default mappings that are always available.
--- @return table<string, table<string, table>> Built-in mappings with div, span, table, image categories.
--- Each category maps class names to configuration tables with wrapper and arguments fields.
local function get_builtin_mappings()
  return {
    div = {
      ['highlight'] = {
        wrapper = 'mcanouil-highlight',
        arguments = false
      },
      ['value-box'] = {
        wrapper = 'mcanouil-value-box',
        arguments = true
      },
      ['panel'] = {
        wrapper = 'mcanouil-panel',
        arguments = true
      },
      ['divider'] = {
        wrapper = 'mcanouil-divider',
        arguments = true
      },
      ['progress'] = {
        wrapper = 'mcanouil-progress',
        arguments = true
      },
      ['executive-summary'] = {
        wrapper = 'mcanouil-executive-summary',
        arguments = true
      },
      ['card-grid'] = {
        wrapper = 'mcanouil-card-grid',
        arguments = true
      },
      ['card'] = {
        wrapper = 'mcanouil-card',
        arguments = true
      }
    },
    span = {
      ['badge'] = {
        wrapper = 'mcanouil-badge',
        arguments = true
      }
    },
    table = {},
    image = {}
  }
end

-- ============================================================================
-- CONFIGURATION PARSING
-- ============================================================================

--- Validate and parse user configuration.
--- Converts user-provided configuration to internal format with validation.
--- @param config any User configuration value (can be Pandoc object or Lua type)
--- @param class string The class name for error messages
--- @return table|nil Parsed configuration table with wrapper and arguments fields, or nil if invalid
local function parse_and_validate_config(config, class)
  -- Try to convert Pandoc objects to strings first
  local config_str = utils.stringify(config)

  -- Check if it's a simple string value (e.g., 'highlight: mcanouil-highlight')
  if type(config) == 'string' or (config_str and not string.find(config_str, '[%{%[]')) then
    if utils.is_empty(config_str) then
      utils.log_warning(
        EXTENSION_NAME,
        'Empty function name for class "' .. class .. '"'
      )
      return nil
    end
    -- Use the configured function name directly as the wrapper
    return {
      wrapper = config_str,
      arguments = false
    }
  elseif type(config) == 'table' then
    -- Table configuration (e.g., 'highlight: {function: my-func, arguments: true}')
    local func_name = config['function']
    if not func_name then
      utils.log_warning(
        EXTENSION_NAME,
        'Missing "function" key for class "' .. class .. '". ' ..
        'Use: ' .. class .. ': function-name or ' .. class .. ': {function: function-name}'
      )
      return nil
    end
    local func_name_str = utils.stringify(func_name)
    -- Use the configured function name directly as the wrapper
    return {
      wrapper = func_name_str,
      arguments = config['arguments'] == true
    }
  else
    utils.log_warning(
      EXTENSION_NAME,
      'Invalid configuration for class "' .. class .. '". ' ..
      'Expected string or table, got ' .. type(config)
    )
    return nil
  end
end

--- Load element mappings from user configuration.
--- Reads configuration from document metadata under extensions.mcanouil.typst-markdown.
--- @param meta pandoc.Meta Document metadata containing extension configuration
--- @return table<string, table<string, table>> User mappings with div, span, table, image categories
local function load_element_mappings(meta)
  local user_mappings = {
    div = {},
    span = {},
    table = {},
    image = {}
  }

  -- Read configuration from extensions.mcanouil.typst-markdown
  local extension_config = meta.extensions and meta.extensions.mcanouil
      and meta.extensions.mcanouil[SECTION_NAME]
  if not extension_config then
    return user_mappings
  end

  -- Process each element type
  local element_types = {
    { config_key = 'divs',   mappings_key = 'div' },
    { config_key = 'spans',  mappings_key = 'span' },
    { config_key = 'tables', mappings_key = 'table' },
    { config_key = 'images', mappings_key = 'image' }
  }

  for _, element_type in ipairs(element_types) do
    if extension_config[element_type.config_key] then
      for class, config in pairs(extension_config[element_type.config_key]) do
        local parsed = parse_and_validate_config(config, class)
        if parsed then
          user_mappings[element_type.mappings_key][class] = parsed
        end
      end
    end
  end

  return user_mappings
end

--- Merge built-in and user configurations.
--- User configuration overrides built-in defaults for the same class.
--- @param builtin table<string, table> Built-in configuration mapping class names to configs
--- @param user table<string, table> User configuration mapping class names to configs
--- @return table<string, table> Merged configuration with user values taking precedence
local function merge_configurations(builtin, user)
  local merged = {}

  -- Start with built-in configuration
  for class, config in pairs(builtin) do
    merged[class] = config
  end

  -- Override with user configuration
  for class, config in pairs(user) do
    merged[class] = config
  end

  return merged
end

-- ============================================================================
-- MODULE EXPORTS
-- ============================================================================

return {
  get_builtin_mappings = get_builtin_mappings,
  parse_and_validate_config = parse_and_validate_config,
  load_element_mappings = load_element_mappings,
  merge_configurations = merge_configurations
}
