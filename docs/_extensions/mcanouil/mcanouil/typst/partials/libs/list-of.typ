// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// List of X (LOX) functions for automatic outline generation
// Generates "List of Figures", "List of Tables", "List of Videos", etc.

// Import shared utilities
// #import "utilities.typ": pluralise

// ============================================================================
// List of X generation
// ============================================================================

/// Render list-of sections based on configuration
/// Processes template configuration and generates list-of sections.
/// If no figures/tables are found, nothing is rendered (including no pagebreaks).
/// @param list-of-config Dictionary mapping figure kinds to titles from template
/// @return Formatted list-of sections with pagebreaks (or nothing if no content exists)
#let render-list-of-sections(list-of-config) = context {
  // Collect all Quarto figure kinds present in the document
  let all-figs = query(figure)
  let doc-kinds = (:)
  let all-kinds = (:)

  for fig in all-figs {
    if type(fig.kind) == str and fig.kind.starts-with("quarto-float-") {
      let short = fig.kind.replace("quarto-float-", "")
      if short not in doc-kinds {
        doc-kinds.insert(short, true)
      }

      // Also collect supplement information (from auto-list-of logic)
      if fig.kind not in all-kinds {
        let supp = if fig.supplement != none {
          if type(fig.supplement) == content {
            let s = repr(fig.supplement)
            if s.starts-with("[") and s.ends-with("]") and s.len() > 2 {
              s.slice(1, -1)
            } else {
              s
            }
          } else {
            str(fig.supplement)
          }
        } else {
          // Fallback: derive from kind
          if short == "fig" {
            "Figure"
          } else if short == "tbl" {
            "Table"
          } else if short == "lst" {
            "Listing"
          } else if short.len() > 0 {
            upper(short.first()) + short.slice(1)
          } else {
            "Float"
          }
        }
        all-kinds.insert(fig.kind, supp)
      }
    }
  }

  // Build config based on list-of setting
  // If config is empty (list-of: true), enable all found kinds
  let config = if list-of-config.len() == 0 {
    let temp = (:)
    for kind in doc-kinds.keys() {
      temp.insert(kind, "true")
    }
    temp
  } else {
    list-of-config
  }

  // Priority order for standard kinds
  let priority = (
    "quarto-float-fig": 1,
    "quarto-float-tbl": 2,
    "quarto-float-lst": 3,
  )

  // Filter and process config
  let enabled-kinds = (:)
  for (key, value) in config {
    let kind-key = "quarto-float-" + key
    if kind-key in all-kinds {
      let custom-title = if value == "true" { none } else { value }
      enabled-kinds.insert(kind-key, (supplement: all-kinds.at(kind-key), custom-title: custom-title))
    }
  }

  // Sort: priority kinds first, then alphabetically
  let sorted-keys = enabled-kinds
    .keys()
    .sorted(key: k => {
      (priority.at(k, default: 99), enabled-kinds.at(k).supplement)
    })

  // Early return if no list-of sections to render (no content, no pagebreaks)
  if sorted-keys.len() == 0 {
    return
  }

  // Generate outlines
  // Add pagebreaks between sections, but not before the first one
  for (index, kind) in sorted-keys.enumerate() {
    let info = enabled-kinds.at(kind)
    let title = if info.custom-title != none {
      [#info.custom-title]
    } else {
      [List of #pluralise(info.supplement)]
    }

    // Add break before subsequent sections (not before first)
    // Uses context-aware conditional-break
    if index > 0 {
      conditional-break()
    }

    outline(title: title, target: figure.where(kind: kind))
  }

  // Break after all list-of sections (uses context-aware conditional-break)
  conditional-break()
}
