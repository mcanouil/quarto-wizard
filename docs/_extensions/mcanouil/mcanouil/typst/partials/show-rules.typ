// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Show rule functions for document styling
// Each function encapsulates styling logic for better readability

// ============================================================================
// Show rule functions
// ============================================================================

/// Apply heading styling
/// The heading's numbering property is set directly by the Lua filter,
/// so no special section state tracking is needed.
/// @param it Heading element
/// @param colours Colour dictionary
/// @param font-headings Heading font family
/// @param section-pagebreak Whether to add breaks before level 1 headings
/// @param show-heading-underlines Whether to show underlines
/// @param section-page Whether to render section pages for level-1 headings
/// @param margin Page margins for section pages
/// @param cols Number of columns for restoring after section page
/// @param toc-depth Maximum heading depth for section page outline
/// @param heading-weight Heading font weight
/// @param heading-style Heading font style
/// @param heading-colour Heading colour
/// @param heading-line-height Heading line height
/// @return Styled heading block
#let apply-heading-style(
  it,
  colours,
  font-headings,
  section-pagebreak,
  show-heading-underlines,
  section-page: false,
  margin: (top: 2.5cm, bottom: 2.5cm, left: 2.5cm, right: 2.5cm),
  cols: 1,
  toc-depth: 3,
  heading-weight: none,
  heading-style: none,
  heading-colour: none,
  heading-line-height: none,
) = {
  // For level-1 headings with section-page enabled, render section page instead
  // Skip headings that are not outlined (e.g., TOC, list-of sections)
  if it.level == 1 and section-page and it.outlined {
    return render-section-page(
      it,
      colours,
      font-headings,
      margin: margin,
      cols: cols,
      toc-depth: toc-depth,
      heading-weight: heading-weight,
      heading-style: heading-style,
      heading-colour: heading-colour,
      heading-line-height: heading-line-height,
    )
  }
  let style = get-heading-style(
    it.level,
    colours,
    heading-weight: heading-weight,
    heading-style: heading-style,
    heading-colour: heading-colour,
    heading-line-height: heading-line-height,
  )
  set text(
    font: font-headings,
    size: style.size,
    weight: style.weight,
    style: style.style,
    fill: style.fill,
  )

  // Configurable break before level 1 headings
  // Uses colbreak for multi-column layouts, pagebreak for single-column
  if it.level == 1 and section-pagebreak {
    conditional-break()
  }

  block(
    above: if it.level == 1 { 1.5em } else { 1.2em },
    below: 0em,
    breakable: false, // Prevent heading from breaking across pages
    {
      // Display numbering if present (set directly by Lua filter)
      if it.numbering != none {
        context {
          let h-counter = counter(heading).at(here())
          if h-counter.len() > 0 {
            // Use the heading's numbering directly (includes prefix if applicable)
            if type(it.numbering) == function {
              (it.numbering)(..h-counter)
            } else {
              numbering(it.numbering, ..h-counter)
            }
            h(0.5em)
          }
        }
      }
      it.body
      linebreak()
      v(-0.8em)
      if show-heading-underlines {
        heading-underline(colours, level: it.level)
      }
      v(0.5em)

      // Orphan prevention: keep at least 2 lines with heading
      v(2.4em, weak: true)
    },
  )
}

/// Apply link styling with optional underline
/// @param it Link element
/// @param colours Colour dictionary
/// @param link-colour Optional custom link colour
/// @param link-underline Whether to underline external links
/// @param link-underline-opacity Underline opacity percentage
/// @return Styled link
#let apply-link-style(it, colours, link-colour, link-underline, link-underline-opacity) = {
  set text(fill: if link-colour != none { link-colour } else { colours.foreground })
  // Only apply underline to external links (URLs), not internal document links
  if type(it.dest) == str and link-underline {
    underline(
      stroke: 1pt + colours.foreground.transparentize(100% - link-underline-opacity),
      offset: 2pt,
      it,
    )
  } else {
    it
  }
}

// ============================================================================
// Code Window Constants and State
// ============================================================================

// State to hold filename for code window styling
// Set by mcanouil-code-window wrapper, read by apply-code-block-style
#let code-window-filename = state("code-window-filename", none)

// Traffic light button constants (macOS standard)
#let TRAFFIC-LIGHT-SIZE = 10pt
#let TRAFFIC-LIGHT-GAP = 5pt
#let TRAFFIC-LIGHT-CLOSE = rgb("#ff5f56")
#let TRAFFIC-LIGHT-MINIMISE = rgb("#ffbd2e")
#let TRAFFIC-LIGHT-MAXIMISE = rgb("#27c93f")

// Code window layout constants
#let CODE-WINDOW-RADIUS = 8pt
#let CODE-WINDOW-BORDER-WIDTH = 1pt
#let CODE-WINDOW-TITLEBAR-INSET = (x: 1em, y: 0.6em)

/// Render macOS-style traffic light buttons
/// @return Content Three circular buttons in a horizontal row
#let render-traffic-lights() = {
  box(
    inset: (right: 8pt),
    stack(
      dir: ltr,
      spacing: TRAFFIC-LIGHT-GAP,
      circle(radius: TRAFFIC-LIGHT-SIZE / 2, fill: TRAFFIC-LIGHT-CLOSE, stroke: none),
      circle(radius: TRAFFIC-LIGHT-SIZE / 2, fill: TRAFFIC-LIGHT-MINIMISE, stroke: none),
      circle(radius: TRAFFIC-LIGHT-SIZE / 2, fill: TRAFFIC-LIGHT-MAXIMISE, stroke: none),
    ),
  )
}

/// Render code block as macOS-style window with traffic lights
/// @param it Code block element
/// @param filename Filename to display in title bar
/// @param is-auto Whether filename is auto-generated (applies smallcaps styling)
/// @param colours Colour dictionary
/// @param content-fill Background fill for content area
/// @param content-inset Content padding
/// @param border-colour Border colour
/// @param breakable-settings Breakable configuration
/// @return Styled code window
#let render-code-window-block(
  it,
  filename,
  is-auto,
  colours,
  content-fill,
  content-inset,
  border-colour,
  breakable-settings,
) = {
  // Title bar is darker than content by darkening the content fill
  // This ensures consistent relative contrast in both light and dark modes
  let titlebar-bg = content-fill.darken(5%)
  let filename-colour = colours.muted

  let code-window = block(
    width: 100%,
    stroke: CODE-WINDOW-BORDER-WIDTH + border-colour,
    radius: CODE-WINDOW-RADIUS,
    clip: true,
    {
      // Title bar with bottom border separator
      // sticky: true prevents orphan title bar at page bottom
      block(
        width: 100%,
        fill: titlebar-bg,
        inset: CODE-WINDOW-TITLEBAR-INSET,
        below: 0pt,
        radius: 0pt,
        stroke: (bottom: CODE-WINDOW-BORDER-WIDTH + border-colour),
        sticky: true,
        {
          grid(
            columns: (auto, 1fr),
            align: (left + horizon, right + horizon),
            gutter: 0.5em,
            stroke: 0pt,
            render-traffic-lights(),
            if filename != none {
              text(
                // Smaller size for auto-generated filenames (simulated small caps)
                size: if is-auto { 0.7em } else { 0.85em },
                weight: 500,
                fill: filename-colour,
                font: ("Fira Code", "Menlo", "Monaco", "Courier New"),
                // Apply uppercase for auto-generated filenames (simulated small caps)
                if is-auto { upper(filename) } else { filename },
              )
            },
          )
        },
      )
      // Content area with same background as standard code blocks
      block(
        width: 100%,
        fill: content-fill,
        inset: content-inset,
        radius: 0pt,
        stroke: 0pt,
        it,
      )
    },
  )

  if breakable-settings.code == auto {
    code-window
  } else {
    block(breakable: breakable-settings.code, code-window)
  }
}

/// Apply code block styling with optional page breaks
/// Handles both standard code blocks and code windows (when filename state is set)
/// @param it Code block element
/// @param colours Colour dictionary
/// @param breakable-settings Breakable configuration
/// @return Styled code block or code window
#let apply-code-block-style(it, colours, breakable-settings) = context {
  // Shared styling values (ensures consistent background)
  // Uses colour-mix to keep code blocks close to page background in both modes
  let content-fill = colour-mix(colours, 95%)
  let content-inset = 8pt
  let content-radius = 4pt
  let border-colour = colour-mix(colours, 50%)

  // Check if this is a code window (filename state set by wrapper)
  // State is now a dictionary with 'filename' and 'is-auto' keys
  let window-state = code-window-filename.get()

  if window-state != none {
    // Reset state immediately to avoid affecting subsequent blocks
    code-window-filename.update(none)
    // Extract filename and is-auto flag from state
    let filename = window-state.filename
    let is-auto = window-state.at("is-auto", default: false)
    // Render macOS-style window
    render-code-window-block(
      it,
      filename,
      is-auto,
      colours,
      content-fill,
      content-inset,
      border-colour,
      breakable-settings,
    )
  } else {
    // Standard code block styling
    let code-block = block(
      width: 100%,
      fill: content-fill,
      inset: content-inset,
      radius: content-radius,
      stroke: 1pt + border-colour,
      it,
    )

    if breakable-settings.code == auto {
      code-block
    } else {
      block(breakable: breakable-settings.code, code-block)
    }
  }
}

/// Apply inline code styling with brand-mode aware background
/// @param it Inline code element
/// @param colours Colour dictionary
/// @return Styled inline code
#let apply-inline-code-style(it, colours) = {
  box(
    fill: colour-mix(colours, 90%),
    inset: (x: 3pt, y: 0pt),
    outset: (y: 3pt),
    radius: 2pt,
    it,
  )
}

/// Apply blockquote styling with decorative quotes
/// Decorative quotation marks are marked as PDF artifacts for accessibility
/// @param it Quote element
/// @param colours Colour dictionary
/// @param quote-width Quote block width
/// @param quote-align Quote block alignment
/// @param breakable-settings Breakable configuration
/// @return Styled blockquote
#let apply-quote-style(it, colours, quote-width, quote-align, breakable-settings) = {
  let quote-block = align(quote-align)[
    #block(
      above: 0.5em,
      below: 0.5em,
      width: quote-width,
      spacing: 0em,
      fill: colour-mix(colours, 95%),
      inset: (left: 24pt, right: 24pt, top: 16pt, bottom: 16pt),
      radius: 5pt,
      stroke: (left: 3pt + colours.foreground),
      breakable: breakable-settings.quote,
      {
        // Opening quotation mark - top left (marked as artifact)
        pdf.artifact(
          place(
            top + left,
            dx: -18pt,
            dy: -10pt,
            text(size: 3em, fill: colours.foreground.transparentize(70%), font: "Georgia", ["]),
          ),
        )
        it.body
        // Closing quotation mark - bottom right (marked as artifact)
        pdf.artifact(
          place(
            bottom + right,
            dx: 18pt,
            dy: 24pt,
            text(size: 3em, fill: colours.foreground.transparentize(70%), font: "Georgia", ["]),
          ),
        )
      },
    )
  ]

  quote-block
}

/// Apply definition list styling whilst preserving semantic structure for PDF/UA
/// Use show terms.item to preserve the terms wrapper for PDF/UA-1 compliance
/// @param it Terms element
/// @param colours Colour dictionary
/// @param breakable-settings Breakable configuration
/// @return Styled definition list with preserved semantics
#let apply-terms-style(it, colours, breakable-settings) = {
  show terms.item: item => {
    // Use set text to style term as bold for PDF/UA-1 compliance
    block(below: 0.2em)[
      #set text(weight: "bold")
      #item.term
    ]
    // Style description with background
    block(
      above: 0em,
      fill: colour-mix(colours, 95%),
      inset: (left: 1.5em, right: 0.5em, top: 0.3em, bottom: 0.3em),
      radius: 3pt,
    )[#item.description]
  }
  // Return original terms element to preserve semantic structure
  if breakable-settings.terms == auto {
    it
  } else {
    block(breakable: breakable-settings.terms, it)
  }
}

/// Apply table styling with optional page breaks
/// @param it Table element
/// @param breakable-settings Breakable configuration
/// @return Styled table
#let apply-table-style(it, breakable-settings) = {
  if breakable-settings.table == auto {
    it
  } else {
    block(breakable: breakable-settings.table, it)
  }
}

/// Apply figure styling with image borders
/// @param it Figure element
/// @param colours Colour dictionary
/// @return Styled figure
#let apply-figure-style(it, colours) = {
  // Check if content is already wrapped (avoid infinite recursion)
  let body-repr = repr(it.body)

  // Check if this is an image figure (kind is image or body contains image)
  let is-image = it.kind == image or body-repr.contains("image(")

  // Check if this is a super figure containing subfigures
  let is-super-figure = body-repr.contains("figure(")

  // Check if already styled (featured image or border already applied)
  // Look for the border wrapper's characteristic "clip: true" which is unique to image-border
  let is-styled = (
    body-repr.contains("mcanouil-featured-image")
      or (body-repr.contains("clip: true") and body-repr.contains("stroke:"))
  )

  if is-image and not is-styled and not is-super-figure {
    // Apply border using a nested show rule instead of creating a new figure
    // This automatically preserves all figure properties including labels
    // Skip border for super figures (they contain subfigures which get borders instead)
    show image: img => image-border(img, colours)
    it
  } else {
    // Pass through - already styled, not an image, super figure, or table/other content
    it
  }
}

/// Apply callout styling with branded design
/// Ensures non-colour differentiation through title text for accessibility
/// @param it Callout figure element
/// @param colours Colour dictionary
/// @param breakable-settings Breakable configuration
/// @return Styled callout
#let apply-callout-style(it, colours, breakable-settings) = {
  // Extract callout type from kind (e.g., "quarto-callout-note" -> "note")
  let callout-type = it.kind.replace("quarto-callout-", "")

  // Get the appropriate colour for this callout type
  let colour = callout-colour(callout-type)

  // Default titles for accessibility (non-colour differentiation)
  let default-titles = (
    note: "Note",
    tip: "Tip",
    warning: "Warning",
    important: "Important",
    caution: "Caution",
  )

  // Extract title from caption if present, otherwise use default based on type
  let title-content = if it.caption != none {
    it.caption.body
  } else {
    // Use default title for accessibility when no custom title provided
    default-titles.at(callout-type, default: upper(callout-type.first()) + callout-type.slice(1))
  }

  // Render the styled callout
  let styled-callout = render-callout(
    callout-type,
    colour,
    title-content,
    it.body,
    colours,
  )

  // Apply breakable setting
  if breakable-settings.callout == false {
    block(breakable: false, styled-callout)
  } else {
    styled-callout
  }
}
