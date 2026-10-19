--- Conformance sweep over every real `_schema.yml` on disk.
---
--- Answers one question: does this validator carry every extension schema
--- that actually ships? For each file it checks that the schema loads, that
--- every descriptor uses a known v2 keyword and a known type, that every
--- declared pattern compiles, and that validating an empty configuration
--- reports nothing (which is where a mistyped default shows up).
---
---     quarto pandoc lua tests/validation/lua/conformance.lua [--findings <file>] <directory> [...]
---
--- At least one directory is required: the sweep reports nothing to check as a
--- failure, so a mistyped root cannot pass as a clean run.
---
--- With `--findings`, the sweep also validates a set of probe values against
--- every top-level descriptor and writes the findings to that file as JSON.
--- `field-value-conformance.test.ts` reads the file and holds the TypeScript
--- field validation to the same findings.

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

local function usage()
  io.stderr:write('usage: conformance.lua [--findings <file>] <directory> [<directory> ...]\n')
  os.exit(1, true)
end

local roots = {}
local findings_path
do
  local index = 1
  while index <= #arg do
    if arg[index] == '--findings' then
      if arg[index + 1] == nil then
        usage()
      end
      findings_path = arg[index + 1]
      index = index + 2
    else
      roots[#roots + 1] = arg[index]
      index = index + 1
    end
  end
end

if #roots == 0 then
  usage()
end

--- List every `_schema.yml` under the given roots, ignoring build output.
local function find_schemas()
  local found = {}
  for _, root in ipairs(roots) do
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

-- ============================================================================
-- FIELD VALUE PROBES
-- ============================================================================

local probes = {}

--- Text that the validator coerces to a number, an integer or a boolean,
--- including the forms where Lua `tonumber` and JavaScript `Number()` differ.
local COERCED_TEXTS = {
  '42', ' 42 ', '-7', '2.5', '1e3', '.5', '-0x10', '0x1p4', '0x1.8', '0xffffffffffffffff',
  '0b101', '0o7', '1e999', '-1e999', '\u{A0}42', '1_000', 'inf', 'TRUE', 'False', 'yes',
}

--- Report whether a descriptor declares a type that text is coerced to.
local function declares_coerced_type(spec)
  local names = type(spec.type) == 'table' and spec.type or { spec.type }
  for _, name in ipairs(names) do
    if name == 'number' or name == 'integer' or name == 'boolean' then
      return true
    end
  end
  return false
end

--- List the values to probe a descriptor with: a few of every scalar type,
--- the values the descriptor names, and each side of every bound. A
--- descriptor of a type that text is coerced to also gets each value written
--- as text, as an attribute or a shortcode argument would give it.
local function probe_values(spec)
  local values = { '', 'conformance-value', 0, -1, 1, 0.5, true, false }
  local coerced = declares_coerced_type(spec)
  local function add(value)
    if value ~= nil and type(value) ~= 'table' then
      values[#values + 1] = value
      if coerced and type(value) ~= 'string' then
        values[#values + 1] = tostring(value)
      end
    end
  end

  if coerced then
    for _, text in ipairs(COERCED_TEXTS) do
      add(text)
    end
  end

  add(spec.default)
  if type(spec.examples) == 'table' then
    for _, example in ipairs(spec.examples) do
      add(example)
    end
  end
  if type(spec.enum) == 'table' then
    for _, allowed in ipairs(spec.enum) do
      add(allowed)
      if type(allowed) == 'string' then
        add(allowed:upper())
      end
    end
    add('Conformance-Not-Listed')
  end
  for _, keyword in ipairs({ 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum' }) do
    local bound = tonumber(spec[keyword])
    if bound then
      for _, offset in ipairs({ -1, -0.5, 0, 0.5, 1 }) do
        add(bound + offset)
      end
    end
  end
  for _, keyword in ipairs({ 'minLength', 'maxLength' }) do
    local bound = tonumber(spec[keyword])
    if bound then
      for length = math.max(bound - 1, 0), bound + 1 do
        add(string.rep('a', length))
      end
    end
  end

  local seen, unique = {}, {}
  for _, value in ipairs(values) do
    local key = type(value) .. '\0' .. tostring(value)
    if not seen[key] then
      seen[key] = true
      unique[#unique + 1] = value
    end
  end
  return unique
end

--- Validate every probe value against one descriptor and record the findings
--- about the field itself, and whether the value has the wrong type once
--- coerced. The shared TypeScript function leaves the type check to its
--- callers, so the reader compares the type outcome on its own.
local function probe(file, location, name, spec)
  if type(spec) ~= 'table' then
    return
  end
  for _, value in ipairs(probe_values(spec)) do
    local _, _, _, _, findings = schema.validate({ [name] = value }, { [name] = spec }, { unknown = 'ignore' })
    local kept, wrong_type = {}, false
    for _, finding in ipairs(findings) do
      if finding.path == name then
        if finding.keyword == 'type' then
          wrong_type = true
        end
        kept[#kept + 1] = { keyword = finding.keyword, severity = finding.severity }
      end
    end
    probes[#probes + 1] = {
      file = file, location = location, value = value, wrong_type = wrong_type, findings = kept,
    }
  end
end

--- Probe every descriptor of a map.
local function probe_map(file, prefix, descriptors)
  if type(descriptors) ~= 'table' then
    return
  end
  for name, spec in pairs(descriptors) do
    local location = {}
    for index, part in ipairs(prefix) do
      location[index] = part
    end
    location[#location + 1] = name
    probe(file, location, name, spec)
  end
end

--- Probe every top-level descriptor of a loaded schema.
local function probe_schema(file, loaded)
  probe_map(file, { 'options' }, loaded.options)
  for format, descriptors in pairs(loaded.formats) do
    probe_map(file, { 'formats', format }, descriptors)
  end
  for group, descriptors in pairs(loaded.attributes) do
    probe_map(file, { 'attributes', group }, descriptors)
  end
  for name, entry in pairs(loaded.shortcodes) do
    if type(entry) == 'table' then
      probe_map(file, { 'shortcodes', name, 'attributes' }, entry.attributes)
      if type(entry.arguments) == 'table' then
        for index, spec in ipairs(entry.arguments) do
          if type(spec) == 'table' and spec.name ~= nil then
            -- Zero-based, so the reader indexes its array with it as is.
            probe(file, { 'shortcodes', name, 'arguments', index - 1 }, spec.name, spec)
          end
        end
      end
    end
  end
end

--- Write the probes as JSON, creating the directory that holds the file.
local function write_probes()
  local directory = findings_path:match('(.*)[/\\]')
  if directory then
    pandoc.system.make_directory(directory, true)
  end
  local handle, open_err = io.open(findings_path, 'w')
  if not handle then
    complain(findings_path, 'cannot write the findings: ' .. tostring(open_err))
    return
  end
  handle:write(pandoc.json.encode(probes))
  handle:close()
  print(string.format('%d probe values written to %s', #probes, findings_path))
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

    if findings_path then
      probe_schema(path, loaded)
    end
  end
end

if findings_path then
  write_probes()
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
