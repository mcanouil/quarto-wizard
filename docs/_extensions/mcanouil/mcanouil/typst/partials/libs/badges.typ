// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Badge rendering for visual indicators

// Import utilities
// #import "utilities.typ": has-content

// ============================================================================
// Helper functions
// ============================================================================

/// Create appropriate background colour for light or dark mode.
/// In light mode, lightens the colour. In dark mode, darkens it.
/// @param base-colour Base colour to adjust
/// @param colours Colour scheme dictionary
/// @return Color Adjusted background colour
#let get-badge-background(base-colour, colours) = {
  // Detect dark mode: if foreground is lighter than background, we're in dark mode
  // Use rgb components to check lightness (components are ratios, so compare with %)
  let fg-components = colours.foreground.components()
  let is-dark-mode = fg-components.at(0, default: 0%) > 50%

  if is-dark-mode {
    // Dark mode: darken the colour instead of lightening
    base-colour.darken(60%)
  } else {
    // Light mode: lighten
    base-colour.lighten(80%)
  }
}

/// Create appropriate border colour for light or dark mode.
/// @param base-colour Base colour to adjust
/// @param colours Colour scheme dictionary
/// @return Color Adjusted border colour
#let get-badge-border(base-colour, colours) = {
  let fg-components = colours.foreground.components()
  let is-dark-mode = fg-components.at(0, default: 0%) > 50%

  if is-dark-mode {
    base-colour.darken(40%)
  } else {
    base-colour.lighten(40%)
  }
}

/// Create WCAG-compliant text colour for badge backgrounds.
/// Badge text is small (0.85em), so requires strict 4.5:1 contrast ratio.
/// Validates text colour against the badge background colour.
/// @param base-colour Base colour to adjust
/// @param colours Colour scheme dictionary
/// @return Color WCAG AA-compliant text colour
#let get-badge-text(base-colour, colours) = {
  // Get the badge background that text will be displayed on
  let bg = get-badge-background(base-colour, colours)

  // Ensure text colour meets WCAG AA requirements (4.5:1)
  // Badge text is small (0.85em), so needs the higher ratio
  ensure-contrast(base-colour, bg, min-ratio: 4.5, preserve-hue: true)
}

/// Get badge colours based on colour type.
/// @param colour Badge colour (success, warning, danger, info, neutral)
/// @param colours Template colour scheme
/// @return Dictionary Badge colour configuration
#let get-badge-colours(colour, colours) = {
  if colour == "success" {
    let base = callout-colour("tip")
    (
      background: get-badge-background(base, colours),
      border: get-badge-border(base, colours),
      text: get-badge-text(base, colours),
    )
  } else if colour == "warning" {
    let base = callout-colour("warning")
    (
      background: get-badge-background(base, colours),
      border: get-badge-border(base, colours),
      text: get-badge-text(base, colours),
    )
  } else if colour == "danger" {
    let base = callout-colour("important")
    (
      background: get-badge-background(base, colours),
      border: get-badge-border(base, colours),
      text: get-badge-text(base, colours),
    )
  } else if colour == "info" {
    let base = callout-colour("note")
    (
      background: get-badge-background(base, colours),
      border: get-badge-border(base, colours),
      text: get-badge-text(base, colours),
    )
  } else {
    // neutral - use muted colours
    let base = colours.muted
    (
      background: get-badge-background(base, colours),
      border: get-badge-border(base, colours),
      text: get-badge-text(base, colours),
    )
  }
}

// ============================================================================
// Badge rendering function
// ============================================================================

/// Render a badge.
/// Badges are compact inline or block elements for showing status, categories, or tags.
/// @param content Badge text content
/// @param colour Badge colour type (success, warning, danger, info, neutral)
/// @param icon Optional icon to display before text
/// @param inline Whether badge is inline (true) or block (false)
/// @param colours Colour scheme dictionary
/// @return Content Rendered badge
#let render-badge(
  content,
  colour: "neutral",
  icon: none,
  inline: true,
  colours: (:),
) = {
  let badge-colours = get-badge-colours(colour, colours)

  let badge-box = box(
    fill: badge-colours.background,
    stroke: 0.5pt + badge-colours.border,
    radius: 4pt,
    inset: 0.25em,
    height: 1em,
    baseline: 0.25em,
  )[
    #align(horizon)[
      #if icon != none {
        text(baseline: -0.15em, size: 0.5em, fill: badge-colours.text, icon)
        h(0.1em)
      }
      #text(
        size: 0.85em,
        weight: "medium",
        fill: badge-colours.text,
        content,
      )
    ]
  ]

  if inline {
    badge-box
  } else {
    block(badge-box)
  }
}

// ============================================================================
// Note: This partial provides badge rendering functionality
// Badges are typically used inline for colour indicators, tags, and labels
// ============================================================================
