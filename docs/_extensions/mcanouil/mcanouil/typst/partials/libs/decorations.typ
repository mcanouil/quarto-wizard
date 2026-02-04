// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Decorative elements matching website branding
// Corner brackets from navbar title hover effect

// Import colour constants for featured-image comparison
// #import "colours.typ": COLOUR-LIGHT-BACKGROUND, colour-mix

// ============================================================================
// Constants for decorative elements
// ============================================================================

// Corner bracket defaults
#let DEFAULT-BRACKET-SIZE = 14pt
#let DEFAULT-BRACKET-THICKNESS = 3pt
#let DEFAULT-BRACKET-INSET = 1em
#let BRACKET-BOX-INSET = 2em

// Highlight block defaults
#let HIGHLIGHT-BLOCK-WIDTH = 75%
#let HIGHLIGHT-BLOCK-RADIUS = 6pt
#let HIGHLIGHT-BRACKET-CURVE-FACTOR = 0.6
#let HIGHLIGHT-BRACKET-QUAD-FACTOR = 0.4

// Featured image defaults
#let FEATURED-IMAGE-RADIUS = 24pt
#let FEATURED-IMAGE-SHADOW-OFFSET-Y = 4pt
#let FEATURED-IMAGE-SHADOW-BLUR = 24pt
#let FEATURED-IMAGE-SHADOW-LAYERS = 16
#let FEATURED-IMAGE-SHADOW-OPACITY-BASE = 3%
#let FEATURED-IMAGE-SHADOW-COLOUR-LIGHT = rgb("#060c37")

// Image border defaults (Bootstrap-style)
#let IMAGE-BORDER-RADIUS = 8pt // Bootstrap 0.5rem
#let IMAGE-BORDER-THICKNESS = 1pt
#let IMAGE-BORDER-INSET = 8pt // Bootstrap 0.25rem

// Heading underline configuration
#let HEADING-UNDERLINE-WIDTHS = (80pt, 60pt, 50pt, 40pt, 30pt, 30pt)
#let HEADING-UNDERLINE-HEIGHTS = (4pt, 3pt, 2.5pt, 2pt, 1.5pt, 1.5pt)
#let HEADING-UNDERLINE-OPACITY = 70%
#let HEADING-UNDERLINE-THICKNESS = 0.5pt

// Title page background geometry
#let TITLE-PAGE-BRACKET-SIZE = 60pt
#let TITLE-PAGE-BRACKET-THICKNESS = 3pt

// Callout block defaults
#let CALLOUT-BORDER-LEFT-WIDTH = 4pt
#let CALLOUT-INSET = 1em
#let CALLOUT-RADIUS = 6pt
#let CALLOUT-BACKGROUND-OPACITY = 85%
#let CALLOUT-BRACKET-SIZE = 12pt
#let CALLOUT-BRACKET-THICKNESS = 2pt
#let CALLOUT-SPACING = 0.5em

// ============================================================================
// Decoration functions
// ============================================================================

/// Corner brackets decoration - signature branding element
/// Draws brackets at top-right and bottom-left corners
/// Brackets are marked as PDF artifacts for accessibility
/// @param content Content to wrap with brackets
/// @param colours Colour dictionary
/// @param size Bracket size
/// @param thickness Bracket line thickness
/// @param inset Bracket offset from content
/// @return Decorated content
#let corner-brackets(
  content,
  colours,
  size: DEFAULT-BRACKET-SIZE,
  thickness: DEFAULT-BRACKET-THICKNESS,
  inset: DEFAULT-BRACKET-INSET,
) = {
  box(
    inset: (x: BRACKET-BOX-INSET, y: BRACKET-BOX-INSET),
    {
      // Top-right bracket (vertical line then horizontal)
      // Marked as artifact for PDF accessibility
      pdf.artifact(
        place(
          bottom + right,
          dx: inset,
          dy: inset,
          curve(
            stroke: thickness + colours.foreground,
            curve.line((0pt, 0pt)),
            curve.line((size, 0pt)),
            curve.line((size, -size)),
          ),
        ),
      )
      // Bottom-left bracket (horizontal line then vertical)
      // Marked as artifact for PDF accessibility
      pdf.artifact(
        place(
          top + left,
          dx: -inset,
          dy: -inset,
          curve(
            stroke: thickness + colours.foreground,
            curve.line((size, 0pt)),
            curve.line((0pt, 0pt)),
            curve.line((0pt, size)),
          ),
        ),
      )
      content
    },
  )
}

/// Margin decoration - configurable gradient bars along page edges
/// All decorations are marked as PDF artifacts for accessibility
/// @param colours Colour dictionary
/// @param margin Page margin dictionary
/// @param decorate-left Enable left margin decoration
/// @param decorate-right Enable right margin decoration
/// @param decorate-top Enable top margin decoration
/// @param decorate-bottom Enable bottom margin decoration
/// @param width Width of decoration bars
/// @return Decoration content for page background
#let margin-decoration(
  colours,
  margin: (top: 2.5cm, bottom: 2.5cm, left: 2.5cm, right: 2.5cm),
  decorate-left: true,
  decorate-right: false,
  decorate-top: false,
  decorate-bottom: false,
  width: 0.5cm,
) = context {
  let page-height = page.height - margin.top - margin.bottom
  let page-width = page.width - margin.left - margin.right

  // Left margin decoration (gradient from top to bottom)
  if decorate-left != false and decorate-left != none {
    pdf.artifact(
      place(
        top + left,
        dx: 0pt,
        dy: 0pt,
        box(
          width: width,
          height: 100%,
          fill: colours.foreground,
        ),
      ),
    )
  }

  // Right margin decoration (gradient from bottom to top)
  if decorate-right != false and decorate-right != none {
    pdf.artifact(
      place(
        top + right,
        dx: 0pt,
        dy: 0pt,
        box(
          width: width,
          height: 100%,
          fill: colours.foreground,
        ),
      ),
    )
  }

  // Top margin decoration (gradient from left to right)
  if decorate-top != false and decorate-top != none {
    pdf.artifact(
      place(
        top + left,
        dx: 0pt,
        dy: 0pt,
        box(
          width: 100%,
          height: width,
          fill: colours.foreground,
        ),
      ),
    )
  }

  // Bottom margin decoration (gradient from right to left)
  if decorate-bottom != false and decorate-bottom != none {
    pdf.artifact(
      place(
        bottom + left,
        dx: 0pt,
        dy: 0pt,
        box(
          width: 100%,
          height: width,
          fill: colours.foreground,
        ),
      ),
    )
  }
}

/// Title page geometric background decoration
/// Creates a stylistic abstract geometric pattern with corner brackets
/// All elements are marked as PDF artifacts for accessibility
/// @param colours Colour dictionary
/// @param margin Page margin dictionary
/// @return Decoration content for title page background
#let title-page-background(colours, margin: (top: 2.5cm, bottom: 2.5cm, left: 2.5cm, right: 2.5cm)) = context {
  let page-w = page.width
  let page-h = page.height
  let bracket-size = TITLE-PAGE-BRACKET-SIZE
  let bracket-thickness = TITLE-PAGE-BRACKET-THICKNESS
  let margin-offset-x = margin.right / 2
  let margin-offset-y = margin.top / 2

  // Large circle in top-right area
  pdf.artifact(
    place(
      top + right,
      dx: 3cm,
      dy: -2cm,
      circle(
        radius: 8cm,
        fill: colours.foreground.transparentize(95%),
      ),
    ),
  )

  // Medium circle in bottom-left
  pdf.artifact(
    place(
      bottom + left,
      dx: -4cm,
      dy: 3cm,
      circle(
        radius: 6cm,
        fill: colours.foreground.transparentize(93%),
      ),
    ),
  )

  // Small decorative circle top-left
  pdf.artifact(
    place(
      top + left,
      dx: 2cm,
      dy: 4cm,
      circle(
        radius: 2cm,
        fill: colours.foreground.transparentize(90%),
      ),
    ),
  )

  // Diagonal line accent from top-left towards centre
  pdf.artifact(
    place(
      top + left,
      dx: 0pt,
      dy: 0pt,
      line(
        start: (0pt, page-h * 0.3),
        end: (page-w * 0.4, 0pt),
        stroke: 2pt + colours.foreground.transparentize(92%),
      ),
    ),
  )

  // Diagonal line accent from bottom-right
  pdf.artifact(
    place(
      bottom + right,
      dx: 0pt,
      dy: 0pt,
      line(
        start: (0pt, -page-h * 0.25),
        end: (-page-w * 0.35, 0pt),
        stroke: 2pt + colours.foreground.transparentize(92%),
      ),
    ),
  )

  // Small decorative circle bottom-right
  pdf.artifact(
    place(
      bottom + right,
      dx: -2.5cm,
      dy: -1cm,
      circle(
        radius: 1.5cm,
        fill: colours.foreground.transparentize(92%),
      ),
    ),
  )

  // Top-right corner bracket (aligned with page corner, in middle of margin)
  pdf.artifact(
    place(
      top + right,
      dx: -margin-offset-x,
      dy: margin-offset-y,
      curve(
        stroke: bracket-thickness + colours.foreground,
        curve.line((0pt, bracket-size)),
        curve.line((0pt, 0pt)),
        curve.line((-bracket-size, 0pt)),
      ),
    ),
  )

  // Bottom-left corner bracket (aligned with page corner, in middle of margin)
  pdf.artifact(
    place(
      bottom + left,
      dx: margin.left / 2,
      dy: -(margin.bottom / 2),
      curve(
        stroke: bracket-thickness + colours.foreground,
        curve.line((bracket-size, 0pt)),
        curve.line((0pt, 0pt)),
        curve.line((0pt, -bracket-size)),
      ),
    ),
  )
}

/// Highlight block - styled block with dashed border and corner brackets
/// Internal implementation (called via mcanouil-highlight wrapper in typst-show.typ)
/// Corner brackets are marked as PDF artifacts for accessibility
/// @param content Content to highlight
/// @param colours Colour dictionary
/// @param bracket-size Size of corner brackets
/// @param bracket-thickness Thickness of bracket lines
/// @param border-thickness Thickness of border
/// @param inset Internal padding
/// @return Highlighted content block
#let _highlight(
  content,
  colours,
  bracket-size: DEFAULT-BRACKET-SIZE,
  bracket-thickness: DEFAULT-BRACKET-THICKNESS,
  border-thickness: 1.5pt,
  inset: 1.5em,
) = {
  let bracket = curve(
    stroke: (paint: colours.foreground, thickness: bracket-thickness, cap: "round", join: "round"),
    curve.line((0pt, 0pt)),
    curve.line((bracket-size * HIGHLIGHT-BRACKET-CURVE-FACTOR, 0pt)),
    curve.quad((bracket-size, 0pt), (bracket-size, -bracket-size * HIGHLIGHT-BRACKET-QUAD-FACTOR)),
    curve.line((bracket-size, -bracket-size)),
  )
  align(center)[
    #block(
      width: HIGHLIGHT-BLOCK-WIDTH,
      inset: inset,
      radius: HIGHLIGHT-BLOCK-RADIUS,
      stroke: (
        paint: colours.muted,
        thickness: border-thickness,
        dash: "dashed",
      ),
      fill: colour-mix(colours, 95%),
      {
        // Top-right corner bracket (rounded) - marked as artifact
        pdf.artifact(
          place(
            bottom + right,
            dx: inset,
            dy: inset,
            bracket,
          ),
        )
        // Bottom-left corner bracket (rounded) - marked as artifact
        pdf.artifact(
          place(
            top + left,
            dx: -inset,
            dy: -inset,
            rotate(180deg, bracket),
          ),
        )
        // Disable TOC inclusion and numbering for headings inside highlight block
        show heading: it => {
          set heading(outlined: false, numbering: none)
          it
        }
        content
      },
    )
  ]
}

/// Image border - rounded corners with subtle border
/// Matches Bootstrap's img-thumbnail styling (0.5rem radius, 0.25rem padding)
/// @param content Image content
/// @param colours Colour dictionary
/// @param radius Corner radius
/// @param border-thickness Border thickness
/// @param inset Internal padding
/// @return Styled image with border
#let image-border(
  content,
  colours,
  radius: IMAGE-BORDER-RADIUS,
  border-thickness: IMAGE-BORDER-THICKNESS,
  inset: IMAGE-BORDER-INSET,
) = {
  box(
    radius: radius,
    inset: inset,
    stroke: border-thickness + colours.muted,
    clip: true,
    content,
  )
}

/// Heading underline - gradient decoration below headings
/// Thickness and width proportional to heading level
/// Marked as PDF artifact for accessibility
/// @param colours Colour dictionary
/// @param level Heading level (1-6)
/// @return Underline decoration
#let heading-underline(colours, level: 1) = {
  let idx = calc.min(level - 1, 5)
  let width = HEADING-UNDERLINE-WIDTHS.at(idx)
  let height = HEADING-UNDERLINE-HEIGHTS.at(idx)
  // Reset first-line-indent to ensure left alignment
  set par(first-line-indent: 0pt)
  // Mark entire underline decoration as artifact for accessibility
  pdf.artifact(
    stack(
      dir: ttb,
      spacing: 0pt,
      // Gradient box
      box(
        width: width,
        height: height,
        fill: gradient.linear(
          colours.foreground,
          colours.background,
          angle: 0deg,
        ),
      ),
      // Full-width line only for level 1
      if level == 1 {
        line(
          length: 100%,
          stroke: HEADING-UNDERLINE-THICKNESS + colours.foreground.transparentize(HEADING-UNDERLINE-OPACITY),
        )
      },
    ),
  )
}

/// Callout block - styled admonition with left border and corner brackets
/// Corner brackets are marked as PDF artifacts for accessibility
/// @param callout-type Type of callout ("note", "tip", "warning", "important", "caution")
/// @param callout-colour Main colour for the callout type
/// @param title Optional title for the callout
/// @param body Content of the callout
/// @param colours Colour dictionary
/// @param icon Optional icon content to display before title
/// @return Styled callout block
#let render-callout(
  callout-type,
  callout-colour,
  title,
  body,
  colours,
  icon: none,
) = {
  // Create background colour with subtle tint
  let background = color.mix(
    (colours.background, CALLOUT-BACKGROUND-OPACITY),
    (callout-colour, 100% - CALLOUT-BACKGROUND-OPACITY),
    space: rgb,
  )

  // Validate callout colour for title text meets WCAG AA requirements (4.5:1)
  let validated-callout-colour = ensure-contrast(callout-colour, background, min-ratio: 4.5, preserve-hue: true)

  // Validate foreground colour for body text meets WCAG AA requirements
  // Body text uses implicit foreground, so we check it here
  let validated-foreground = ensure-contrast(colours.foreground, background, min-ratio: 4.5, preserve-hue: false)

  // Build corner brackets
  let bracket = curve(
    stroke: (paint: validated-callout-colour, thickness: CALLOUT-BRACKET-THICKNESS, cap: "round", join: "round"),
    curve.line((0pt, 0pt)),
    curve.line((CALLOUT-BRACKET-SIZE * 0.6, 0pt)),
    curve.quad((CALLOUT-BRACKET-SIZE, 0pt), (CALLOUT-BRACKET-SIZE, -CALLOUT-BRACKET-SIZE * 0.4)),
    curve.line((CALLOUT-BRACKET-SIZE, -CALLOUT-BRACKET-SIZE)),
  )

  block(
    width: 100%,
    inset: CALLOUT-INSET,
    radius: CALLOUT-RADIUS,
    fill: background,
    stroke: (left: CALLOUT-BORDER-LEFT-WIDTH + validated-callout-colour),
    breakable: true,
    {
      // Top-right corner bracket - marked as artifact
      pdf.artifact(
        place(
          bottom + right,
          dx: CALLOUT-INSET,
          dy: CALLOUT-INSET,
          bracket,
        ),
      )
      // Bottom-left corner bracket - marked as artifact
      pdf.artifact(
        place(
          top + left,
          dx: -CALLOUT-INSET,
          dy: -CALLOUT-INSET,
          rotate(180deg, bracket),
        ),
      )

      // Title section (if provided)
      if title != none and title != "" {
        block(
          spacing: CALLOUT-SPACING,
          {
            if icon != none {
              box(baseline: 20%, icon)
              h(0.5em)
            }
            text(weight: "bold", fill: validated-callout-colour, title)
          },
        )
      } else if icon != none {
        block(
          spacing: CALLOUT-SPACING,
          box(baseline: 20%, icon),
        )
      }

      // Body content - use validated foreground colour
      set text(fill: validated-foreground)
      body
    },
  )
}
