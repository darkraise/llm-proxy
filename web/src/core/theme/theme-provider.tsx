import { useCallback, useEffect, useMemo, useState } from "react"
import type {
  AccentColor,
  BackgroundStyle,
  SurfaceColor,
  SurfaceStyle,
  FontFamily,
  Mode,
  ResolvedMode,
  ThemeContextValue,
} from "./types"
import { SURFACE_COLORS, SURFACE_STYLES } from "./types"
import { generateTokens } from "./engine/generate-tokens"
import { loadFont, applyFontFamily } from "./engine/font-loader"
import { ThemeContext } from "./theme-context"
import { themeConfig } from "./theme.config"

const LS_ACCENT = "theme-accent"
const LS_SURFACE_COLOR = "theme-surface-color"
const LS_STYLE = "theme-style"
const LS_BG_STYLE = "theme-bg-style"
const LS_FONT = "theme-font"
const LS_MODE = "mode"

function getSystemMode(): ResolvedMode {
  if (typeof window === "undefined") return "light"
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

function resolveMode(mode: Mode): ResolvedMode {
  return mode === "system" ? getSystemMode() : mode
}

function applyTokens(tokens: Record<string, string>) {
  const style = document.documentElement.style
  for (const [key, value] of Object.entries(tokens)) {
    style.setProperty(key, value)
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [accentColor, setAccentColorState] = useState<AccentColor>(() => {
    const stored = localStorage.getItem(LS_ACCENT)
    return (stored as AccentColor) || themeConfig.defaults.accentColor
  })

  const [surfaceColor, setSurfaceColorState] = useState<SurfaceColor>(() => {
    const stored = localStorage.getItem(LS_SURFACE_COLOR)
    if (stored && (SURFACE_COLORS as readonly string[]).includes(stored)) {
      return stored as SurfaceColor
    }
    return themeConfig.defaults.surfaceColor
  })

  const [surfaceStyle, setSurfaceStyleState] = useState<SurfaceStyle>(() => {
    const stored = localStorage.getItem(LS_STYLE)
    if (stored && (SURFACE_STYLES as readonly string[]).includes(stored)) {
      return stored as SurfaceStyle
    }
    return themeConfig.defaults.surfaceStyle
  })

  const [backgroundStyle, setBackgroundStyleState] = useState<BackgroundStyle>(
    () => {
      const stored = localStorage.getItem(LS_BG_STYLE)
      return (stored as BackgroundStyle) || themeConfig.defaults.backgroundStyle
    },
  )

  const [fontFamily, setFontFamilyState] = useState<FontFamily>(() => {
    const stored = localStorage.getItem(LS_FONT)
    return (stored as FontFamily) || themeConfig.defaults.fontFamily
  })

  const [mode, setModeState] = useState<Mode>(() => {
    const stored = localStorage.getItem(LS_MODE)
    return (stored as Mode) || themeConfig.defaults.mode
  })

  const [resolvedMode, setResolvedMode] = useState<ResolvedMode>(() =>
    resolveMode(mode),
  )

  const applyTheme = useCallback(
    (
      accent: AccentColor,
      surfColor: SurfaceColor,
      style: SurfaceStyle,
      bgStyle: BackgroundStyle,
      font: FontFamily,
      resolved: ResolvedMode,
    ) => {
      document.documentElement.setAttribute("data-mode", resolved)
      loadFont(font)
      applyFontFamily(font)
      const tokens = generateTokens({
        accentColor: accent,
        surfaceColor: surfColor,
        surfaceStyle: style,
        backgroundStyle: bgStyle,
        fontFamily: font,
        mode: resolved,
      })
      applyTokens(tokens)
    },
    [],
  )

  const setAccentColor = useCallback(
    (color: AccentColor) => {
      setAccentColorState(color)
      localStorage.setItem(LS_ACCENT, color)
      applyTheme(
        color,
        surfaceColor,
        surfaceStyle,
        backgroundStyle,
        fontFamily,
        resolvedMode,
      )
    },
    [
      applyTheme,
      surfaceColor,
      surfaceStyle,
      backgroundStyle,
      fontFamily,
      resolvedMode,
    ],
  )

  const setSurfaceColor = useCallback(
    (color: SurfaceColor) => {
      setSurfaceColorState(color)
      localStorage.setItem(LS_SURFACE_COLOR, color)
      applyTheme(
        accentColor,
        color,
        surfaceStyle,
        backgroundStyle,
        fontFamily,
        resolvedMode,
      )
    },
    [
      applyTheme,
      accentColor,
      surfaceStyle,
      backgroundStyle,
      fontFamily,
      resolvedMode,
    ],
  )

  const setSurfaceStyle = useCallback(
    (style: SurfaceStyle) => {
      setSurfaceStyleState(style)
      localStorage.setItem(LS_STYLE, style)
      applyTheme(
        accentColor,
        surfaceColor,
        style,
        backgroundStyle,
        fontFamily,
        resolvedMode,
      )
    },
    [
      applyTheme,
      accentColor,
      surfaceColor,
      backgroundStyle,
      fontFamily,
      resolvedMode,
    ],
  )

  const setBackgroundStyle = useCallback(
    (bgStyle: BackgroundStyle) => {
      setBackgroundStyleState(bgStyle)
      localStorage.setItem(LS_BG_STYLE, bgStyle)
      applyTheme(
        accentColor,
        surfaceColor,
        surfaceStyle,
        bgStyle,
        fontFamily,
        resolvedMode,
      )
    },
    [
      applyTheme,
      accentColor,
      surfaceColor,
      surfaceStyle,
      fontFamily,
      resolvedMode,
    ],
  )

  const setFontFamily = useCallback(
    (font: FontFamily) => {
      setFontFamilyState(font)
      localStorage.setItem(LS_FONT, font)
      applyTheme(
        accentColor,
        surfaceColor,
        surfaceStyle,
        backgroundStyle,
        font,
        resolvedMode,
      )
    },
    [
      applyTheme,
      accentColor,
      surfaceColor,
      surfaceStyle,
      backgroundStyle,
      resolvedMode,
    ],
  )

  const setMode = useCallback(
    (m: Mode) => {
      const resolved = resolveMode(m)
      setModeState(m)
      setResolvedMode(resolved)
      localStorage.setItem(LS_MODE, m)
      applyTheme(
        accentColor,
        surfaceColor,
        surfaceStyle,
        backgroundStyle,
        fontFamily,
        resolved,
      )
    },
    [
      applyTheme,
      accentColor,
      surfaceColor,
      surfaceStyle,
      backgroundStyle,
      fontFamily,
    ],
  )

  useEffect(() => {
    applyTheme(
      accentColor,
      surfaceColor,
      surfaceStyle,
      backgroundStyle,
      fontFamily,
      resolvedMode,
    )
  }, [
    applyTheme,
    accentColor,
    surfaceColor,
    surfaceStyle,
    backgroundStyle,
    fontFamily,
    resolvedMode,
  ])

  useEffect(() => {
    if (mode !== "system") return
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => {
      const resolved = getSystemMode()
      setResolvedMode(resolved)
      applyTheme(
        accentColor,
        surfaceColor,
        surfaceStyle,
        backgroundStyle,
        fontFamily,
        resolved,
      )
    }
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [
    mode,
    accentColor,
    surfaceColor,
    surfaceStyle,
    backgroundStyle,
    fontFamily,
    applyTheme,
  ])

  const value = useMemo<ThemeContextValue>(
    () => ({
      accentColor,
      surfaceColor,
      surfaceStyle,
      backgroundStyle,
      fontFamily,
      mode,
      resolvedMode,
      setAccentColor,
      setSurfaceColor,
      setSurfaceStyle,
      setBackgroundStyle,
      setFontFamily,
      setMode,
    }),
    [
      accentColor,
      surfaceColor,
      surfaceStyle,
      backgroundStyle,
      fontFamily,
      mode,
      resolvedMode,
      setAccentColor,
      setSurfaceColor,
      setSurfaceStyle,
      setBackgroundStyle,
      setFontFamily,
      setMode,
    ],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
