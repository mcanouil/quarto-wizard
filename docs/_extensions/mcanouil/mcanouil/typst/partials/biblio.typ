// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Bibliography configuration
// Pandoc template partial for rendering bibliographies

// ============================================================================
// Bibliography setup
// ============================================================================

$if(citations)$
$if(csl)$

#set bibliography(style: "$csl$")
$elseif(bibliographystyle)$

#set bibliography(style: "$bibliographystyle$")
$endif$
$if(bibliography)$
// TODO: Add suppress-bibliography support for citation-location: margin
// When marginalia integration is implemented, uncomment the following
// to hide the bibliography when full citations appear in margins:
// $if(suppress-bibliography)$
// #show bibliography: none
// $endif$

#bibliography(($for(bibliography)$"$bibliography$"$sep$,$endfor$))
$endif$
$endif$
