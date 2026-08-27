--- Conformance sweep over every real `_schema.yml` on disk.
---
--- Answers one question: does this validator carry every extension schema
--- that actually ships? For each file it checks that the schema loads, that
--- every descriptor uses a known v2 keyword and a known type, that every
--- declared pattern compiles, and that validating an empty configuration
--- reports nothing (which is where a mistyped default shows up).
---
---     quarto pandoc lua tests/validation/lua/conformance.lua <directory> [...]
---
--- At least one directory is required: the sweep reports nothing to check as a
--- failure, so a mistyped root cannot pass as a clean run.

local script = (arg and arg[0]) or 'tests/validation/lua/conformance.lua'
local here = script:match('(.*[/\\])') or './'
package.path = here .. '../../../src/validation/?.lua;' .. package.path

local schema = require('schema')

schema._env.warn = function() end
schema._env.report_error = function() end

local V2_TYPES = {
  string = true, number = true, integer = true, boolean = true,
  array = true, object = true, ['null'] = true, content = true,
}

if #arg == 0 then
  io.stderr:write('usage: conformance.lua <directory> [<directory> ...]\n')
  os.exit(1, true)
end

--- List every `_schema.yml` under the given roots, ignoring build output.
local function find_schemas()
  local found = {}
  for _, root in ipairs(arg) do
    -- Quote for the shell, not with `%q`: Lua's own quoting leaves `$` alone,
    -- so a path containing one would undergo parameter expansion and the sweep
    -- would silently search somewhere else.
    local quoted = "'" .. root:gsub("'", "'\\''") .. "'"
    local command = string.format(
      "find %s -name '_schema.yml' -not -path '*/_site/*' -not -path '*/.quarto/*'",
      quoted
    )
    local pipe = io.popen(command)
    if pipe then
      for line in pipe:lines() do
        found[#found + 1] = line
      end
      pipe:close()
    end
  end
  table.sort(found)
  return found
end

local problems = {}
local checked_files = 0
local checked_descriptors = 0
local without_version = {}

local function complain(path, message)
  problems[#problems + 1] = string.format('%s\n    %s', path, message)
end

--- Check one field descriptor.
local function check_descriptor(path, where, name, spec)
  if type(spec) ~= 'table' then
    complain(path, string.format('%s "%s" is not a mapping.', where, name))
    return
  end
  checked_descriptors = checked_descriptors + 1

  for keyword in pairs(spec) do
    if schema.KEYWORDS[keyword] == nil then
      complain(path, string.format('%s "%s" uses unknown keyword "%s".', where, name, keyword))
    end
  end

  local declared = spec.type
  if declared ~= nil then
    local names = type(declared) == 'table' and declared or { declared }
    for _, type_name in ipairs(names) do
      if not V2_TYPES[type_name] then
        complain(path, string.format('%s "%s" declares unknown type "%s".', where, name, tostring(type_name)))
      end
    end
  end

  for _, keyword in ipairs({ 'pattern', 'propertyNames' }) do
    if type(spec[keyword]) == 'string' then
      local branches, reason = schema._compile_pattern(spec[keyword])
      if not branches then
        complain(path, string.format('%s "%s" has a %s this validator cannot compile (%s): %s',
          where, name, keyword, tostring(reason), spec[keyword]))
      end
    end
  end

  if type(spec.items) == 'table' then
    check_descriptor(path, where, name .. '.items', spec.items)
  end
  if type(spec.properties) == 'table' then
    for key, value in pairs(spec.properties) do
      check_descriptor(path, where, name .. '.' .. key, value)
    end
  end
  if type(spec.additionalProperties) == 'table' then
    check_descriptor(path, where, name .. '.additionalProperties', spec.additionalProperties)
  end
end

--- Check a whole map of descriptors.
local function check_map(path, where, descriptors)
  if type(descriptors) ~= 'table' then
    return
  end
  for name, spec in pairs(descriptors) do
    check_descriptor(path, where, name, spec)
  end
end

for _, path in ipairs(find_schemas()) do
  checked_files = checked_files + 1

  local loaded, load_err = schema.load_schema(path)
  if load_err then
    complain(path, 'failed to load: ' .. tostring(load_err))
  else
    if loaded['$schema'] ~= schema.SCHEMA_VERSION then
      without_version[#without_version + 1] = path
    end

    check_map(path, 'option', loaded.options)

    for format, descriptors in pairs(loaded.formats) do
      check_map(path, 'format ' .. format .. ' option', descriptors)
    end

    for group, descriptors in pairs(loaded.attributes) do
      check_map(path, 'attribute of ' .. group, descriptors)
    end

    for name, entry in pairs(loaded.shortcodes) do
      if type(entry) == 'table' then
        if type(entry.arguments) == 'table' then
          for index, spec in ipairs(entry.arguments) do
            check_descriptor(path, 'argument', name .. '[' .. index .. ']', spec)
            if spec.name == nil then
              complain(path, string.format('argument %d of shortcode "%s" has no name.', index, name))
            end
          end
        end
        check_map(path, 'attribute of shortcode ' .. name, entry.attributes)
      end
    end

    -- A schema must accept an empty configuration: every default has to
    -- satisfy the type it is declared under.
    local valid, errors = schema.validate({}, loaded.options, { unknown = 'ignore' })
    if not valid then
      complain(path, 'an empty configuration is rejected: ' .. table.concat(errors, ' | '))
    end
  end
end

print(string.format('%d schema files, %d descriptors checked', checked_files, checked_descriptors))

if #without_version > 0 then
  print(string.format('\n%d file(s) do not declare the v2 meta-schema:', #without_version))
  for _, path in ipairs(without_version) do
    print('  ' .. path)
  end
end

if #problems > 0 then
  print(string.format('\n%d problem(s):', #problems))
  for _, problem in ipairs(problems) do
    print('  ' .. problem)
  end
end

io.stdout:flush()
os.exit((#problems == 0 and checked_files > 0) and 0 or 1, true)
