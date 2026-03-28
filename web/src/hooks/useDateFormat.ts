import { createContext, useContext } from 'react'
import { DEFAULT_FORMAT, formatDateTime, type DateFormatKey } from '../lib/dateformat'

interface DateFormatContextType {
  formatKey: DateFormatKey
  fmt: (ts: string | Date) => string
}

export const DateFormatContext = createContext<DateFormatContextType>({
  formatKey: DEFAULT_FORMAT,
  fmt: (ts) => formatDateTime(ts, DEFAULT_FORMAT),
})

export function useDateFormat() {
  return useContext(DateFormatContext)
}
