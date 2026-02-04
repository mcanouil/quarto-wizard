// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Card grid component for displaying content in card layouts

// Import utilities and colour functions
// #import "utilities.typ": has-content, is-empty
// Note: Functions from utilities.typ are available via template.typ inclusion

// ============================================================================
// Constants for card grid
// ============================================================================

#let CARD-RADIUS = 8pt
#let CARD-BORDER-WIDTH = 1pt
#let CARD-INSET = 1em
#let CARD-GAP = 1em
#let CARD-TITLE-SIZE = 1.1em
#let CARD-TITLE-WEIGHT = "semibold"

// ============================================================================
// Card rendering functions
// ============================================================================

/// Render a single card with optional title, content, and footer.
/// Header and footer have distinct background from body (matching HTML styling).
///
/// @param config Card configuration dictionary
/// @param colours Colour scheme dictionary
/// @return Content Rendered card
///
/// Configuration keys:
/// - title: Card title (optional)
/// - content: Main card content
/// - footer: Footer content (optional)
/// - colour: Card accent colour (default: muted)
/// - style: Card style - "subtle", "outlined", "filled" (default: "subtle")
#let render-card(config, colours) = {
  let card-title = config.at("title", default: none)
  let card-content = config.at("content", default: none)
  let card-footer = config.at("footer", default: none)
  let card-colour-raw = config.at("colour", default: colours.muted)
  let card-style = config.at("style", default: "subtle")

  // Convert colour string to colour object if needed
  let card-colour = if type(card-colour-raw) == str {
    rgb(card-colour-raw)
  } else {
    card-colour-raw
  }

  // Determine card styling based on style
  let (bg-colour, border-colour, title-colour, header-bg, content-colour) = if card-style == "filled" {
    (
      card-colour,
      card-colour.darken(10%),
      colours.background,
      card-colour.darken(8%),
      colours.background,
    )
  } else if card-style == "outlined" {
    (
      colours.background,
      card-colour,
      colours.foreground,
      get-adaptive-background(colours.muted, colours),
      colours.foreground,
    )
  } else {
    // "subtle" style
    let adaptive-bg = get-adaptive-background(card-colour, colours)
    (
      adaptive-bg,
      get-adaptive-border(card-colour, colours),
      colours.foreground,
      get-adaptive-background(colours.muted, colours),
      colours.foreground,
    )
  }

  box(
    width: 100%,
    fill: bg-colour,
    stroke: CARD-BORDER-WIDTH + border-colour,
    radius: CARD-RADIUS,
    clip: true,
    {
      // Header with title (distinct background)
      if card-title != none and has-content(card-title) {
        block(
          width: 100%,
          fill: header-bg,
          inset: (x: CARD-INSET, y: 0.8em),
          below: 0pt,
          {
            text(
              size: CARD-TITLE-SIZE,
              weight: CARD-TITLE-WEIGHT,
              fill: title-colour,
              card-title,
            )
          },
        )
        line(length: 100%, stroke: 0.5pt + border-colour)
      }

      // Body content
      if card-content != none and has-content(card-content) {
        block(
          width: 100%,
          inset: CARD-INSET,
          above: 0pt,
          below: 0pt,
          {
            text(
              fill: content-colour,
              card-content,
            )
          },
        )
      }

      // Footer (distinct background)
      if card-footer != none and has-content(card-footer) {
        line(length: 100%, stroke: 0.5pt + border-colour)
        block(
          width: 100%,
          fill: header-bg,
          inset: (x: CARD-INSET, y: 0.8em),
          above: 0pt,
          {
            text(
              size: 0.9em,
              fill: if card-style == "filled" { colours.background.lighten(20%) } else { colours.muted },
              card-footer,
            )
          },
        )
      }
    },
  )
}

/// Render a grid of cards with consistent styling.
/// Creates a responsive grid layout for displaying multiple cards.
///
/// @param cards Array of card configuration dictionaries
/// @param columns Number of columns (default: 3)
/// @param colours Colour scheme dictionary
/// @param alt Optional alt text for accessibility (wraps grid in figure when provided)
/// @return Content Card grid layout
///
/// @usage
/// ```typst
/// #render-card-grid(
///   (
///     (title: "Feature 1", content: "Description of feature 1"),
///     (title: "Feature 2", content: "Description of feature 2", footer: "Learn more"),
///     (title: "Feature 3", content: "Description of feature 3", colour: red),
///   ),
///   columns: 3,
///   colours
/// )
/// ```
#let render-card-grid(cards, columns: 3, colours, alt: none) = {
  // Create column specification
  let cols = ()
  for _ in range(columns) {
    cols.push(1fr)
  }

  let content = grid(
    columns: cols,
    gutter: CARD-GAP,
    ..cards.map(card => render-card(card, colours))
  )

  // Wrap in figure with alt text for accessibility if provided
  if alt != none {
    figure(content, alt: alt, kind: "card-grid", supplement: none)
  } else {
    content
  }
}

/// Render a feature comparison grid.
/// Specialised card grid for comparing features across different options.
///
/// @param features Array of feature dictionaries with name and options array
/// @param options Array of option names
/// @param colours Colour scheme dictionary
/// @return Content Feature comparison grid
///
/// @usage
/// ```typst
/// #render-feature-grid(
///   features: (
///     (name: "Storage", options: ("10GB", "100GB", "Unlimited")),
///     (name: "Users", options: ("1", "10", "Unlimited")),
///   ),
///   options: ("Basic", "Pro", "Enterprise"),
///   colours
/// )
/// ```
#let render-feature-grid(features, options, colours) = {
  let num-cols = options.len() + 1

  // Create table with header row and feature rows
  table(
    columns: (auto,) + (1fr,) * options.len(),
    stroke: CARD-BORDER-WIDTH + get-adaptive-border(colours.muted, colours),
    fill: (col, row) => {
      if row == 0 {
        get-adaptive-background(colours.muted, colours)
      } else if calc.rem(row, 2) == 0 {
        colours.background
      } else {
        get-adaptive-background(colours.muted, colours).lighten(50%)
      }
    },
    inset: 0.8em,
    align: (col, row) => if col == 0 { left } else { center },

    // Header row
    table.header(
      [],
      ..options.map(opt => text(weight: "semibold", opt)),
    ),

    // Feature rows
    ..features
      .map(feature => {
        (
          text(weight: "medium", feature.name),
          ..feature.options.map(val => text(val)),
        )
      })
      .flatten()
  )
}
