// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Quarto metadata mapping to Typst template
// Maps YAML frontmatter to mcanouil-document dispatcher function parameters.
// The dispatcher routes to the appropriate template based on document-type.
#show: mcanouil-document.with(
// Document Type (report, invoice, letter, cv)

  document-type: $if(document-type)$"$document-type$"$else$"report"$endif$,
// Document Metadata
$if(title)$
  title: [$title$],
$endif$
$if(subtitle)$
  subtitle: [$subtitle$],
$endif$
$if(by-author)$
  authors: (
$for(by-author)$
    (
      name: (
        literal: $if(it.name.literal)$[$it.name.literal$]$else$none$endif$,
        given: $if(it.name.given)$[$it.name.given$]$else$none$endif$,
        family: $if(it.name.family)$[$it.name.family$]$else$none$endif$,
      ),
      degrees: $if(it.degrees)$($for(it.degrees)$"$it$",$endfor$)$else$none$endif$,
      email: $if(it.email)$"$it.email$"$else$none$endif$,
      orcid: $if(it.orcid)$"$it.orcid$"$else$none$endif$,
      url: $if(it.url)$"$it.url$"$else$none$endif$,
      attributes: $if(it.attributes)$(
        corresponding: $if(it.attributes.corresponding)$$it.attributes.corresponding$$else$false$endif$,
      )$else$none$endif$,
      affiliations: $if(it.affiliations)$(
$for(it.affiliations)$
        (
          name: $if(it.name)$[$it.name$]$else$none$endif$,
          department: $if(it.department)$[$it.department$]$else$none$endif$,
          city: $if(it.city)$[$it.city$]$else$none$endif$,
          country: $if(it.country)$[$it.country$]$else$none$endif$,
        ),
$endfor$
      )$else$()$endif$,
    ),
$endfor$
  ),
$else$
  authors: (),
$endif$
$if(date)$
  date: [$date$],
$endif$
$if(abstract)$
  abstract: [$abstract$],
$endif$
$if(keywords)$
  keywords: ($for(keywords)$"$keywords$",$endfor$),
$endif$
// Colour Configuration
$if(brand-mode)$
  brand-mode: "$brand-mode$",
$else$
  brand-mode: "light",
$endif$
$if(colour.background)$
  colour-background: $colour.background$,
$elseif(colour-background)$
  colour-background: $colour-background$,
$elseif(brand)$
  colour-background: brand-color.at("background", default: none),
$endif$
$if(colour.foreground)$
  colour-foreground: $colour.foreground$,
$elseif(colour-foreground)$
  colour-foreground: $colour-foreground$,
$elseif(brand)$
  colour-foreground: brand-color.at("foreground", default: none),
$endif$
$if(colour.muted)$
  colour-muted: $colour.muted$,
$elseif(colour-muted)$
  colour-muted: $colour-muted$,
$endif$
// Decorative Elements
$if(show-corner-brackets)$
  show-corner-brackets: $show-corner-brackets$,
$endif$
$if(show-margin-decoration)$
  show-margin-decoration: $show-margin-decoration$,
$endif$
$if(show-title-page-background)$
  show-title-page-background: $show-title-page-background$,
$endif$
$if(show-heading-underlines)$
  show-heading-underlines: $show-heading-underlines$,
$endif$
// Logo Configuration
$if(logo.enabled)$
  show-logo: $logo.enabled$,
$elseif(show-logo)$
  show-logo: $show-logo$,
$endif$
$if(logo.path)$
  logo: "$logo.path$",
$elseif(logo)$
  logo: "$logo$",
$endif$
$if(logo-light)$
  logo-light: "$logo-light.path$",
$elseif(logo.light)$
  logo-light: "$logo.light$",
$endif$
$if(logo-dark)$
  logo-dark: "$logo-dark.path$",
$elseif(logo.dark)$
  logo-dark: "$logo.dark$",
$endif$
$if(logo.width)$
  logo-width: $logo.width$,
$elseif(logo-width)$
  logo-width: $logo-width$,
$endif$
$if(logo.height)$
  logo-height: $logo.height$,
$elseif(logo-height)$
  logo-height: $logo-height$,
$endif$
$if(logo.inset)$
  logo-inset: $logo.inset$,
$elseif(logo-inset)$
  logo-inset: $logo-inset$,
$endif$
$if(logo.alt)$
  logo-alt: "$logo.alt$",
$elseif(logo-alt)$
  logo-alt: "$logo-alt$",
$endif$
$if(orcid-icon)$
  orcid-icon: "$orcid-icon$",
$endif$
// Title Page
$if(title-page)$
  title-page: $title-page$,
$endif$
// Style
$if(style)$
  style: "$style$",
$endif$
$if(institute)$
  institute: [$institute$],
$endif$
$if(copyright)$
  copyright: [$copyright.statement$],
$endif$
$if(license)$
  license: [$license.text$],
$endif$
// Watermark
$if(watermark.text)$
  watermark-text: "$watermark.text$",
$elseif(watermark-text)$
  watermark-text: "$watermark-text$",
$endif$
$if(watermark.image)$
  watermark-image: "$watermark.image$",
$elseif(watermark-image)$
  watermark-image: "$watermark-image$",
$endif$
$if(watermark.opacity)$
  watermark-opacity: $watermark.opacity$,
$elseif(watermark-opacity)$
  watermark-opacity: $watermark-opacity$,
$endif$
$if(watermark.angle)$
  watermark-angle: $watermark.angle$,
$elseif(watermark-angle)$
  watermark-angle: $watermark-angle$,
$endif$
$if(watermark.size)$
  watermark-size: $watermark.size$,
$elseif(watermark-size)$
  watermark-size: $watermark-size$,
$endif$
$if(watermark.colour)$
  watermark-colour: $watermark.colour$,
$elseif(watermark-colour)$
  watermark-colour: $watermark-colour$,
$endif$
// Typography
$if(mainfont)$
  font-body: "$mainfont$",
$elseif(brand.typography.base.family)$
  font-body: $brand.typography.base.family$,
$endif$
$if(sansfont)$
  font-headings: "$sansfont$",
$elseif(brand.typography.headings.family)$
  font-headings: $brand.typography.headings.family$,
$endif$
$if(codefont)$
  font-code: ($for(codefont)$"$codefont$",$endfor$),
$elseif(brand.typography.monospace.family)$
  font-code: $brand.typography.monospace.family$,
$endif$
$if(fontsize)$
  font-size: $fontsize$,
$elseif(brand.typography.base.size)$
  font-size: $brand.typography.base.size$,
$endif$
$if(heading.weight)$
  heading-weight: "$heading.weight$",
$elseif(heading-weight)$
  heading-weight: "$heading-weight$",
$endif$
$if(heading.style)$
  heading-style: "$heading.style$",
$elseif(heading-style)$
  heading-style: "$heading-style$",
$endif$
$if(heading.colour)$
  heading-colour: $heading.colour$,
$elseif(heading-colour)$
  heading-colour: $heading-colour$,
$endif$
$if(heading.line-height)$
  heading-line-height: $heading.line-height$,
$elseif(heading-line-height)$
  heading-line-height: $heading-line-height$,
$endif$
$if(title-size)$
  title-size: $title-size$,
$endif$
$if(subtitle-size)$
  subtitle-size: $subtitle-size$,
$endif$
$if(labels.abstract)$
  abstract-title: "$labels.abstract$",
$endif$
$if(labels.keywords)$
  keywords-title: "$labels.keywords$",
$endif$
// Page Layout
$if(papersize)$
  paper: "$papersize$",
$endif$
$if(margin)$
  margin: (
    top: $margin.top$,
    bottom: $margin.bottom$,
    left: $margin.left$,
    right: $margin.right$,
  ),
$endif$
$if(columns)$
  cols: $columns$,
$endif$
$if(column-gutter)$
  column-gutter: $column-gutter$,
$endif$
$if(lang)$
  lang: "$lang$",
$endif$
$if(region)$
  region: "$region$",
$endif$
// Document Structure
$if(section-numbering)$
  section-numbering: "$section-numbering$",
$endif$
  section-pagebreak: $section-pagebreak$,
$if(section-page)$
  section-page: $section-page$,
$endif$
$if(toc-depth)$
  toc-depth: $toc-depth$,
$endif$
$if(toc)$
  has-outlines: true,
$elseif(list-of)$
  has-outlines: true,
$endif$
$if(page-break-inside)$
  page-break-inside: $if(page-break-inside.table)$(
    table: $page-break-inside.table$,
    callout: $page-break-inside.callout$,
    code: $page-break-inside.code$,
    quote: $page-break-inside.quote$,
    terms: $page-break-inside.terms$,
  )$else$$page-break-inside$$endif$,
$endif$
// Table Styling
$if(table.stroke)$
  table-stroke: $table.stroke$,
$elseif(table-stroke)$
  table-stroke: $table-stroke$,
$endif$
$if(table.inset)$
  table-inset: $table.inset$,
$elseif(table-inset)$
  table-inset: $table-inset$,
$endif$
$if(table.fill)$
  table-fill: $if(table.fill/pairs)$(
$for(table.fill/pairs)$
    $it.key$: $it.value$,
$endfor$
  )$else$"$table.fill$"$endif$,
$elseif(table-fill)$
  table-fill: "$table-fill$",
$endif$
// Quote Styling
$if(quote.width)$
  quote-width: $quote.width$,
$elseif(quote-width)$
  quote-width: $quote-width$,
$endif$
$if(quote.align)$
  quote-align: $quote.align$,
$elseif(quote-align)$
  quote-align: $quote-align$,
$endif$
// Figure and Link Styling
$if(figure-placement)$
  figure-placement: $figure-placement$,
$endif$
$if(link.underline)$
  link-underline: $link.underline$,
$elseif(link-underline)$
  link-underline: $link-underline$,
$endif$
$if(link.underline-opacity)$
  link-underline-opacity: $link.underline-opacity$,
$elseif(link-underline-opacity)$
  link-underline-opacity: $link-underline-opacity$,
$endif$
$if(link.colour)$
  link-colour: $link.colour$,
$elseif(link-colour)$
  link-colour: $link-colour$,
$endif$
)

// Define brand mode with default fallback to "light"
#let effective-brand-mode = "$if(brand-mode)$$brand-mode$$else$light$endif$"

// Helper to get colours with brand-color support
// Uses brand-color from Quarto's brand.yml integration when available
#let effective-colours() = {
$if(brand)$
  // brand.yml is configured - use brand-color injected by Quarto's typst-brand-yaml.lua filter
  mcanouil-colours(
    mode: effective-brand-mode,
    colour-background: brand-color.at("background", default: none),
    colour-foreground: brand-color.at("foreground", default: none),
  )
$else$
  // No brand.yml - use template defaults
  mcanouil-colours(mode: effective-brand-mode)
$endif$
}

// Override Quarto's brand-color to respect template brand-mode
// This ensures callouts and other Quarto-generated elements use the correct colours
#let brand-colour-override = (
  background: effective-colours().background,
  foreground: effective-colours().foreground,
)

// Wrapper functions for typst-markdown filter
// These inject colours from template brand-mode with brand.yml support

// Wrapper for .highlight divs
#let mcanouil-highlight(content, ..args) = {
  _highlight(content, effective-colours(), ..args)
}

// Image border wrapper - uses template brand-mode colours
#let mcanouil-image-border(content) = {
  image-border(content, effective-colours())
}

// Wrapper for .value-box divs
#let mcanouil-value-box(content, ..args) = {
  render-value-box(colours: effective-colours(), ..args)
}

// Wrapper for .panel divs
#let mcanouil-panel(content, ..args) = {
  render-panel(content, colours: effective-colours(), ..args)
}

// Wrapper for .badge spans
#let mcanouil-badge(content, ..args) = {
  render-badge(content, colours: effective-colours(), ..args)
}

// Wrapper for .divider divs
#let mcanouil-divider(content, ..args) = {
  render-divider(colours: effective-colours(), ..args)
}

// Wrapper for .progress divs
#let mcanouil-progress(content, ..args) = {
  render-progress(colours: effective-colours(), ..args)
}

// Wrapper for .executive-summary divs
#let mcanouil-executive-summary(content, ..args) = {
  render-executive-summary(content, colours: effective-colours(), ..args)
}

// Wrapper for card grid rendering
#let mcanouil-card-grid(cards, ..args) = {
  render-card-grid(cards, effective-colours(), ..args)
}

// Wrapper for standalone .card divs
#let mcanouil-card(content, ..args) = {
  let colours = effective-colours()
  let named = args.named()
  let card-title = named.at("title", default: none)
  let card-footer = named.at("footer", default: none)
  let card-colour = named.at("colour", default: colours.muted)
  let card-style = named.at("style", default: "subtle")
  render-card(
    (
      title: card-title,
      content: content,
      footer: card-footer,
      colour: card-colour,
      style: card-style,
    ),
    colours,
  )
}

// Wrapper for code windows with filename
// Sets state for apply-code-block-style to render as code window
// is-auto: true when filename is auto-generated from language (applies smallcaps)
#let mcanouil-code-window(content, filename: none, is-auto: false) = {
  code-window-filename.update((filename: filename, is-auto: is-auto))
  content
}

// Outlines section (TOC, List of X) on own page(s) when any are enabled
// These sections are rendered in single column mode
$if(toc)$
// Add break before TOC only if there's content before it (title block)
// Uses conditional-break to automatically select colbreak or pagebreak
$if(title)$
#conditional-break()
$endif$

// Native table of contents
// The heading's numbering property is set directly by the Lua filter,
// so the outline automatically displays correct numbering including prefixes
#context {
  // Only render TOC if there are headings to display
  let headings = query(heading).filter(it => it.outlined and it.level <= $toc-depth$)
  if headings.len() > 0 {
    heading(title-case([$toc-title$]), outlined: false, bookmarked: true, numbering: none)
    v(1em)
    // Style level 1 outline entries with extra spacing and bold (scoped to TOC only)
    // Use set text to style as bold for PDF/UA-1 compliance
    {
      show outline.entry.where(level: 1): it => {
        v(0.5em, weak: true)
        set text(weight: "bold")
        it
      }
      outline(
        title: none,
        depth: $toc-depth$,
        indent: 1em,
      )
    }
    conditional-break()
  }
}
$endif$
$if(list-of)$
// Build configuration from Pandoc template variables
// Note: render-list-of-sections handles its own pagebreaks (before each section and after all sections)
#render-list-of-sections((
$for(list-of/pairs)$
  // Only add non-empty keys
  $if(it.key)$$it.key$: "$it.value$",$endif$
$endfor$
))
$endif$

// Apply columns to main content (after title block and outlines)
// This ensures outlines render in single column
$if(columns)$
// Update state to indicate if columns are active (true if > 1)
#columns-active-state.update($columns$ > 1)
// Set page columns (even for columns: 1, which is equivalent to single column)
#set page(columns: $columns$$if(column-gutter)$, column-gutter: $column-gutter$$endif$)
$endif$
