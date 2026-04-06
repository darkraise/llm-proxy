import type {
  AccentColor,
  SurfaceColor,
  SurfaceStyle,
  BackgroundStyle,
  FontFamily,
  Mode,
} from "./types"

export interface ThemeConfig {
  defaults: {
    accentColor: AccentColor
    surfaceColor: SurfaceColor
    surfaceStyle: SurfaceStyle
    backgroundStyle: BackgroundStyle
    fontFamily: FontFamily
    mode: Mode
  }
  switcher: {
    enabled: boolean
    axes: {
      mode: boolean
      accentColor: boolean
      surfaceColor: boolean
      surfaceStyle: boolean
      backgroundStyle: boolean
      fontFamily: boolean
    }
  }
}

export const themeConfig: ThemeConfig = {
  defaults: {
    accentColor: "blue",
    surfaceColor: "slate",
    surfaceStyle: "default",
    backgroundStyle: "solid",
    fontFamily: "default",
    mode: "system",
  },
  switcher: {
    enabled: true,
    axes: {
      mode: true,
      accentColor: true,
      surfaceColor: true,
      surfaceStyle: true,
      backgroundStyle: true,
      fontFamily: true,
    },
  },
}
