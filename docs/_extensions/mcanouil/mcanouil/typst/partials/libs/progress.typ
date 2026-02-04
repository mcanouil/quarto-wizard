// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
/// Progress bar component for visualising completion and proportions

/// Render a progress bar
/// @param value Progress value (0-100)
/// @param label Optional label text displayed above the bar
/// @param colour Colour type or custom colour (default: "info")
/// @param height Bar height (default: 1.5em)
/// @param show-percentage Whether to show percentage label (default: true)
/// @param colours Colour dictionary from brand mode
/// @return Formatted progress bar
#let render-progress(
  value: 0,
  label: none,
  colour: "info",
  height: 1.5em,
  show-percentage: true,
  colours: none,
) = {
  if colours == none {
    panic("colours parameter is required for render-progress")
  }

  // Ensure value is between 0 and 100
  let progress-value = calc.max(0, calc.min(100, value))
  let progress-ratio = progress-value / 100

  // Get progress bar colour using centralised semantic-colour function
  let bar-colour = semantic-colour(colour, colours)

  // Wrap entire progress bar in non-breakable block
  block(
    breakable: false,
    above: 1em,
    below: 1em,
    {
      // Label above bar (if provided)
      if label != none {
        text(size: 0.95em, weight: "semibold", fill: colours.foreground)[#label]
        v(0.3em)
      }

      // Progress bar container
      block(
        width: 100%,
        height: height,
        fill: colour-mix-adaptive(colours, 92%),
        stroke: 1pt + colour-mix-adaptive(colours, 80%),
        radius: calc.min(height / 2, 0.5em),
        clip: true,
      )[
        // Filled portion
        #place(
          left,
          box(
            width: progress-ratio * 100%,
            height: 100%,
            fill: bar-colour,
          ),
        )

        // Percentage label overlay (centred)
        #if show-percentage {
          place(
            center + horizon,
            box(
              fill: colours.background.transparentize(20%),
              inset: (x: 0.5em, y: 0.2em),
              radius: 0.3em,
              text(
                size: 0.85em,
                weight: "bold",
                fill: colours.foreground,
              )[#progress-value%],
            ),
          )
        }
      ]
    },
  )
}
