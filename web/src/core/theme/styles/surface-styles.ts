import type {
  SurfaceStyle,
  SurfaceStyleRecipe,
  ColorScale,
  ResolvedMode,
} from "../types"

const WHITE = "0 0% 100%"

function lightDark(
  scale: ColorScale,
  mode: ResolvedMode,
  lightStep: keyof ColorScale,
  darkStep: keyof ColorScale,
): string {
  return mode === "light" ? scale[lightStep] : scale[darkStep]
}

const defaultStyle: SurfaceStyleRecipe = {
  name: "default",
  label: "Default",
  description:
    "Subtle elevation through background color shifts. No shadows. Clean and neutral.",
  tokens: {
    surfaceRaised: (_scale, mode) => (mode === "light" ? WHITE : _scale[900]),
    surfaceOverlay: (_scale, mode) => (mode === "light" ? WHITE : _scale[800]),
    surfaceSunken: (scale, mode) => lightDark(scale, mode, 100, 950),
    surfaceSidebar: (scale, mode) => lightDark(scale, mode, 50, 950),
    surfaceHeader: (_scale, mode) => (mode === "light" ? WHITE : _scale[900]),
    borderSubtle: (scale, mode) => lightDark(scale, mode, 100, 800),
    borderDefault: (scale, mode) => lightDark(scale, mode, 200, 700),
  },
  overrides: {
    radius: "0.5rem",
    shadowCard: "none",
    shadowDropdown:
      "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
    backdropBlur: "none",
    surfaceOpacity: "1",
  },
}

const glassmorphism: SurfaceStyleRecipe = {
  name: "glassmorphism",
  label: "Glassmorphism",
  description:
    "Frosted glass effect with backdrop-blur, semi-transparent surfaces.",
  tokens: {
    surfaceRaised: (_scale, mode) => (mode === "light" ? WHITE : _scale[900]),
    surfaceOverlay: (_scale, mode) => (mode === "light" ? WHITE : _scale[800]),
    surfaceSunken: (scale, mode) => lightDark(scale, mode, 100, 950),
    surfaceSidebar: (scale, mode) => lightDark(scale, mode, 50, 950),
    surfaceHeader: (_scale, mode) => (mode === "light" ? WHITE : _scale[900]),
    borderSubtle: (scale, mode) => lightDark(scale, mode, 100, 600),
    borderDefault: (scale, mode) => lightDark(scale, mode, 200, 500),
  },
  overrides: {
    radius: "0.5rem",
    shadowCard: "0 1px 3px 0 rgb(0 0 0 / 0.1)",
    shadowDropdown:
      "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
    backdropBlur: "12px",
    surfaceOpacity: "0.8",
  },
}

export const surfaceStyles: Record<SurfaceStyle, SurfaceStyleRecipe> = {
  default: defaultStyle,
  glassmorphism,
}
