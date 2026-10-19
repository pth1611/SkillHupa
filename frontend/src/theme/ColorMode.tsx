import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material'
import type { PaletteMode } from '@mui/material'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { buildTheme } from './index'

const STORAGE_KEY = 'skillmkt.mode'
type Stored = PaletteMode | null

interface ColorModeValue {
  mode: PaletteMode
  toggle: () => void
}

const ColorModeContext = createContext<ColorModeValue>({ mode: 'light', toggle: () => undefined })

function readStored(): Stored {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const [stored, setStored] = useState<Stored>(readStored)
  const mode: PaletteMode = stored ?? (systemDark ? 'dark' : 'light')

  useEffect(() => {
    document.documentElement.style.colorScheme = mode
  }, [mode])

  const value = useMemo<ColorModeValue>(
    () => ({
      mode,
      toggle: () => {
        const next: PaletteMode = mode === 'dark' ? 'light' : 'dark'
        setStored(next)
        try {
          localStorage.setItem(STORAGE_KEY, next)
        } catch {
          /* chế độ riêng tư: bỏ qua, lựa chọn chỉ có hiệu lực trong phiên */
        }
      },
    }),
    [mode],
  )
  const theme = useMemo(() => buildTheme(mode), [mode])

  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  )
}

export const useColorMode = () => useContext(ColorModeContext)
