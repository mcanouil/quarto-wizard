// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Title block composition
// Combines title, subtitle, authors, date, abstract with decorations

// ============================================================================
// Title block function
// ============================================================================

/// Create document title block
/// Supports two modes: standard (inline) and title-page (dedicated page)
/// @param title Document title
/// @param subtitle Document subtitle
/// @param authors Array of author dictionaries
/// @param date Publication date
/// @param abstract Abstract text
/// @param keywords Array of keywords
/// @param colours Colour dictionary
/// @param show-corner-brackets Whether to show corner bracket decorations
/// @param orcid-icon Path to ORCID icon file
/// @param has-outlines Whether document has table of contents or list-of sections
/// @param title-page Whether to use dedicated title page mode
/// @param logo Path to logo image file
/// @param logo-width Optional logo width
/// @param logo-height Logo height (title page uses 4x this value)
/// @param logo-inset Logo padding
/// @param logo-alt Alternative text for logo image
/// @param title-size Title font size
/// @param subtitle-size Subtitle font size
/// @param abstract-title Abstract section heading
/// @param keywords-title Keywords section heading
/// @return Formatted title block content
#let mcanouil-title-block(
  title: none,
  subtitle: none,
  authors: (),
  date: none,
  abstract: none,
  keywords: (),
  colours: none,
  show-corner-brackets: true,
  orcid-icon: none,
  has-outlines: false,
  title-page: false,
  logo: none,
  logo-light: none,
  logo-dark: none,
  logo-width: none,
  logo-height: 1.5em,
  logo-inset: 0pt,
  logo-alt: none,
  brand-mode: "light",
  title-size: 24pt,
  subtitle-size: 14pt,
  abstract-title: "Abstract",
  keywords-title: "Keywords",
) = {
  // Collect affiliations and create mapping
  let (affiliations, aff-map) = collect-affiliations(authors)

  // Helper to check if a value is a valid file path (not none, not empty, and looks like a path)
  // Excludes simple names like "light" or "dark" which are brand references, not paths
  let is-valid-path(val) = {
    val != none and val != "" and (val.contains("/") or val.contains("."))
  }

  // For title page: invert logo selection based on brand-mode
  // Dark mode (dark background) -> use light logo (visible on dark)
  // Light mode (light background) -> use dark logo (visible on light)
  let title-page-logo = if brand-mode == "dark" and is-valid-path(logo-light) {
    logo-light
  } else if brand-mode == "light" and is-valid-path(logo-dark) {
    logo-dark
  } else if is-valid-path(logo) {
    logo // fallback to standard logo
  } else {
    none
  }
  // Note: .replace("\\", "") removes backslash escapes from paths (Quarto escaping workaround)
  title-page-logo = if title-page-logo != none {
    title-page-logo.replace("\\", "")
  } else {
    none
  }

  // Shared content blocks (defined at function level for use in both modes)
  let abstract-content = if abstract != none [
    #block(
      width: 100%,
      inset: (left: 2em, right: 2em),
      [
        #text(weight: "bold", size: 10pt)[#abstract-title]
        #v(0.3em)
        #text(size: 10pt, style: "italic")[#abstract]
      ],
    )
    #v(1em)
  ]

  let keywords-content = if keywords != () [
    #block(
      width: 100%,
      inset: (left: 2em, right: 2em),
      [
        #text(weight: "bold", size: 10pt)[#keywords-title:] #text(size: 10pt, style: "italic")[#keywords.join(", ")]
      ],
    )
    #v(1em)
  ]

  let affiliations-content = if authors.len() > 0 [
    #affiliations-section(authors, affiliations, colours, orcid-icon: orcid-icon)
    #v(1em)
  ]

  // Title page mode: centred content with logo, no abstract/affiliations on first page
  if title-page {
    // Vertically centre the title block on the page
    align(center + horizon)[
      // Logo at top of title block (2x the header logo size)
      // Uses inverted logo for title page (light logo on dark background, etc.)
      #if title-page-logo != none {
        // Use width if specified, otherwise use height
        if logo-width != none {
          image(title-page-logo, width: logo-width, alt: if logo-alt != none { logo-alt } else { "" })
        } else {
          image(title-page-logo, height: logo-height * 4, alt: if logo-alt != none { logo-alt } else { "" })
        }
        v(2em)
      }

      // Title with corner brackets
      #if show-corner-brackets {
        corner-brackets(
          [
            #text(size: title-size * 1.167, weight: "bold", fill: colours.foreground)[#title]

            #if subtitle != none {
              v(0.5em)
              text(size: subtitle-size * 1.143, fill: colours.muted, style: "italic")[#subtitle]
            }
          ],
          colours,
          size: title-size * 1.167,
          thickness: 3pt,
          inset: 2em,
        )
      } else {
        text(size: title-size * 1.167, weight: "bold", fill: colours.foreground)[#title]

        if subtitle != none {
          v(0.5em)
          text(size: subtitle-size * 1.143, fill: colours.muted, style: "italic")[#subtitle]
        }
      }

      #v(2em)

      // Authors
      #if authors.len() > 0 {
        author-block(authors, colours, aff-map: aff-map)
      }

      // Date
      #if date != none {
        v(1em)
        text(size: 11pt, fill: colours.muted)[#date]
      }
    ]

    // Page break after title page
    pagebreak()

    // Abstract and affiliations on their own page (page 2), vertically centred
    align(horizon)[
      #abstract-content
      #keywords-content
      #affiliations-content
    ]

    // Page break before body content (or outlines) starts
    // Only add pagebreak if no outlines, otherwise outlines will handle it
    if not has-outlines {
      pagebreak()
    }
  } else {
    // Standard mode: inline title block (existing behaviour)
    if title != none or subtitle != none or authors.len() > 0 or date != none {
      let header-content = [
        #align(center)[
          // Title
          #if title != none {
            text(size: title-size, weight: "bold", fill: colours.foreground)[#title]
          }

          // Subtitle
          #if subtitle != none {
            v(0.25em)
            text(size: subtitle-size, fill: colours.muted, style: "italic")[#subtitle]
          }

          #if authors.len() > 0 or date != none {
            v(1em)
          }

          // Authors with affiliation superscripts
          #if authors.len() > 0 {
            author-block(authors, colours, aff-map: aff-map)
          }

          // Date
          #if date != none {
            v(0.5em)
            text(size: 10pt, fill: colours.muted)[#date]
          }
        ]
      ]

      // Wrap header in corner brackets if enabled
      v(1em)
      align(center)[
        #if show-corner-brackets {
          corner-brackets(header-content, colours, size: title-size, thickness: 3pt, inset: 2em)
        } else {
          header-content
        }
      ]
      v(1.5em)
    }

    // Abstract, keywords, and affiliations
    abstract-content
    keywords-content
    affiliations-content

    // Line separator (hidden when outlines are present)
    if not has-outlines {
      line(start: (25%, 0%), end: (75%, 0%), stroke: 1pt + colours.muted)
      v(1em)
    }
  }
}
