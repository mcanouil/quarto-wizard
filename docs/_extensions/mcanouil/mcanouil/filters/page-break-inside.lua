--- Normalise page-break-inside metadata for Typst template compatibility.
--- When page-break-inside is a dictionary (MetaMap), Pandoc's $if()$ treats
--- boolean false as falsy, causing the template to misidentify the value type.
--- This filter fills in missing keys with defaults and converts all values to
--- strings so they pass $if()$ truthiness checks (non-empty strings are truthy).

local BREAKABLE_DEFAULTS = {
  table = "true",
  callout = "false",
  code = "auto",
  quote = "false",
  terms = "false",
}

local BREAKABLE_KEYS = { "table", "callout", "code", "quote", "terms" }

--- Convert a Pandoc metadata value to its string representation.
--- @param value any Pandoc MetaValue
--- @return string
local function stringify_meta_value(value)
  if type(value) == "boolean" then
    return tostring(value)
  end
  return pandoc.utils.stringify(value)
end

function Meta(meta)
  local pbi = meta["page-break-inside"]
  if pbi == nil then
    return meta
  end

  if pandoc.utils.type(pbi) ~= "table" then
    return meta
  end

  local normalised = {}
  for _, key in ipairs(BREAKABLE_KEYS) do
    local user_value = pbi[key]
    if user_value ~= nil then
      normalised[key] = stringify_meta_value(user_value)
    else
      normalised[key] = BREAKABLE_DEFAULTS[key]
    end
  end

  meta["page-break-inside"] = normalised
  return meta
end

return {
  { Meta = Meta },
}
