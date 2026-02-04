--- @module components
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @version 1.0.0
--- @brief Format-agnostic component filter
--- @description Processes div and span components for HTML, Reveal.js, and Typst formats.
--- Delegates component processing to format-specific modules.

-- ============================================================================
-- MODULE IMPORTS
-- ============================================================================

local format_utils = require(
  quarto.utils.resolve_path('../_modules/format-utils.lua'):gsub('%.lua$', '')
)

-- Lazy-loaded modules (loaded based on format)
local html_renderers = nil
local typst_config = nil
local typst_wrapper = nil
local typst_badges = nil
local typst_card_grid = nil
local code_window = nil

-- ============================================================================
-- LAZY LOADING
-- ============================================================================

--- Load HTML modules (for HTML and Reveal.js formats)
local function load_html_modules()
  if not html_renderers then
    html_renderers = require(
      quarto.utils.resolve_path('../_modules/component-renderers.lua'):gsub('%.lua$', '')
    )
  end
end

--- Load Typst modules
local function load_typst_modules()
  if not typst_config then
    typst_config = require(
      quarto.utils.resolve_path('../_modules/typst-config.lua'):gsub('%.lua$', '')
    )
    typst_wrapper = require(
      quarto.utils.resolve_path('../_modules/typst-wrapper.lua'):gsub('%.lua$', '')
    )
    typst_badges = require(
      quarto.utils.resolve_path('../_modules/typst-badges.lua'):gsub('%.lua$', '')
    )
    typst_card_grid = require(
      quarto.utils.resolve_path('../_modules/typst-card-grid.lua'):gsub('%.lua$', '')
    )
  end
end

--- Load code-window module
local function load_code_window_module()
  if not code_window then
    code_window = require(
      quarto.utils.resolve_path('../_modules/code-window.lua'):gsub('%.lua$', '')
    )
  end
end

-- ============================================================================
-- GLOBAL CONFIGURATION
-- ============================================================================

--- @type string|nil Current format
local CURRENT_FORMAT = nil

--- @type table Format-specific configuration
local FORMAT_CONFIG = nil

--- @type table Code-window module configuration
local CODE_WINDOW_CONFIG = nil

--- @type table<string, function> Div handlers (loaded based on format)
local DIV_HANDLERS = {}

--- @type table<string, function> Span handlers (loaded based on format)
local SPAN_HANDLERS = {}

-- Typst-specific mappings (loaded from configuration)
local TYPST_DIV_MAPPINGS = {}
local TYPST_SPAN_MAPPINGS = {}

-- ============================================================================
-- METADATA PROCESSING
-- ============================================================================

--- Load configuration from document metadata
--- @param meta pandoc.Meta Document metadata
--- @return pandoc.Meta Unchanged metadata
function Meta(meta)
  CURRENT_FORMAT = format_utils.get_format()
  FORMAT_CONFIG = format_utils.get_config()

  -- Load and configure code-window module
  load_code_window_module()
  CODE_WINDOW_CONFIG = code_window.get_config(meta)

  if CURRENT_FORMAT == 'html' or CURRENT_FORMAT == 'revealjs' then
    load_html_modules()

    -- Build HTML/Reveal.js handlers
    DIV_HANDLERS = {
      ['panel'] = function(div)
        return html_renderers.render_panel(div, FORMAT_CONFIG)
      end,
      ['executive-summary'] = function(div)
        return html_renderers.render_executive_summary(div, FORMAT_CONFIG)
      end,
      ['card-grid'] = function(div)
        return html_renderers.render_card_grid(div, FORMAT_CONFIG)
      end,
      ['card'] = function(div)
        return html_renderers.render_card(div, FORMAT_CONFIG)
      end
    }

    SPAN_HANDLERS = {
      ['badge'] = function(span)
        return html_renderers.render_badge(span, FORMAT_CONFIG)
      end
    }
  elseif CURRENT_FORMAT == 'typst' then
    load_typst_modules()

    -- Load Typst configuration
    local builtin = typst_config.get_builtin_mappings()
    local user = typst_config.load_element_mappings(meta)

    TYPST_DIV_MAPPINGS = typst_config.merge_configurations(builtin.div, user.div)
    TYPST_SPAN_MAPPINGS = typst_config.merge_configurations(builtin.span, user.span)

    -- Build Typst handlers
    DIV_HANDLERS = {
      ['value-box'] = function(div, config)
        return typst_wrapper.create_atomic_handler()(div, config)
      end,
      ['panel'] = function(div, config)
        return typst_wrapper.create_wrapped_handler(true)(div, config)
      end,
      ['progress'] = function(div, config)
        return typst_wrapper.create_atomic_handler()(div, config)
      end,
      ['divider'] = function(div, config)
        return typst_wrapper.create_wrapped_handler(false)(div, config)
      end,
      ['executive-summary'] = function(div, config)
        return typst_wrapper.create_wrapped_handler(true)(div, config)
      end,
      ['card-grid'] = function(div, config)
        return typst_card_grid.process_card_grid(div, config)
      end,
      ['card'] = function(div, config)
        return typst_card_grid.process_card_div(div, config)
      end
    }

    SPAN_HANDLERS = {
      ['badge'] = function(span, config)
        return typst_badges.process_badge(span, config)
      end
    }
  end

  return meta
end

-- ============================================================================
-- ELEMENT TRANSFORMATIONS
-- ============================================================================

-- Container classes that must be processed before their children
local CONTAINER_CLASSES = {
  ['card-grid'] = true
}

--- Process container Div elements (first pass)
--- Handles divs that contain other component divs and must extract them before transformation.
--- @param div pandoc.Div Div element to process
--- @return pandoc.RawBlock|table|pandoc.Div Transformed element or original
local function DivContainers(div)
  if not CURRENT_FORMAT then
    return div
  end

  -- Only process container classes in this pass
  for _, class in ipairs(div.classes) do
    if CONTAINER_CLASSES[class] then
      if CURRENT_FORMAT == 'html' or CURRENT_FORMAT == 'revealjs' then
        local handler = DIV_HANDLERS[class]
        if handler then
          return handler(div)
        end
      elseif CURRENT_FORMAT == 'typst' then
        if TYPST_DIV_MAPPINGS[class] then
          local config = TYPST_DIV_MAPPINGS[class]
          local handler = DIV_HANDLERS[class]
          if handler then
            return handler(div, config)
          end
        end
      end
    end
  end

  return div
end

--- Process non-container Div elements (second pass)
--- Handles individual component divs after containers have been processed.
--- @param div pandoc.Div Div element to process
--- @return pandoc.RawBlock|table|pandoc.Div Transformed element or original
local function DivComponents(div)
  if not CURRENT_FORMAT then
    return div
  end

  -- Skip container classes (already processed)
  for _, class in ipairs(div.classes) do
    if CONTAINER_CLASSES[class] then
      return div
    end
  end

  if CURRENT_FORMAT == 'html' or CURRENT_FORMAT == 'revealjs' then
    -- HTML/Reveal.js processing
    for _, class in ipairs(div.classes) do
      local handler = DIV_HANDLERS[class]
      if handler then
        return handler(div)
      end
    end
  elseif CURRENT_FORMAT == 'typst' then
    -- Typst processing
    for _, class in ipairs(div.classes) do
      if TYPST_DIV_MAPPINGS[class] then
        local config = TYPST_DIV_MAPPINGS[class]
        local handler = DIV_HANDLERS[class]

        if handler then
          return handler(div, config)
        else
          -- Default Typst handling: wrap content with Typst function
          local attrs = typst_wrapper.attributes_to_table(div)
          local opening, closing = typst_wrapper.build_typst_block_wrappers(config, attrs)

          local result = { pandoc.RawBlock('typst', opening) }
          for _, item in ipairs(div.content) do
            table.insert(result, item)
          end
          table.insert(result, pandoc.RawBlock('typst', closing))

          return result
        end
      end
    end
  end

  return div
end

--- Process Span elements
--- @param span pandoc.Span Span element to process
--- @return pandoc.RawInline|pandoc.Span Transformed element or original
function Span(span)
  if not CURRENT_FORMAT then
    return span
  end

  if CURRENT_FORMAT == 'html' or CURRENT_FORMAT == 'revealjs' then
    -- HTML/Reveal.js processing
    for _, class in ipairs(span.classes) do
      local handler = SPAN_HANDLERS[class]
      if handler then
        return handler(span)
      end
    end
  elseif CURRENT_FORMAT == 'typst' then
    -- Typst processing
    for _, class in ipairs(span.classes) do
      if TYPST_SPAN_MAPPINGS[class] then
        local config = TYPST_SPAN_MAPPINGS[class]
        local handler = SPAN_HANDLERS[class]

        if handler then
          return handler(span, config)
        else
          -- Default Typst handling: wrap content with Typst function
          local content = pandoc.write(pandoc.Pandoc({ pandoc.Plain(span.content) }), 'typst')
          local attrs = typst_wrapper.attributes_to_table(span)
          local has_attributes = next(attrs) ~= nil
          local include_attributes = config.arguments or has_attributes
          local typst_code = typst_wrapper.build_function_call(config.wrapper, content, attrs, include_attributes)
          return pandoc.RawInline('typst', typst_code)
        end
      end
    end
  end

  return span
end

--- Process Table elements (placeholder for future customisation)
--- @param tbl pandoc.Table Table element to process
--- @return pandoc.Table Original table (no transformation applied yet)
function Table(tbl)
  -- Placeholder for future table customisation
  return tbl
end

--- Process Image elements (placeholder for future customisation)
--- @param img pandoc.Image Image element to process
--- @return pandoc.Image Original image (no transformation applied yet)
function Image(img)
  -- Placeholder for future image customisation
  return img
end

--- Process CodeBlock elements with filename attribute.
--- Only handles Typst format here; HTML/Reveal.js is handled by
--- filters/code-window.lua at post-quarto stage for code-annotation compatibility.
--- @param block pandoc.CodeBlock Code block element to process
--- @return pandoc.RawBlock|pandoc.CodeBlock Transformed element or original
function CodeBlock(block)
  if not CURRENT_FORMAT then
    return block
  end

  -- Only process Typst here; HTML/Reveal.js handled by post-quarto filter
  if CURRENT_FORMAT == 'typst' and CODE_WINDOW_CONFIG then
    return code_window.process_code_block(block, CURRENT_FORMAT, CODE_WINDOW_CONFIG)
  end

  return block
end

-- ============================================================================
-- FILTER EXPORTS
-- ============================================================================

-- Three-pass filter:
-- 1. Meta: Load configuration
-- 2. DivContainers: Process container divs (card-grid) before children are transformed
-- 3. DivComponents + others: Process individual components
return {
  { Meta = Meta },
  { Div = DivContainers },
  { Div = DivComponents, Span = Span, Table = Table, Image = Image, CodeBlock = CodeBlock }
}
