// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Margin section display for showing current section in page margin
// Professional style displays vertical section title in left margin
//
// Usage:
//   #import "margin-section.typ": margin-section
//
//   // In page setup (professional style)
//   #set page(
//     background: context {
//       margin-section(
//         style: "professional",
//         colours: colours,
//         margin: margin,
//       )
//     }
//   )
//
// Features:
//   - Section title persists across pages until new section appears
//   - Supports special section numbering (Appendix A.1, Supplementary I.1, etc.)
//   - Vertical text positioned in left margin with configurable styling
//   - Graceful degradation - returns none if parameters invalid
//   - Automatic font size calculation based on longest heading
//   - Consistent sizing across all pages without text wrapping
//   - Dual constraints: 90% of page height and 50% of left margin width
//   - Minimum text size constraint for accessibility

// ============================================================================
// Constants for margin section display
// ============================================================================

/// Reference font size for measuring heading text widths
/// Used as baseline for calculating optimal font size
/// Default: 12pt is a standard readable size
#let MARGIN-SECTION-REFERENCE-SIZE = 12pt

/// Target fill ratio for margin section text (vertical constraint)
/// The longest heading will occupy at most this percentage of available height
/// Default: 90% provides visual impact whilst leaving breathing room
/// Rationale: Maximises readability and visual presence in margin
#let MARGIN-SECTION-FILL-RATIO = 90%

/// Maximum font size as percentage of left margin width (horizontal constraint)
/// After rotation, font size becomes the horizontal width of the text
/// Default: 50% ensures text does not dominate the margin
/// Example: 3cm margin × 50% ≈ 1.5cm text height
#let MARGIN-SECTION-MAX-MARGIN-RATIO = 50%

/// Horizontal position of margin section as percentage of left margin
/// Default: 85% positions text near left edge whilst avoiding page clipping
/// Rationale: Provides visual separation from body whilst maintaining margin alignment
#let MARGIN-SECTION-POSITION-HORIZONTAL = 85%

/// Opacity level for margin section text (transparency percentage)
/// Default: 70% ensures subtle appearance without compromising legibility
/// Rationale: Balances visual hierarchy (background element) with WCAG contrast requirements
/// Note: Actual contrast ratio depends on colours.muted value and page background
#let MARGIN-SECTION-OPACITY = 70%

/// Font weight for margin section text
/// Default: "bold" provides sufficient visual weight for rotated text
/// Rationale: Bold weight maintains legibility when text is displayed vertically
#let MARGIN-SECTION-WEIGHT = "bold"

/// Rotation angle for margin section text (counterclockwise)
/// Default: -90deg for vertical layout reading from bottom to top
/// Rationale: Standard orientation for spine text and vertical margin elements
#let MARGIN-SECTION-ROTATION = -90deg

/// Minimum text size for margin section (accessibility requirement)
/// Default: 9pt ensures text remains legible even with narrow margins
/// Rationale: WCAG accessibility guidelines recommend minimum 9pt for body text
/// Ensures readability when calculated size (50% of narrow margin) would be too small
#let MARGIN-SECTION-MIN-SIZE = 9pt

/// Default heading level to display in margin
/// Default: 1 (top-level sections)
/// Rationale: Level 1 headings represent major document sections
/// Can be overridden to show subsections (level 2) or other heading levels
#let MARGIN-SECTION-HEADING-LEVEL = 1

// ============================================================================
// Helper functions
// ============================================================================

/// Get most recent heading of specified level on or before current page
/// @param current-page Current page number
/// @param heading-level Heading level to query (default: MARGIN-SECTION-HEADING-LEVEL)
/// @return Heading element or none
#let get-current-section-heading(
  current-page,
  heading-level: MARGIN-SECTION-HEADING-LEVEL,
) = {
  let all-headings = query(selector(heading.where(level: heading-level)))
  let page-headings = all-headings.filter(h => {
    counter(page).at(h.location()).first() <= current-page
  })

  if page-headings.len() > 0 {
    page-headings.last()
  } else {
    none
  }
}

/// Construct heading text with appropriate numbering
/// The heading's numbering property is set directly by the Lua filter,
/// including any prefix (e.g., "Appendix A").
/// @param heading Heading element
/// @param h-location Heading location
/// @return Formatted heading text
#let construct-margin-heading-text(heading, h-location) = {
  if heading.numbering == none {
    return heading.body
  }

  let h-counter = counter(heading.func()).at(h-location)

  // Build number text using the heading's numbering function
  let number-text = if type(heading.numbering) == function {
    (heading.numbering)(..h-counter)
  } else {
    numbering(heading.numbering, ..h-counter)
  }

  // Combine number and title
  if number-text != none {
    [#number-text #heading.body]
  } else {
    heading.body
  }
}

/// Calculate optimal font size for margin section based on longest heading.
/// Queries all headings, measures their text width, and calculates the font size
/// subject to two constraints:
///   1. Longest heading fills at most MARGIN-SECTION-FILL-RATIO of available height
///   2. Font size is at most MARGIN-SECTION-MAX-MARGIN-RATIO of left margin width
///
/// @param heading-level Heading level to query (default: MARGIN-SECTION-HEADING-LEVEL)
/// @param available-height Available vertical space after rotation (page height - margins)
/// @param left-margin Left margin width (used for maximum size constraint)
/// @return Optimal font size (minimum MARGIN-SECTION-MIN-SIZE for accessibility)
#let calculate-optimal-margin-size(
  heading-level: MARGIN-SECTION-HEADING-LEVEL,
  available-height: 0pt,
  left-margin: 2.5cm,
) = {
  let all-headings = query(selector(heading.where(level: heading-level)))

  if all-headings.len() == 0 {
    MARGIN-SECTION-REFERENCE-SIZE
  } else {
    // Measure each heading at reference size to find the longest
    let max-width = 0pt

    for h in all-headings {
      let h-location = h.location()

      // Construct the full heading text including numbering
      let heading-text = construct-margin-heading-text(h, h-location)

      // Measure at reference size with bold weight (matching actual rendering)
      let dimensions = measure(text(
        size: MARGIN-SECTION-REFERENCE-SIZE,
        weight: MARGIN-SECTION-WEIGHT,
        heading-text,
      ))

      if dimensions.width > max-width {
        max-width = dimensions.width
      }
    }

    // If no measurable content, use reference size
    if max-width == 0pt {
      MARGIN-SECTION-REFERENCE-SIZE
    } else {
      // Calculate size based on vertical constraint (90% of available height)
      // After -90° rotation, text width becomes vertical height
      let target-height = available-height * MARGIN-SECTION-FILL-RATIO
      let scale = target-height / max-width
      let height-based-size = MARGIN-SECTION-REFERENCE-SIZE * scale

      // Calculate maximum size based on horizontal constraint (50% of left margin)
      // After -90° rotation, font size becomes horizontal width
      let max-margin-size = left-margin * MARGIN-SECTION-MAX-MARGIN-RATIO

      // Apply both constraints: minimum of height-based and margin-based, then ensure minimum
      let constrained-size = calc.min(height-based-size, max-margin-size)
      calc.max(constrained-size, MARGIN-SECTION-MIN-SIZE)
    }
  }
}

// ============================================================================
// Margin section functions
// ============================================================================

/// Display section in left margin (academic style)
/// Academic style does not show margin sections
/// @param colours Colour dictionary
/// @param margin Page margins dictionary with top, bottom, left, right
/// @return None (no margin section displayed)
#let margin-section-academic(
  colours: none,
  margin: (top: 2.5cm, bottom: 2.5cm, left: 2.5cm, right: 2.5cm),
) = {
  none
}

/// Display section in left margin (professional style)
/// Professional style shows vertical section title in left margin
/// Section persists across pages until new heading of specified level appears
///
/// Font size is automatically calculated based on the longest heading in the document
/// to ensure consistent sizing without text wrapping across all pages.
///
/// Note: This function fails gracefully. If required parameters are missing
/// or invalid, it returns none rather than throwing an error. This ensures
/// the margin section (a decorative element) never breaks document rendering.
///
/// @param colours Colour dictionary with required fields:
///   - muted: Colour - Secondary/muted colour for section text
///   Example: (foreground: rgb("#..."), background: rgb("#..."), muted: rgb("#..."))
///   Returns none if missing or invalid
///
/// @param margin Page margins dictionary with required fields:
///   - left: Length - Left margin width (used for positioning)
///   - top: Length - Top margin height (used for calculating available space)
///   - bottom: Length - Bottom margin height (used for vertical positioning and space calculation)
///   Example: (top: 2.5cm, bottom: 2.5cm, left: 2.5cm, right: 2.5cm)
///   Returns none if missing required fields
///
/// @param heading-level Heading level to display in margin (default: MARGIN-SECTION-HEADING-LEVEL)
///   1 for top-level sections, 2 for subsections, etc.
///   Allows customisation of which heading level appears in margin
///
/// @return Positioned margin section element or none if no heading found or validation fails
#let margin-section-professional(
  colours: none,
  margin: (top: 2.5cm, bottom: 2.5cm, left: 2.5cm, right: 2.5cm),
  heading-level: MARGIN-SECTION-HEADING-LEVEL,
) = context {
  // Skip margin section on section pages (they have their own layout)
  if section-page-state.get() {
    return none
  }

  // Validate required parameters (fail gracefully for decorative element)
  if colours == none {
    return none
  }

  // Use current margin from state (dynamically adapts to margin changes mid-document)
  let current-margin = current-margin-state.get()

  // Get current section heading
  let current-page = counter(page).get().first()
  let heading = get-current-section-heading(current-page, heading-level: heading-level)

  if heading == none {
    return none
  }

  // Get page height from context and calculate available vertical space
  // After -90° rotation, text width becomes vertical height
  let page-height = page.height
  let available-height = page-height - current-margin.top - current-margin.bottom

  // Calculate optimal font size based on longest heading and margin constraints
  let margin-section-size = calculate-optimal-margin-size(
    heading-level: heading-level,
    available-height: available-height,
    left-margin: current-margin.left,
  )

  // Construct heading text (includes numbering set by Lua filter)
  let h-location = heading.location()
  let heading-text = construct-margin-heading-text(heading, h-location)

  // Create the styled text element
  let styled-text = text(
    size: margin-section-size,
    weight: MARGIN-SECTION-WEIGHT,
    fill: colours.muted.transparentize(MARGIN-SECTION-OPACITY),
    heading-text,
  )

  // Measure actual text dimensions for accurate centring
  // After -90° rotation, text height becomes horizontal width
  let text-dimensions = measure(styled-text)
  let text-horizontal-extent = text-dimensions.height

  // Centre horizontally in margin using text middle as reference point
  let horizontal-centre = (current-margin.left - text-horizontal-extent) / 2

  // Render margin section
  place(
    top + left,
    // Horizontal: Centre the rotated text within the left margin
    dx: horizontal-centre,
    // Vertical: Position at bottom of page minus bottom margin
    // This aligns the top of the rotated text with the bottom of the content area
    dy: 100% - current-margin.bottom,
    rotate(MARGIN-SECTION-ROTATION, origin: top + left, styled-text),
  )
}

/// Display section in margin (dispatcher)
/// Routes to appropriate style-specific function based on style
///
/// Font size is automatically calculated based on the longest heading in the document
/// to ensure consistent sizing without text wrapping across all pages.
///
/// @param style Header footer style - determines which variant to use
///   - "academic": No margin section displayed (returns none)
///   - "professional": Vertical section title in left margin
///   Default: "academic"
///
/// @param colours Colour dictionary - see margin-section-professional for structure
///   Required for professional style, ignored for academic style
///
/// @param margin Page margins dictionary - see margin-section-professional for structure
///   Required for professional style, ignored for academic style
///
/// @param heading-level Heading level to display in margin (default: MARGIN-SECTION-HEADING-LEVEL)
///   Only used for professional style
///   1 for top-level sections, 2 for subsections, etc.
///
/// @return Margin section element (professional style) or none (academic style)
#let margin-section(
  style: "academic",
  colours: none,
  margin: (top: 2.5cm, bottom: 2.5cm, left: 2.5cm, right: 2.5cm),
  heading-level: MARGIN-SECTION-HEADING-LEVEL,
) = {
  if style == "professional" {
    margin-section-professional(
      colours: colours,
      margin: margin,
      heading-level: heading-level,
    )
  } else {
    margin-section-academic(
      colours: colours,
      margin: margin,
    )
  }
}
