// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Value boxes for displaying metrics, KPIs, and statistics

// Import utilities and colour functions
// #import "utilities.typ": has-content, is-empty, get-adaptive-background, get-adaptive-border
// #import "colours.typ": callout-colour
// Note: Functions from utilities.typ are available via template.typ inclusion

// ============================================================================
// Constants for value boxes
// ============================================================================

#let VALUE-BOX-ALIGNMENT = center
#let VALUE-BOX-RADIUS = 8pt
#let VALUE-BOX-BORDER-WIDTH = 1pt
#let VALUE-BOX-INSET = 1.2em
#let VALUE-BOX-SPACING = 0.6em
#let VALUE-SIZE-RATIO = 2.5
#let LABEL-SIZE-RATIO = 0.85
#let UNIT-SIZE-RATIO = 0.7
#let TREND-ICON-SIZE = 2em

// ============================================================================
// Helper functions
// ============================================================================

/// Get colour for value box.
/// Supports predefined colour types or custom colour values (hex codes, rgb(), etc.).
/// Uses semantic colours (brighter) for UI components, not callout colours.
/// @param colour Colour type (success, warning, danger, info, neutral) or custom colour (e.g., "#ff0000", rgb(...))
/// @param colours Colour scheme dictionary
/// @return Color Colour for the value box
#let get-value-box-colour(colour, colours) = {
  // Use semantic-colour for predefined types (brighter colours for UI components)
  if colour == "success" or colour == "warning" or colour == "danger" or colour == "info" {
    semantic-colour(colour, colours)
  } else if colour == "neutral" {
    colours.muted
  } else if colour != none and colour != "" {
    // Custom colour value - check if it's a hex string
    if type(colour) == str and colour.starts-with("#") {
      rgb(colour)
    } else {
      // Already a color object (rgb(), color function, etc.)
      colour
    }
  } else {
    colours.foreground
  }
}

/// Process icon content.
/// Supports predefined shortcuts (up, down, stable) or any UTF-8 character/symbol.
/// @param icon_content Icon to display (up, down, stable, or any UTF-8 character like "✓", "→", "★")
/// @return Content Icon symbol or text
#let process-icon-content(icon_content) = {
  if icon_content == "up" {
    sym.arrow.t
  } else if icon_content == "down" {
    sym.arrow.b
  } else if icon_content == "stable" {
    sym.dash.em
  } else if has-content(icon_content) {
    // Any UTF-8 character or content
    icon_content
  } else {
    none
  }
}

// ============================================================================
// Main value box function
// ============================================================================

/// Render a value box for displaying metrics and KPIs.
///
/// @param value Value to display (number, text, or content)
/// @param unit Optional unit to display after the value
/// @param label Description or label for the value
/// @param icon Icon to display next to value (up, down, stable, or any UTF-8 character like "✓", "→", "★")
/// @param colour Colour type (success, warning, danger, info, neutral) or custom hex/rgb colour
/// @param colours Colour scheme dictionary
/// @param border-width Border thickness
/// @param radius Corner radius
/// @param inset Internal padding
/// @param spacing Spacing between elements
/// @param value-size-ratio Size multiplier for the value
/// @param label-size-ratio Size multiplier for the label
/// @param unit-size-ratio Size multiplier for the unit
/// @param icon-size Size of icon
/// @param background Optional background colour
/// @param show-border Show border around the box
/// @return Content Rendered value box
#let render-value-box(
  value: none,
  unit: none,
  label: none,
  icon: none,
  colour: none,
  colours: (:),
  border-width: VALUE-BOX-BORDER-WIDTH,
  radius: VALUE-BOX-RADIUS,
  inset: VALUE-BOX-INSET,
  spacing: VALUE-BOX-SPACING,
  alignment: VALUE-BOX-ALIGNMENT,
  value-size-ratio: VALUE-SIZE-RATIO,
  label-size-ratio: LABEL-SIZE-RATIO,
  unit-size-ratio: UNIT-SIZE-RATIO,
  icon-size: TREND-ICON-SIZE,
  background: none,
  show-border: true,
) = {
  // Determine the accent colour based on colour parameter
  let accent-colour = get-value-box-colour(colour, colours)

  // Determine background
  let bg-colour = if background != none {
    background
  } else if colour != none and colour != "" {
    get-adaptive-background(accent-colour, colours)
  } else {
    colours.background
  }

  // Validate accent colour meets WCAG AA requirements against background
  // Use 4.5:1 ratio to cover both value text (large, could use 3:1) and unit text (small, needs 4.5:1)
  let validated-accent = ensure-contrast(accent-colour, bg-colour, min-ratio: 4.5, preserve-hue: true)

  // Determine border colour (uses validated accent to match text)
  let border-colour = if show-border {
    get-adaptive-border(validated-accent, colours)
  } else {
    none
  }

  // Build the value display with optional unit
  let value-display = {
    text(
      size: 1em * value-size-ratio,
      weight: "bold",
      fill: validated-accent,
    )[#value]
    if has-content(unit) {
      h(0.2em)
      text(
        size: 1em * unit-size-ratio,
        weight: "medium",
        fill: validated-accent,
      )[#unit]
    }
  }

  // Build icon display (shown inline with value)
  let icon-display = if has-content(icon) {
    let icon-content = process-icon-content(icon)
    if icon-content != none {
      h(0.3em)
      text(
        size: icon-size,
        fill: validated-accent,
      )[#icon-content]
    }
  }

  // Build label display
  let label-display = if has-content(label) {
    text(
      size: 1em * label-size-ratio,
      fill: colours.muted,
    )[#label]
  }

  // Render the box
  block(
    width: 100%,
    fill: bg-colour,
    stroke: if border-colour != none {
      border-width + border-colour
    } else {
      none
    },
    radius: radius,
    inset: inset,
    breakable: false,
    {
      align(alignment)[
        // Value row (with optional icon)
        #block(
          below: spacing * 0.8,
          {
            value-display
            icon-display
          },
        )

        // Label row (if present)
        #if label-display != none {
          label-display
        }
      ]
    },
  )
}

// ============================================================================
// Grid layout helper
// ============================================================================

/// Render multiple value boxes in a grid layout.
///
/// @param boxes Array of value box configurations
/// @param columns Number of columns in the grid
/// @param gap Spacing between boxes
/// @param colours Colour scheme dictionary
/// @param alt Optional alt text for accessibility (wraps grid in figure when provided)
/// @return Content Grid of value boxes
#let value-box-grid(
  boxes: (),
  columns: 3,
  gap: 1em,
  colours: (:),
  alt: none,
) = {
  let content = grid(
    columns: columns,
    column-gutter: gap,
    row-gutter: gap,
    ..boxes.map(box-config => {
      render-value-box(
        value: box-config.at("value", default: none),
        unit: box-config.at("unit", default: none),
        label: box-config.at("label", default: none),
        icon: box-config.at("icon", default: none),
        colour: box-config.at("colour", default: none),
        colours: colours,
      )
    })
  )

  // Wrap in figure with alt text for accessibility if provided
  if alt != none {
    figure(content, alt: alt, kind: "value-box-grid", supplement: none)
  } else {
    content
  }
}

// ============================================================================
// Note: Public wrapper function mcanouil-value-box is defined in typst-show.typ
// to inject colours from template brand-mode
// ============================================================================
