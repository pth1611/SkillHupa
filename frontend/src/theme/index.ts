import { createTheme, type PaletteMode, type Theme } from '@mui/material/styles'
import { brand } from './brand'

export function buildTheme(mode: PaletteMode): Theme {
  return createTheme({
    palette: {
      mode,
      primary: { main: brand.primary },
      secondary: { main: brand.secondary },
      background:
        mode === 'dark'
          ? { default: '#0d1117', paper: '#161b22' }
          : { default: '#f6f8fa', paper: '#ffffff' },
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: '"Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      h3: { fontWeight: 700 },
      h5: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiCard: { defaultProps: { variant: 'outlined' } },
      MuiAppBar: { defaultProps: { elevation: 0, color: 'default' } },
    },
  })
}
