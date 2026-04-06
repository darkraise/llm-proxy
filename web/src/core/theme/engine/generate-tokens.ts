import type {
  AccentColor,
  BackgroundStyle,
  SurfaceColor,
  SurfaceStyle,
  ResolvedMode,
  ColorScale,
  FontFamily,
} from "../types"
import { accentColors, LIGHT_ACCENT_COLORS } from "../palettes/accent-colors"
import { surfaceColors } from "../palettes/surface-colors"
import { surfaceStyles } from "../styles/surface-styles"
import { ACCENT_COLORS } from "../types"
import { fontFamilies } from "../palettes/font-families"

export interface GenerateTokensInput {
  accentColor: AccentColor
  surfaceColor: SurfaceColor
  surfaceStyle: SurfaceStyle
  backgroundStyle: BackgroundStyle
  fontFamily: FontFamily
  mode: ResolvedMode
}

function getChartColors(
  accentColor: AccentColor,
  mode: ResolvedMode,
): string[] {
  const index = ACCENT_COLORS.indexOf(accentColor)
  const count = ACCENT_COLORS.length
  const step = Math.floor(count / 5)
  const shade = mode === "light" ? 500 : 400

  return Array.from({ length: 5 }, (_, i) => {
    const colorIndex = (index + i * step) % count
    const colorName = ACCENT_COLORS[colorIndex] ?? accentColor
    return accentColors[colorName][shade]
  })
}

function generateGradient(
  surfaceColor: SurfaceColor,
  mode: ResolvedMode,
): string {
  if (surfaceColor === "slate") {
    const slate = surfaceColors.slate as ColorScale
    if (mode === "light") {
      return `linear-gradient(135deg, hsl(${slate[300]} / 0.3) 0%, hsl(${slate[200]} / 0.1) 100%)`
    }
    return `linear-gradient(135deg, hsl(${slate[950]} / 0.4) 0%, hsl(${slate[900]} / 0.1) 100%)`
  }

  const color = accentColors[surfaceColor]
  const index = ACCENT_COLORS.indexOf(surfaceColor)
  const neighborIndex = (index + 3) % ACCENT_COLORS.length
  const neighborName = ACCENT_COLORS[neighborIndex] ?? surfaceColor
  const neighbor = accentColors[neighborName]

  if (mode === "light") {
    return `linear-gradient(135deg, hsl(${color[400]} / 0.3) 0%, hsl(${neighbor[600]} / 0.1) 100%)`
  }
  return `linear-gradient(135deg, hsl(${color[950]} / 0.4) 0%, hsl(${neighbor[950]} / 0.1) 100%)`
}

function resolveOpacity(
  style: SurfaceStyle,
  bgStyle: BackgroundStyle,
  mode: ResolvedMode,
  defaultOpacity: string,
): string {
  if (style === "glassmorphism") {
    if (bgStyle === "gradient") {
      return mode === "light" ? "0.3" : "0.4"
    }
    return mode === "light" ? "0.5" : "0.5"
  }
  return defaultOpacity
}

function tintScale(
  scale: ColorScale,
  neutral: ColorScale,
  satFactor: number,
  useNeutralLightness: boolean,
): ColorScale {
  const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const
  const result = {} as Record<number, string>
  for (const step of steps) {
    const parts = scale[step].split(" ")
    const h = parts[0] ?? "0"
    const s = parseFloat(parts[1] ?? "0")
    const l = useNeutralLightness
      ? (neutral[step].split(" ")[2] ?? "0%")
      : (parts[2] ?? "0%")
    result[step] = `${h} ${(s * satFactor).toFixed(0)}% ${l}`
  }
  return result as ColorScale
}

function isSidebarDark(_style: SurfaceStyle, mode: ResolvedMode): boolean {
  return mode === "dark"
}

export function generateTokens(
  input: GenerateTokensInput,
): Record<string, string> {
  const {
    accentColor,
    surfaceColor,
    surfaceStyle,
    backgroundStyle,
    fontFamily,
    mode,
  } = input

  const accent: ColorScale = accentColors[accentColor]
  const neutral: ColorScale = surfaceColors.slate as ColorScale
  const surface: ColorScale =
    surfaceColor === "slate"
      ? neutral
      : tintScale(
          accentColors[surfaceColor],
          neutral,
          mode === "light" ? 0.4 : 0.35,
          mode === "dark",
        )
  const recipe = surfaceStyles[surfaceStyle]

  const isLightAccent = LIGHT_ACCENT_COLORS.has(accentColor)
  const isRedishAccent =
    accentColor === "red" || accentColor === "rose" || accentColor === "pink"

  const primaryShade = mode === "light" ? 500 : 400
  const primaryForeground = isLightAccent ? accent[950] : "0 0% 100%"
  const ringValue = accent[primaryShade]

  const chartColors = getChartColors(accentColor, mode)

  const foreground = recipe.overrides.foreground
    ? recipe.overrides.foreground(neutral, mode)
    : mode === "light"
      ? neutral[900]
      : neutral[50]

  let border = recipe.overrides.border
    ? recipe.overrides.border(surface, mode)
    : mode === "light"
      ? surface[200]
      : surface[800]

  if (mode === "dark" && backgroundStyle === "gradient") {
    border = "0 0% 100% / 0.1"
  } else if (surfaceStyle === "glassmorphism" && mode === "dark") {
    border = surface[800]
  }

  const inputValue = recipe.overrides.input
    ? recipe.overrides.input(surface, mode)
    : border

  const tokens: Record<string, string> = {
    "--primary": accent[primaryShade],
    "--primary-foreground": primaryForeground,
    "--ring": ringValue,

    "--chart-1": chartColors[0] ?? "",
    "--chart-2": chartColors[1] ?? "",
    "--chart-3": chartColors[2] ?? "",
    "--chart-4": chartColors[3] ?? "",
    "--chart-5": chartColors[4] ?? "",

    "--background": mode === "light" ? surface[50] : surface[950],
    "--foreground": foreground,

    "--card": mode === "light" ? "0 0% 100%" : surface[900],
    "--card-foreground": mode === "light" ? neutral[900] : neutral[50],

    "--popover": mode === "light" ? "0 0% 100%" : surface[900],
    "--popover-foreground": mode === "light" ? neutral[900] : neutral[50],

    "--secondary": mode === "light" ? surface[100] : surface[800],
    "--secondary-foreground": mode === "light" ? neutral[900] : neutral[50],

    "--muted": mode === "light" ? surface[100] : surface[800],
    "--muted-foreground": mode === "light" ? neutral[500] : neutral[400],

    "--accent": mode === "light" ? surface[100] : surface[800],
    "--accent-foreground": mode === "light" ? neutral[900] : neutral[50],

    "--destructive": isRedishAccent
      ? mode === "light"
        ? "25 95% 53%"
        : "21 90% 48%"
      : mode === "light"
        ? "0 84% 60%"
        : "0 72% 51%",
    "--destructive-foreground": "0 0% 100%",

    "--border": border,
    "--input": inputValue,

    "--surface-base": mode === "light" ? surface[50] : surface[950],
    "--surface-raised": recipe.tokens.surfaceRaised(surface, mode),
    "--surface-overlay": recipe.tokens.surfaceOverlay(surface, mode),
    "--surface-sunken": recipe.tokens.surfaceSunken(surface, mode),
    "--surface-sidebar": recipe.tokens.surfaceSidebar(surface, mode),
    "--sidebar-foreground": isSidebarDark(surfaceStyle, mode)
      ? neutral[300]
      : neutral[600],
    "--sidebar-foreground-hover": isSidebarDark(surfaceStyle, mode)
      ? "0 0% 100%"
      : neutral[900],
    "--sidebar-foreground-muted": isSidebarDark(surfaceStyle, mode)
      ? neutral[500]
      : neutral[400],
    "--sidebar-border": isSidebarDark(surfaceStyle, mode)
      ? "0 0% 100% / 0.1"
      : surface[200],
    "--sidebar-hover-bg": isSidebarDark(surfaceStyle, mode)
      ? `${accent[500]} / 0.15`
      : accent[100],
    "--surface-header": recipe.tokens.surfaceHeader(surface, mode),

    "--border-subtle": recipe.tokens.borderSubtle(surface, mode),
    "--border-default": recipe.tokens.borderDefault(surface, mode),

    "--radius": recipe.overrides.radius,
    "--shadow-card": recipe.overrides.shadowCard,
    "--shadow-dropdown": recipe.overrides.shadowDropdown,
    "--backdrop-blur": recipe.overrides.backdropBlur,
    "--backdrop-filter":
      recipe.overrides.backdropBlur === "none"
        ? "none"
        : `blur(${recipe.overrides.backdropBlur})`,
    "--surface-opacity": resolveOpacity(
      surfaceStyle,
      backgroundStyle,
      mode,
      recipe.overrides.surfaceOpacity,
    ),

    "--bg-style": backgroundStyle,
    "--bg-gradient":
      backgroundStyle === "gradient"
        ? generateGradient(surfaceColor, mode)
        : "none",

    "--sidebar-gradient":
      backgroundStyle === "gradient"
        ? generateGradient(surfaceColor, mode)
        : "none",

    "--content-gradient-overlay":
      backgroundStyle === "gradient" && surfaceStyle !== "glassmorphism"
        ? `linear-gradient(135deg, hsl(${accent[mode === "light" ? 100 : 900]} / 0.4) 0%, transparent 60%)`
        : surfaceStyle === "glassmorphism" && backgroundStyle === "solid"
          ? `linear-gradient(135deg, hsl(${accent[mode === "light" ? 200 : 800]} / 0.2) 0%, transparent 70%)`
          : "none",

    "--theme-font-sans": fontFamilies[fontFamily].sans,
    "--theme-font-heading": fontFamilies[fontFamily].heading,
    "--theme-font-mono": fontFamilies[fontFamily].mono,
  }

  return tokens
}
