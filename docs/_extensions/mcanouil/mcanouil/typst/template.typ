// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Pandoc template main file
// Composes all partials into final document

$libs.typ()$

// $if(highlighting-definitions)$
// $highlighting-definitions$
// $endif$

$show-rules.typ()$

$typst-template.typ()$

// Document type templates (must be loaded after shared components)
$report.typ()$
$invoice.typ()$
$letter.typ()$
$cv.typ()$
$document-type-dispatcher.typ()$

$for(header-includes)$
$header-includes$
$endfor$

$typst-show.typ()$

$for(include-before)$
$include-before$
$endfor$

$body$

$notes.typ()$

$biblio.typ()$

$for(include-after)$
$include-after$
$endfor$
