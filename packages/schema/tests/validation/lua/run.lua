--- Test suite for src/validation/schema.lua
---
--- Run with the Pandoc that Quarto ships, so the tests exercise the real
--- `pandoc.read` typing rules rather than a stub:
---
---     quarto pandoc lua tests/validation/lua/run.lua
---
--- Every test named after a defect asserts the behaviour that defect denied.

local script = (arg and arg[0]) or 'tests/validation/lua/run.lua'
local here = script:match('(.*[/\\])') or './'
package.path = here .. '../../../src/validation/?.lua;' .. package.path

local schema = require('schema')

-- ============================================================================
-- HARNESS
-- ============================================================================

local passed, failed = 0, 0
local failures = {}
local logged = {}

schema._env.warn = function(message) logged[#logged + 1] = message end
schema._env.report_error = function(message) logged[#logged + 1] = message end

local function test(name, body)
  logged = {}
  local ok, err = pcall(body)
  if ok then
    passed = passed + 1
  else
    failed = failed + 1
    failures[#failures + 1] = string.format('%s\n    %s', name, tostring(err))
  end
end

local function fail(message)
  error(message, 3)
end

local function assert_true(value, message)
  if not value then
    fail(message or 'expected a truthy value')
  end
end

local function assert_false(value, message)
  if value then
    fail(message or 'expected a falsy value')
  end
end

local function assert_eq(actual, expected, message)
  if actual ~= expected then
    fail(string.format('%s: expected %s, got %s',
      message or 'mismatch', tostring(expected), tostring(actual)))
  end
end

local function assert_contains(haystack, needle, message)
  if type(haystack) == 'table' then
    haystack = table.concat(haystack, ' | ')
  end
  if not tostring(haystack):find(needle, 1, true) then
    fail(string.format('%s: %q not found in %q',
      message or 'missing text', needle, tostring(haystack)))
  end
end

local function assert_valid(valid, errors, message)
  if not valid then
    fail(string.format('%s: %s', message or 'expected valid',
      table.concat(errors, ' | ')))
  end
end

--- Write a schema to a temporary file, load it, and hand it to the body.
local function with_schema(yaml, body)
  local path = os.tmpname()
  local handle = assert(io.open(path, 'w'))
  handle:write(yaml)
  handle:close()
  local ok, err = pcall(body, path)
  os.remove(path)
  if not ok then
    error(err, 0)
  end
end

--- Load a schema from YAML text.
local function load_schema(yaml)
  local result
  with_schema(yaml, function(path)
    local loaded, err = schema.load_schema(path)
    if err then
      fail('schema did not load: ' .. tostring(err))
    end
    result = loaded
  end)
  return result
end

--- Build document metadata the way Pandoc really delivers it.
local function doc_options(yaml)
  local meta = pandoc.read('---\nextensions:\n  demo:\n' .. yaml .. '\n---\n', 'markdown').meta
  return schema.extract_meta_options(meta, 'demo')
end

--- Report whether a regex compiles and matches a value.
local function pattern_matches(regex, value)
  local branches, reason = schema._compile_pattern(regex)
  if not branches then
    fail(string.format('pattern %q did not compile: %s', regex, tostring(reason)))
  end
  for _, branch in ipairs(branches) do
    if value:match(branch) then
      return true
    end
  end
  return false
end

-- ============================================================================
-- CORRECTNESS DEFECTS
-- ============================================================================

test('C1: deprecated.replaceWith forwards the value and names the replacement', function()
  local loaded = load_schema([[
options:
  old-name:
    type: string
    deprecated:
      since: "1.2.0"
      replaceWith: new-name
  new-name:
    type: string
]])
  local valid, errors, warnings, merged =
    schema.validate({ ['old-name'] = 'carried' }, loaded.options)
  assert_valid(valid, errors)
  assert_eq(merged['new-name'], 'carried', 'value forwarded')
  assert_eq(merged['old-name'], nil, 'deprecated key removed')
  assert_contains(warnings, 'new-name', 'warning names the replacement')
  assert_contains(warnings, '1.2.0', 'warning names the version')
end)

test('C2: type integer accepts a whole number and rejects a fractional one', function()
  local loaded = load_schema([[
options:
  dpi:
    type: integer
    exclusiveMinimum: 0
]])
  local valid, errors, _, merged = schema.validate({ dpi = '300' }, loaded.options)
  assert_valid(valid, errors)
  assert_eq(merged.dpi, 300, 'coerced to a number')
  assert_eq(type(merged.dpi), 'number', 'stored as a number')

  local fractional_valid, fractional_errors = schema.validate({ dpi = '1.5' }, loaded.options)
  assert_false(fractional_valid, 'a fractional value is not an integer')
  assert_contains(fractional_errors, 'integer')
end)

test('C3: a null member of a union does not reject the other members', function()
  local loaded = load_schema([[
options:
  maybe:
    type: [string, "null"]
]])
  local valid, errors = schema.validate({ maybe = 'present' }, loaded.options)
  assert_valid(valid, errors)
end)

test('C4: a numeric default survives its own type check', function()
  local loaded = load_schema([[
options:
  typst-cache-max-age:
    type: number
    default: 30
  typst-cache-max-entries:
    type: number
    default: 0
]])
  local valid, errors, _, merged = schema.validate({}, loaded.options)
  assert_valid(valid, errors)
  assert_eq(merged['typst-cache-max-age'], 30, 'default applied')
  assert_eq(type(merged['typst-cache-max-age']), 'number', 'default is a number')
  assert_eq(merged['typst-cache-max-entries'], 0, 'zero default applied')
end)

test('C5: numeric and boolean enum entries match a coerced value', function()
  local loaded = load_schema([[
options:
  echo:
    type: [boolean, string]
    enum: [true, false, fenced]
  level:
    type: number
    enum: [1, 2, 3]
]])
  local boolean_valid, boolean_errors = schema.validate({ echo = true }, loaded.options)
  assert_valid(boolean_valid, boolean_errors)

  local string_valid, string_errors = schema.validate({ echo = 'fenced' }, loaded.options)
  assert_valid(string_valid, string_errors)

  local number_valid, number_errors, _, merged = schema.validate({ level = '2' }, loaded.options)
  assert_valid(number_valid, number_errors)
  assert_eq(merged.level, 2, 'numeric enum value coerced')
end)

test('C6: a mixed-type enum reports instead of crashing', function()
  local loaded = load_schema([[
options:
  echo:
    type: [boolean, string]
    enum: [true, false, fenced]
]])
  local valid, errors = schema.validate({ echo = 'nope' }, loaded.options)
  assert_false(valid, 'an unlisted value is rejected')
  assert_contains(errors, 'true, false, fenced', 'every enum entry is listed')
end)

test('C7: a deprecated field with a default is not resurrected', function()
  local loaded = load_schema([[
options:
  old-name:
    type: string
    default: fallback
    deprecated:
      replaceWith: new-name
  new-name:
    type: string
]])
  local _, _, warnings, merged = schema.validate({ ['old-name'] = 'carried' }, loaded.options)
  assert_eq(merged['old-name'], nil, 'deprecated key stays removed')
  assert_eq(merged['new-name'], 'carried', 'value forwarded')
  assert_eq(#warnings, 1, 'the deprecation is reported once')
end)

test('C8: hyphenated keys survive loading in every section', function()
  local loaded = load_schema([[
classes:
  no-cascade:
    description: "A class whose name contains a hyphen."
  executive-summary:
    description: "Another one."
attributes:
  callout-note:
    fig-alt:
      type: string
options:
  typst-cache:
    type: string
    default: ".quarto/iconify-svg"
]])
  assert_true(loaded.classes['no-cascade'] ~= nil, 'class name kept verbatim')
  assert_true(loaded.classes['executive-summary'] ~= nil, 'second class name kept verbatim')
  assert_true(loaded.attributes['callout-note'] ~= nil, 'attribute group kept verbatim')
  assert_true(loaded.attributes['callout-note']['fig-alt'] ~= nil, 'attribute kept verbatim')

  local _, _, _, merged = schema.validate({}, loaded.options)
  assert_eq(merged['typst-cache'], '.quarto/iconify-svg', 'merged uses the authored spelling')
end)

test('C8: a hyphenated shortcode attribute is matched, not reported unknown', function()
  local loaded = load_schema([[
shortcodes:
  iconify:
    attributes:
      aria-hidden:
        type: string
        enum: ["true", "false"]
]])
  local valid, errors, warnings, merged = schema.validate_shortcode(
    'iconify', {}, { ['aria-hidden'] = 'true' }, loaded.shortcodes.iconify)
  assert_valid(valid, errors)
  assert_eq(#warnings, 0, 'a declared attribute is not unknown')
  assert_eq(merged.attributes['aria-hidden'], 'true')
end)

test('C9: a shorthand class inside a character class translates correctly', function()
  assert_true(pattern_matches('^[\\w-]+$', 'a-b'), 'hyphen inside the class')
  assert_true(pattern_matches('^[\\w-]+$', 'abc'), 'word characters')
  assert_false(pattern_matches('^[\\w-]+$', 'a b'), 'a space is excluded')
end)

test('C10: a counted quantifier is refused wherever it appears', function()
  local leading, leading_reason = schema._compile_pattern('{2,3}x')
  assert_eq(leading, nil, 'a leading counted quantifier is refused')
  assert_contains(leading_reason, 'counted quantifier')

  local trailing, trailing_reason = schema._compile_pattern('a{2,3}')
  assert_eq(trailing, nil, 'a trailing counted quantifier is refused')
  assert_contains(trailing_reason, 'counted quantifier')
end)

test('C11: alternation compiles and is enforced', function()
  assert_true(pattern_matches('^(svg|style|bg|mask)$', 'svg'))
  assert_true(pattern_matches('^(svg|style|bg|mask)$', 'mask'))
  assert_false(pattern_matches('^(svg|style|bg|mask)$', 'nope'))
end)

test('C11: an uncompilable pattern fails closed', function()
  local loaded = load_schema([[
options:
  weird:
    type: string
    pattern: "^(?=x)a$"
]])
  local valid, errors = schema.validate({ weird = 'anything' }, loaded.options)
  assert_false(valid, 'an uncompilable pattern is reported, not accepted')
  assert_contains(errors, 'cannot compile')
end)

test('C12: anchors bind to the whole value', function()
  assert_true(pattern_matches('^abc$', 'abc'))
  assert_false(pattern_matches('^abc$', 'xabcx'), 'anchored pattern does not match a substring')
  assert_true(pattern_matches('abc', 'xabcx'), 'unanchored pattern searches')
end)

test('the only pattern used in the corpus still works', function()
  local regex = '^\\d+\\.?\\d*m?s$'
  assert_true(pattern_matches(regex, '3s'))
  assert_true(pattern_matches(regex, '0.5s'))
  assert_true(pattern_matches(regex, '250ms'))
  assert_false(pattern_matches(regex, 'abc'))
  assert_false(pattern_matches(regex, '3'))
end)

test('an anchor across an alternation is refused rather than misapplied', function()
  local branches, reason = schema._compile_pattern('^abc|def$')
  assert_eq(branches, nil, 'an anchored alternation should not compile')
  assert_true(
    reason ~= nil and reason:find('alternation', 1, true) ~= nil,
    'the reason should name the alternation, got: ' .. tostring(reason)
  )
end)

test('an anchor on a single branch still compiles', function()
  assert_true(pattern_matches('^abc$', 'abc'), '^abc$ should match abc')
  assert_false(pattern_matches('^abc$', 'xabc'), '^abc$ should not match xabc')
end)

test('an unanchored alternation still compiles', function()
  assert_true(pattern_matches('abc|def', 'def'), 'abc|def should match def')
end)

test('a control escape maps to its character', function()
  assert_true(pattern_matches('a\\nb', 'a\nb'), '\\n should match a newline')
  assert_true(pattern_matches('a\\tb', 'a\tb'), '\\t should match a tab')
end)

test('an escape this compiler cannot express is refused', function()
  local branches, reason = schema._compile_pattern('a\\bc')
  assert_eq(branches, nil, '\\b should not compile to the letter b')
  assert_true(
    reason ~= nil and reason:find('escape', 1, true) ~= nil,
    'the reason should name the escape, got: ' .. tostring(reason)
  )
end)

test('a refused escape inside a character class is reported too', function()
  local branches, reason = schema._compile_pattern('[\\b]')
  assert_eq(branches, nil, '\\b inside a class should not compile')
  assert_true(reason ~= nil, 'a reason should be given')
end)

test('a zero escape inside a character class is named an escape, not a backreference', function()
  local branches, reason = schema._compile_pattern('[\\0]')
  assert_eq(branches, nil, '[\\0] should not compile')
  assert_contains(reason, 'unsupported escape "\\0"')
end)

test('a control escape inside a character class matches its character', function()
  assert_true(pattern_matches('[\\n]', '\n'), '[\\n] should match a newline')
  assert_false(pattern_matches('[\\n]', 'n'), '[\\n] should not match the letter n')
end)

test('an ordinary pattern still compiles', function()
  assert_true(pattern_matches('abc', 'abc'), 'abc should match abc')
end)

-- ============================================================================
-- KEYWORD COVERAGE
-- ============================================================================

test('S4: exclusiveMinimum and exclusiveMaximum are enforced', function()
  local loaded = load_schema([[
options:
  dpi:
    type: integer
    exclusiveMinimum: 0
    exclusiveMaximum: 1000
]])
  assert_false((schema.validate({ dpi = '0' }, loaded.options)), 'zero is excluded')
  assert_false((schema.validate({ dpi = '1000' }, loaded.options)), 'the upper bound is excluded')
  local valid, errors = schema.validate({ dpi = '300' }, loaded.options)
  assert_valid(valid, errors)
end)

test('S4: multipleOf is enforced', function()
  local loaded = load_schema([[
options:
  step:
    type: number
    multipleOf: 5
]])
  assert_false((schema.validate({ step = '7' }, loaded.options)))
  local valid, errors = schema.validate({ step = '15' }, loaded.options)
  assert_valid(valid, errors)
end)

test('S4: minLength and maxLength apply to strings', function()
  local loaded = load_schema([[
options:
  code:
    type: string
    minLength: 2
    maxLength: 4
]])
  assert_false((schema.validate({ code = 'a' }, loaded.options)), 'too short')
  assert_false((schema.validate({ code = 'abcde' }, loaded.options)), 'too long')
  local valid, errors = schema.validate({ code = 'abc' }, loaded.options)
  assert_valid(valid, errors)
end)

test('S4: minItems, maxItems and uniqueItems apply to arrays', function()
  local loaded = load_schema([[
options:
  preload:
    type: array
    minItems: 1
    maxItems: 3
    uniqueItems: true
    items:
      type: string
]])
  assert_false((schema.validate({ preload = {} }, loaded.options)), 'too few items')
  assert_false((schema.validate({ preload = { 'a', 'b', 'c', 'd' } }, loaded.options)), 'too many items')
  assert_false((schema.validate({ preload = { 'a', 'a' } }, loaded.options)), 'repeated item')
  local valid, errors = schema.validate({ preload = { 'a', 'b' } }, loaded.options)
  assert_valid(valid, errors)
end)

test('S4: items validates every element', function()
  local loaded = load_schema([[
options:
  levels:
    type: array
    items:
      type: number
      minimum: 1
]])
  local valid, errors, _, merged = schema.validate({ levels = { '2', '3' } }, loaded.options)
  assert_valid(valid, errors)
  assert_eq(merged.levels[1], 2, 'elements are coerced')

  local bad_valid, bad_errors = schema.validate({ levels = { '2', '0' } }, loaded.options)
  assert_false(bad_valid)
  assert_contains(bad_errors, 'levels[2]', 'the failing index is named')
end)

test('S4: const is enforced', function()
  local loaded = load_schema([[
options:
  version:
    type: number
    const: 2
]])
  assert_false((schema.validate({ version = '3' }, loaded.options)))
  local valid, errors = schema.validate({ version = '2' }, loaded.options)
  assert_valid(valid, errors)
end)

test('S4: additionalProperties false rejects surplus keys', function()
  local loaded = load_schema([[
options:
  layout:
    type: object
    additionalProperties: false
    properties:
      columns:
        type: number
]])
  local valid, errors = schema.validate(
    { layout = { columns = '2', rows = '3' } }, loaded.options)
  assert_false(valid)
  assert_contains(errors, 'layout.rows')
end)

test('S4: additionalProperties as a descriptor validates surplus keys', function()
  local loaded = load_schema([[
options:
  input:
    type: object
    additionalProperties:
      type: string
]])
  local valid, errors = schema.validate(
    { input = { name = 'value' } }, loaded.options)
  assert_valid(valid, errors)

  local bad_valid, bad_errors = schema.validate(
    { input = { name = { 'a', 'b' } } }, loaded.options)
  assert_false(bad_valid, 'an array is not a string')
  assert_contains(bad_errors, 'input.name')
end)

test('S4: propertyNames constrains object keys', function()
  local loaded = load_schema([[
options:
  mapping:
    type: object
    propertyNames: "^[a-z]+$"
]])
  local valid, errors, _, _, findings = schema.validate({ mapping = { Bad = 'x' } }, loaded.options)
  assert_false(valid)
  assert_contains(errors, 'mapping.Bad')
  assert_eq(findings[1].keyword, 'propertyNames', 'the keyword is recorded structurally')
end)

test('S4: dependentRequired is enforced', function()
  local loaded = load_schema([[
options:
  auth:
    type: object
    dependentRequired:
      user:
        - password
    properties:
      user:
        type: string
      password:
        type: string
]])
  local valid, errors = schema.validate({ auth = { user = 'me' } }, loaded.options)
  assert_false(valid)
  assert_contains(errors, 'password')

  local ok_valid, ok_errors = schema.validate(
    { auth = { user = 'me', password = 'secret' } }, loaded.options)
  assert_valid(ok_valid, ok_errors)
end)

test('dependentRequired sees a value supplied under an alias', function()
  local loaded = load_schema([[
options:
  auth:
    type: object
    dependentRequired:
      user:
        - password
    properties:
      user:
        type: string
      password:
        type: string
        aliases:
          - pass
]])
  local valid, errors = schema.validate(
    { auth = { user = 'me', pass = 'secret' } }, loaded.options)
  assert_valid(valid, errors)
end)

test('dependentRequired still reports a genuinely missing dependent', function()
  local loaded = load_schema([[
options:
  auth:
    type: object
    dependentRequired:
      user:
        - password
    properties:
      user:
        type: string
      password:
        type: string
]])
  local valid, errors = schema.validate({ auth = { user = 'me' } }, loaded.options)
  assert_false(valid, 'a missing dependent should be reported')
  assert_contains(errors, 'password')
end)

test('a trigger key filled by its own default does not fire dependentRequired', function()
  local loaded = load_schema([[
options:
  auth:
    type: object
    dependentRequired:
      user:
        - password
    properties:
      user:
        type: string
        default: anonymous
      password:
        type: string
]])
  local valid, errors, _, merged = schema.validate({ auth = {} }, loaded.options)
  assert_valid(valid, errors)
  assert_eq(merged.auth.user, 'anonymous', 'the default is still applied')
end)

test('a trigger key the author supplied still fires dependentRequired', function()
  local loaded = load_schema([[
options:
  auth:
    type: object
    dependentRequired:
      user:
        - password
    properties:
      user:
        type: string
        default: anonymous
      password:
        type: string
]])
  local valid, errors = schema.validate({ auth = { user = 'me' } }, loaded.options)
  assert_false(valid, 'a supplied trigger fires even when the field has a default')
  assert_contains(errors, 'password')
end)

test('a dependent filled only by its own default does not satisfy the requirement', function()
  local loaded = load_schema([[
options:
  auth:
    type: object
    dependentRequired:
      user:
        - password
    properties:
      user:
        type: string
      password:
        type: string
        default: letmein
]])
  local valid, errors = schema.validate({ auth = { user = 'me' } }, loaded.options)
  assert_false(valid, 'a dependent that holds only a default is not present')
  assert_contains(errors, 'password')
end)

test('nested properties contribute defaults and coercion to merged', function()
  local loaded = load_schema([[
options:
  layout:
    type: object
    properties:
      columns:
        type: number
        default: 2
      gap:
        type: number
]])
  local valid, errors, _, merged = schema.validate({ layout = {} }, loaded.options)
  assert_valid(valid, errors)
  assert_eq(merged.layout.columns, 2, 'a nested default is applied')

  local ok, errs, _, coerced = schema.validate({ layout = { gap = '3' } }, loaded.options)
  assert_valid(ok, errs)
  assert_eq(coerced.layout.gap, 3, 'a nested value is coerced')
  assert_eq(type(coerced.layout.gap), 'number', 'and stored as a number')
end)

test('a value given under an alias leaves only the canonical key', function()
  local loaded = load_schema([[
options:
  colour:
    type: number
    aliases:
      - color
]])
  local _, _, _, merged = schema.validate({ color = '30' }, loaded.options)
  assert_eq(merged.colour, 30, 'canonical key holds the coerced value')
  assert_eq(merged.color, nil, 'the alias key is not left behind')
end)

test('a value given under the other spelling leaves only the canonical key', function()
  local loaded = load_schema([[
options:
  typst-cache-max-age:
    type: number
]])
  local _, _, _, merged = schema.validate({ ['typst_cache_max_age'] = '30' }, loaded.options)
  assert_eq(merged['typst-cache-max-age'], 30, 'canonical key holds the value')
  assert_eq(merged['typst_cache_max_age'], nil, 'the variant spelling is not left behind')
end)

test('a leading YAML document marker is accepted', function()
  local loaded = load_schema([[
---
options:
  a:
    type: string
    default: set
]])
  local _, _, _, merged = schema.validate({}, loaded.options)
  assert_eq(merged.a, 'set', 'the single document is parsed')
end)

test('a second YAML document is refused', function()
  local path = os.tmpname()
  local handle = assert(io.open(path, 'w'))
  handle:write('options:\n  a:\n    type: string\n---\noptions:\n  b:\n    type: string\n')
  handle:close()
  local loaded, err = schema.load_schema(path)
  os.remove(path)
  assert_eq(loaded, nil, 'a second document is refused')
  assert_contains(tostring(err), 'document')
end)

test('type object rejects an array but accepts an empty table', function()
  local loaded = load_schema([[
options:
  thing:
    type: object
]])
  assert_false((schema.validate({ thing = { 'a', 'b' } }, loaded.options)), 'an array is not an object')
  local valid, errors = schema.validate({ thing = {} }, loaded.options)
  assert_valid(valid, errors, 'an empty table is still an object')
end)

test('uniqueItems distinguishes a number from its string form', function()
  local loaded = load_schema([[
options:
  mixed:
    type: array
    uniqueItems: true
]])
  local valid, errors = schema.validate({ mixed = { 1, '1' } }, loaded.options)
  assert_valid(valid, errors, '1 and "1" are different items')
end)

test('the duplicate item message names the value alone', function()
  local loaded = load_schema([[
options:
  preload:
    type: array
    uniqueItems: true
    items:
      type: string
]])
  local valid, errors = schema.validate({ preload = { 'a', 'a' } }, loaded.options)
  assert_false(valid, 'a repeated item should be reported')
  local joined = table.concat(errors, ' | ')
  assert_true(joined:find('\0', 1, true) == nil, 'the message must not hold a NUL byte')
  assert_true(joined:find('string', 1, true) == nil, 'the message must not name the Lua type')
  assert_contains(errors, 'a')
end)

test('uniqueItems distinguishes an empty string from a pair of quote characters', function()
  local loaded = load_schema([[
options:
  marks:
    type: array
    uniqueItems: true
    items:
      type: string
]])
  local valid, errors = schema.validate({ marks = { '', '""' } }, loaded.options)
  assert_valid(valid, errors, 'an empty string and the string \'""\' are different items')
end)

test('uniqueItems reports a repeated empty string as ""', function()
  local loaded = load_schema([[
options:
  marks:
    type: array
    uniqueItems: true
    items:
      type: string
]])
  local valid, errors = schema.validate({ marks = { '', '' } }, loaded.options)
  assert_false(valid, 'a repeated empty string should be reported')
  assert_contains(errors, 'but "" appears more than once')
end)

test('minLength and maxLength count characters, not bytes', function()
  local loaded = load_schema([[
options:
  glyph:
    type: string
    maxLength: 1
]])
  local valid, errors = schema.validate({ glyph = '\u{25CF}' }, loaded.options)
  assert_valid(valid, errors, 'a single multi-byte character is one character')
end)

test('a block scalar with an indentation indicator is refused, not swallowed', function()
  local path = os.tmpname()
  local handle = assert(io.open(path, 'w'))
  handle:write('options:\n  a:\n    description: |2\n      text\n    type: string\n')
  handle:close()
  local loaded, err = schema.load_schema(path)
  os.remove(path)
  assert_eq(loaded, nil, 'the indicator is reported')
  assert_contains(tostring(err), 'indentation indicator')
end)

test('an empty sequence item is refused rather than shifting later items', function()
  local path = os.tmpname()
  local handle = assert(io.open(path, 'w'))
  handle:write('options:\n  a:\n    type: string\n    aliases:\n      -\n      - second\n')
  handle:close()
  local loaded, err = schema.load_schema(path)
  os.remove(path)
  assert_eq(loaded, nil, 'an empty item is reported')
  assert_contains(tostring(err), 'empty')
end)

test('a block sequence may sit at the column of its key', function()
  local loaded = load_schema([[
options:
  colour:
    type: string
    aliases:
    - color
]])
  local aliases = loaded.options.colour.aliases
  assert_eq(type(aliases), 'table', 'aliases should parse to a table')
  assert_eq(#aliases, 1, 'aliases should hold one entry')
  assert_eq(aliases[1], 'color', 'the alias should be "color"')
end)

test('an indented block sequence still parses', function()
  local loaded = load_schema([[
options:
  colour:
    type: string
    aliases:
      - color
]])
  assert_eq(loaded.options.colour.aliases[1], 'color', 'the alias should be "color"')
end)

-- ============================================================================
-- STRUCTURE AND ENTRY POINTS
-- ============================================================================

test('S5: an unknown option is reported by default', function()
  local loaded = load_schema([[
options:
  mode:
    type: string
]])
  local valid, _, warnings = schema.validate({ mod = 'svg' }, loaded.options)
  assert_true(valid, 'an unknown key is a warning, not an error')
  assert_contains(warnings, 'mod')
end)

test('S5: aliases claim their key and resolve the value', function()
  local loaded = load_schema([[
options:
  colour:
    type: string
    aliases:
      - color
]])
  local valid, errors, warnings, merged = schema.validate({ color = 'red' }, loaded.options)
  assert_valid(valid, errors)
  assert_eq(merged.colour, 'red', 'alias resolved')
  assert_eq(#warnings, 0, 'an alias is not an unknown key')
end)

test('S6: validate_shortcode covers arguments, attributes and required', function()
  local loaded = load_schema([[
shortcodes:
  iconify:
    required:
      - size
    arguments:
      - name: set-or-icon
        type: string
        required: true
      - name: icon
        type: string
    attributes:
      size:
        type: string
      mode:
        type: string
        enum: [svg, style, bg, mask]
]])
  local entry = loaded.shortcodes.iconify

  local valid, errors, _, merged = schema.validate_shortcode(
    'iconify', { 'mdi:home' }, { size = '2x', mode = 'svg' }, entry)
  assert_valid(valid, errors)
  assert_eq(merged.arguments['set-or-icon'], 'mdi:home')
  assert_eq(merged.attributes.size, '2x')

  local missing_valid, missing_errors = schema.validate_shortcode(
    'iconify', {}, { size = '2x' }, entry)
  assert_false(missing_valid, 'a required argument is enforced')
  assert_contains(missing_errors, 'set-or-icon')

  local required_valid, required_errors = schema.validate_shortcode(
    'iconify', { 'mdi:home' }, {}, entry)
  assert_false(required_valid, 'the parent-level required list is enforced')
  assert_contains(required_errors, 'iconify.size')

  local enum_valid, enum_errors = schema.validate_shortcode(
    'iconify', { 'mdi:home' }, { size = '2x', mode = 'nope' }, entry)
  assert_false(enum_valid)
  assert_contains(enum_errors, 'iconify.mode')
end)

test('S6: an unknown shortcode attribute is reported', function()
  local loaded = load_schema([[
shortcodes:
  iconify:
    attributes:
      aria-hidden:
        type: string
]])
  local _, _, warnings = schema.validate_shortcode(
    'iconify', {}, { ['arai-hidden'] = 'true' }, loaded.shortcodes.iconify)
  assert_contains(warnings, 'arai-hidden', 'the typo is surfaced')
end)

test('shortcode required works without an attributes block', function()
  local loaded = load_schema([[
shortcodes:
  demo:
    required:
      - icon
]])
  local valid, errors = schema.validate_shortcode(
    'demo', {}, { icon = 'star' }, loaded.shortcodes.demo)
  assert_valid(valid, errors)
end)

test('shortcode required still reports a missing attribute', function()
  local loaded = load_schema([[
shortcodes:
  demo:
    required:
      - icon
]])
  local valid, errors = schema.validate_shortcode('demo', {}, {}, loaded.shortcodes.demo)
  assert_false(valid, 'a missing required attribute should be reported')
  assert_contains(errors, 'icon')
end)

test('shortcode required reads the merged attributes when the entry declares them', function()
  -- `replaceWith` forwards the value and clears the old key, so the old
  -- spelling is genuinely absent once the attributes are merged. Reading the
  -- caller's raw arguments instead let it satisfy the requirement.
  local loaded = load_schema([[
shortcodes:
  demo:
    attributes:
      old-name:
        type: string
        deprecated:
          since: "1.2.0"
          replaceWith: new-name
      new-name:
        type: string
    required:
      - old-name
]])
  local valid, errors = schema.validate_shortcode(
    'demo', {}, { ['old-name'] = 'carried' }, loaded.shortcodes.demo)
  assert_false(valid, 'a key cleared by replaceWith no longer satisfies required')
  assert_contains(errors, 'old-name')
end)

test('shortcode required accepts a value supplied under a declared alias', function()
  -- An alias resolves to its canonical field and the alias spelling is
  -- cleared from the merged attributes, the way `_validate_map` clears a
  -- deprecated key. Unlike `replaceWith`, the value is still present, under
  -- the canonical name, so `required` must find it there.
  local loaded = load_schema([[
shortcodes:
  demo:
    attributes:
      new-name:
        type: string
        aliases:
          - legacy-name
    required:
      - legacy-name
]])
  local valid, errors = schema.validate_shortcode(
    'demo', {}, { ['legacy-name'] = 'carried' }, loaded.shortcodes.demo)
  assert_valid(valid, errors)
end)

test('shortcode required matches an alias under its other spelling too', function()
  -- `required` is read from the schema author, and a caller's raw argument
  -- carries its own spelling. The match between them has to go through
  -- `_lookup`, the same way every other name comparison in this module does,
  -- so a hyphen in one and an underscore in the other still match.
  local loaded = load_schema([[
shortcodes:
  demo:
    attributes:
      new-name:
        type: string
        aliases:
          - legacy-name
    required:
      - legacy_name
]])
  local valid, errors = schema.validate_shortcode(
    'demo', {}, { ['legacy-name'] = 'carried' }, loaded.shortcodes.demo)
  assert_valid(valid, errors)
end)

test('S7: validate_attributes checks declared keys and ignores the rest', function()
  local loaded = load_schema([[
attributes:
  typst:
    format:
      type: string
      enum: [png, svg, pdf, html]
    dpi:
      type: integer
      exclusiveMinimum: 0
]])
  local valid, errors, warnings, merged = schema.validate_attributes(
    { format = 'png', dpi = '300', ['layout-ncol'] = '2' }, 'typst', loaded)
  assert_valid(valid, errors)
  assert_eq(#warnings, 0, 'a foreign Pandoc attribute is not reported')
  assert_eq(merged.dpi, 300, 'a declared attribute is coerced')

  local bad_valid, bad_errors = schema.validate_attributes(
    { format = 'gif' }, 'typst', loaded)
  assert_false(bad_valid)
  assert_contains(bad_errors, 'typst.format')
end)

test('S7: validate_attributes on an undeclared group is a no-op', function()
  local loaded = load_schema([[
attributes:
  typst:
    format:
      type: string
]])
  local valid, errors = schema.validate_attributes({ anything = 'goes' }, 'other', loaded)
  assert_valid(valid, errors)
end)

test('S7: validate_format checks one output format', function()
  local loaded = load_schema([[
formats:
  typst:
    paper:
      type: string
      enum: [a4, letter]
]])
  local meta = pandoc.read('---\ntypst:\n  paper: a4\n---\n', 'markdown').meta
  local valid, errors, _, merged = schema.validate_format(meta, 'typst', loaded)
  assert_valid(valid, errors)
  assert_eq(merged.paper, 'a4')

  local bad_meta = pandoc.read('---\ntypst:\n  paper: a3\n---\n', 'markdown').meta
  local bad_valid, bad_errors = schema.validate_format(bad_meta, 'typst', loaded)
  assert_false(bad_valid)
  assert_contains(bad_errors, 'typst.paper')
end)

test('S11: a second YAML document is reported clearly', function()
  local path = os.tmpname()
  local handle = assert(io.open(path, 'w'))
  handle:write('options:\n  a:\n    type: string\n---\nstray: true\n')
  handle:close()
  local loaded, err = schema.load_schema(path)
  os.remove(path)
  assert_eq(loaded, nil, 'the file is refused')
  assert_contains(tostring(err), 'multiple YAML documents')
end)

test('S11: a missing schema file names the path', function()
  local loaded, err = schema.load_schema('/nonexistent/_schema.yml')
  assert_eq(loaded, nil)
  assert_contains(tostring(err), '/nonexistent/_schema.yml')
end)

test('validate_options degrades instead of aborting the render', function()
  local meta = pandoc.read('---\ntitle: t\n---\n', 'markdown').meta
  local merged = schema.validate_options(meta, 'demo', '/nonexistent/_schema.yml')
  assert_eq(type(merged), 'table', 'a table is still returned')
  assert_contains(logged, 'demo', 'the failure is logged')
end)

test('extract_meta_options keeps the spelling the document used', function()
  local options = doc_options('    typst-cache-max-age: 12\n    inline: false')
  assert_eq(options['typst-cache-max-age'], '12', 'hyphenated key kept')
  assert_eq(options.inline, false, 'a bare YAML boolean stays boolean')
end)

test('a bare YAML boolean survives validation as a boolean', function()
  local loaded = load_schema([[
options:
  inline:
    type: boolean
    default: true
]])
  local options = doc_options('    inline: false')
  local valid, errors, _, merged = schema.validate(options, loaded.options)
  assert_valid(valid, errors)
  assert_eq(merged.inline, false, 'false is preserved, not defaulted or stringified')
  assert_eq(type(merged.inline), 'boolean', 'and it is still a boolean')
end)

test('a string boolean is normalised', function()
  local loaded = load_schema([[
options:
  inline:
    type: boolean
]])
  local _, _, _, merged = schema.validate({ inline = 'no' }, loaded.options)
  assert_eq(merged.inline, false)
end)

test('a string enum of "true" and "false" stays a string', function()
  local loaded = load_schema([[
shortcodes:
  iconify:
    attributes:
      inline:
        type: string
        enum: ["true", "false"]
]])
  local valid, errors, _, merged = schema.validate_shortcode(
    'iconify', {}, { inline = 'false' }, loaded.shortcodes.iconify)
  assert_valid(valid, errors)
  assert_eq(merged.attributes.inline, 'false', 'not coerced to a boolean')
end)

test('a required option that is absent is an error', function()
  local loaded = load_schema([[
options:
  token:
    type: string
    required: true
]])
  local valid, errors = schema.validate({}, loaded.options)
  assert_false(valid)
  assert_contains(errors, 'token')
end)

test('key_order returns the keys as the schema declared them', function()
  local loaded = load_schema([[
options:
  zulu:
    type: string
  alpha:
    type: string
  mike:
    type: string
]])
  local order = schema.key_order(loaded.options)
  assert_eq(table.concat(order, ','), 'zulu,alpha,mike', 'authored order is kept')
end)

test('key_order falls back to sorted keys for a hand-built table', function()
  local order = schema.key_order({ zulu = 1, alpha = 1, mike = 1 })
  assert_eq(table.concat(order, ','), 'alpha,mike,zulu', 'sorted when order is unknown')
end)

test('the schema declares the v2 meta-schema', function()
  local loaded = load_schema([[
$schema: https://m.canouil.dev/quarto-wizard/assets/schema/v2/extension-schema.json
options: {}
]])
  assert_eq(loaded['$schema'], schema.SCHEMA_VERSION)
end)

test('every section defaults to an empty table', function()
  local loaded = load_schema('options: {}\n')
  for _, section in ipairs({ 'options', 'shortcodes', 'formats', 'projects', 'attributes', 'classes' }) do
    assert_eq(type(loaded[section]), 'table', section .. ' is a table')
  end
end)

test('compiling a descriptor does not mutate the caller schema', function()
  local loaded = load_schema([[
options:
  count:
    type: number
    default: 5
]])
  local before = loaded.options.count.default
  schema.validate({}, loaded.options)
  assert_eq(loaded.options.count.default, before, 'the loaded schema is untouched')
end)

test('a value given under both spellings drops the alias key', function()
  local loaded = load_schema([[
options:
  colour:
    type: string
    aliases:
      - color
]])
  local valid, errors, warnings, merged = schema.validate(
    { colour = 'red', color = 'blue' }, loaded.options)
  assert_eq(merged.colour, 'red', 'the declared name should win')
  assert_eq(merged.color, nil, 'the alias key should not survive in merged')
  assert_true(
    #errors > 0 or #warnings > 0,
    'supplying both spellings should be reported'
  )
end)

test('a value given only under an alias still moves to the declared name', function()
  local loaded = load_schema([[
options:
  colour:
    type: string
    aliases:
      - color
]])
  local valid, errors, _, merged = schema.validate({ color = 'blue' }, loaded.options)
  assert_valid(valid, errors)
  assert_eq(merged.colour, 'blue', 'the alias value should move to the declared name')
  assert_eq(merged.color, nil, 'the alias key should be removed')
end)

test('two different aliases supplied for the same field both drop, with a warning', function()
  local loaded = load_schema([[
options:
  colour:
    type: string
    aliases:
      - color
      - farbe
]])
  local valid, errors, warnings, merged = schema.validate(
    { color = 'blue', farbe = 'rot' }, loaded.options)
  assert_eq(merged.colour, 'blue', 'the first alias in declaration order wins')
  assert_eq(merged.color, nil, 'the first alias key should not survive in merged')
  assert_eq(merged.farbe, nil, 'the second alias key should not survive in merged')
  assert_true(
    #errors > 0 or #warnings > 0,
    'supplying two aliases for the same field should be reported'
  )
end)

test('the declared name wins over an alias, even in its normalised spelling', function()
  local loaded = load_schema([[
options:
  text-color:
    type: string
    aliases:
      - color
]])
  local valid, errors, warnings, merged = schema.validate(
    { text_color = 'a', color = 'b' }, loaded.options)
  assert_valid(valid, errors)
  assert_eq(merged['text-color'], 'a', 'the declared name should win over the alias')
  assert_eq(merged.color, nil, 'the alias key should be removed')
  assert_eq(merged.text_color, nil, 'the normalised declared key should be removed')
  assert_contains(warnings, '"text_color" and "color"', 'the warning names both supplied keys')
  for _, warning in ipairs(warnings) do
    assert_false(
      warning:find('not a recognised key', 1, true) ~= nil,
      'the declared spelling is not an unknown key: ' .. warning
    )
  end
end)

test('the conflict warning names the two keys the author supplied', function()
  local loaded = load_schema([[
options:
  colour:
    type: string
    aliases:
      - color
      - farbe
]])
  local _, _, warnings = schema.validate({ color = 'blue', farbe = 'rot' }, loaded.options)
  assert_contains(warnings, 'was given as both "color" and "farbe"; "color" was used.')
end)

test('an alias matched via hyphen/underscore normalisation moves without a false conflict', function()
  local loaded = load_schema([[
options:
  colour:
    type: string
    aliases:
      - text-color
]])
  local valid, errors, warnings, merged = schema.validate(
    { text_color = 'blue' }, loaded.options)
  assert_valid(valid, errors)
  assert_eq(#warnings, 0, 'a single spelling, even a normalised one, is not a conflict')
  assert_eq(merged.colour, 'blue', 'the normalised alias value should move to the declared name')
  assert_eq(merged.text_color, nil, 'the normalised alias key should be removed')
end)

test('an explicit empty string is not replaced by the default', function()
  local loaded = load_schema([[
options:
  label:
    type: string
    default: fallback
]])
  local _, _, _, merged = schema.validate({ label = '' }, loaded.options)
  assert_eq(merged.label, '', 'an empty string should survive')
end)

test('an absent key still takes its default', function()
  local loaded = load_schema([[
options:
  label:
    type: string
    default: fallback
]])
  local _, _, _, merged = schema.validate({}, loaded.options)
  assert_eq(merged.label, 'fallback', 'an absent key should take the default')
end)

test('required is satisfied by an empty string', function()
  local loaded = load_schema([[
options:
  label:
    type: string
    required: true
]])
  local valid, errors = schema.validate({ label = '' }, loaded.options)
  assert_valid(valid, errors)
end)

test('required still reports an absent key', function()
  local loaded = load_schema([[
options:
  label:
    type: string
    required: true
]])
  local valid = schema.validate({}, loaded.options)
  assert_false(valid, 'an absent required key should be reported')
end)

test('minLength is enforced against an empty string', function()
  local loaded = load_schema([[
options:
  label:
    type: string
    minLength: 1
]])
  local valid, errors = schema.validate({ label = '' }, loaded.options)
  assert_false(valid, 'an empty string should fail minLength 1')
  assert_contains(errors, 'label')
end)

test('a bare option in document metadata is absent and takes its default', function()
  local loaded = load_schema([[
options:
  count:
    type: string
    default: fallback
]])
  local options = doc_options('    count:')
  local _, _, _, merged = schema.validate(options, loaded.options)
  assert_eq(merged.count, 'fallback', 'a bare key should take the default')
end)

test('an option set to null in document metadata is absent and takes its default', function()
  local loaded = load_schema([[
options:
  count:
    type: string
    default: fallback
]])
  local options = doc_options('    count: null')
  local _, _, _, merged = schema.validate(options, loaded.options)
  assert_eq(merged.count, 'fallback', 'an explicit null should take the default')
end)

test('an option set to ~ in document metadata is absent and takes its default', function()
  local loaded = load_schema([[
options:
  count:
    type: string
    default: fallback
]])
  local options = doc_options('    count: ~')
  local _, _, _, merged = schema.validate(options, loaded.options)
  assert_eq(merged.count, 'fallback', 'an explicit ~ should take the default')
end)

test('an option set to "" in document metadata is an empty string, not the default', function()
  local loaded = load_schema([[
options:
  count:
    type: string
    default: fallback
]])
  local options = doc_options('    count: ""')
  local _, _, _, merged = schema.validate(options, loaded.options)
  assert_eq(merged.count, '', 'an explicit empty string should survive, not take the default')
end)

test('an empty string on a numeric field is a type error, not the default', function()
  local loaded = load_schema([[
options:
  count:
    type: number
    default: 3
]])
  local valid, errors, _, merged = schema.validate({ count = '' }, loaded.options)
  assert_false(valid, 'an empty string is not a number')
  assert_contains(errors, 'must be of type "number", got "string"')
  assert_eq(merged.count, '', 'the empty string is not replaced by the default')
end)

test('minLength is enforced against an empty array element', function()
  local loaded = load_schema([[
options:
  tags:
    type: array
    items:
      type: string
      minLength: 1
]])
  local valid, errors = schema.validate({ tags = { '' } }, loaded.options)
  assert_false(valid, 'an empty array element should fail minLength 1')
  assert_contains(errors, 'tags[1]')
end)

test('minLength is enforced against a surplus key when properties and additionalProperties are both declared', function()
  local loaded = load_schema([[
options:
  layout:
    type: object
    properties:
      columns:
        type: number
    additionalProperties:
      type: string
      minLength: 1
]])
  local valid, errors = schema.validate(
    { layout = { columns = 2, extra = '' } }, loaded.options)
  assert_false(valid, 'a surplus key set to an empty string should fail minLength 1')
  assert_contains(errors, 'layout.extra')
end)

test('an empty string is rendered as "" in an error message', function()
  local loaded = load_schema([[
options:
  echo:
    type: string
    enum: [a, b]
]])
  local valid, errors = schema.validate({ echo = '' }, loaded.options)
  assert_false(valid, 'an empty string not in the enum should be reported')
  assert_contains(errors, 'got ""')
end)

test('a null element in the middle of a document metadata sequence does not leave a hole', function()
  local loaded = load_schema([[
options:
  tags:
    type: array
    minItems: 1
    items:
      type: string
]])
  local options = doc_options('    tags: [~, b]')
  local valid, errors, _, merged = schema.validate(options, loaded.options)
  assert_valid(valid, errors)
  assert_eq(#merged.tags, 1, 'the null element should be dropped, not leave a hole')
  assert_eq(merged.tags[1], 'b', 'the surviving element should be first')
end)

test('a document metadata sequence of only null elements becomes an empty array', function()
  local loaded = load_schema([[
options:
  tags:
    type: array
    minItems: 1
    items:
      type: string
]])
  local options = doc_options('    tags: [~]')
  local valid, errors, _, merged = schema.validate(options, loaded.options)
  assert_false(valid, 'an empty array should fail minItems 1')
  assert_eq(#merged.tags, 0, 'the null element should be dropped, leaving an empty array')
  assert_contains(errors, 'at least 1 items')
end)

test('a null element at the end of a document metadata sequence is dropped', function()
  local loaded = load_schema([[
options:
  tags:
    type: array
    minItems: 1
    items:
      type: string
]])
  local options = doc_options('    tags: [a, ~]')
  local valid, errors, _, merged = schema.validate(options, loaded.options)
  assert_valid(valid, errors)
  assert_eq(#merged.tags, 1, 'the null element should be dropped')
  assert_eq(merged.tags[1], 'a', 'the surviving element should be kept')
end)

test('a document metadata sequence with no null elements is unaffected', function()
  local loaded = load_schema([[
options:
  tags:
    type: array
    minItems: 1
    items:
      type: string
]])
  local options = doc_options('    tags: [a, b]')
  local valid, errors, _, merged = schema.validate(options, loaded.options)
  assert_valid(valid, errors)
  assert_eq(#merged.tags, 2, 'both elements should be kept')
  assert_eq(merged.tags[1], 'a', 'the first element should be kept')
  assert_eq(merged.tags[2], 'b', 'the second element should be kept')
end)

-- ============================================================================
-- REPORT
-- ============================================================================

print(string.format('%d passed, %d failed', passed, failed))
if failed > 0 then
  print('')
  for _, failure in ipairs(failures) do
    print('  FAIL ' .. failure)
  end
end

-- `os.exit` leaves the Lua state open by default, which loses buffered output.
io.stdout:flush()
os.exit(failed == 0 and 0 or 1, true)
