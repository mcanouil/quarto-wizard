--- @module html-options
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @version 1.0.0
--- @brief HTML options filter
--- @description Processes YAML options for HTML format styling.
--- Supports:
---   - style: 'professional' or 'academic' (converts to style.professional/style.academic booleans)
---   - title-block-authors: show/hide authors section (default: true)
---   - title-block-abstract: show/hide abstract and keywords (default: true)
---   - title-block-meta: show/hide dates, DOI, and categories (default: true)
---   - extensions.mcanouil.hide-navbar-title: hides navbar brand/title

-- ============================================================================
-- FORMAT CHECK
-- ============================================================================

-- This filter only applies to HTML format
if not quarto.doc.is_format('html') then
  return {}
end

-- ============================================================================
-- MODULES
-- ============================================================================

local meta_mod = require(
  quarto.utils.resolve_path('../_modules/metadata.lua'):gsub('%.lua$', '')
)

-- ============================================================================
-- CSS TEMPLATES
-- ============================================================================

local CSS_HIDE_NAVBAR_TITLE = [[
<style>
/* extensions.mcanouil.hide-navbar-title: Hide navbar brand/title */
a.navbar-brand {
  display: none;
}
</style>
]]

-- ============================================================================
-- FILTER FUNCTIONS
-- ============================================================================

--- Process metadata and add CSS for enabled options
--- @param meta pandoc.Meta Document metadata
--- @return pandoc.Meta Modified metadata with style booleans
local function Meta(meta)
  -- Convert style string to nested booleans for template use
  -- Default is "professional" if not specified
  local style_value = 'professional' -- default
  if meta['style'] ~= nil then
    style_value = pandoc.utils.stringify(meta['style']):lower()
  end

  -- Create nested style table with boolean values
  meta['style'] = pandoc.MetaMap({
    professional = style_value == 'professional',
    academic = style_value == 'academic'
  })

  -- Title block group toggles (default: true)
  for _, key in ipairs({'title-block-authors', 'title-block-abstract', 'title-block-meta'}) do
    if meta[key] == nil then
      meta[key] = true
    end
  end

  -- Check extensions.mcanouil.hide-navbar-title option
  local mcanouil_config = meta_mod.get_extension_config(meta, 'mcanouil')
  if mcanouil_config and mcanouil_config['hide-navbar-title'] then
    quarto.doc.add_html_dependency({
      name = 'hide-navbar-title',
      version = '1.0.0',
      head = CSS_HIDE_NAVBAR_TITLE
    })
  end

  return meta
end

-- ============================================================================
-- FILTER EXPORT
-- ============================================================================

return {
  { Meta = Meta }
}
