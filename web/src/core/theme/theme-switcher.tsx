import { Moon, Sun, Monitor, Palette, Square, Blend } from "lucide-react"
import { Button } from "@/core/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/core/components/ui/popover"
import { Label } from "@/core/components/ui/label"
import { Separator } from "@/core/components/ui/separator"
import { cn } from "@/core/lib/utils"
import { useTheme } from "./use-theme"
import {
  ACCENT_COLORS,
  SURFACE_COLORS,
  SURFACE_STYLES,
  FONT_FAMILIES,
} from "./types"
import type {
  Mode,
  AccentColor,
  SurfaceColor,
  BackgroundStyle,
  SurfaceStyle,
  FontFamily,
} from "./types"
import { accentColors } from "./palettes/accent-colors"
import { surfaceStyles } from "./styles/surface-styles"
import { fontFamilies } from "./palettes/font-families"
import { themeConfig } from "./theme.config"

const modeOptions: { value: Mode; icon: typeof Sun; label: string }[] = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "system", icon: Monitor, label: "System" },
]

export function ThemeSwitcher() {
  const {
    accentColor,
    surfaceColor,
    surfaceStyle,
    backgroundStyle,
    fontFamily,
    mode,
    setAccentColor,
    setSurfaceColor,
    setSurfaceStyle,
    setBackgroundStyle,
    setFontFamily,
    setMode,
  } = useTheme()

  const bgOptions: {
    value: BackgroundStyle
    icon: typeof Square
    label: string
  }[] = [
    { value: "solid", icon: Square, label: "Solid" },
    { value: "gradient", icon: Blend, label: "Gradient" },
  ]

  const { axes } = themeConfig.switcher

  const visibleSections = [
    axes.mode && (
      <div key="mode">
        <Label className="text-xs font-medium text-muted-foreground">
          Mode
        </Label>
        <div className="mt-1.5 flex gap-1">
          {modeOptions.map(({ value, icon: Icon, label }) => (
            <Button
              key={value}
              variant={mode === value ? "default" : "outline"}
              size="sm"
              className="flex-1"
              onClick={() => setMode(value)}
            >
              <Icon className="mr-1.5 h-3.5 w-3.5" />
              {label}
            </Button>
          ))}
        </div>
      </div>
    ),
    axes.backgroundStyle && (
      <div key="backgroundStyle">
        <Label className="text-xs font-medium text-muted-foreground">
          Background
        </Label>
        <div className="mt-1.5 flex gap-1">
          {bgOptions.map(({ value, icon: Icon, label }) => (
            <Button
              key={value}
              variant={backgroundStyle === value ? "default" : "outline"}
              size="sm"
              className="flex-1"
              onClick={() => setBackgroundStyle(value)}
            >
              <Icon className="mr-1.5 h-3.5 w-3.5" />
              {label}
            </Button>
          ))}
        </div>
      </div>
    ),
    axes.accentColor && (
      <div key="accentColor">
        <Label className="text-xs font-medium text-muted-foreground">
          Accent Color
        </Label>
        <div className="mt-1.5 grid grid-cols-9 gap-1.5">
          {ACCENT_COLORS.map((color: AccentColor) => (
            <button
              key={color}
              type="button"
              title={color}
              className={cn(
                "h-6 w-6 rounded-full border-2 transition-transform hover:scale-110",
                accentColor === color
                  ? "scale-110 border-foreground"
                  : "border-transparent",
              )}
              style={{
                backgroundColor: `hsl(${accentColors[color][500]})`,
              }}
              onClick={() => setAccentColor(color)}
            />
          ))}
        </div>
      </div>
    ),
    axes.surfaceColor && (
      <div key="surfaceColor">
        <Label className="text-xs font-medium text-muted-foreground">
          Surface Color
        </Label>
        <div className="mt-1.5 grid grid-cols-9 gap-1.5">
          {SURFACE_COLORS.map((color: SurfaceColor) => {
            const previewHsl =
              color === "slate" ? "215 16% 47%" : accentColors[color][500]
            return (
              <button
                key={color}
                type="button"
                title={color}
                className={cn(
                  "h-6 w-6 rounded-full border-2 transition-transform hover:scale-110",
                  surfaceColor === color
                    ? "scale-110 border-foreground"
                    : "border-transparent",
                )}
                style={{
                  backgroundColor: `hsl(${previewHsl})`,
                }}
                onClick={() => setSurfaceColor(color)}
              />
            )
          })}
        </div>
      </div>
    ),
    axes.surfaceStyle && (
      <div key="surfaceStyle">
        <Label className="text-xs font-medium text-muted-foreground">
          Surface Style
        </Label>
        <div className="mt-1.5 grid grid-cols-2 gap-1">
          {SURFACE_STYLES.map((style: SurfaceStyle) => {
            const recipe = surfaceStyles[style]
            return (
              <button
                key={style}
                type="button"
                className={cn(
                  "rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  surfaceStyle === style
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent hover:text-accent-foreground",
                )}
                onClick={() => setSurfaceStyle(style)}
              >
                {recipe.label}
              </button>
            )
          })}
        </div>
      </div>
    ),
    axes.fontFamily && (
      <div key="fontFamily">
        <Label className="text-xs font-medium text-muted-foreground">
          Font
        </Label>
        <div className="mt-1.5 grid grid-cols-1 gap-1">
          {FONT_FAMILIES.map((font: FontFamily) => {
            const def = fontFamilies[font]
            return (
              <button
                key={font}
                type="button"
                className={cn(
                  "rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  fontFamily === font
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent hover:text-accent-foreground",
                )}
                onClick={() => setFontFamily(font)}
              >
                <span className="font-medium">{def.label}</span>
                <span className="ml-2 text-[10px] opacity-70">
                  {def.description}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    ),
  ].filter(Boolean)

  if (visibleSections.length === 0) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon">
          <Palette className="h-4 w-4" />
          <span className="sr-only">Customize theme</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-4">
          {visibleSections.map((section, i) => (
            <div key={i}>
              {section}
              {i < visibleSections.length - 1 && <Separator className="mt-4" />}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
