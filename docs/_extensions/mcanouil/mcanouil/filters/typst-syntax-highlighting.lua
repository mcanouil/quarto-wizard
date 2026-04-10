--- Enforce idiomatic syntax highlighting for the Typst format.
--- The mcanouil-typst format requires native Typst highlighting ("idiomatic").
--- This pre-quarto filter:
---   1. Overrides any metadata value back to "idiomatic".
---   2. Detects when a top-level `syntax-highlighting` key has already
---      configured the Pandoc writer with a Skylighting theme (which happens
---      before filters run) and halts the render so the user can fix it.

function Meta(meta)
  if not quarto.doc.is_format("typst") then
    return meta
  end

  meta["syntax-highlighting"] = pandoc.MetaInlines({ pandoc.Str("idiomatic") })

  -- Quarto configures PANDOC_WRITER_OPTIONS from the YAML before pre-quarto
  -- filters run. A top-level `syntax-highlighting` key overrides the
  -- format-level extension default at that stage, leaving the writer with a
  -- Skylighting theme we cannot undo from a filter.
  local hm = PANDOC_WRITER_OPTIONS and PANDOC_WRITER_OPTIONS.highlight_method
  if hm and hm['text-styles'] then
    io.stderr:write('\n'
      .. '[mcanouil-typst] ERROR: "syntax-highlighting" must be "idiomatic" for Typst output.\n'
      .. '  A top-level or project-level setting is overriding the extension default.\n'
      .. '  Move it under the target format instead, e.g.:\n\n'
      .. '    format:\n'
      .. '      html:\n'
      .. '        syntax-highlighting: github\n'
      .. '      mcanouil-typst:\n'
      .. '        syntax-highlighting: idiomatic   # or omit (default)\n\n')
    os.exit(1)
  end

  return meta
end

return {
  { Meta = Meta },
}
