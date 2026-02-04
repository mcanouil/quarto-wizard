--- @module math-alt-text
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @version 1.0.0
--- @brief Math alt-text filter for Typst accessibility
--- @description Converts math elements with alt attributes to Typst math.equation()
--- calls with proper alt-text support for accessibility.
--- For non-Typst formats, removes the wrapper and returns the math content directly.

-- ============================================================================
-- CONSTANTS
-- ============================================================================

--- @type boolean Whether the output format is Typst.
local IS_TYPST = quarto.doc.is_format('typst')

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

--- Escape a string for use in Typst quoted strings.
--- @param s string The string to escape.
--- @return string The escaped string.
local function escape_typst_string(s)
  if not s then
    return ''
  end
  return s:gsub('\\', '\\\\'):gsub('"', '\\"')
end

--- Convert a Math element to Typst format using Pandoc.
--- @param math_elem pandoc.Math The math element to convert.
--- @return string The Typst math content (including $ delimiters).
local function math_to_typst(math_elem)
  local doc = pandoc.Pandoc({ pandoc.Plain({ math_elem }) })
  local typst_output = pandoc.write(doc, 'typst')
  -- Remove trailing newline if present
  return typst_output:gsub('%s*$', '')
end

--- Generate Typst math.equation code from a Math element.
--- @param math_elem pandoc.Math The math element.
--- @param alt_text string The alt text for accessibility.
--- @param is_block boolean Whether this is block (display) math.
--- @return string The Typst code.
local function make_math_equation(math_elem, alt_text, is_block)
  local block_value = is_block and 'true' or 'false'
  local typst_math = math_to_typst(math_elem)
  return string.format(
    '#math.equation(\n  block: %s,\n  alt: "%s",\n  [%s]\n)',
    block_value,
    escape_typst_string(alt_text),
    typst_math
  )
end

--- Find a Math element within a div's content.
--- @param div pandoc.Div The div element to search.
--- @return pandoc.Math|nil The math element if found, nil otherwise.
local function find_math_in_div(div)
  for _, block in ipairs(div.content) do
    if block.t == 'Para' then
      for _, inline in ipairs(block.content) do
        if inline.t == 'Math' and inline.mathtype == 'DisplayMath' then
          return inline
        end
      end
    end
  end
  return nil
end

-- ============================================================================
-- FILTER FUNCTIONS
-- ============================================================================

--- Process Span elements (inline math with alt attribute).
--- For Typst: wraps in math.equation with alt-text.
--- For other formats: unwraps and returns the math content directly.
--- @param span pandoc.Span The span element to process.
--- @return pandoc.RawInline|pandoc.Math|nil The processed element or nil if not applicable.
local function Span(span)
  local alt = span.attributes['alt']
  if not alt then
    return nil
  end

  -- Check if span contains a single Math element
  if #span.content == 1 and span.content[1].t == 'Math' then
    local math_elem = span.content[1]

    if IS_TYPST then
      local typst_code = make_math_equation(math_elem, alt, false)
      return pandoc.RawInline('typst', typst_code)
    else
      -- For non-Typst formats, return the math content directly (unwrap)
      return math_elem
    end
  end

  return nil
end

--- Process Div elements (block math with alt attribute).
--- For Typst: wraps in math.equation with alt-text.
--- For other formats: unwraps and returns the div content directly.
--- @param div pandoc.Div The div element to process.
--- @return pandoc.RawBlock|pandoc.List|nil The processed element or nil if not applicable.
local function Div(div)
  local alt = div.attributes['alt']
  if not alt then
    return nil
  end

  local math_elem = find_math_in_div(div)
  if not math_elem then
    return nil
  end

  if IS_TYPST then
    local typst_code = make_math_equation(math_elem, alt, true)
    return pandoc.RawBlock('typst', typst_code)
  else
    -- For non-Typst formats, return the div content directly (unwrap)
    return div.content
  end
end

-- ============================================================================
-- FILTER EXPORTS
-- ============================================================================

return {
  { Span = Span, Div = Div }
}
