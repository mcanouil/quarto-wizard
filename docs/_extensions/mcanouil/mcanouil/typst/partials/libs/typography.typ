// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Typography configuration
// Matches the website's Alegreya Sans font family

// ============================================================================
// Font configuration
// ============================================================================

/// Font families for different text types with fallbacks
#let fonts = (
  body: ("Alegreya Sans", "Helvetica Neue", "Arial", "sans-serif"),
  headings: ("Alegreya Sans", "Helvetica Neue", "Arial", "sans-serif"),
  mono: ("Fira Code", "Menlo", "Monaco", "Courier New", "monospace"),
)

// ============================================================================
// Heading configuration
// ============================================================================

/// Heading sizes for levels 1-6
#let heading-sizes = (24pt, 18pt, 14pt, 12pt, 11pt, 11pt)

/// Heading font weights for levels 1-6
#let heading-weights = ("bold", "bold", "semibold", "semibold", "medium", "medium")

/// Get heading style for a given level
/// @param level Heading level (1-6)
/// @param colours Colour dictionary
/// @param heading-weight Optional custom font weight
/// @param heading-style Optional custom font style
/// @param heading-colour Optional custom colour
/// @param heading-line-height Optional custom line height
/// @return Dictionary with font, size, weight, style, and fill properties
#let get-heading-style(
  level,
  colours,
  heading-weight: none,
  heading-style: none,
  heading-colour: none,
  heading-line-height: none,
) = {
  let idx = calc.min(level - 1, 5)
  (
    font: fonts.headings,
    size: heading-sizes.at(idx),
    weight: if heading-weight != none { heading-weight } else { heading-weights.at(idx) },
    style: if heading-style != none { heading-style } else { "normal" },
    fill: if heading-colour != none { heading-colour } else { colours.foreground },
  )
}

// ============================================================================
// Paragraph configuration
// ============================================================================

/// Default paragraph settings
#let paragraph-settings = (
  justify: true,
  leading: 0.75em, // Increased from 0.65em for better readability
  first-line-indent: 0em,
)
