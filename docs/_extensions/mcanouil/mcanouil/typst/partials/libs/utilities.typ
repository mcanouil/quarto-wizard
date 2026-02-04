// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Shared utility functions
// Common helpers used across multiple template partials

// ============================================================================
// Document state for layout tracking
// ============================================================================

/// State to track whether columns are currently active
/// Set to true when multi-column layout is enabled via set page(columns: ...)
#let columns-active-state = state("columns-active", false)

/// State to track current page margins
/// Used by header, footer, and margin-section to position elements correctly
/// when margins change mid-document (e.g., professional style symmetric to asymmetric)
#let current-margin-state = state("current-margin", (top: 2.5cm, bottom: 2.5cm, left: 2.5cm, right: 2.5cm))

/// State to track if current page is a section page
/// Used by margin-section to skip rendering on section pages
#let section-page-state = state("section-page", false)

/// State to track current section type ("main", "appendix", "supplementary", "references")
/// Used by figure numbering to determine the correct prefix format
#let section-type = state("section-type", "main")

// ============================================================================
// Content validation and type checking
// ============================================================================

/// Check if a value has meaningful content
/// @param value Any value to check
/// @return Boolean indicating if value is non-empty
#let has-content(value) = {
  if value == none {
    false
  } else if type(value) == content {
    value != []
  } else {
    true
  }
}

/// Check if a value is empty (inverse of has-content)
/// @param value Any value to check
/// @return Boolean indicating if value is empty
#let is-empty(value) = {
  if type(value) == str {
    value.trim() == ""
  } else if type(value) == content {
    if value.at("text", default: none) != none {
      return is-empty(value.text)
    }
    for child in value.at("children", default: ()) {
      if not is-empty(child) {
        return false
      }
    }
    return true
  } else {
    value == none
  }
}

// ============================================================================
// Content conversion utilities
// ============================================================================

/// Convert content to plain string (for PDF metadata)
/// @param content Content to convert
/// @return String representation
#let content-to-string(c) = {
  if c == none {
    ""
  } else if type(c) == str {
    c
  } else if type(c) == content {
    if c.has("text") {
      c.text
    } else if c.has("children") {
      c.children.map(content-to-string).join("")
    } else if c.has("body") {
      content-to-string(c.body)
    } else {
      ""
    }
  } else {
    str(c)
  }
}

/// Unescape email addresses (Pandoc escapes @ as \@)
/// @param email Email string that may contain escaped characters
/// @return Unescaped email string
#let unescape-email(email) = {
  if email == none {
    none
  } else {
    email.replace("\\@", "@")
  }
}

// ============================================================================
// Block manipulation utilities
// ============================================================================

/// Create a new block with updated content whilst preserving other fields
/// @param old-block Original block element
/// @param new-content New content to insert
/// @return New block with updated content
#let block-with-new-content(old-block, new-content) = {
  let fields = old-block.fields()
  fields.remove("body")
  if fields.at("below", default: none) != none {
    // Workaround for synthesised element
    fields.below = fields.below.abs
  }
  return block.with(..fields)(new-content)
}

// ============================================================================
// String manipulation utilities
// ============================================================================

/// Pluralise a word using British English rules
/// @param word Word to pluralise (string or content)
/// @return Pluralised form
#let pluralise(word) = {
  let text = if type(word) == content {
    let s = repr(word)
    if s.starts-with("[") and s.ends-with("]") { s.slice(1, -1) } else { s }
  } else if type(word) == str { word } else { str(word) }

  // Irregular plurals dictionary
  let irregulars = (
    "Analysis": "Analyses",
    "Axis": "Axes",
    "Index": "Indices",
    "Matrix": "Matrices",
    "Appendix": "Appendices",
    "Vertex": "Vertices",
    "Datum": "Data",
    "Medium": "Media",
    "Criterion": "Criteria",
    "Phenomenon": "Phenomena",
    "Stimulus": "Stimuli",
    "Thesis": "Theses",
    "Hypothesis": "Hypotheses",
  )

  if text in irregulars {
    irregulars.at(text)
  } else if text.ends-with("y") {
    let before-y = text.slice(0, -1)
    let last-char = if before-y.len() > 0 { before-y.last() } else { "" }
    if last-char not in ("a", "e", "i", "o", "u") {
      before-y + "ies"
    } else {
      text + "s"
    }
  } else if (
    text.ends-with("s") or text.ends-with("x") or text.ends-with("z") or text.ends-with("ch") or text.ends-with("sh")
  ) {
    text + "es"
  } else if text.ends-with("f") {
    text.slice(0, -1) + "ves"
  } else if text.ends-with("fe") {
    text.slice(0, -2) + "ves"
  } else {
    text + "s"
  }
}

/// Convert string to title case following English capitalisation rules
/// Small words (articles, conjunctions, prepositions) are not capitalised
/// unless they are the first word
/// @param s String to convert to title case
/// @return Title-cased string
#let title-case(s) = {
  let text = if type(s) == content {
    let s = repr(s)
    if s.starts-with("[") and s.ends-with("]") { s.slice(1, -1) } else { s }
  } else if type(s) == str { s } else { str(s) }
  let small-words = (
    "a",
    "an",
    "and",
    "as",
    "at",
    "but",
    "by",
    "for",
    "in",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with",
  )
  let words = text.split(" ")
  words
    .enumerate()
    .map(((i, word)) => {
      if word.len() == 0 {
        word
      } else if i == 0 or lower(word) not in small-words {
        upper(word.first()) + lower(word.slice(1))
      } else {
        lower(word)
      }
    })
    .join(" ")
}

// ============================================================================
// Layout utilities
// ============================================================================

/// Apply appropriate page or column break based on layout context
/// Uses state tracking to determine if columns are active.
/// Uses colbreak when inside columns/containers, pagebreak otherwise.
/// @param weak Whether to use weak break (default: true)
/// @return Content with the appropriate break
#let conditional-break(weak: true) = context {
  let in-columns = columns-active-state.get()

  if in-columns {
    colbreak(weak: weak)
  } else {
    pagebreak(weak: weak)
  }
}

// ============================================================================
// Configuration processing utilities
// ============================================================================

/// Default breakable settings for page-break-inside configuration
/// Tables and quotes are breakable by default, callouts are not
#let BREAKABLE-DEFAULTS = (
  table: true,
  callout: false,
  code: auto,
  quote: false,
  terms: false,
)

/// Process page-break-inside configuration into breakable settings
/// Converts various input formats into a consistent dictionary
/// @param page-break-inside Raw configuration (auto, bool, or dictionary)
/// @return Dictionary with breakable settings for each element type
#let process-breakable-settings(page-break-inside) = {
  if page-break-inside == auto {
    BREAKABLE-DEFAULTS
  } else if type(page-break-inside) == bool {
    // Global setting applied to all element types
    (
      table: page-break-inside,
      callout: page-break-inside,
      code: page-break-inside,
      quote: page-break-inside,
      terms: page-break-inside,
    )
  } else if type(page-break-inside) == dictionary {
    // Granular settings with defaults for missing keys
    (
      table: page-break-inside.at("table", default: BREAKABLE-DEFAULTS.table),
      callout: page-break-inside.at("callout", default: BREAKABLE-DEFAULTS.callout),
      code: page-break-inside.at("code", default: BREAKABLE-DEFAULTS.code),
      quote: page-break-inside.at("quote", default: BREAKABLE-DEFAULTS.quote),
      terms: page-break-inside.at("terms", default: BREAKABLE-DEFAULTS.terms),
    )
  } else {
    // Fallback to defaults
    BREAKABLE-DEFAULTS
  }
}

// ============================================================================
// WCAG 2.1 Accessibility Functions
// ============================================================================

/// Calculate relative luminance according to WCAG 2.1 specification
/// Implements the WCAG 2.1 relative luminance formula for accessibility compliance.
/// The formula converts sRGB colour values to linear RGB, then calculates a weighted sum.
///
/// Reference: https://www.w3.org/WAI/GL/wiki/Relative_luminance
///
/// @param colour RGB colour to calculate luminance for
/// @return Float Relative luminance value between 0.0 (darkest black) and 1.0 (lightest white)
///
/// @example
/// ```typst
/// #let black-luminance = calculate-luminance(rgb("#000000"))  // Returns 0.0
/// #let white-luminance = calculate-luminance(rgb("#ffffff"))  // Returns 1.0
/// #let gray-luminance = calculate-luminance(rgb("#808080"))   // Returns ~0.22
/// ```
#let calculate-luminance(colour) = {
  // Extract RGB components (Typst returns percentages 0%-100%)
  let components = colour.components()

  // Convert percentages to 0-1 range
  let r-srgb = components.at(0) / 100%
  let g-srgb = components.at(1) / 100%
  let b-srgb = components.at(2) / 100%

  // Convert sRGB to linear RGB using WCAG 2.1 formula
  // If value <= 0.03928, divide by 12.92
  // Otherwise, apply gamma correction: ((value + 0.055) / 1.055) ^ 2.4
  let linearize(value) = {
    if value <= 0.03928 {
      value / 12.92
    } else {
      calc.pow((value + 0.055) / 1.055, 2.4)
    }
  }

  let r-linear = linearize(r-srgb)
  let g-linear = linearize(g-srgb)
  let b-linear = linearize(b-srgb)

  // Calculate relative luminance using WCAG 2.1 weighted sum
  // L = 0.2126 * R + 0.7152 * G + 0.0722 * B
  let luminance = 0.2126 * r-linear + 0.7152 * g-linear + 0.0722 * b-linear

  luminance
}

/// Calculate contrast ratio between two colours according to WCAG 2.1
/// Uses relative luminance values to determine the contrast ratio.
/// WCAG AA requires 4.5:1 for normal text, 3:1 for large text (14pt bold or 18pt+).
/// WCAG AAA requires 7:1 for normal text, 4.5:1 for large text.
///
/// Reference: https://www.w3.org/WAI/GL/wiki/Contrast_ratio
///
/// @param colour1 First colour (typically text colour)
/// @param colour2 Second colour (typically background colour)
/// @return Float Contrast ratio between 1.0 (no contrast) and 21.0 (maximum contrast)
///
/// @example
/// ```typst
/// #let ratio1 = calculate-contrast-ratio(rgb("#000000"), rgb("#ffffff"))  // Returns 21.0 (black on white)
/// #let ratio2 = calculate-contrast-ratio(rgb("#767676"), rgb("#ffffff"))  // Returns 4.54 (WCAG AA pass)
/// #let ratio3 = calculate-contrast-ratio(rgb("#999999"), rgb("#ffffff"))  // Returns 2.85 (WCAG AA fail)
/// ```
#let calculate-contrast-ratio(colour1, colour2) = {
  let lum1 = calculate-luminance(colour1)
  let lum2 = calculate-luminance(colour2)

  // WCAG formula: (L1 + 0.05) / (L2 + 0.05)
  // where L1 is the lighter colour and L2 is the darker colour
  let lighter = calc.max(lum1, lum2)
  let darker = calc.min(lum1, lum2)

  let ratio = (lighter + 0.05) / (darker + 0.05)

  ratio
}

/// Determine minimum contrast ratio required for WCAG AA compliance
/// Large text (14pt bold or 18pt+ regular) requires 3:1, normal text requires 4.5:1.
///
/// WCAG 2.1 defines large text as:
/// - 14pt (18.66px) bold or heavier
/// - 18pt (24px) regular weight or larger
///
/// Reference: https://www.w3.org/WAI/GL/WCAG21/Understanding/contrast-minimum.html
///
/// @param size Font size in pt (default: 11pt)
/// @param weight Font weight string or integer (default: "normal")
///   Recognised weights: "normal", "medium", "semibold", "bold", "extrabold", "black"
///   or numeric values 100-900
/// @return Float Minimum contrast ratio (3.0 for large text, 4.5 for normal text)
///
/// @example
/// ```typst
/// #let ratio1 = get-required-contrast-ratio(size: 18pt, weight: "normal")  // Returns 3.0 (large)
/// #let ratio2 = get-required-contrast-ratio(size: 14pt, weight: "bold")    // Returns 3.0 (large)
/// #let ratio3 = get-required-contrast-ratio(size: 12pt, weight: "normal")  // Returns 4.5 (normal)
/// ```
#let get-required-contrast-ratio(size: 11pt, weight: "normal") = {
  // Convert weight to numeric value for comparison
  let numeric-weight = if type(weight) == str {
    if weight == "thin" or weight == "hairline" {
      100
    } else if weight == "extralight" or weight == "ultralight" {
      200
    } else if weight == "light" {
      300
    } else if weight == "normal" or weight == "regular" {
      400
    } else if weight == "medium" {
      500
    } else if weight == "semibold" or weight == "demibold" {
      600
    } else if weight == "bold" {
      700
    } else if weight == "extrabold" or weight == "ultrabold" {
      800
    } else if weight == "black" or weight == "heavy" {
      900
    } else {
      400 // Default to normal if unrecognised
    }
  } else {
    weight // Already numeric
  }

  // Extract numeric value from size (handles both pt and raw numbers)
  let size-pt = if type(size) == length {
    size / 1pt
  } else {
    size
  }

  // WCAG 2.1 large text criteria:
  // - 14pt bold (weight >= 700) or larger
  // - 18pt any weight or larger
  let is-large-text = (size-pt >= 18) or (size-pt >= 14 and numeric-weight >= 700)

  if is-large-text {
    3.0 // WCAG AA for large text
  } else {
    4.5 // WCAG AA for normal text
  }
}

/// Ensure a colour meets minimum contrast requirements against a background
/// Automatically adjusts the colour by lightening or darkening whilst preserving hue.
/// Falls back to pure black or white if adjustment alone cannot achieve the required ratio.
///
/// @param text-colour Colour to potentially adjust (typically text or foreground element)
/// @param bg-colour Background colour to contrast against
/// @param min-ratio Minimum contrast ratio required (default: 4.5 for WCAG AA normal text)
/// @param preserve-hue Attempt to preserve colour hue by adjusting lightness (default: true)
///   If false, mixes with pure black/white instead
/// @return Color Adjusted colour meeting contrast requirements
///
/// @example
/// ```typst
/// // Adjust grey text on white background to meet 4.5:1
/// #let adjusted = ensure-contrast(rgb("#999999"), rgb("#ffffff"), min-ratio: 4.5)
///
/// // Adjust brand colour on dark background
/// #let adjusted = ensure-contrast(rgb("#0066cc"), rgb("#333333"), min-ratio: 4.5)
/// ```
#let ensure-contrast(
  text-colour,
  bg-colour,
  min-ratio: 4.5,
  preserve-hue: true,
) = {
  // Check if current contrast is already sufficient
  let current-ratio = calculate-contrast-ratio(text-colour, bg-colour)

  if current-ratio >= min-ratio {
    return text-colour
  }

  // Determine whether to lighten or darken based on background luminance
  let bg-luminance = calculate-luminance(bg-colour)
  let should-lighten = bg-luminance < 0.5 // Darken background = lighten text

  // Try adjusting in incremental steps to preserve hue
  if preserve-hue {
    // Try adjustment percentages from 10% to 100% in 10% steps
    let adjustment-step = 10%
    let max-adjustment = 100%

    for adjustment in range(1, 11) {
      let adjusted-colour = if should-lighten {
        text-colour.lighten(adjustment * adjustment-step)
      } else {
        text-colour.darken(adjustment * adjustment-step)
      }

      let test-ratio = calculate-contrast-ratio(adjusted-colour, bg-colour)

      if test-ratio >= min-ratio {
        return adjusted-colour
      }
    }
  }

  // If hue preservation failed or wasn't requested, fall back to pure black/white
  // Choose based on which would provide better contrast
  let black-ratio = calculate-contrast-ratio(rgb("#000000"), bg-colour)
  let white-ratio = calculate-contrast-ratio(rgb("#ffffff"), bg-colour)

  if white-ratio > black-ratio {
    rgb("#ffffff")
  } else {
    rgb("#000000")
  }
}

/// Get WCAG-compliant text colour for a given background
/// Selects between foreground and background colours from the colour scheme,
/// choosing whichever provides better contrast against the specified background.
/// If neither meets the minimum ratio, automatically adjusts the better option.
///
/// This is useful when you need simple dark/light text rather than preserving a brand colour.
///
/// @param bg-colour Background colour to contrast against
/// @param colours Colour scheme dictionary from mcanouil-colours()
/// @param min-ratio Minimum contrast ratio required (default: 4.5 for WCAG AA normal text)
/// @return Color Either foreground or background colour (or adjusted version) with best contrast
///
/// @example
/// ```typst
/// // Get appropriate text colour for a custom background
/// #let text-colour = get-wcag-compliant-text-colour(rgb("#6699cc"), colours, min-ratio: 4.5)
///
/// // For large text with lower requirement
/// #let text-colour = get-wcag-compliant-text-colour(rgb("#cccccc"), colours, min-ratio: 3.0)
/// ```
#let get-wcag-compliant-text-colour(bg-colour, colours, min-ratio: 4.5) = {
  // Calculate contrast ratios for both foreground and background
  let fg-ratio = calculate-contrast-ratio(colours.foreground, bg-colour)
  let bg-ratio = calculate-contrast-ratio(colours.background, bg-colour)

  // Choose the colour with better contrast
  let best-colour = if fg-ratio > bg-ratio {
    colours.foreground
  } else {
    colours.background
  }

  let best-ratio = calc.max(fg-ratio, bg-ratio)

  // If the best option still doesn't meet requirements, adjust it
  if best-ratio < min-ratio {
    ensure-contrast(best-colour, bg-colour, min-ratio: min-ratio)
  } else {
    best-colour
  }
}

// ============================================================================
// Colour utilities
// ============================================================================

/// Create appropriate background colour for light or dark mode with WCAG compliance.
/// Detects dark mode and creates a background that ensures text meets minimum contrast.
/// Mixes base colour heavily with page background, then validates text contrast.
///
/// The background is created by mixing base colour (5%) with page background (95%),
/// ensuring subtle colour tint whilst maintaining sufficient contrast for text.
///
/// @param base-colour Base colour to adjust
/// @param colours Colour scheme dictionary with background and foreground fields
/// @param min-ratio Minimum contrast ratio for text on this background (default: 4.5)
/// @return Color WCAG-compliant background colour
#let get-adaptive-background(base-colour, colours, min-ratio: 4.5) = {
  // Detect dark mode
  let fg-components = colours.foreground.components()
  let is-dark-mode = fg-components.at(0, default: 0%) > 50%

  // Create initial background by mixing heavily with page background
  // This creates a subtle tint whilst staying close to page background
  let initial-bg = color.mix(
    (colours.background, 95%),
    (base-colour, 5%),
    space: rgb,
  )

  // The background needs to provide contrast for foreground text
  // We adjust the background colour to ensure foreground text is readable
  // Strategy: lighten or darken the initial background until foreground contrasts well
  let current-ratio = calculate-contrast-ratio(colours.foreground, initial-bg)

  if current-ratio >= min-ratio {
    // Already meets contrast, return as-is
    initial-bg
  } else {
    // Need to adjust the background towards page background colour
    // Mix more heavily with page background to improve contrast
    color.mix(
      (colours.background, 98%),
      (base-colour, 2%),
      space: rgb,
    )
  }
}

/// Create appropriate border colour for light or dark mode with WCAG awareness.
/// Detects dark mode and creates a border colour with moderate contrast.
/// Border colours use a more saturated mix (30% base colour) than backgrounds.
///
/// @param base-colour Base colour to adjust
/// @param colours Colour scheme dictionary with background field
/// @return Color Adaptive border colour
#let get-adaptive-border(base-colour, colours) = {
  let fg-components = colours.foreground.components()
  let is-dark-mode = fg-components.at(0, default: 0%) > 50%

  // Create border with more saturation than background (30% vs 5%)
  // Borders don't require WCAG compliance as they're decorative, not text
  color.mix(
    (colours.background, 70%),
    (base-colour, 30%),
    space: rgb,
  )
}
