export const ACCENT_COLORS = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
] as const
export type AccentColor = (typeof ACCENT_COLORS)[number]

export const SURFACE_COLORS = ["slate", ...ACCENT_COLORS] as const
export type SurfaceColor = (typeof SURFACE_COLORS)[number]

export const SURFACE_STYLES = ["default", "glassmorphism"] as const
export type SurfaceStyle = (typeof SURFACE_STYLES)[number]

export const BACKGROUND_STYLES = ["solid", "gradient"] as const
export type BackgroundStyle = (typeof BACKGROUND_STYLES)[number]

export const FONT_FAMILIES = [
  "default",
  "editorial",
  "modern",
  "humanist",
  "technical",
] as const
export type FontFamily = (typeof FONT_FAMILIES)[number]

export const MODES = ["light", "dark", "system"] as const
export type Mode = (typeof MODES)[number]

export type ResolvedMode = "light" | "dark"

export type ColorScale = Record<
  50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950,
  string
>

export interface SurfaceStyleRecipe {
  name: SurfaceStyle
  label: string
  description: string
  tokens: {
    surfaceRaised: (scale: ColorScale, mode: ResolvedMode) => string
    surfaceOverlay: (scale: ColorScale, mode: ResolvedMode) => string
    surfaceSunken: (scale: ColorScale, mode: ResolvedMode) => string
    surfaceSidebar: (scale: ColorScale, mode: ResolvedMode) => string
    surfaceHeader: (scale: ColorScale, mode: ResolvedMode) => string
    borderSubtle: (scale: ColorScale, mode: ResolvedMode) => string
    borderDefault: (scale: ColorScale, mode: ResolvedMode) => string
  }
  overrides: {
    radius: string
    shadowCard: string
    shadowDropdown: string
    backdropBlur: string
    surfaceOpacity: string
    foreground?: (scale: ColorScale, mode: ResolvedMode) => string
    border?: (scale: ColorScale, mode: ResolvedMode) => string
    input?: (scale: ColorScale, mode: ResolvedMode) => string
  }
}

export interface ThemeContextValue {
  accentColor: AccentColor
  surfaceColor: SurfaceColor
  surfaceStyle: SurfaceStyle
  backgroundStyle: BackgroundStyle
  fontFamily: FontFamily
  mode: Mode
  resolvedMode: ResolvedMode
  setAccentColor: (color: AccentColor) => void
  setSurfaceColor: (color: SurfaceColor) => void
  setSurfaceStyle: (style: SurfaceStyle) => void
  setBackgroundStyle: (style: BackgroundStyle) => void
  setFontFamily: (font: FontFamily) => void
  setMode: (mode: Mode) => void
}
