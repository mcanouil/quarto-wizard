--- @module normalise-extension-paths
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @brief Normalises .*_extensions/ to /_extensions/ in logo and orcid-icon paths.
---
--- NOTE: This is a workaround for Quarto's path resolution in Typst output.
--- When rendering from subdirectories, paths to extension assets include
--- relative prefixes (e.g., ../../_extensions/). This filter normalises
--- these paths to use absolute references (/_extensions/) for portability.
--- See: https://github.com/quarto-dev/quarto-cli/issues/13917

local KEYS = { 'logo', 'logo-light', 'logo-dark', 'orcid-icon' }

local function normalise_path(value)
  local t = pandoc.utils.type(value)
  if t == 'string' then
    return (value:gsub("^.*_extensions/", "/_extensions/"))
  elseif t == 'Inlines' then
    return pandoc.Inlines({ pandoc.Str((pandoc.utils.stringify(value):gsub("^.*_extensions/", "/_extensions/"))) })
  elseif t == 'List' then
    local result = {}
    for i, v in ipairs(value) do result[i] = normalise_path(v) end
    return result
  elseif t == 'table' or t == 'MetaMap' then
    local result = {}
    for k, v in pairs(value) do result[k] = normalise_path(v) end
    return result
  end
  return value
end

local function get_nested_meta(tbl, path)
  local cur = tbl
  for p in path:gmatch("[^.]+") do
    local t = pandoc.utils.type(cur)
    if t ~= 'table' and t ~= 'MetaMap' and t ~= 'Meta' then return nil end
    cur = cur[p]
  end
  return cur
end

local function Meta(meta)
  if not quarto.doc.is_format('typst') then return meta end

  -- Normalise top-level keys
  for _, k in ipairs(KEYS) do
    if meta[k] then meta[k] = normalise_path(meta[k]) end
  end

  -- Set logo.path from appropriate variant based on brand-mode
  local mode = meta['brand-mode'] and pandoc.utils.stringify(meta['brand-mode']) or 'light'
  local src = get_nested_meta(meta, 'logo-' .. mode .. '.path')
  if src and meta['logo'] then
    meta['logo']['path'] = normalise_path(src)
  end

  return meta
end

return { { Meta = Meta } }
