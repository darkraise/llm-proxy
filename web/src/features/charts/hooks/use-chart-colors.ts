import { useMemo } from "react"

export interface ChartColorSet {
  series: string[]
  gridStroke: string
  tickFill: string
}

export function useChartColors(): ChartColorSet {
  return useMemo(() => {
    const root = getComputedStyle(document.documentElement)
    const series = [1, 2, 3, 4, 5].map((i) => {
      const hsl = root.getPropertyValue(`--chart-${i}`).trim()
      return `hsl(${hsl})`
    })
    const border = root.getPropertyValue("--border").trim()
    const mutedFg = root.getPropertyValue("--muted-foreground").trim()
    return {
      series,
      gridStroke: `hsl(${border})`,
      tickFill: `hsl(${mutedFg})`,
    }
  }, [])
}
