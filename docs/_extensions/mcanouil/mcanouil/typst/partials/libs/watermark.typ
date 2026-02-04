// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
/// Watermark component for documents

// ============================================================================
// Constants
// ============================================================================

#let WATERMARK-DEFAULT-OPACITY = 10%
#let WATERMARK-DEFAULT-ANGLE = -45deg
#let WATERMARK-DEFAULT-SIZE = 4em
#let WATERMARK-DEFAULT-COLOUR = gray

// ============================================================================
// Watermark rendering functions
// ============================================================================

/// Render a text watermark
/// @param content Watermark text to display
/// @param opacity Transparency of watermark (0-100%)
/// @param angle Rotation angle (default: -45deg for diagonal)
/// @param size Font size for text watermark
/// @param colour Text colour
/// @return Content Watermark content
#let render-text-watermark(
  content,
  opacity: WATERMARK-DEFAULT-OPACITY,
  angle: WATERMARK-DEFAULT-ANGLE,
  size: WATERMARK-DEFAULT-SIZE,
  colour: WATERMARK-DEFAULT-COLOUR,
) = {
  rotate(
    angle,
    text(
      size: size,
      fill: colour.transparentize(100% - opacity),
      weight: "bold",
    )[#content],
  )
}

/// Render an image watermark
/// @param image-path Path to watermark image file
/// @param opacity Transparency of watermark (0-100%)
/// @param angle Rotation angle (default: 0deg)
/// @param width Width of image watermark
/// @return Content Watermark content
#let render-image-watermark(
  image-path,
  opacity: WATERMARK-DEFAULT-OPACITY,
  angle: 0deg,
  width: 50%,
) = {
  rotate(
    angle,
    box(
      image(image-path, width: width),
      fill: none.transparentize(100% - opacity),
    ),
  )
}

/// Apply watermark to page background
/// Watermarks are marked as PDF artifacts for accessibility
/// @param watermark-text Text for watermark (if provided)
/// @param watermark-image Path to image for watermark (if provided)
/// @param watermark-opacity Transparency (0-100%, default: 10%)
/// @param watermark-angle Rotation angle (default: -45deg)
/// @param watermark-size Size for text watermark (default: 4em)
/// @param watermark-colour Colour for text watermark (default: gray)
/// @param watermark-position Position (center, top, bottom, etc.)
/// @return Content Watermark background
#let apply-watermark(
  watermark-text: none,
  watermark-image: none,
  watermark-opacity: WATERMARK-DEFAULT-OPACITY,
  watermark-angle: WATERMARK-DEFAULT-ANGLE,
  watermark-size: WATERMARK-DEFAULT-SIZE,
  watermark-colour: WATERMARK-DEFAULT-COLOUR,
  watermark-position: center + horizon,
) = {
  if watermark-text != none and watermark-text != "" {
    // Text watermark - marked as artifact for accessibility
    pdf.artifact(
      place(
        watermark-position,
        render-text-watermark(
          watermark-text,
          opacity: watermark-opacity,
          angle: watermark-angle,
          size: watermark-size,
          colour: watermark-colour,
        ),
      ),
    )
  } else if watermark-image != none and watermark-image != "" {
    // Image watermark - marked as artifact for accessibility
    pdf.artifact(
      place(
        watermark-position,
        render-image-watermark(
          watermark-image,
          opacity: watermark-opacity,
          angle: watermark-angle,
        ),
      ),
    )
  }
}
