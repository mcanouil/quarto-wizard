--- @module panel-tabset
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @version 1.0.0
--- @brief Panel tabset filter for Typst format
--- @description Transforms .panel-tabset divs into hierarchical heading structure for Typst.
--- In HTML-based formats, panel-tabsets render as tabbed interfaces.
--- Since Typst has no tabs, this filter converts tab names into parent headings
--- and shifts content headings to become children of the tab names.

-- ============================================================================
-- FORMAT CHECK
-- ============================================================================

-- This filter only applies to Typst format
if not quarto.doc.is_format('typst') then
  return {}
end

-- ============================================================================
-- CONSTANTS
-- ============================================================================

local TABSET_CLASS = 'panel-tabset'
local MIN_TAB_LEVEL = 2

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

--- Check if a div element is a panel-tabset.
--- @param el pandoc.Div The div element to check
--- @return boolean True if the div has the panel-tabset class
local function is_panel_tabset(el)
  return el.classes and el.classes:includes(TABSET_CLASS)
end

--- Find the minimum heading level among content headings.
--- Content headings are those not at the tab level.
--- @param blocks pandoc.List List of blocks to search
--- @param tab_level number The tab name heading level to exclude
--- @return number|nil The minimum content heading level, or nil if none found
local function find_min_content_heading_level(blocks, tab_level)
  local min_level = nil
  for _, block in ipairs(blocks) do
    if block.t == 'Header' and block.level ~= tab_level then
      if not min_level or block.level < min_level then
        min_level = block.level
      end
    end
  end
  return min_level
end

-- ============================================================================
-- FILTER FUNCTIONS
-- ============================================================================

--- Transform panel-tabset divs for Typst format.
--- Removes the div wrapper and adjusts heading levels so that:
--- - Tab name headings (first heading level found) remain unchanged
--- - Content headings are shifted to become children of tab names
--- @param el pandoc.Div The div element to process
--- @return pandoc.List|nil The unwrapped and transformed content, or nil if not a tabset
local function Div(el)
  if not is_panel_tabset(el) then
    return nil
  end

  -- Find first heading to determine original tab level
  local original_tab_level = nil
  for _, block in ipairs(el.content) do
    if block.t == 'Header' then
      original_tab_level = block.level
      break
    end
  end

  -- No headings found, return content as-is (unwrapped)
  if not original_tab_level then
    return el.content
  end

  -- Calculate effective tab level (enforce minimum)
  local effective_tab_level = math.max(original_tab_level, MIN_TAB_LEVEL)

  -- Find minimum content heading level (headings not at the original tab level)
  local min_content_level = find_min_content_heading_level(el.content, original_tab_level)

  -- Calculate shift for content headings
  -- Content headings must be below the effective tab level
  local shift = 0
  if min_content_level and min_content_level <= effective_tab_level then
    shift = (effective_tab_level + 1) - min_content_level
  end

  -- Calculate shift for tab name headings (if they need to be raised to minimum)
  local tab_shift = effective_tab_level - original_tab_level

  -- Apply transformation
  local result = pandoc.List()
  for _, block in ipairs(el.content) do
    if block.t == 'Header' then
      if block.level == original_tab_level then
        -- Tab name heading: apply tab shift to reach effective level
        block.level = block.level + tab_shift
      else
        -- Content heading: apply content shift
        block.level = block.level + shift
      end
    end
    result:insert(block)
  end

  return result
end

-- ============================================================================
-- FILTER EXPORT
-- ============================================================================

return {
  { Div = Div }
}
