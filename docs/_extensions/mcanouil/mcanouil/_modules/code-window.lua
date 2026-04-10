--- @module code-window
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @brief Code block window decorations with multiple styles
--- @description Adds window chrome (macOS traffic lights, Windows title bar
--- buttons, or plain filename) to code blocks in HTML, Reveal.js, and Typst
--- formats. Registered at pre-quarto to process all formats in a single pass.

-- ============================================================================
-- EXTENSION NAME
-- ============================================================================

local EXTENSION_NAME = 'mcanouil'
local SECTION_NAME = 'code-window'

-- Dependencies injected by the entry-point filter (filters/code-window.lua)
-- via set_dependencies() before any filter handlers run.
local str = nil
local log = nil
local meta_mod = nil
local pdoc = nil
local html_mod = nil
local code_annotations = nil

-- ============================================================================
-- DEFAULTS AND STATE
-- ============================================================================

--- @class CodeWindowConfig
--- @field enabled boolean Whether code-window styling is enabled
--- @field auto_filename boolean Whether to auto-generate filename from language
--- @field style string Window decoration style ('macos', 'windows', 'default')
--- @field typst_wrapper string Typst wrapper function name
--- @field hotfix_code_annotations boolean Whether to apply the code-annotations hot-fix for Typst
--- @field hotfix_skylighting boolean Whether to apply the Skylighting hot-fix for Typst

local VALID_STYLES = { ['default'] = true, ['macos'] = true, ['windows'] = true }

local DEFAULTS = {
  ['enabled'] = 'true',
  ['auto-filename'] = 'true',
  ['style'] = 'macos',
  ['wrapper'] = 'mcanouil-code-window',
}

local HOTFIX_DEFAULTS = {
  ['code-annotations'] = true,
  ['skylighting'] = true,
  ['typst-title'] = true,
}

local CURRENT_FORMAT = nil
local CONFIG = nil
local TYPST_BG_COLOUR = nil
local ANNOTATION_BLOCK_COUNTER = 0

-- ============================================================================
-- BLOCK-LEVEL STYLE OVERRIDE
-- ============================================================================

--- Read the block-level style override from code-window-style attribute.
--- Returns the validated style value or nil.
--- Strips the attribute from the block.
--- @param block pandoc.CodeBlock Code block element
--- @return string|nil Style override value
local function read_block_style(block)
  local block_style = block.attributes['code-window-style']
  if not block_style or block_style == '' then
    return nil
  end
  block.attributes['code-window-style'] = nil
  if VALID_STYLES[block_style] then
    return block_style
  end
  log.log_warning(EXTENSION_NAME,
    string.format('Unknown block style "%s", using configured default.', block_style))
  return nil
end

-- NOTE: Typst helper functions (_cw-page-bg, _cw-fg, _cw-annotations,
-- mcanouil-code-window-annote-colour, mcanouil-code-window-circled-number,
-- mcanouil-code-window-annotation-item, mcanouil-code-window-annotated-content)
-- are defined in the Typst template partials (show-rules.typ), not injected
-- here, so they are available in the template's lexical scope.

-- ============================================================================
-- TYPST PROCESSING
-- ============================================================================

--- Get the next unique block ID for annotation linking.
--- @return integer
local function next_block_id()
  ANNOTATION_BLOCK_COUNTER = ANNOTATION_BLOCK_COUNTER + 1
  return ANNOTATION_BLOCK_COUNTER
end

--- Build the Typst bg-colour parameter string.
--- @return string Empty string or ', bg-colour: rgb("...")'
local function typst_bg_colour_param()
  if not TYPST_BG_COLOUR then
    return ''
  end
  return string.format(', bg-colour: rgb("%s")', TYPST_BG_COLOUR)
end

--- Build a code-window opening RawBlock for Typst.
--- @param filename string
--- @param is_auto boolean
--- @param style string
--- @param annotations table|nil
--- @param block_id integer
--- @return pandoc.RawBlock
local function typst_code_window_open(filename, is_auto, style, annotations, block_id)
  local annot_param = ''
  if annotations and next(annotations) then
    annot_param = string.format(', annotations: %s, block-id: %d',
      code_annotations.annotations_to_typst_dict(annotations), block_id)
  end

  return pandoc.RawBlock('typst', string.format(
    '#%s(filename: "%s", is-auto: %s, style: "%s"%s%s)[',
    CONFIG.typst_wrapper,
    filename:gsub('"', '\\"'),
    is_auto and 'true' or 'false',
    style,
    annot_param,
    typst_bg_colour_param()
  ))
end

--- Build a standalone annotation wrapper for non-windowed blocks.
--- @param annotations table
--- @param block_id integer
--- @return pandoc.RawBlock opening, pandoc.RawBlock closing
local function typst_annotation_wrapper(annotations, block_id)
  local open = pandoc.RawBlock('typst', string.format(
    '#%s-annotated-content(annotations: %s, block-id: %d%s)[',
    CONFIG.typst_wrapper,
    code_annotations.annotations_to_typst_dict(annotations),
    block_id,
    typst_bg_colour_param()
  ))
  local close = pandoc.RawBlock('typst', ']')
  return open, close
end

-- ============================================================================
-- HTML PROCESSING
-- ============================================================================

--- Process CodeBlock for HTML/Reveal.js formats.
--- Explicit-filename blocks are returned for Quarto to wrap; a marker class
--- is added when a block-level style override is present.
--- Auto-filename blocks are wrapped directly with the style class.
--- @param block pandoc.CodeBlock Code block element
--- @return pandoc.Div|pandoc.CodeBlock Wrapped block or original
local function process_html(block)
  -- Per-block opt-out: code-window-enabled="false" skips window chrome.
  local block_enabled = block.attributes['code-window-enabled']
  if block_enabled then
    block.attributes['code-window-enabled'] = nil
  end
  if block_enabled == 'false' then
    return block
  end

  local block_style = read_block_style(block)
  local explicit_filename = block.attributes['filename']
  local no_auto = block.attributes['code-window-no-auto-filename']
  if no_auto then
    block.attributes['code-window-no-auto-filename'] = nil
  end

  if explicit_filename and explicit_filename ~= '' then
    -- Let Quarto create the .code-with-filename wrapper.
    -- Add a marker class for block-level style override; the injected JS
    -- reads it and promotes it to the wrapper div.
    if block_style then
      table.insert(block.classes, 'cw-style-' .. block_style)
    end
    return block
  end

  if not CONFIG.auto_filename or no_auto then
    return block
  end

  if not block.classes or #block.classes == 0 then
    return block
  end

  local filename = block.classes[1]
  local effective_style = block_style or CONFIG.style

  local filename_header = pandoc.RawBlock(
    'html',
    string.format(
      '<div class="code-with-filename-file"><pre><strong>%s</strong></pre></div>',
      str.escape_html(filename)
    )
  )

  return pandoc.Div(
    { filename_header, block },
    pandoc.Attr('', { 'code-with-filename', 'code-window-' .. effective_style, 'code-window-auto' })
  )
end

-- ============================================================================
-- FILTER HANDLERS
-- ============================================================================

--- Generate a JS snippet that adds the configured default style class
--- to Quarto-created .code-with-filename wrappers (explicit filenames)
--- and promotes block-level cw-style-* marker classes.
--- @param default_style string The configured default style
--- @return string JavaScript code
local function make_style_js(default_style)
  return string.format([=[
document.addEventListener("DOMContentLoaded",function(){
  document.querySelectorAll(".code-with-filename").forEach(function(el){
    if(/\bcode-window-(macos|windows|default)\b/.test(el.className))return;
    var c=el.querySelector('[class*="cw-style-"]');
    if(c){var m=c.className.match(/cw-style-(\w+)/);if(m){el.classList.add("code-window-"+m[1]);return;}}
    el.classList.add("code-window-%s");
  });
});]=], default_style)
end

--- Load configuration and inject CSS/JS dependencies.
function Meta(meta)
  CURRENT_FORMAT = pdoc.get_quarto_format()

  -- Read config from extensions.mcanouil.code-window namespace.
  local ext_config = meta_mod.get_extension_config(meta, EXTENSION_NAME)
  local cw_config = ext_config and ext_config[SECTION_NAME] or nil

  local opts = {}
  for key, default in pairs(DEFAULTS) do
    if cw_config and cw_config[key] ~= nil then
      opts[key] = pandoc.utils.stringify(cw_config[key])
    else
      opts[key] = default
    end
  end

  if not VALID_STYLES[opts['style']] then
    log.log_warning(EXTENSION_NAME,
      string.format('Unknown style "%s", falling back to "macos".', opts['style']))
  end

  -- Read code-annotations metadata (Quarto standard option).
  local annot_meta = meta['code-annotations']
  local annot_value = annot_meta and pandoc.utils.stringify(annot_meta) or ''
  local annotations_enabled = annot_value ~= 'none' and annot_value ~= 'false'

  -- Read hotfix sub-table from extensions.mcanouil.code-window.hotfix.
  local hotfix_meta = cw_config and cw_config['hotfix'] or nil

  -- Parse hotfix options with per-hotfix version-based auto-disable.
  -- Each hotfix value can be:
  --   boolean/string: true/false to enable/disable
  --   map: { enabled: true/false, quarto-version: "x.y.z" }
  local hotfix = {}
  for key, default in pairs(HOTFIX_DEFAULTS) do
    local entry = hotfix_meta and hotfix_meta[key]
    if entry ~= nil and pandoc.utils.type(entry) == 'table' then
      -- Map form: { enabled: bool, quarto-version: "x.y.z" }
      local enabled = true
      if entry['enabled'] ~= nil then
        enabled = pandoc.utils.stringify(entry['enabled']) == 'true'
      end
      local ver = entry['quarto-version']
      if ver then
        ver = pandoc.utils.stringify(ver)
        if ver ~= '' then
          local ok, threshold = pcall(pandoc.types.Version, ver)
          if ok and quarto.version >= threshold then
            enabled = false
          end
        end
      end
      hotfix[key] = enabled
    elseif entry ~= nil then
      -- Simple boolean/string form
      hotfix[key] = pandoc.utils.stringify(entry) == 'true'
    else
      hotfix[key] = default
    end
  end

  CONFIG = {
    enabled = opts['enabled'] == 'true',
    auto_filename = opts['auto-filename'] == 'true',
    style = VALID_STYLES[opts['style']] and opts['style'] or 'macos',
    typst_wrapper = opts['wrapper'],
    hotfix_code_annotations = hotfix['code-annotations'],
    hotfix_skylighting = hotfix['skylighting'],
    hotfix_typst_title = hotfix['typst-title'],
    code_annotations = annotations_enabled,
  }

  -- Store hotfix state in metadata so the post-quarto typst-title-fix filter
  -- can read it (it runs as a separate filter and has no access to CONFIG).
  if not meta['_code-window-hotfix'] then
    meta['_code-window-hotfix'] = pandoc.MetaMap({})
  end
  meta['_code-window-hotfix']['typst-title'] = pandoc.MetaString(
    CONFIG.enabled and hotfix['typst-title'] and 'true' or 'false'
  )

  -- Cache syntax highlighting background colour for Typst contrast-aware annotations.
  if CURRENT_FORMAT == 'typst' then
    local hm = PANDOC_WRITER_OPTIONS and PANDOC_WRITER_OPTIONS.highlight_method
    if hm then
      local bg = hm['background-color']
      if bg and type(bg) == 'string' then
        TYPST_BG_COLOUR = bg
      end
    end
  end

  if CURRENT_FORMAT == 'html' and CONFIG.enabled then
    -- CSS is provided by the SCSS theme mixin (scss/_components.scss).
    -- Only inject JS for promoting style classes on explicit-filename blocks.
    html_mod.ensure_html_dependency({
      name = SECTION_NAME .. '-style-init',
      version = '0.1.0',
      head = '<script>' .. make_style_js(CONFIG.style) .. '</script>',
    })
  end

  return meta
end

--- Process CodeBlock elements for HTML/Reveal.js only.
--- Typst processing is handled by the Blocks filter.
function CodeBlock(block)
  if not CURRENT_FORMAT or not CONFIG or not CONFIG.enabled then
    block.attributes['code-window-no-auto-filename'] = nil
    return block
  end

  if CURRENT_FORMAT == 'html' then
    return process_html(block)
  end

  return block
end

-- ============================================================================
-- TYPST BLOCKS FILTER
-- ============================================================================

--- Determine whether a CodeBlock should get code-window chrome.
--- @param block pandoc.CodeBlock
--- @return string|nil filename
--- @return boolean is_auto
--- @return string|nil block_style
--- @return boolean window_opted_out True when code-window-enabled="false" was set
local function resolve_window_params(block)
  -- Per-block opt-out: code-window-enabled="false" skips window chrome.
  local block_enabled = block.attributes['code-window-enabled']
  if block_enabled then
    block.attributes['code-window-enabled'] = nil
  end
  if block_enabled == 'false' then
    return nil, false, nil, true
  end

  local block_style = read_block_style(block)
  local explicit_filename = block.attributes['filename']
  local filename = explicit_filename
  local is_auto = false
  local no_auto = block.attributes['code-window-no-auto-filename']
  if no_auto then
    block.attributes['code-window-no-auto-filename'] = nil
  end

  if (not filename or filename == '') and not no_auto then
    if CONFIG.auto_filename and block.classes and #block.classes > 0 then
      filename = block.classes[1]
      is_auto = true
    end
  end

  return filename, is_auto, block_style, false
end

--- Process a single CodeBlock for Typst, returning replacement blocks.
--- Handles both code-window wrapping and standalone annotation rendering.
--- @param block pandoc.CodeBlock
--- @param next_block pandoc.Block|nil The block following this CodeBlock
--- @param wrap_expansions boolean If true, multi-block expansions are wrapped
---   in a Pandoc Div so Quarto's layout processor sees a single child per
---   CodeBlock (prevents layout-ncol from splitting open/body/close across
---   grid cells).
--- @return pandoc.List replacement_blocks Blocks to splice in
--- @return boolean consumed_next Whether the next block was consumed
--- @return integer|nil annotation_block_id Block ID if annotations were found (for parent propagation)
local function process_typst_block(block, next_block, wrap_expansions)
  local filename, is_auto, block_style, window_opted_out = resolve_window_params(block)
  local has_window = filename and filename ~= ''
  local effective_style = block_style or CONFIG.style

  -- Resolve annotations if enabled and the code-annotations hot-fix is active.
  local annotations = nil
  local should_handle_annotations = CONFIG.code_annotations and CONFIG.hotfix_code_annotations

  if should_handle_annotations then
    local cleaned_text
    cleaned_text, annotations = code_annotations.resolve_annotations(block)
    if annotations then
      block.text = cleaned_text
    end
  end

  -- Strip filename attribute so the CodeBlock renders as plain code inside the
  -- code-window wrapper (the DecoratedCodeBlock Div is already unwrapped above).
  if has_window and block.attributes['filename'] then
    block.attributes['filename'] = nil
  end

  local has_annotations = annotations and next(annotations)
  local consumed_next = false
  local result = {}
  local block_id = has_annotations and next_block_id() or 0

  if has_window and has_annotations then
    table.insert(result, typst_code_window_open(
      filename, is_auto, effective_style, annotations, block_id))
    table.insert(result, block)
    table.insert(result, pandoc.RawBlock('typst', ']'))
  elseif has_window then
    table.insert(result, typst_code_window_open(
      filename, is_auto, effective_style, nil, 0))
    table.insert(result, block)
    table.insert(result, pandoc.RawBlock('typst', ']'))
  elseif has_annotations then
    local open, close = typst_annotation_wrapper(annotations, block_id)
    table.insert(result, open)
    table.insert(result, block)
    table.insert(result, close)
  else
    table.insert(result, block)
  end

  -- Consume the following OrderedList if it is an annotation list.
  if has_annotations
      and next_block
      and code_annotations.is_annotation_ordered_list(next_block) then
    local wrapper_prefix = CONFIG.typst_wrapper
    local annot_blocks = code_annotations.ordered_list_to_typst_blocks(
      next_block, wrapper_prefix, block_id)
    for _, ab in ipairs(annot_blocks) do
      table.insert(result, ab)
    end
    consumed_next = true
  end

  -- When the current block sits directly inside a layout-ncol/layout-nrow/
  -- layout Div, Quarto's layout processor distributes each direct child into
  -- a grid cell. A multi-block expansion would be split across cells, leaving
  -- the #mcanouil-code-window(...)[ opener and its closing ] in different
  -- cells and producing unclosed Typst delimiters. Wrap the expansion in a
  -- Div so the layout processor sees it as a single child.
  if wrap_expansions and #result > 1 then
    result = {
      pandoc.Div(
        pandoc.Blocks(result),
        pandoc.Attr('', { 'cw-typst-layout-group' })
      ),
    }
  end

  local returned_block_id = has_annotations and (not consumed_next) and block_id or nil
  return result, consumed_next, returned_block_id
end

--- Detect whether a Div is a Quarto layout container. Layout containers
--- distribute direct block children across grid cells; expanded code-window
--- blocks must be grouped in a single child to survive this distribution.
--- @param div pandoc.Div
--- @return boolean
local function is_layout_div(div)
  local attrs = div.attributes
  if not attrs then return false end
  return attrs['layout-ncol'] ~= nil
    or attrs['layout-nrow'] ~= nil
    or attrs['layout'] ~= nil
end

--- Check if a Div is Quarto's DecoratedCodeBlock wrapper.
--- @param div pandoc.Div
--- @return boolean
local function is_decorated_codeblock(div)
  return div.attributes['__quarto_custom_type'] == 'DecoratedCodeBlock'
end

--- Extract the CodeBlock from a DecoratedCodeBlock Div.
--- Structure: DecoratedCodeBlock Div > scaffold Div > CodeBlock
--- @param div pandoc.Div
--- @return pandoc.CodeBlock|nil
local function extract_codeblock(div)
  for _, child in ipairs(div.content) do
    if child.t == 'CodeBlock' then
      return child
    elseif child.t == 'Div' then
      local found = extract_codeblock(child)
      if found then return found end
    end
  end
  return nil
end

--- Process a flat list of blocks for Typst, handling CodeBlocks and their
--- following OrderedLists. Called recursively on Div contents.
--- @param blocks pandoc.Blocks|pandoc.List
--- @param wrap_expansions boolean When true, multi-block CodeBlock expansions
---   at this level are wrapped in a Div so Quarto's layout processor sees a
---   single child per input CodeBlock. Set when descending into a layout Div.
--- @return pandoc.Blocks processed_blocks
--- @return integer|nil pending_annotation_block_id Block ID if the last block had annotations (for parent consumption)
local function process_typst_blocks(blocks, wrap_expansions)
  local new_blocks = {}
  local pending_annot_block_id = nil
  local i = 1
  while i <= #blocks do
    local blk = blocks[i]

    if blk.t == 'CodeBlock' then
      local next_blk = blocks[i + 1]
      local replacement, consumed_next, annot_id =
        process_typst_block(blk, next_blk, wrap_expansions)
      for _, rb in ipairs(replacement) do
        table.insert(new_blocks, rb)
      end
      if consumed_next then
        pending_annot_block_id = nil
        i = i + 2
      else
        pending_annot_block_id = annot_id
        i = i + 1
      end
    elseif blk.t == 'Div' and is_decorated_codeblock(blk) then
      -- Unwrap Quarto's DecoratedCodeBlock to prevent double filename wrapping.
      -- Process the inner CodeBlock directly, replacing the entire Div.
      local inner_block = extract_codeblock(blk)
      if inner_block then
        local next_blk = blocks[i + 1]
        local replacement, consumed_next, annot_id =
          process_typst_block(inner_block, next_blk, wrap_expansions)
        for _, rb in ipairs(replacement) do
          table.insert(new_blocks, rb)
        end
        if consumed_next then
          pending_annot_block_id = nil
          i = i + 2
        else
          pending_annot_block_id = annot_id
          i = i + 1
        end
      else
        -- Fallback: keep the Div as-is if no CodeBlock found.
        local processed, inner_pending = process_typst_blocks(blk.content, is_layout_div(blk))
        blk.content = processed
        table.insert(new_blocks, blk)
        pending_annot_block_id = inner_pending
        i = i + 1
      end
    elseif blk.t == 'Div' then
      local processed, inner_pending = process_typst_blocks(blk.content, is_layout_div(blk))
      blk.content = processed
      table.insert(new_blocks, blk)
      -- If the Div's last processed block had pending annotations,
      -- check if the next sibling is an OrderedList to consume.
      if inner_pending then
        local next_blk = blocks[i + 1]
        if next_blk and code_annotations.is_annotation_ordered_list(next_blk) then
          local annot_blocks = code_annotations.ordered_list_to_typst_blocks(
            next_blk, CONFIG.typst_wrapper, inner_pending)
          for _, ab in ipairs(annot_blocks) do
            table.insert(new_blocks, ab)
          end
          pending_annot_block_id = nil
          i = i + 2
        else
          pending_annot_block_id = inner_pending
          i = i + 1
        end
      else
        pending_annot_block_id = nil
        i = i + 1
      end
    else
      pending_annot_block_id = nil
      table.insert(new_blocks, blk)
      i = i + 1
    end
  end
  return pandoc.Blocks(new_blocks), pending_annot_block_id
end

--- Inject Typst function definition and process code blocks for Typst format.
--- Runs as a Pandoc filter to have full control over the document tree.
function Pandoc(doc)
  if CURRENT_FORMAT ~= 'typst' or not CONFIG or not CONFIG.enabled then
    return doc
  end

  -- Process code blocks and annotations throughout the document tree.
  -- Top-level blocks are not inside any layout Div, so expansion wrapping
  -- is disabled at this level.
  doc.blocks = process_typst_blocks(doc.blocks, false)

  return doc
end

-- ============================================================================
-- MODULE EXPORTS
-- ============================================================================

--- Inject all module dependencies.
--- Called by the entry-point filter before any filter handlers run.
--- @param deps table Table with keys: str, log, meta_mod, pdoc, html_mod, code_annotations
local function set_dependencies(deps)
  str = deps.str
  log = deps.log
  meta_mod = deps.meta_mod
  pdoc = deps.pdoc
  html_mod = deps.html_mod
  if deps.code_annotations then
    code_annotations = deps.code_annotations
  end
end

return {
  set_dependencies = set_dependencies,
  Meta = Meta,
  Pandoc = Pandoc,
  CodeBlock = CodeBlock,
  CONFIG = function() return CONFIG end,
}
