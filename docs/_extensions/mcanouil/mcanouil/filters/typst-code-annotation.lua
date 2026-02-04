--- @module typst-code-annotation
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @version 1.1.0
--- @brief Code annotation support for Typst output
--- @description Processes code annotations (comment + <N> paired with ordered
--- lists) for Typst format. Runs at pre-ast stage, before Quarto's built-in
--- code-annotation.lua and the components filter, so that annotations are
--- handled with circled number markers using brand colours.

-- ============================================================================
-- FORMAT CHECK
-- ============================================================================

if not quarto.doc.is_format('typst') then
  return {}
end

-- ============================================================================
-- MODULE IMPORTS
-- ============================================================================

local utils = require(
  quarto.utils.resolve_path('../_modules/utils.lua'):gsub('%.lua$', '')
)

-- ============================================================================
-- CONSTANTS
-- ============================================================================

local COLOURS_EXPR = 'mcanouil-colours(mode: effective-brand-mode)'

--- Comment characters per language (subset matching Quarto's constants.lua).
local LANG_COMMENT_CHARS = {
  apl = { "⍝" },
  asy = { "//" },
  awk = { "#" },
  bash = { "#" },
  c = { "/*", "*/" },
  cc = { "//" },
  coffee = { "#" },
  cpp = { "//" },
  csharp = { "//" },
  css = { "/*", "*/" },
  d3 = { "//" },
  dockerfile = { "#" },
  dot = { "//" },
  elm = { "#" },
  fortran = { "!" },
  fortran95 = { "!" },
  fsharp = { "//" },
  gap = { "#" },
  gawk = { "#" },
  go = { "//" },
  groovy = { "//" },
  haskell = { "--" },
  html = { "<!--", "-->" },
  java = { "//" },
  javascript = { "//" },
  js = { "//" },
  json = { "//" },
  julia = { "#" },
  latex = { "%" },
  lua = { "--" },
  markdown = { "<!--", "-->" },
  matlab = { "%" },
  mermaid = { "%%" },
  mysql = { "--" },
  node = { "//" },
  ocaml = { "(*", "*)" },
  octave = { "#" },
  ojs = { "//" },
  perl = { "#" },
  powershell = { "#" },
  psql = { "--" },
  python = { "#" },
  q = { "/" },
  r = { "#" },
  ruby = { "#" },
  rust = { "//" },
  sas = { "*", ";" },
  sass = { "//" },
  scala = { "//" },
  scss = { "//" },
  sed = { "#" },
  sql = { "--" },
  stan = { "#" },
  stata = { "*" },
  swift = { "//" },
  tikz = { "%" },
  typescript = { "//" },
  typst = { "//" },
  vhdl = { "--" },
  yaml = { "#" },
}

local DEFAULT_COMMENT = { "#" }

-- ============================================================================
-- ANNOTATION DETECTION
-- ============================================================================

--- Build annotation detector for a given language.
--- @param lang string|nil Language identifier
--- @return table|nil Provider with annotation_number and strip_annotation functions
local function annotation_provider(lang)
  local comment_chars = LANG_COMMENT_CHARS[lang] or DEFAULT_COMMENT
  if comment_chars == nil then
    return nil
  end

  local start_comment = utils.escape_pattern(comment_chars[1])
  local match_expr = '.*' .. start_comment .. '%s*<([0-9]+)>%s*'
  local strip_prefix = '%s*' .. start_comment .. '%s*<'
  local strip_suffix = '>%s*'

  if #comment_chars == 2 then
    local end_comment = utils.escape_pattern(comment_chars[2])
    match_expr = match_expr .. end_comment .. '%s*'
    strip_suffix = strip_suffix .. end_comment .. '%s*'
  end

  match_expr = match_expr .. '$'
  strip_suffix = strip_suffix .. '$'

  return {
    annotation_number = function(line)
      local _, _, number = string.find(line, match_expr)
      if number ~= nil then
        return tonumber(number)
      end
      return nil
    end,
    strip_annotation = function(line, annotation_id)
      return line:gsub(strip_prefix .. annotation_id .. strip_suffix, '')
    end,
  }
end

--- Split text into lines.
--- @param s string
--- @return function Iterator over lines
local function split_into_lines(s)
  if s:sub(-1) ~= '\n' then
    s = s .. '\n'
  end
  return s:gmatch('(.-)\n')
end

-- ============================================================================
-- ANNOTATION PROCESSING
-- ============================================================================

--- Extract the first class that looks like a language identifier from a CodeBlock.
--- @param el pandoc.CodeBlock
--- @return string|nil
local function get_language(el)
  for _, cls in ipairs(el.attr.classes) do
    if cls ~= 'cell-code' and cls ~= 'sourceCode' then
      return cls
    end
  end
  return nil
end

--- Resolve annotations in a code block.
--- Strips annotation comments and returns the cleaned code block plus a table
--- mapping annotation numbers to their line numbers.
--- @param code_block pandoc.CodeBlock
--- @return pandoc.CodeBlock Cleaned code block
--- @return table|nil Annotations: {[annotation_number] = line_number, ...}
local function resolve_annotations(code_block)
  local lang = get_language(code_block)
  local provider = annotation_provider(lang)
  if provider == nil then
    return code_block, nil
  end

  local annotations = {}
  local new_lines = {}
  local line_number = 1

  for line in split_into_lines(code_block.text) do
    local annotation_number = provider.annotation_number(line)
    if annotation_number ~= nil then
      annotations[annotation_number] = line_number
      local stripped = provider.strip_annotation(line, tostring(annotation_number))
      table.insert(new_lines, stripped)
    else
      table.insert(new_lines, line)
    end
    line_number = line_number + 1
  end

  if next(annotations) == nil then
    return code_block, nil
  end

  local new_code = code_block:clone()
  new_code.text = table.concat(new_lines, '\n')
  return new_code, annotations
end

--- Serialise annotations table as a Typst dictionary literal.
--- Typst dictionaries require string keys, so annotation numbers are quoted.
--- @param annotations table {[number]=number, ...} mapping annote number to line number
--- @return string Typst dictionary, e.g. '("1": 1, "2": 2, "3": 3, "4": 4)'
local function annotations_to_typst_dict(annotations)
  local parts = {}
  local keys = {}
  for k in pairs(annotations) do
    table.insert(keys, k)
  end
  table.sort(keys)
  for _, k in ipairs(keys) do
    table.insert(parts, '"' .. tostring(k) .. '": ' .. tostring(annotations[k]))
  end
  return '(' .. table.concat(parts, ', ') .. ')'
end

--- Store annotation data on a CodeBlock as a custom attribute.
--- The code-window module reads this attribute to wrap the code with
--- annotated-code().
--- @param code_block pandoc.CodeBlock
--- @param annotations table
--- @return pandoc.CodeBlock
local function tag_code_block(code_block, annotations)
  code_block.attributes['data-code-annotations'] = annotations_to_typst_dict(annotations)
  return code_block
end

--- Build annotation list items as raw Typst blocks.
--- Each item renders the circled number inline with the description text.
--- @param ol pandoc.OrderedList
--- @param annotations table
--- @return pandoc.Blocks
local function build_annotation_list(ol, annotations)
  local items = pandoc.Blocks({})

  for i, item in ipairs(ol.content) do
    local annotation_number = ol.start + i - 1
    if annotations[annotation_number] then
      local content_inlines = item[1].content or pandoc.Inlines(item[1])
      -- Wrap content in Typst content brackets: #annotation-item(N, [content], colours)
      local block_content = pandoc.Inlines({})
      block_content:insert(pandoc.RawInline(
        'typst',
        '#annotation-item(' .. tostring(annotation_number) .. ', ['
      ))
      block_content:extend(content_inlines)
      block_content:insert(pandoc.RawInline('typst', '], ' .. COLOURS_EXPR .. ')'))
      items:insert(pandoc.Plain(block_content))
    end
  end

  return items
end

-- ============================================================================
-- BLOCK PROCESSING
-- ============================================================================

--- Process a CodeBlock element (standalone, not inside a cell Div).
--- @param block pandoc.CodeBlock
--- @return pandoc.CodeBlock|nil Cleaned code block, or nil if no annotations
--- @return table|nil Annotations table
local function process_code_block(block)
  if block.attr.classes:includes('cell-code') then
    return nil, nil
  end
  local resolved, annotations = resolve_annotations(block)
  if annotations then
    resolved = tag_code_block(resolved, annotations)
  end
  return resolved, annotations
end

--- Process a cell Div, looking for .cell-code CodeBlocks inside.
--- @param div pandoc.Div
--- @return pandoc.Div|nil Modified div, or nil if no annotations
--- @return table|nil Annotations table
local function process_cell_div(div)
  if not div.attr.classes:includes('cell') then
    return nil, nil
  end

  local found_annotations = nil
  local resolved_div = pandoc.walk_block(div, {
    CodeBlock = function(el)
      if el.attr.classes:includes('cell-code') then
        local resolved, annotations = resolve_annotations(el)
        if annotations and next(annotations) ~= nil then
          found_annotations = annotations
          resolved = tag_code_block(resolved, annotations)
          return resolved
        end
      end
      return nil
    end,
  })

  if found_annotations then
    return resolved_div, found_annotations
  end
  return nil, nil
end

-- ============================================================================
-- MAIN FILTER
-- ============================================================================

--- Check if code annotations are enabled in metadata.
--- @param meta pandoc.Meta
--- @return boolean Whether annotations are enabled
local function get_annotations_config(meta)
  local val = meta['code-annotations']
  if val == nil then
    return true
  end
  local str_val = pandoc.utils.stringify(val)
  if str_val == 'false' or str_val == 'none' then
    return false
  end
  return true
end

local annotations_enabled = true

return {
  {
    Meta = function(meta)
      annotations_enabled = get_annotations_config(meta)
    end,
  },
  {
    traverse = 'topdown',
    Blocks = function(blocks)
      if not annotations_enabled then
        return nil
      end

      local outputs = pandoc.Blocks({})
      local pending_code = nil
      local pending_annotations = nil

      local function flush_pending()
        if pending_code then
          outputs:insert(pending_code)
        end
        pending_code = nil
        pending_annotations = nil
      end

      for _, block in ipairs(blocks) do
        if block.t == 'CodeBlock' then
          flush_pending()
          local resolved, annotations = process_code_block(block)
          if annotations then
            pending_code = resolved
            pending_annotations = annotations
          else
            outputs:insert(block)
          end
        elseif block.t == 'Div' and block.attr.classes:includes('cell') then
          flush_pending()
          local resolved, annotations = process_cell_div(block)
          if annotations then
            pending_code = resolved
            pending_annotations = annotations
          else
            outputs:insert(block)
          end
        elseif block.t == 'OrderedList' and pending_annotations then
          local annotation_blocks = build_annotation_list(block, pending_annotations)
          outputs:insert(pending_code)
          outputs:extend(annotation_blocks)
          pending_code = nil
          pending_annotations = nil
        else
          flush_pending()
          outputs:insert(block)
        end
      end

      flush_pending()
      return outputs
    end,
  },
}
