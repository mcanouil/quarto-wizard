--- @module github
--- @license MIT
--- @copyright 2026 Mickaël Canouil
--- @author Mickaël Canouil

--- Load modules
local str = require(quarto.utils.resolve_path('_modules/string.lua'):gsub('%.lua$', ''))
local meta_mod = require(quarto.utils.resolve_path('_modules/metadata.lua'):gsub('%.lua$', ''))
local pdoc = require(quarto.utils.resolve_path('_modules/pandoc-helpers.lua'):gsub('%.lua$', ''))
local git = require(quarto.utils.resolve_path('_modules/git.lua'):gsub('%.lua$', ''))

--- Flag to track if superseded warning has been shown
--- @type boolean
local superseded_warning_shown = false

--- Flag to track if deprecation warning has been shown
--- @type boolean
local deprecation_warning_shown = false

--- @type string|nil The GitHub repository name (e.g., "owner/repo")
local github_repository = nil

--- @type string The base URL for GitHub (defaults to "https://github.com")
local github_base_url = 'https://github.com'

--- @type table<string, boolean> Set of reference IDs from the document
local references_ids_set = {}

--- @type integer Full length of a git commit SHA
local COMMIT_SHA_FULL_LENGTH = 40

--- @type integer Short length for displaying commit SHA
local COMMIT_SHA_SHORT_LENGTH = 7



--- Extract metadata value from document meta, supporting both new nested structure and deprecated top-level keys
--- @param meta table The document metadata table
--- @param key string The metadata key to retrieve
--- @return string|nil The metadata value as a string, or nil if not found
local function get_metadata_value(meta, key)
  -- Check for the new nested structure first: extensions.github.key
  local meta_value = meta_mod.get_metadata_value(meta, 'github', key)
  if meta_value then
    return meta_value
  end

  -- Check for deprecated top-level key and warn
  if meta[key] then
    local value
    value, deprecation_warning_shown = meta_mod.check_deprecated_config(meta, 'github', key, deprecation_warning_shown)
    if value then
      return value
    end
  end

  return nil
end

--- Show superseded extension warning once
--- This function displays a warning message informing users that this extension
--- has been superseded by the Git Link extension
local function show_superseded_warning()
  if not superseded_warning_shown then
    quarto.log.warning(
      'The "GitHub" extension has been superseded by the "Git Link" extension. ' ..
      'Please update your extension following the instructions at: ' ..
      'https://github.com/mcanouil/quarto-gitlink?tab=readme-ov-file#installation'
    )
    superseded_warning_shown = true
  end
end

--- Get repository name from metadata or git remote
--- This function extracts the GitHub repository name either from document metadata
--- or by querying the git remote origin URL
--- @param meta table The document metadata table
--- @return table The metadata table (unchanged)
local function get_repository(meta)
  show_superseded_warning()

  local meta_github_base_url = get_metadata_value(meta, 'base-url')
  local meta_github_repository = get_metadata_value(meta, 'repository-name')

  --- Set base URL if provided, otherwise use default
  if not str.is_empty(meta_github_base_url) then
    github_base_url = meta_github_base_url --[[@as string]]
  end

  if str.is_empty(meta_github_repository) then
    meta_github_repository = git.get_repository()
  end

  github_repository = meta_github_repository
  return meta
end

--- Extract and store reference IDs from the document
--- This function collects all reference IDs from the document to distinguish
--- between actual citations and GitHub mentions
--- @param doc pandoc.Pandoc The Pandoc document
--- @return pandoc.Pandoc The document (unchanged)
local function get_references(doc)
  local references = pandoc.utils.references(doc)

  for _, reference in ipairs(references) do
    if reference.id then
      references_ids_set[reference.id] = true
    end
  end
  return doc
end

--- Process GitHub mentions in citations
--- Distinguishes between actual bibliography citations and GitHub @mentions
--- @param cite pandoc.Cite The citation element
--- @return pandoc.Cite|pandoc.Link The original citation or a GitHub mention link
local function mentions(cite)
  if references_ids_set[cite.citations[1].id] then
    return cite
  else
    local mention_text = pandoc.utils.stringify(cite.content)
    local github_link = pdoc.create_link(mention_text, github_base_url .. '/' .. mention_text:sub(2))
    return github_link or cite
  end
end

--- Process GitHub issues, pull requests, and discussions
--- Converts various GitHub reference formats into clickable links
--- Supported formats:
--- - #123 (issue in current repo)
--- - owner/repo#123 (issue in specific repo)
--- - GH-123 (issue in current repo)
--- - https://example.com/owner/repo/issues/123 (full URL)
--- @param elem pandoc.Str The string element to process
--- @return pandoc.Link|nil A GitHub link or nil if no valid pattern found
local function issues(elem)
  local user_repo = nil
  local issue_number = nil
  local type = nil
  local short_link = nil

  if elem.text:match('^#(%d+)$') then
    issue_number = elem.text:match('^#(%d+)$')
    user_repo = github_repository
    type = 'issues'
    short_link = '#' .. issue_number
  elseif elem.text:match('^([^/]+/[^/#]+)#(%d+)$') then
    user_repo, issue_number = elem.text:match('^([^/]+/[^/#]+)#(%d+)$')
    type = 'issues'
    short_link = user_repo .. '#' .. issue_number
  elseif elem.text:match('^GH%-(%d+)$') then
    issue_number = elem.text:match('^GH%-(%d+)$')
    user_repo = github_repository
    type = 'issues'
    short_link = '#' .. issue_number
  else
    -- Dynamic pattern matching for base URL
    local escaped_base_url = str.escape_pattern(github_base_url)
    local url_pattern = '^' .. escaped_base_url .. '/([^/]+/[^/]+)/([^/]+)/(%d+)$'
    if elem.text:match(url_pattern) then
      user_repo, type, issue_number = elem.text:match(url_pattern)
      if user_repo == github_repository then
        short_link = '#' .. issue_number
      else
        short_link = user_repo .. '#' .. issue_number
      end
    end
  end

  local uri = nil
  local text = nil
  if not str.is_empty(short_link) and not str.is_empty(issue_number) and not str.is_empty(user_repo) and not str.is_empty(type) then
    if type == 'issues' or type == 'discussions' or type == 'pull' then
      uri = github_base_url .. '/' .. user_repo .. '/' .. type .. '/' .. issue_number
      text = pandoc.utils.stringify(short_link)
    end
  end

  return pdoc.create_link(text, uri)
end

--- Process GitHub commit references
--- Converts various commit reference formats into clickable links
--- Supported formats:
--- - 40-character SHA (commit in current repo)
--- - owner/repo@sha (commit in specific repo)
--- - username@40-character-sha (commit by user)
--- - https://example.com/owner/repo/commit/sha (full URL)
--- @param elem pandoc.Str The string element to process
--- @return pandoc.Link|nil A GitHub commit link or nil if no valid pattern found
local function commits(elem)
  local user_repo = nil
  local commit_sha = nil
  local type = nil
  local short_link = nil

  if elem.text:match('^(%w+)$') and elem.text:len() == COMMIT_SHA_FULL_LENGTH then
    commit_sha = elem.text:match('^(%w+)$')
    user_repo = github_repository
    type = 'commit'
    short_link = commit_sha:sub(1, COMMIT_SHA_SHORT_LENGTH)
  elseif elem.text:match('^([^/]+/[^/@]+)@(%w+)$') then
    user_repo, commit_sha = elem.text:match('^([^/]+/[^/@]+)@(%w+)$')
    type = 'commit'
    short_link = user_repo .. '@' .. commit_sha:sub(1, COMMIT_SHA_SHORT_LENGTH)
  elseif elem.text:match('^(%w+)@(%w+)$') then
    user_repo, commit_sha = elem.text:match('^(%w+)@(%w+)$')
    if commit_sha:len() == COMMIT_SHA_FULL_LENGTH then
      type = 'commit'
      short_link = user_repo .. '@' .. commit_sha:sub(1, COMMIT_SHA_SHORT_LENGTH)
    end
  else
    -- Dynamic pattern matching for base URL
    local escaped_base_url = str.escape_pattern(github_base_url)
    local url_pattern = '^' .. escaped_base_url .. '/([^/]+/[^/]+)/([^/]+)/(%w+)$'
    if elem.text:match(url_pattern) then
      user_repo, type, commit_sha = elem.text:match(url_pattern)
      if user_repo == github_repository then
        short_link = commit_sha:sub(1, COMMIT_SHA_SHORT_LENGTH)
      else
        short_link = user_repo .. '@' .. commit_sha:sub(1, COMMIT_SHA_SHORT_LENGTH)
      end
    end
  end

  local uri = nil
  local text = nil
  if not str.is_empty(short_link) and not str.is_empty(commit_sha) and not str.is_empty(user_repo) and not str.is_empty(type) then
    if type == 'commit' and commit_sha:len() == COMMIT_SHA_FULL_LENGTH then
      uri = github_base_url .. '/' .. user_repo .. '/' .. type .. '/' .. commit_sha
      text = pandoc.utils.stringify(short_link)
    end
  end

  return pdoc.create_link(text, uri)
end

--- Main GitHub processing function
--- Attempts to convert string elements into GitHub links by trying different patterns
--- @param elem pandoc.Str The string element to process
--- @return pandoc.Str|pandoc.Link The original element or a GitHub link
local function github(elem)
  local link = nil
  if link == nil then
    link = issues(elem)
  end

  if link == nil then
    link = commits(elem)
  end

  if link == nil then
    return elem
  else
    return link
  end
end

--- Pandoc filter configuration
--- Defines the order of filter execution:
--- 1. Extract references from the document
--- 2. Get repository information from metadata
--- 3. Process string elements for GitHub patterns
--- 4. Process citations for GitHub mentions
return {
  { Pandoc = get_references },
  { Meta = get_repository },
  { Str = github },
  { Cite = mentions }
}
