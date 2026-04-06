import type { FontFamily } from "../types"

export interface FontFamilyDefinition {
  name: FontFamily
  label: string
  description: string
  sans: string
  heading: string
  mono: string
  googleFontsUrl: string | null
}

export const fontFamilies: Record<FontFamily, FontFamilyDefinition> = {
  default: {
    name: "default",
    label: "Default",
    description: "Inter + JetBrains Mono",
    sans: "Inter",
    heading: "Inter",
    mono: "JetBrains Mono",
    googleFontsUrl: null,
  },
  editorial: {
    name: "editorial",
    label: "Editorial",
    description: "Source Sans 3 + Playfair Display headings",
    sans: "Source Sans 3",
    heading: "Playfair Display",
    mono: "Source Code Pro",
    googleFontsUrl:
      "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Source+Code+Pro:wght@400;500&family=Source+Sans+3:wght@400;500;600;700&display=swap",
  },
  modern: {
    name: "modern",
    label: "Modern",
    description: "Geist + Geist Mono",
    sans: "Geist",
    heading: "Geist",
    mono: "Geist Mono",
    googleFontsUrl:
      "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap",
  },
  humanist: {
    name: "humanist",
    label: "Humanist",
    description: "DM Sans + DM Mono",
    sans: "DM Sans",
    heading: "DM Sans",
    mono: "DM Mono",
    googleFontsUrl:
      "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&display=swap",
  },
  technical: {
    name: "technical",
    label: "Technical",
    description: "JetBrains Mono + Inter",
    sans: "JetBrains Mono",
    heading: "JetBrains Mono",
    mono: "JetBrains Mono",
    googleFontsUrl: null,
  },
}
