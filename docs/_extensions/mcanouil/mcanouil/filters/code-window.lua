--- @module code-window-main
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @brief Entry point for the code-window extension.
--- Loads all submodules, wires dependencies, and assembles the filter list.

local EXTENSION_NAME = 'mcanouil'
local log = require(quarto.utils.resolve_path('../_modules/logging.lua'):gsub('%.lua$', ''))

-- ============================================================================
-- LOAD SUBMODULES
-- ============================================================================

local str = require(
  quarto.utils.resolve_path('../_modules/string.lua'):gsub('%.lua$', ''))

local meta_mod = require(
  quarto.utils.resolve_path('../_modules/metadata.lua'):gsub('%.lua$', ''))

local pdoc = require(
  quarto.utils.resolve_path('../_modules/pandoc-helpers.lua'):gsub('%.lua$', ''))

local html_mod = require(
  quarto.utils.resolve_path('../_modules/html.lua'):gsub('%.lua$', ''))

local language = require(
  quarto.utils.resolve_path('../_modules/language.lua'):gsub('%.lua$', ''))

local code_annotations = require(
  quarto.utils.resolve_path('../_modules/hotfix/code-annotations.lua'):gsub('%.lua$', ''))

local code_window = require(
  quarto.utils.resolve_path('../_modules/code-window.lua'):gsub('%.lua$', ''))

-- Inject all dependencies into the code-window module
code_window.set_dependencies({
  str = str,
  log = log,
  meta_mod = meta_mod,
  pdoc = pdoc,
  html_mod = html_mod,
  code_annotations = code_annotations,
})

-- ============================================================================
-- SKYLIGHTING HOT-FIX
-- ============================================================================

--- Load optional skylighting hot-fix module from sibling file.
--- @return table Module table with .filters and .set_wrapper, or empty table
local function load_skylighting_hotfix_module()
  local ok, result = pcall(require,
    quarto.utils.resolve_path('../_modules/hotfix/skylighting-typst-fix.lua'):gsub('%.lua$', ''))
  if not ok then
    log.log_warning(EXTENSION_NAME,
      'Failed to load optional skylighting hot-fix: ' .. tostring(result))
    return {}
  end
  if type(result) ~= 'table' then
    log.log_warning(EXTENSION_NAME,
      'Skylighting hot-fix did not return a module table.')
    return {}
  end
  return result
end

-- ============================================================================
-- FILTER ASSEMBLY
-- ============================================================================

local filters = {
  { CodeBlock = language.CodeBlock },
  { Meta = code_window.Meta },
  { Pandoc = code_window.Pandoc },
  { CodeBlock = code_window.CodeBlock },
}

local skylighting_mod = load_skylighting_hotfix_module()

for _, subfilter in ipairs(skylighting_mod.filters or {}) do
  local wrapped = {}
  for element_type, handler in pairs(subfilter) do
    wrapped[element_type] = function(...)
      local cfg = code_window.CONFIG()
      if not cfg or not cfg.hotfix_skylighting then
        return nil
      end
      if skylighting_mod.set_wrapper then
        skylighting_mod.set_wrapper(cfg.typst_wrapper)
      end
      return handler(...)
    end
  end
  table.insert(filters, wrapped)
end

return filters
