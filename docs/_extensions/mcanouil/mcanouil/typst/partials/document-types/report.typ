// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Report Template
// Academic/professional report document type with title page, sections, references.

/// Create branded report document.
/// This is the main template function that configures the entire document.
/// It sets up page layout, typography, styling, and processes all document metadata.
///
/// Document Metadata:
/// @param title Document title
/// @param subtitle Document subtitle
/// @param authors Array of author dictionaries (Quarto normalised schema)
/// @param date Publication date
/// @param abstract Abstract text
/// @param keywords Array of keywords
///
/// Colour Configuration:
/// @param brand-mode Colour mode ("light" or "dark")
/// @param colour-background Optional background colour override
/// @param colour-foreground Optional foreground colour override
/// @param colour-muted Optional muted colour override
///
/// Decorative Elements:
/// @param show-corner-brackets Whether to show corner bracket decorations
/// @param show-margin-decoration Whether to show coloured bars along page margins
/// @param show-title-page-background Whether to show geometric background on title page
/// @param show-heading-underlines Whether to show gradient underlines below headings
///
/// Logo Configuration:
/// @param show-logo Whether to show logo in header
/// @param logo Path to logo image file
/// @param logo-width Optional logo width (if none, uses height)
/// @param logo-height Optional logo height
/// @param logo-inset Logo padding
/// @param logo-alt Alternative text for logo image
/// @param orcid-icon Path to ORCID icon file
///
/// Title Page:
/// @param title-page Whether to use dedicated title page mode
///
/// Header and Footer:
/// @param style Header/footer layout style ('academic' or 'professional')
/// @param institute Institute name for professional footer left (defaults to first author affiliation or URL)
/// @param copyright Copyright statement for professional footer right
/// @param license License information for professional footer right (combined with copyright if both present)
///
/// Watermark:
/// @param watermark-text Text content for watermark
/// @param watermark-image Path to image file for watermark
/// @param watermark-opacity Watermark transparency (default: 10%)
/// @param watermark-angle Watermark rotation angle (default: -45deg)
/// @param watermark-size Size for text watermarks (default: 4em)
/// @param watermark-colour Colour for text watermarks (default: gray)
///
/// Typography:
/// @param font-body Body text font family
/// @param font-headings Heading font family
/// @param font-code Monospace font family for code
/// @param font-size Base font size
/// @param heading-weight Heading font weight
/// @param heading-style Heading font style
/// @param heading-colour Heading colour (defaults to foreground)
/// @param heading-line-height Heading line height
/// @param title-size Title font size
/// @param subtitle-size Subtitle font size
/// @param abstract-title Abstract section heading
/// @param keywords-title Keywords section heading
///
/// Page Layout:
/// @param paper Paper size (default: "a4")
/// @param margin Page margins dictionary
/// @param cols Number of columns (default: 1)
/// @param column-gutter Space between columns (default: 1em)
/// @param lang Document language code
/// @param region Document region code
///
/// Document Structure:
/// @param section-numbering Section numbering pattern
/// @param section-pagebreak Whether to add breaks before level 1 headings (default: true)
/// @param section-page Whether to render dedicated section pages for level-1 headings (default: false)
/// @param toc-depth Maximum heading depth for TOC and section page outlines (default: 3)
/// @param has-outlines Whether document has TOC or list-of sections
/// @param page-break-inside Control page breaks inside elements (auto, avoid, or dictionary)
///
/// Table Styling:
/// @param table-stroke Table border style (auto uses 0.5pt + foreground)
/// @param table-inset Table cell padding
/// @param table-fill Table fill style (none, "alternating", or custom)
///
/// Quote Styling:
/// @param quote-width Blockquote width percentage
/// @param quote-align Blockquote alignment
///
/// Figure and Link Styling:
/// @param figure-placement Figure placement strategy (none: in-place, auto: floating, top/bottom: specific)
/// @param link-underline Whether to underline links
/// @param link-underline-opacity Link underline opacity
/// @param link-colour Optional custom link colour
///
/// @param body Document body content
/// @return Configured document
#let mcanouil-report(
  // Document Metadata
  title: none,
  subtitle: none,
  authors: (),
  date: none,
  abstract: none,
  keywords: (),
  // Colour Configuration
  brand-mode: "light",
  colour-background: none,
  colour-foreground: none,
  colour-muted: none,
  // Decorative Elements
  show-corner-brackets: true,
  show-margin-decoration: true,
  show-title-page-background: true,
  show-heading-underlines: true,
  // Logo Configuration
  show-logo: true,
  logo: none,
  logo-light: none,
  logo-dark: none,
  logo-width: none,
  logo-height: none,
  logo-inset: 0pt,
  logo-alt: none,
  orcid-icon: none,
  // Title Page
  title-page: false,
  // Header and Footer
  style: "academic",
  institute: none,
  copyright: none,
  license: none,
  // Watermark
  watermark-text: none,
  watermark-image: none,
  watermark-opacity: 10%,
  watermark-angle: -45deg,
  watermark-size: 4em,
  watermark-colour: gray,
  // Typography
  font-body: "Alegreya Sans",
  font-headings: "Alegreya Sans",
  font-code: "Fira Code",
  font-size: 11pt,
  heading-weight: "bold",
  heading-style: "normal",
  heading-colour: none,
  heading-line-height: 0.65em,
  title-size: 24pt,
  subtitle-size: 14pt,
  abstract-title: "Abstract",
  keywords-title: "Keywords",
  // Page Layout
  paper: "a4",
  margin: (top: 2.5cm, bottom: 2.5cm, left: 2.5cm, right: 2.5cm),
  cols: 1,
  column-gutter: 1em,
  lang: "en",
  region: "GB",
  // Document Structure
  section-numbering: none,
  section-pagebreak: false,
  section-page: false,
  toc-depth: 3,
  has-outlines: false,
  page-break-inside: auto,
  // Table Styling
  table-stroke: auto,
  table-inset: 6pt,
  table-fill: none,
  // Quote Styling
  quote-width: 90%,
  quote-align: center,
  // Figure and Link Styling
  figure-placement: none, // Keep figures/tables in their sections (use 'auto' for floating)
  link-underline: true,
  link-underline-opacity: 50%,
  link-colour: none,
  // Content
  body,
) = {
  // Resolve colours based on mode with optional colour overrides
  let colours = mcanouil-colours(
    mode: brand-mode,
    colour-background: colour-background,
    colour-foreground: colour-foreground,
    colour-muted: colour-muted,
  )

  // Automatically disable title-page mode when there's no title
  let title-page = if title == none { false } else { title-page }

  // Define content margins for professional style (asymmetric, used after title block)
  // Professional style uses wider left margin to accommodate margin section
  let content-margin = if (
    style == "professional" and margin == (top: 2.5cm, bottom: 2.5cm, left: 2.5cm, right: 2.5cm)
  ) {
    (top: 4cm, bottom: 2.5cm, left: 3cm, right: 2.5cm)
  } else {
    margin
  }

  // Initial margin: symmetric for professional style (title block pages)
  // This ensures pages with title block have equal left/right margins
  // Asymmetric margins are applied after the title block
  let margin = if (
    style == "professional" and margin == (top: 2.5cm, bottom: 2.5cm, left: 2.5cm, right: 2.5cm)
  ) {
    (top: 4cm, bottom: 2.5cm, left: 2.5cm, right: 2.5cm)
  } else {
    content-margin
  }

  // Process page-break-inside configuration
  let breakable-settings = process-breakable-settings(page-break-inside)

  // Get first author information for footer
  let first-author = if authors.len() > 0 {
    format-author-name(authors.at(0))
  } else {
    none
  }

  let first-author-contact = if authors.len() > 0 {
    format-author-contact(authors.at(0))
  } else {
    none
  }

  // Get first author affiliation name for professional footer fallback
  let first-author-affiliation = if authors.len() > 0 {
    let author = authors.at(0)
    if author.affiliations != none and author.affiliations.len() > 0 {
      let first-aff = author.affiliations.at(0)
      if has-content(first-aff.name) {
        first-aff.name
      } else {
        none
      }
    } else {
      none
    }
  } else {
    none
  }

  // Get first author URL for professional footer fallback
  let first-author-url = if authors.len() > 0 {
    let author = authors.at(0)
    if has-content(author.url) {
      let url-str = if type(author.url) == str {
        author.url
      } else {
        content-to-string(author.url)
      }
      url-str.replace("\\/", "/").replace("https://", "").replace("http://", "")
    } else {
      none
    }
  } else {
    none
  }

  // Determine footer left content based on style
  let footer-left-content = if style == "professional" {
    // Priority: institute → affiliation → URL → none
    if institute != none {
      institute
    } else if first-author-affiliation != none {
      first-author-affiliation
    } else if first-author-url != none {
      first-author-url
    } else {
      none
    }
  } else {
    // Academic style: use first author
    first-author
  }

  // Determine footer right content based on style
  let footer-right-content = if style == "professional" {
    // Combine copyright and license when both available
    if copyright != none and license != none {
      [#copyright · #license]
    } else if copyright != none {
      copyright
    } else if license != none {
      license
    } else {
      none
    }
  } else {
    // Academic style: use contact info
    first-author-contact
  }

  // Document metadata for PDF properties (requires strings, not content)
  // Note: Only include optional fields if they have values (Typst doesn't accept none for some fields)
  let doc-params = (
    author: authors.map(a => format-author-name-str(a)),
  )

  if title != none {
    doc-params.insert("title", content-to-string(title))
  }

  if keywords != () {
    doc-params.insert("keywords", keywords)
  }

  if date != none {
    doc-params.insert("date", auto)
  }

  set document(..doc-params)

  // Initialize margin state with initial margin value
  // This allows header/footer/margin-section to access current margins dynamically
  current-margin-state.update(margin)

  // Page setup with header, footer, and margin decorations
  // When title-page is enabled, first page has no header/footer and geometric background
  // Headers and footers are marked as PDF artifacts for accessibility
  set page(
    paper: paper,
    margin: margin,
    fill: colours.background,
    header: context {
      if title-page and counter(page).get().first() == 1 {
        none
      } else {
        pdf.artifact(
          mcanouil-header(
            style: style,
            title: title,
            subtitle: subtitle,
            logo: logo,
            logo-light: logo-light,
            logo-dark: logo-dark,
            logo-alt: logo-alt,
            brand-mode: brand-mode,
            colours: colours,
            show-logo: show-logo,
          ),
        )
      }
    },
    footer: context {
      if title-page and counter(page).get().first() == 1 {
        none
      } else {
        pdf.artifact(
          mcanouil-footer(
            style: style,
            left-content: footer-left-content,
            right-content: footer-right-content,
            colours: colours,
          ),
        )
      }
    },
    background: context {
      {
        if title-page and counter(page).get().first() == 1 {
          if show-title-page-background {
            title-page-background(colours, margin: margin)
          }
        } else if show-margin-decoration and style == "academic" {
          // Only show margin decoration when style is academic
          margin-decoration(
            colours,
            margin: margin,
            decorate-left: true,
            decorate-right: true,
            decorate-top: true,
            decorate-bottom: true,
            width: 0.25cm,
          )
        }

        // Display section in margin (professional style shows vertical section title)
        margin-section(
          style: style,
          colours: colours,
          margin: margin,
        )

        // Apply watermark on all pages
        apply-watermark(
          watermark-text: watermark-text,
          watermark-image: watermark-image,
          watermark-opacity: watermark-opacity,
          watermark-angle: watermark-angle,
          watermark-size: watermark-size,
          watermark-colour: watermark-colour,
        )
      }
    },
  )

  // Text defaults
  set text(
    font: font-body,
    size: font-size,
    fill: colours.foreground,
    lang: lang,
    region: region,
    hyphenate: true, // Enable hyphenation for better text flow
  )

  // Paragraph settings
  set par(
    justify: paragraph-settings.justify,
    leading: paragraph-settings.leading,
    first-line-indent: paragraph-settings.first-line-indent,
  )

  // Monospace font for code
  show raw: set text(font: font-code)

  // Section numbering (will be overridden in special section modes)
  set heading(numbering: section-numbering)

  // Show rules - each defined in show-rules.typ for better readability

  // Reset figure counter at level 1 headings for section-prefixed numbering
  show heading.where(level: 1): it => {
    counter(figure).update(0)
    it
  }

  // Heading styles
  show heading: it => {
    apply-heading-style(
      it,
      colours,
      font-headings,
      section-pagebreak,
      show-heading-underlines,
      section-page: section-page,
      margin: margin,
      cols: cols,
      toc-depth: toc-depth,
      heading-weight: heading-weight,
      heading-style: heading-style,
      heading-colour: heading-colour,
      heading-line-height: heading-line-height,
    )
  }

  // Link styling
  show link: it => apply-link-style(it, colours, link-colour, link-underline, link-underline-opacity)

  // Code block styling
  show raw.where(block: true): it => apply-code-block-style(it, colours, breakable-settings)

  // Inline code styling
  show raw.where(block: false): it => apply-inline-code-style(it, colours)

  // Blockquote styling
  show quote.where(block: true): it => apply-quote-style(it, colours, quote-width, quote-align, breakable-settings)

  // Definition list styling
  show terms: it => apply-terms-style(it, colours, breakable-settings)

  // Table styling with customisation options
  set table(
    inset: table-inset,
    stroke: if table-stroke == auto {
      0.5pt + colours.foreground
    } else {
      table-stroke
    },
    fill: if table-fill == "alternating" {
      (x, y) => if calc.odd(y) { colour-mix(colours, 97%) } else { none }
    } else {
      table-fill
    },
  )

  // Table show rule
  show table: it => apply-table-style(it, breakable-settings)

  // Table header styling
  show table.cell.where(y: 0): set text(weight: "bold")

  // Figure placement control
  set figure(placement: figure-placement)

  // Figure numbering
  // Uses section-type state (updated by Lua filter for special sections)
  // and counter(heading).get() to derive section-prefixed figure numbers.
  // This approach avoids context/here() issues with outline().
  set figure(numbering: (..num) => {
    let h-count = counter(heading).get()
    let fig-num = num.pos().first()
    let stype = section-type.get()

    if h-count.len() > 0 and h-count.first() > 0 {
      // Determine prefix based on section type
      let prefix = if stype == "appendix" {
        numbering("A", h-count.first())
      } else if stype == "supplementary" {
        numbering("I", h-count.first())
      } else {
        str(h-count.first())
      }
      [#prefix.#fig-num]
    } else {
      str(fig-num)
    }
  })

  // Expand auto-width boxes containing images to full width
  // This allows images inside boxes (e.g., in callouts) to be horizontally centred
  // All existing box properties (stroke, radius, clip, inset) are preserved
  // to avoid stripping styling from image-border boxes
  show box.where(width: auto): it => {
    if it.body != none and it.body.func() == image {
      box(
        width: 100%,
        height: it.height,
        baseline: it.baseline,
        fill: it.fill,
        stroke: it.stroke,
        radius: it.radius,
        inset: it.inset,
        outset: it.outset,
        clip: it.clip,
        it.body,
      )
    } else {
      it
    }
  }

  // Figure show rule
  show figure: it => apply-figure-style(it, colours)

  // Callout show rule
  show figure.where(kind: it => type(it) == str and it.starts-with("quarto-callout-")): it => {
    apply-callout-style(it, colours, breakable-settings)
  }

  // Title block
  if title != none or subtitle != none or authors.len() > 0 or date != none or abstract != none {
    mcanouil-title-block(
      title: title,
      subtitle: subtitle,
      authors: authors,
      date: date,
      abstract: abstract,
      keywords: keywords,
      colours: colours,
      show-corner-brackets: show-corner-brackets,
      orcid-icon: orcid-icon,
      has-outlines: has-outlines,
      title-page: title-page,
      logo: logo,
      logo-light: logo-light,
      logo-dark: logo-dark,
      logo-width: logo-width,
      logo-height: logo-height,
      logo-inset: logo-inset,
      logo-alt: logo-alt,
      brand-mode: brand-mode,
      title-size: title-size,
      subtitle-size: subtitle-size,
      abstract-title: abstract-title,
      keywords-title: keywords-title,
    )
  }

  // Main content (columns applied via set page in typst-show.typ after outlines)
  // This ensures title block and outlines render in single column
  // For professional style, switch to asymmetric margins after title block
  if style == "professional" and margin != content-margin {
    // Update margin state and apply asymmetric content margins after title block
    current-margin-state.update(content-margin)
    set page(margin: content-margin)
    body
  } else {
    body
  }
}
