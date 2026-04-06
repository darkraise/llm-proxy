import type { FontFamily } from "../types"
import { fontFamilies } from "../palettes/font-families"

const loadedFonts = new Set<FontFamily>(["default"])

export function loadFont(family: FontFamily): void {
  if (loadedFonts.has(family)) return

  const definition = fontFamilies[family]
  if (!definition.googleFontsUrl) {
    loadedFonts.add(family)
    return
  }

  const link = document.createElement("link")
  link.rel = "stylesheet"
  link.href = definition.googleFontsUrl
  document.head.appendChild(link)
  loadedFonts.add(family)
}

export function applyFontFamily(family: FontFamily): void {
  const definition = fontFamilies[family]
  const style = document.documentElement.style
  style.setProperty("--theme-font-sans", definition.sans)
  style.setProperty("--theme-font-heading", definition.heading)
  style.setProperty("--theme-font-mono", definition.mono)
}
