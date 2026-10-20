--- Read every text of a corpus with Lua `tonumber` and write the results.
---
---     quarto pandoc lua tests/validation/lua/tonumber.lua <corpus> <output>
---
--- The corpus is a JSON array of strings. The output is a JSON array of
--- `{ text, value }` entries. `value` is null when `tonumber` answers nil,
--- and otherwise the number as text: an integer in full, a float with 17
--- significant digits, and an infinity as `inf` or `-inf`.
--- `tonumber-conformance.test.ts` reads the output and holds the TypeScript
--- coercion to the same numbers.

local corpus_path, output_path = arg[1], arg[2]
if corpus_path == nil or output_path == nil then
  io.stderr:write('usage: tonumber.lua <corpus> <output>\n')
  os.exit(1, true)
end

local corpus_handle = assert(io.open(corpus_path, 'r'))
local corpus = pandoc.json.decode(corpus_handle:read('a'), false)
corpus_handle:close()

local results = {}
for index, text in ipairs(corpus) do
  local number = tonumber(text)
  local value = pandoc.json.null
  if math.type(number) == 'integer' then
    value = string.format('%d', number)
  elseif number ~= nil then
    value = string.format('%.17g', number)
  end
  results[index] = { text = text, value = value }
end

local directory = output_path:match('(.*)[/\\]')
if directory then
  pandoc.system.make_directory(directory, true)
end
local output_handle = assert(io.open(output_path, 'w'))
output_handle:write(pandoc.json.encode(results))
output_handle:close()
print(string.format('%d texts read with tonumber, written to %s', #results, output_path))
