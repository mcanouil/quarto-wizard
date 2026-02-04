// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Info panels for highlighting content in professional reports

// Import utilities and colour functions
// #import "utilities.typ": has-content, is-empty, get-adaptive-background, get-adaptive-border
// #import "colours.typ": callout-colour
// Note: Functions from utilities.typ are available via template.typ inclusion

// ============================================================================
// Constants for panels
// ============================================================================

#let PANEL-RADIUS = 8pt
#let PANEL-BORDER-WIDTH = 1pt
#let PANEL-INSET = 1.2em
#let PANEL-TITLE-SIZE = 1.1em
#let PANEL-TITLE-WEIGHT = "semibold"

// ============================================================================
// Helper functions
// ============================================================================

/// Determine appropriate text colour for contrast against background.
/// Uses WCAG 2.1 calculation to ensure AA compliance (4.5:1 contrast ratio).
/// Selects between foreground and background colours based on which provides better contrast.
/// @param background Background colour
/// @param colours Colour scheme dictionary
/// @return Color WCAG-compliant contrasting text colour
#let get-contrast-text-colour(background, colours) = {
  // Use WCAG-compliant text colour selection
  // This ensures all panel text meets WCAG AA requirements (4.5:1)
  get-wcag-compliant-text-colour(background, colours, min-ratio: 4.5)
}

/// Get colours for panel style.
/// @param style Style variant (subtle, emphasis, accent, outline, info, success, warning, danger)
/// @param colours Colour scheme dictionary
/// @return Dictionary Background, border, title, and content text colours for the style
#let get-panel-colours(style, colours) = {
  if style == "subtle" {
    let bg = get-adaptive-background(colours.muted, colours)
    let text-colour = get-contrast-text-colour(bg, colours)
    (
      background: bg,
      border: get-adaptive-border(colours.muted, colours),
      title: text-colour,
      content: text-colour,
    )
  } else if style == "emphasis" {
    let emphasis-colour = callout-colour("note")
    let bg = get-adaptive-background(emphasis-colour, colours)
    let text-colour = get-contrast-text-colour(bg, colours)
    (
      background: bg,
      border: get-adaptive-border(emphasis-colour, colours),
      title: text-colour,
      content: text-colour,
    )
  } else if style == "accent" {
    let bg = colours.foreground
    let text-colour = get-contrast-text-colour(bg, colours)
    (
      background: bg,
      border: colours.foreground.darken(10%),
      title: text-colour,
      content: text-colour,
    )
  } else if style == "outline" {
    let bg = colours.background
    let text-colour = get-contrast-text-colour(bg, colours)
    (
      background: bg,
      border: get-adaptive-border(colours.muted, colours),
      title: text-colour,
      content: text-colour,
    )
  } else if style == "info" {
    let info-colour = callout-colour("note")
    let bg = get-adaptive-background(info-colour, colours)
    let text-colour = get-contrast-text-colour(bg, colours)
    (
      background: bg,
      border: get-adaptive-border(info-colour, colours),
      title: text-colour,
      content: text-colour,
    )
  } else if style == "success" {
    let success-colour = callout-colour("tip")
    let bg = get-adaptive-background(success-colour, colours)
    let text-colour = get-contrast-text-colour(bg, colours)
    (
      background: bg,
      border: get-adaptive-border(success-colour, colours),
      title: text-colour,
      content: text-colour,
    )
  } else if style == "warning" {
    let warning-colour = callout-colour("caution")
    let bg = get-adaptive-background(warning-colour, colours)
    let text-colour = get-contrast-text-colour(bg, colours)
    (
      background: bg,
      border: get-adaptive-border(warning-colour, colours),
      title: text-colour,
      content: text-colour,
    )
  } else if style == "danger" {
    let danger-colour = callout-colour("important")
    let bg = get-adaptive-background(danger-colour, colours)
    let text-colour = get-contrast-text-colour(bg, colours)
    (
      background: bg,
      border: get-adaptive-border(danger-colour, colours),
      title: text-colour,
      content: text-colour,
    )
  } else {
    // Default to subtle style
    let bg = get-adaptive-background(colours.muted, colours)
    let text-colour = get-contrast-text-colour(bg, colours)
    (
      background: bg,
      border: get-adaptive-border(colours.muted, colours),
      title: text-colour,
      content: text-colour,
    )
  }
}

/// Process icon content for panel title.
/// @param icon_content Icon to display (emoji, symbol, or UTF-8 character)
/// @return Content Icon or none
#let process-panel-icon(icon_content) = {
  if has-content(icon_content) {
    icon_content
  } else {
    none
  }
}

// ============================================================================
// Main panel rendering function
// ============================================================================

/// Render an info panel for highlighting content.
///
/// @param content Panel content (can include text, images, lists, etc.)
/// @param title Optional title for the panel
/// @param style Style variant (subtle, emphasis, accent, outline, info, success, warning, danger)
/// @param icon Optional icon to display next to title (emoji or UTF-8 character)
/// @param colours Colour scheme dictionary
/// @param border-width Border thickness
/// @param radius Corner radius
/// @param inset Internal padding
/// @param title-size Title font size
/// @param title-weight Title font weight
/// @param breakable Allow panel to break across pages (default: false to prevent orphans/widows)
/// @return Content Rendered panel
#let render-panel(
  content,
  title: none,
  style: "subtle",
  icon: none,
  colours: (:),
  border-width: PANEL-BORDER-WIDTH,
  radius: PANEL-RADIUS,
  inset: PANEL-INSET,
  title-size: PANEL-TITLE-SIZE,
  title-weight: PANEL-TITLE-WEIGHT,
  breakable: false,
) = {
  // Get colours for the style
  let panel-colours = get-panel-colours(style, colours)

  // Build title display with optional icon
  let title-display = if has-content(title) {
    let icon-display = if has-content(icon) {
      let icon-content = process-panel-icon(icon)
      if icon-content != none {
        [#icon-content #h(0.4em)]
      }
    }

    block(
      below: 0.8em,
      {
        text(
          size: title-size,
          weight: title-weight,
          fill: panel-colours.title,
        )[#icon-display#title]
      },
    )
  }

  // Render the panel
  block(
    width: 100%,
    fill: panel-colours.background,
    stroke: border-width + panel-colours.border,
    radius: radius,
    inset: inset,
    breakable: breakable,
    {
      if title-display != none {
        title-display
      }
      // Disable TOC inclusion and numbering for headings inside panel
      show heading: it => {
        set heading(outlined: false, numbering: none)
        it
      }
      text(fill: panel-colours.content)[#content]
    },
  )
}

// ============================================================================
// Note: Public wrapper function mcanouil-panel is defined in typst-show.typ
// to inject colours from template brand-mode
// ============================================================================
