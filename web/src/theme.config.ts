import type { ThemeConfig } from "darkraise-ui/theme"

export const themeConfig: ThemeConfig = {
  defaults: {
    accentColor: "purple",
    surfaceColor: "purple",
    surfaceStyle: "default",
    backgroundStyle: "solid",
    fontFamily: "default",
    mode: "dark",
  },
  switcher: {
    enabled: true,
    axes: {
      mode: true,
      accentColor: true,
      surfaceColor: false,
      surfaceStyle: false,
      backgroundStyle: false,
      fontFamily: false,
    },
  },
}
