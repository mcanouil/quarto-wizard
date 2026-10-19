/** The label fills of the scene files read on a dark background; each has a darker variant for white. */
export const LIGHT_COLOURS = {
	"#9be38a": "#1b6e1f",
	"#f4a261": "#a84d00",
	"#f5d76e": "#7a6000",
	"#7fb2ff": "#0b57d0",
	"#ff8a80": "#c62828",
	"#c39bff": "#6a3fc4",
	"#ff7ad9": "#a8176f",
	"#6fe3e3": "#006a70",
	"#ffffff": "#1f1f1f",
};

/** The outline is the background colour of the theme, so a label reads on either theme. */
export const OUTLINE = { dark: "#1f1f1f", light: "#ffffff" };

/**
 * @param {{ text: string, colour: string }[]} labels
 * @param {"dark" | "light"} theme
 */
export function labelsForTheme(labels, theme) {
	return labels.map((label) => {
		const colour = theme === "dark" ? label.colour : (label.colourLight ?? LIGHT_COLOURS[label.colour]);
		if (!colour) {
			throw new Error(`Label "${label.text}": no light variant for the colour ${label.colour}.`);
		}
		return { ...label, colour, outline: OUTLINE[theme] };
	});
}
