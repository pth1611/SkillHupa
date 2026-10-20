import { createTheme, type PaletteMode, type Theme } from '@mui/material/styles'
import { brand } from './brand'

export function buildTheme(mode: PaletteMode): Theme {
  return createTheme({
    palette: {
      mode,
      primary: { main: brand.primary, contrastText: '#04130d' },
      secondary: { main: brand.secondary },
      background:
        mode === 'dark'
          ? { default: '#050506', paper: '#0d0d10' }
          : { default: '#f7f8fa', paper: '#ffffff' },
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: '"Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      h3: { fontWeight: 800, letterSpacing: '-0.03em' },
      h5: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiCard: { defaultProps: { variant: 'outlined' } },
      MuiAppBar: { defaultProps: { elevation: 0, color: 'default' } },
      MuiButton: { styleOverrides: { root: { borderRadius: 999 } } },
    },
  })
}
