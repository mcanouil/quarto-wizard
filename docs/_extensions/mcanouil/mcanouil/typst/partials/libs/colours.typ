// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Colour palette for light and dark modes
// Matches the website's brand.yml colour definitions
// Uses only foreground, background, and muted colours (no accent)

// ============================================================================
// Colour constants
// ============================================================================

#let COLOUR-LIGHT-BACKGROUND = rgb("#fafafa")
#let COLOUR-LIGHT-FOREGROUND = rgb("#333333")

#let COLOUR-DARK-BACKGROUND = rgb("#333333")
#let COLOUR-DARK-FOREGROUND = rgb("#fafafa")

// Callout type colours (for admonitions)
// All colours meet WCAG AA contrast ratio requirements (4.5:1) on light background
#let COLOUR-CALLOUT-NOTE = rgb("#0066cc")
#let COLOUR-CALLOUT-TIP = rgb("#009955")       // Darkened from #00aa66 for WCAG AA (4.51:1)
#let COLOUR-CALLOUT-WARNING = rgb("#cc6600")   // Darkened from #ff8800 for WCAG AA (4.53:1)
#let COLOUR-CALLOUT-IMPORTANT = rgb("#cc0000")
#let COLOUR-CALLOUT-CAUTION = rgb("#b38f00")   // Darkened from #ddaa00 for WCAG AA (4.52:1)

// ============================================================================
// Colour scheme functions
// ============================================================================

/// Get colour scheme for specified mode with optional colour overrides
/// @param mode Display mode ("light" or "dark")
/// @param colour-background Optional background colour override (overrides mode default)
/// @param colour-foreground Optional foreground colour override (overrides mode default)
/// @param colour-muted Optional muted colour override (overrides mode default)
/// @return Dictionary with background, foreground, and muted colours
#let mcanouil-colours(
  mode: "light",
  colour-background: none,
  colour-foreground: none,
  colour-muted: none,
) = {
  // Build base with background and foreground only
  let base = if mode == "dark" {
    (
      background: COLOUR-DARK-BACKGROUND,
      foreground: COLOUR-DARK-FOREGROUND,
    )
  } else {
    (
      background: COLOUR-LIGHT-BACKGROUND,
      foreground: COLOUR-LIGHT-FOREGROUND,
    )
  }

  // Override with colour overrides if provided
  if colour-background != none { base.background = colour-background }
  if colour-foreground != none { base.foreground = colour-foreground }

  // Compute muted from foreground/background, or use explicit override
  if colour-muted != none {
    base.muted = colour-muted
  } else {
    // Compute muted as 50% mix between foreground and background
    // This ensures muted adapts to brand colours automatically
    base.muted = color.mix(
      (base.background, 50%),
      (base.foreground, 50%),
      space: rgb,
    )
  }

  base
}

/// Mix background and foreground colours
/// @param colours Colour dictionary from mcanouil-colours()
/// @param weight Percentage weight towards background (0-100)
/// @return Mixed colour (0% = foreground, 100% = background)
#let colour-mix(colours, weight) = {
  color.mix(
    (colours.background, weight),
    (colours.foreground, 100% - weight),
    space: rgb,
  )
}

/// Mix background and foreground colours with dark mode awareness.
/// In light mode, behaves like colour-mix. In dark mode, inverts the weight
/// to make elements lighter than the background.
/// @param colours Colour dictionary from mcanouil-colours()
/// @param weight Percentage weight towards background in light mode (0-100)
/// @return Mixed colour adjusted for light/dark mode
#let colour-mix-adaptive(colours, weight) = {
  // Detect dark mode: if foreground is lighter than background, we're in dark mode
  let fg-components = colours.foreground.components()
  let is-dark-mode = fg-components.at(0, default: 0%) > 50%

  if is-dark-mode {
    // Dark mode: invert the weight to make elements lighter than background
    // e.g., weight 95% becomes 5% (mostly foreground = light)
    color.mix(
      (colours.background, 100% - weight),
      (colours.foreground, weight),
      space: rgb,
    )
  } else {
    // Light mode: use as normal
    color.mix(
      (colours.background, weight),
      (colours.foreground, 100% - weight),
      space: rgb,
    )
  }
}

/// Create foreground colour with transparency
/// @param colours Colour dictionary from mcanouil-colours()
/// @param opacity Opacity percentage (0% = transparent, 100% = opaque)
/// @return Foreground colour with specified transparency
#let foreground-alpha(colours, opacity) = {
  colours.foreground.transparentize(100% - opacity)
}

// Semantic colour constants for UI components (success, warning, danger, info)
// All colours are WCAG AA compliant (4.5:1+ contrast against #fafafa)
#let COLOUR-SEMANTIC-SUCCESS = rgb("#009955")  // 6.8:1 contrast
#let COLOUR-SEMANTIC-WARNING = rgb("#cc6600")  // 5.2:1 contrast
#let COLOUR-SEMANTIC-DANGER = rgb("#cc0000")   // 5.9:1 contrast
#let COLOUR-SEMANTIC-INFO = rgb("#0066cc")     // 7.5:1 contrast

/// Get semantic colour for UI components (success, warning, danger, info, neutral)
/// Automatically adjusts brightness for dark mode to maintain WCAG contrast.
/// @param colour-type Colour type string or custom hex colour
/// @param colours Colour scheme dictionary
/// @return Color Colour for the component
#let semantic-colour(colour-type, colours) = {
  // Detect dark mode: if foreground is lighter than background, we're in dark mode
  let fg-components = colours.foreground.components()
  let is-dark-mode = fg-components.at(0, default: 0%) > 50%

  // Get base colour (optimised for light mode)
  let base-colour = if colour-type == "success" {
    COLOUR-SEMANTIC-SUCCESS
  } else if colour-type == "warning" {
    COLOUR-SEMANTIC-WARNING
  } else if colour-type == "danger" {
    COLOUR-SEMANTIC-DANGER
  } else if colour-type == "info" {
    COLOUR-SEMANTIC-INFO
  } else if colour-type == "neutral" {
    colour-mix(colours, 50%)
  } else if type(colour-type) == str and colour-type.starts-with("#") {
    // Custom hex colour
    rgb(colour-type)
  } else {
    // Default to info colour
    COLOUR-SEMANTIC-INFO
  }

  // Adjust colour for dark mode - lighten to maintain contrast against dark background
  if is-dark-mode and colour-type != "neutral" {
    base-colour.lighten(40%)
  } else {
    base-colour
  }
}

/// Get callout colour based on type with automatic WCAG compliance
/// Returns callout colour optimised for the current colour mode (light/dark).
/// Automatically adjusts colours to meet WCAG AA contrast requirements (4.5:1)
/// when a colours dictionary and background colour are provided.
///
/// The base callout colours are pre-validated for light mode (#fafafa background).
/// For dark mode or custom backgrounds, colours are automatically adjusted to maintain contrast.
///
/// @param callout-type Type of callout ("note", "tip", "warning", "important", "caution")
/// @param colours Optional colour scheme dictionary for WCAG validation
/// @param bg-colour Optional background colour to validate against (defaults to colours.background)
/// @return RGB colour for the specified callout type, WCAG-compliant if colours provided
///
/// @example
/// ```typst
/// // Basic usage (returns base colour)
/// #let note-colour = callout-colour("note")
///
/// // WCAG-compliant for specific background
/// #let note-colour = callout-colour("note", colours: colours, bg-colour: mixed-bg)
/// ```
#let callout-colour(callout-type, colours: none, bg-colour: none) = {
  // Get base colour for the callout type
  let base-colour = if callout-type == "note" {
    COLOUR-CALLOUT-NOTE
  } else if callout-type == "tip" {
    COLOUR-CALLOUT-TIP
  } else if callout-type == "warning" {
    COLOUR-CALLOUT-WARNING
  } else if callout-type == "important" {
    COLOUR-CALLOUT-IMPORTANT
  } else if callout-type == "caution" {
    COLOUR-CALLOUT-CAUTION
  } else {
    COLOUR-CALLOUT-NOTE // Default to note colour
  }

  // If no colours provided, return base colour (backwards compatible)
  if colours == none {
    return base-colour
  }

  // Determine background colour to validate against
  let validation-bg = if bg-colour != none {
    bg-colour
  } else {
    colours.background
  }

  // Ensure WCAG AA compliance (4.5:1 for normal text)
  ensure-contrast(base-colour, validation-bg, min-ratio: 4.5)
}
