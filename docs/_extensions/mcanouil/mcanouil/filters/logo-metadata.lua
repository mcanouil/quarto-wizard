--- @module logo-metadata
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @version 1.0.0
--- @brief Logo metadata flattening filter
--- @description Flattens nested logo metadata (logo.light.path, logo.light.alt, etc.)
--- into flat metadata keys (logo-light-path, logo-light-alt, etc.) for use in templates.

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

--- Copy a logo variant to a new top-level key.
--- @param meta pandoc.Meta The metadata table to modify.
--- @param variant_name string The variant name ('light' or 'dark').
--- @param variant_data table The variant data containing path, alt, width, etc.
local function copy_logo_variant(meta, variant_name, variant_data)
  if not variant_data then
    return
  end

  local new_key = 'logo-' .. variant_name
  meta[new_key] = variant_data
end

-- ============================================================================
-- FILTER FUNCTIONS
-- ============================================================================

--- Process metadata to flatten nested logo structure.
--- @param meta pandoc.Meta The document metadata.
--- @return pandoc.Meta The modified metadata.
local function Meta(meta)
  local logo = meta['logo']

  if not logo or pandoc.utils.type(logo) ~= 'table' then
    return meta
  end

  local light = logo['light']
  local dark = logo['dark']

  if light and pandoc.utils.type(light) == 'table' then
    copy_logo_variant(meta, 'light', light)
  end

  if dark and pandoc.utils.type(dark) == 'table' then
    copy_logo_variant(meta, 'dark', dark)
  end

  return meta
end

-- ============================================================================
-- FILTER EXPORTS
-- ============================================================================

return {
  { Meta = Meta }
}
