--- @module language
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @brief Normalise code blocks with no or unknown language class.

local M = {}

local known_language_cache = {}

--- Check if a language is recognised by Pandoc's syntax highlighter.
--- Renders a test CodeBlock to HTML and checks for the sourceCode class.
--- @param lang string Language identifier
--- @return boolean
local function is_known_language(lang)
  if not lang or lang == '' then
    return false
  end

  if known_language_cache[lang] ~= nil then
    return known_language_cache[lang]
  end

  local test_block = pandoc.CodeBlock('x', pandoc.Attr('', { lang }))
  local html = pandoc.write(pandoc.Pandoc({ test_block }), 'html')
  local is_known = html:find('sourceCode') ~= nil
  known_language_cache[lang] = is_known
  return is_known
end

--- Normalise code blocks with no or unknown language class to "default".
--- For unknown languages, preserves the original name as an explicit
--- filename when one is not already set.
--- @param block pandoc.CodeBlock
--- @return pandoc.CodeBlock
function M.CodeBlock(block)
  if not block.classes or #block.classes == 0 then
    block.classes:insert('default')
    block.attributes['code-window-no-auto-filename'] = 'true'
    return block
  end

  local lang = block.classes[1]
  if not is_known_language(lang) then
    block.classes[1] = 'default'
    if not block.attributes['filename'] or block.attributes['filename'] == '' then
      block.attributes['filename'] = lang
    end
  end

  return block
end

return M
