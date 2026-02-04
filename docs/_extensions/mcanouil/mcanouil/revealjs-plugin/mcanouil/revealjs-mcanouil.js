/**
 * MCanouil Reveal.js Plugin
 *
 * A comprehensive Reveal.js plugin providing:
 * - Section slide detection and outline generation.
 * - Date superscript formatting (1st, 2nd, 3rd).
 * - Favicon generation from slide logo.
 * - Title slide chrome visibility (menu/logo/footer/slide-number).
 *
 * @license MIT
 * @copyright 2026 Mickaël Canouil
 * @author Mickaël Canouil
 * @version 1.0.0
 */

window.RevealJsMCanouil = function () {
  "use strict";

  // Default configuration
  const defaults = {
    sectionOutline: true,
    dateSuperscript: true,
    faviconFromLogo: true,
    hideTitleSlideChrome: true,
    debugBorders: false,
  };

  let config = {};

  // =========================================================================
  // SECTION SLIDES
  // =========================================================================

  /**
   * Get direct h1 child of a section (not inherited from nested sections).
   * @param {Element} section - Section element.
   * @returns {Element|null} The h1 element if found.
   */
  function getDirectH1(section) {
    for (const child of section.children) {
      if (child.tagName === "H1") {
        return child;
      }
    }
    return null;
  }

  /**
   * Wrap heading in banner structure.
   * @param {Element} slide - Slide element.
   * @param {Element} heading - H1 heading element.
   */
  function wrapInBanner(slide, heading) {
    if (heading.parentElement.classList.contains("section-banner")) {
      return;
    }

    const banner = document.createElement("div");
    banner.className = "section-banner";

    slide.insertBefore(banner, slide.firstChild);
    banner.appendChild(heading);
  }

  /**
   * Collect subsections (h2 headings) from sibling slides until next section.
   * Skips duplicated headings (only first occurrence is included) and
   * headings marked with .unlisted class.
   * @param {Element} sectionSlide - The section slide element.
   * @returns {Array} Array of subsection objects with text and id.
   */
  function collectSubsections(sectionSlide) {
    const subsections = [];
    const seenTexts = new Set();
    const parent = sectionSlide.parentElement;

    if (parent?.tagName === "SECTION") {
      // Nested structure: collect h2s from sibling sections within the stack
      let foundCurrent = false;

      for (const sibling of parent.children) {
        if (sibling === sectionSlide) {
          foundCurrent = true;
          continue;
        }
        if (!foundCurrent || sibling.tagName !== "SECTION") continue;

        if (getDirectH1(sibling)) break;

        // Skip unlisted slides
        if (sibling.classList.contains("unlisted")) continue;

        const h2 = sibling.querySelector("h2");
        if (h2) {
          // Skip unlisted headings
          if (h2.classList.contains("unlisted")) continue;

          const text = h2.textContent.trim();
          const normalisedText = text.toLowerCase();

          // Skip duplicates
          if (seenTexts.has(normalisedText)) continue;
          seenTexts.add(normalisedText);

          subsections.push({
            text: text,
            id: sibling.id || "",
          });
        }
      }
    } else {
      // Flat structure: collect from following top-level sections
      let current = sectionSlide.nextElementSibling;

      while (current) {
        if (current.tagName !== "SECTION") {
          current = current.nextElementSibling;
          continue;
        }

        if (
          getDirectH1(current) ||
          current.querySelector(":scope > section > h1")
        ) {
          break;
        }

        // Skip unlisted slides
        if (current.classList.contains("unlisted")) {
          current = current.nextElementSibling;
          continue;
        }

        const h2 = current.querySelector("h2");
        if (h2) {
          // Skip unlisted headings
          if (h2.classList.contains("unlisted")) {
            current = current.nextElementSibling;
            continue;
          }

          const text = h2.textContent.trim();
          const normalisedText = text.toLowerCase();

          // Skip duplicates
          if (seenTexts.has(normalisedText)) {
            current = current.nextElementSibling;
            continue;
          }
          seenTexts.add(normalisedText);

          subsections.push({
            text: text,
            id: current.id || "",
          });
        }

        current = current.nextElementSibling;
      }
    }

    return subsections;
  }

  /**
   * Add subsection outline to section slide.
   * @param {Element} slide - Section slide element.
   * @param {Array} subsections - Array of subsection objects.
   */
  function addSectionOutline(slide, subsections) {
    const outline = document.createElement("div");
    outline.className = "section-outline";
    outline.setAttribute("role", "navigation");
    outline.setAttribute("aria-label", "Section outline");

    const ul = document.createElement("ul");
    ul.setAttribute("role", "list");

    for (const sub of subsections) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = `#/${sub.id}`;
      a.textContent = sub.text;
      a.setAttribute("title", `Jump to: ${sub.text}`);
      li.appendChild(a);
      ul.appendChild(li);
    }

    outline.appendChild(ul);
    slide.insertBefore(outline, slide.firstChild);
  }

  /**
   * Process section slides (level-1 headings) and add styling/outlines.
   * @param {Object} cfg - Plugin configuration.
   */
  function processSectionSlides(cfg) {
    const allSections = document.querySelectorAll(".reveal .slides section");
    const sectionSlides = [];

    for (const section of allSections) {
      if (
        section.classList.contains("quarto-title-block") ||
        section.classList.contains("mcanouil-title-slide")
      ) {
        continue;
      }

      const h1 = getDirectH1(section);
      if (h1) {
        sectionSlides.push({ section, h1 });
        section.classList.add("section-slide");
        wrapInBanner(section, h1);
      }
    }

    if (cfg.sectionOutline) {
      for (const { section } of sectionSlides) {
        const subsections = collectSubsections(section);
        if (subsections.length > 0) {
          addSectionOutline(section, subsections);
        }
      }
    }
  }

  // =========================================================================
  // DATE SUPERSCRIPT
  // =========================================================================

  /**
   * Convert ordinal day numbers (1st, 2nd, 3rd, etc.) to superscript format.
   */
  function formatDates() {
    const selectors = [
      ".mcanouil-title-slide .date",
      ".quarto-title-block .date",
      ".title-content .date",
      "p.date",
      ".date",
      "div.listing-date",
    ];

    const dateElements = document.querySelectorAll(selectors.join(", "));

    for (const el of dateElements) {
      el.innerHTML = el.innerHTML.replace(
        /(\d+)(st|nd|rd|th)\b/gi,
        "$1<sup>$2</sup>"
      );
    }
  }

  // =========================================================================
  // FAVICON FROM LOGO
  // =========================================================================

  /**
   * Update or create a favicon link element.
   * @param {string} rel - Link rel attribute.
   * @param {string} href - Favicon URL.
   * @param {string} type - MIME type.
   */
  function updateFaviconLink(rel, href, type) {
    let link = document.querySelector(`link[rel="${rel}"]`);
    if (!link) {
      link = document.createElement("link");
      link.rel = rel;
      document.head.appendChild(link);
    }
    link.type = type;
    link.href = href;
  }

  /**
   * Automatically generate favicon from the presentation logo.
   */
  function setFaviconFromLogo() {
    const logo = document.querySelector("img.slide-logo[src]");
    if (!logo) return;

    const logoSrc = logo.getAttribute("src");
    if (!logoSrc) return;

    const extension = logoSrc.split(".").pop().toLowerCase();
    const mimeTypes = {
      svg: "image/svg+xml",
      png: "image/png",
      ico: "image/x-icon",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
    };
    const mimeType = mimeTypes[extension] || "image/png";

    updateFaviconLink("icon", logoSrc, mimeType);
    updateFaviconLink("shortcut icon", logoSrc, mimeType);
  }

  // =========================================================================
  // TITLE SLIDE CHROME VISIBILITY
  // =========================================================================

  /**
   * Update menu button, logo, slide number, and footer visibility.
   * Hide on title slide, show on all other slides.
   */
  function updateTitleSlideChrome() {
    const currentSlide = document.querySelector(
      ".reveal .slides > section.present, .reveal .slides > section > section.present"
    );
    const isTitle =
      currentSlide?.classList.contains("mcanouil-title-slide") ||
      currentSlide?.classList.contains("quarto-title-block");

    const display = isTitle ? "none" : "";

    const elements = [
      ".slide-menu-button",
      "div.has-logo > img.slide-logo",
      ".reveal .slide-number",
      ".reveal .footer",
    ];

    for (const selector of elements) {
      const el = document.querySelector(selector);
      if (el) {
        el.style.display = display;
      }
    }
  }

  // =========================================================================
  // DEBUG BORDERS
  // =========================================================================

  /**
   * Apply debug borders to all slides for overflow detection.
   */
  function applyDebugBorders() {
    const slidesContainer = document.querySelector(".reveal .slides");
    if (slidesContainer) {
      slidesContainer.style.outline = "2px dashed magenta";
      slidesContainer.style.outlineOffset = "-2px";
    }

    const sections = document.querySelectorAll(".reveal .slides > section");

    for (const section of sections) {
      let borderColour = "red";

      if (
        section.classList.contains("mcanouil-title-slide") ||
        section.classList.contains("mcanouil-closing-slide")
      ) {
        borderColour = "green";
      } else if (section.classList.contains("section-slide")) {
        borderColour = "orange";
      }

      section.style.border = `3px solid ${borderColour}`;
      section.style.boxSizing = "border-box";

      const nestedSections = section.querySelectorAll("section");
      for (const nested of nestedSections) {
        nested.style.border = "3px solid blue";
        nested.style.boxSizing = "border-box";
      }
    }
  }

  // =========================================================================
  // SOCIAL HANDLES
  // =========================================================================

  /**
   * Process social handle elements to extract just the handle from URLs.
   */
  function processSocialHandles() {
    const handles = document.querySelectorAll(".social-handle");

    for (const handle of handles) {
      let text = handle.textContent.trim();

      const lastSlashIndex = text.lastIndexOf("/");
      if (lastSlashIndex !== -1 && lastSlashIndex < text.length - 1) {
        text = text.substring(lastSlashIndex + 1);
      }

      try {
        text = decodeURIComponent(text);
      } catch {
        // Keep original if decoding fails
      }

      const parent = handle.closest(".social-link");
      if (parent) {
        const needsAtPrefix =
          parent.classList.contains("github") ||
          parent.classList.contains("bluesky") ||
          parent.classList.contains("mastodon");

        if (needsAtPrefix && !text.startsWith("@")) {
          text = `@${text}`;
        }
      }

      handle.textContent = text;
    }
  }

  // =========================================================================
  // PLUGIN RETURN
  // =========================================================================

  return {
    id: "mcanouil-revealjs",

    init: function (deck) {
      const deckConfig = deck.getConfig();

      // Read from extensions.mcanouil namespace
      const mcanouil = deckConfig["extensions"]?.["mcanouil"] || {};

      // Build config from extensions.mcanouil.* options
      config = {
        ...defaults,
        sectionOutline: mcanouil["section-outline"] ?? defaults.sectionOutline,
        dateSuperscript: mcanouil["date-superscript"] ?? defaults.dateSuperscript,
        faviconFromLogo: mcanouil["favicon-from-logo"] ?? defaults.faviconFromLogo,
        hideTitleSlideChrome:
          mcanouil["hide-title-slide-chrome"] ?? defaults.hideTitleSlideChrome,
        debugBorders: mcanouil["debug-borders"] ?? defaults.debugBorders,
      };

      deck.on("ready", function () {
        if (config.sectionOutline) {
          processSectionSlides(config);
        }
        if (config.dateSuperscript) {
          formatDates();
        }
        if (config.faviconFromLogo) {
          setFaviconFromLogo();
        }
        if (config.hideTitleSlideChrome) {
          updateTitleSlideChrome();
        }
        if (config.debugBorders) {
          applyDebugBorders();
        }
        processSocialHandles();
      });

      if (config.hideTitleSlideChrome) {
        deck.on("slidechanged", updateTitleSlideChrome);
      }
    },
  };
};
