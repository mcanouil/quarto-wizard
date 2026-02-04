--- @module typst-card-grid
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil
--- @version 1.0.0
--- @brief Handles card grid divs with complex card extraction
--- @description Mirrors partials/card-grid.typ

-- ============================================================================
-- MODULE IMPORTS
-- ============================================================================

local typst_utils = require(
  quarto.utils.resolve_path('../_modules/typst-utils.lua'):gsub('%.lua$', '')
)
local utils = require(
  quarto.utils.resolve_path('../_modules/utils.lua'):gsub('%.lua$', '')
)
local content_extraction = require(
  quarto.utils.resolve_path('../_modules/content-extraction.lua'):gsub('%.lua$', '')
)

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

--- Extract card data from a div.
--- Uses content_extraction.parse_sections() for header/body/footer extraction.
--- @param div pandoc.Div The card div.
--- @return table Card data with title, content, footer, style, colour.
local function extract_card(div)
  local parsed = content_extraction.parse_sections(div.content)

  return {
    title = parsed.header_text,
    content = parsed.body_blocks and #parsed.body_blocks > 0
        and utils.stringify(parsed.body_blocks) or nil,
    footer = parsed.footer_blocks and #parsed.footer_blocks > 0
        and utils.stringify(parsed.footer_blocks) or nil,
    style = div.attributes.style,
    colour = div.attributes.colour
  }
end

-- ============================================================================
-- COMPONENT PROCESSING
-- ============================================================================

--- Process card-grid div
--- Extracts cards from child divs and builds Typst code
--- @param div pandoc.Div Card-grid div containing card divs
--- @param config table Component configuration (not used for card-grid special processing)
--- @return pandoc.RawBlock Typst code for rendering card grid
local function process_card_grid(div, config)
  local cards = pandoc.List()
  local columns = div.attributes.columns and tonumber(div.attributes.columns) or 3

  -- Extract cards from child divs
  for _, block in ipairs(div.content) do
    if block.t == 'Div' and block.classes:includes('card') then
      local card = extract_card(block)
      if card.title or card.content or card.footer then
        cards:insert(card)
      end
    end
  end

  if #cards == 0 then
    return pandoc.Null()
  end

  -- Build cards array for Typst
  local card_items = {}
  for _, card in ipairs(cards) do
    local card_parts = {}

    if card.title then
      table.insert(card_parts, string.format('title: %s', typst_utils.typst_value(card.title)))
    end
    if card.content then
      table.insert(card_parts, string.format('content: %s', typst_utils.typst_value(card.content)))
    end
    if card.footer then
      table.insert(card_parts, string.format('footer: %s', typst_utils.typst_value(card.footer)))
    end
    if card.style then
      table.insert(card_parts, string.format('style: %s', typst_utils.typst_value(card.style)))
    end
    if card.colour then
      -- Hex colours need rgb() wrapper, other values use typst_value()
      if card.colour:match('^#') then
        table.insert(card_parts, string.format('colour: rgb(%s)', typst_utils.typst_value(card.colour)))
      else
        table.insert(card_parts, string.format('colour: %s', typst_utils.typst_value(card.colour)))
      end
    end

    table.insert(card_items, '(' .. table.concat(card_parts, ', ') .. ')')
  end

  -- Build Typst code
  local typst_code = string.format(
    '#mcanouil-card-grid(\n  (%s),\n  columns: %d\n)',
    table.concat(card_items, ',\n    '),
    columns
  )

  return pandoc.RawBlock('typst', typst_code)
end

--- Process standalone card div
--- Extracts card data and builds Typst code for a single card
--- @param div pandoc.Div Card div
--- @param config table Component configuration
--- @return pandoc.RawBlock Typst code for rendering single card
local function process_card_div(div, config)
  local card = extract_card(div)

  -- Build Typst function call
  local parts = {}

  if card.title then
    table.insert(parts, string.format('title: %s', typst_utils.typst_value(card.title)))
  end
  if card.footer then
    table.insert(parts, string.format('footer: %s', typst_utils.typst_value(card.footer)))
  end
  if card.style then
    table.insert(parts, string.format('style: %s', typst_utils.typst_value(card.style)))
  end
  if card.colour then
    if card.colour:match('^#') then
      table.insert(parts, string.format('colour: rgb(%s)', typst_utils.typst_value(card.colour)))
    else
      table.insert(parts, string.format('colour: %s', typst_utils.typst_value(card.colour)))
    end
  end

  local args_str = ''
  if #parts > 0 then
    args_str = table.concat(parts, ', ') .. ', '
  end

  -- Content is passed as body argument
  local content_str = card.content or ''
  local typst_code = string.format('#mcanouil-card(%s)[%s]', args_str, content_str)

  return pandoc.RawBlock('typst', typst_code)
end

-- ============================================================================
-- MODULE EXPORTS
-- ============================================================================

return {
  extract_card = extract_card,
  process_card_grid = process_card_grid,
  process_card_div = process_card_div
}
