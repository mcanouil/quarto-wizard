// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Page header with branding
// Layout: [Logo] ... [DOCUMENT TITLE]
//         ─────────────────────────────

// ============================================================================
// Constants for professional header style
// ============================================================================

#let HEADER-PROFESSIONAL-TITLE-SIZE = 2em
#let HEADER-PROFESSIONAL-SUBTITLE-SIZE = 1.25em
#let HEADER-PROFESSIONAL-TITLE-WEIGHT = 600
#let HEADER-PROFESSIONAL-SUBTITLE-OPACITY = 90%
#let HEADER-PROFESSIONAL-LOGO-HEIGHT = 100%
#let HEADER-PROFESSIONAL-BORDER-THICKNESS = 2pt
#let HEADER-PROFESSIONAL-PADDING-VERTICAL = 0.5cm  // Increased by 20% (20pt * 1.2)
#let HEADER-PROFESSIONAL-PADDING-HORIZONTAL = 0cm  // Increased by 20% (30pt * 1.2)

// ============================================================================
// Header functions
// ============================================================================

/// Create academic style page header
/// @param title Document title (displayed in uppercase on right)
/// @param logo Path to logo image file
/// @param logo-alt Alternative text for logo image
/// @param colours Colour dictionary
/// @param show-logo Whether to display the logo
/// @return Formatted academic header content
#let mcanouil-header-academic(
  title: none,
  logo: none,
  logo-alt: none,
  colours: none,
  show-logo: true,
) = {
  v(0.5em)
  grid(
    rows: 2.5cm,
    columns: (1fr, auto),
    align: (left + horizon, right + horizon),
    gutter: 0em,
    {
      if show-logo and logo != none {
        image(logo, height: 1.5em, alt: if logo-alt != none { logo-alt } else { "" })
      }
    },
    {
      if title != none {
        text(
          size: 9pt,
          fill: colours.muted,
          weight: "medium",
          upper(title),
        )
      }
    },
  )
  line(length: 100%, stroke: 0.5pt + colours.muted)
}

/// Create professional style page header
/// @param title Document title (displayed on left, stacked with subtitle)
/// @param subtitle Document subtitle (displayed below title, optional)
/// @param logo Path to logo image file
/// @param logo-alt Alternative text for logo image
/// @param colours Colour dictionary
/// @param show-logo Whether to display the logo
/// @return Formatted professional header content
#let mcanouil-header-professional(
  title: none,
  subtitle: none,
  logo: none,
  logo-alt: none,
  colours: none,
  show-logo: true,
) = context {
  // Use current margin from state (dynamically adapts to margin changes mid-document)
  let current-margin = current-margin-state.get()
  let left-margin = current-margin.left
  let right-margin = current-margin.right
  let total-horizontal = left-margin + right-margin
  let top-margin = current-margin.top
  // Use symmetric margin for header content (minimum of left/right)
  let symmetric-margin = calc.min(left-margin, right-margin)

  place(
    top + left,
    dx: -left-margin,
    dy: 0cm,
    block(
      width: 100% + total-horizontal,
      fill: colours.foreground,
      inset: (
        left: symmetric-margin + HEADER-PROFESSIONAL-PADDING-HORIZONTAL,
        right: symmetric-margin + HEADER-PROFESSIONAL-PADDING-HORIZONTAL,
        top: HEADER-PROFESSIONAL-PADDING-VERTICAL,
        bottom: HEADER-PROFESSIONAL-PADDING-VERTICAL,
      ),
      {
        grid(
          columns: (1fr, auto),
          align: (left + horizon, right + horizon),
          column-gutter: 3em,
          {
            // Left: Title and subtitle stacked
            stack(
              dir: ttb,
              spacing: 0.5em,
              {
                if title != none {
                  text(
                    size: HEADER-PROFESSIONAL-TITLE-SIZE,
                    weight: HEADER-PROFESSIONAL-TITLE-WEIGHT,
                    fill: colours.background,
                    title,
                  )
                }
              },
              {
                if subtitle != none {
                  text(
                    size: HEADER-PROFESSIONAL-SUBTITLE-SIZE,
                    fill: colours.background.transparentize(
                      100% - HEADER-PROFESSIONAL-SUBTITLE-OPACITY,
                    ),
                    subtitle,
                  )
                }
              },
            )
          },
          {
            // Right: Logo with constrained height
            if show-logo and logo != none {
              image(
                logo,
                fit: "contain",
                height: HEADER-PROFESSIONAL-LOGO-HEIGHT,
                alt: if logo-alt != none { logo-alt } else { "" },
              )
            }
          },
        )
      },
    ),
  )
  // Spacing to account for the banner height (padding + logo height)
  v(HEADER-PROFESSIONAL-PADDING-VERTICAL * 2 + HEADER-PROFESSIONAL-LOGO-HEIGHT)
}

/// Create branded page header (dispatcher)
/// @param style Header style ("academic" or "professional")
/// @param title Document title
/// @param subtitle Document subtitle (used in professional style)
/// @param logo Path to logo image file
/// @param logo-light Path to light version of logo image file (for dark mode)
/// @param logo-dark Path to dark version of logo image file (for light mode)
/// @param logo-alt Alternative text for logo image
/// @param colours Colour dictionary
/// @param show-logo Whether to display the logo
/// @return Formatted header content based on style
#let mcanouil-header(
  style: "academic",
  title: none,
  subtitle: none,
  logo: none,
  logo-light: none,
  logo-dark: none,
  logo-alt: none,
  brand-mode: "light",
  colours: none,
  show-logo: true,
) = {
  // Helper to check if a value is a valid file path (not none, not empty, and looks like a path)
  // Excludes simple names like "light" or "dark" which are brand references, not paths
  let is-valid-path(val) = {
    val != none and val != "" and (val.contains("/") or val.contains("."))
  }

  if style == "professional" {
    let header-logo = if brand-mode == "dark" and is-valid-path(logo-dark) {
      logo-dark
    } else if brand-mode == "light" and is-valid-path(logo-light) {
      logo-light
    } else if is-valid-path(logo) {
      logo // fallback to standard logo
    } else {
      none
    }
    // Note: .replace("\\", "") removes backslash escapes from paths (Quarto escaping workaround)
    header-logo = if header-logo != none {
      header-logo.replace("\\", "")
    } else {
      none
    }
    mcanouil-header-professional(
      title: title,
      subtitle: subtitle,
      logo: header-logo,
      logo-alt: logo-alt,
      colours: colours,
      show-logo: show-logo,
    )
  } else {
    let header-logo = if brand-mode == "dark" and is-valid-path(logo-light) {
      logo-light
    } else if brand-mode == "light" and is-valid-path(logo-dark) {
      logo-dark
    } else if is-valid-path(logo) {
      logo // fallback to standard logo
    } else {
      none
    }
    // Note: .replace("\\", "") removes backslash escapes from paths (Quarto escaping workaround)
    header-logo = if header-logo != none {
      header-logo.replace("\\", "")
    } else {
      none
    }
    mcanouil-header-academic(
      title: title,
      logo: header-logo,
      logo-alt: logo-alt,
      colours: colours,
      show-logo: show-logo,
    )
  }
}
