import DarkModeIcon from '@mui/icons-material/DarkModeOutlined'
import LightModeIcon from '@mui/icons-material/LightModeOutlined'
import MenuIcon from '@mui/icons-material/Menu'
import NotificationsIcon from '@mui/icons-material/NotificationsNone'
import {
  AppBar, Badge, Box, Button, Container, Divider, IconButton, ListItemText, Menu, MenuItem,
  Stack, ToggleButton, ToggleButtonGroup, Toolbar, Tooltip, Typography,
} from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { atLeast, useAuth } from '../auth/AuthProvider'
import { LANGUAGES, setLanguage, type Language } from '../i18n'
import { brand } from '../theme/brand'
import { useColorMode } from '../theme/ColorMode'

interface NavItem {
  to: string
  label: string
}

export function AppLayout() {
  const { t, i18n } = useTranslation()
  const { user, logout } = useAuth()
  const { mode, toggle } = useColorMode()
  const navigate = useNavigate()
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)

  const items: NavItem[] = [
    { to: '/', label: t('nav.home') },
    { to: '/my-skills', label: t('nav.mySkills') },
  ]
  if (user?.role === 'creator' || user?.role === 'manager') items.push({ to: '/studio', label: t('nav.studio') })
  if (user?.role === 'reviewer' || user?.role === 'manager') items.push({ to: '/reviews', label: t('nav.reviews') })
  if (user?.role === 'manager') items.push({ to: '/admin', label: t('nav.admin') })

  const lang = (i18n.resolvedLanguage ?? 'vi') as Language

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="sticky" sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Toolbar sx={{ gap: 1 }}>
          <Typography
            component={RouterLink}
            to="/"
            variant="h6"
            sx={{ color: 'primary.main', fontWeight: 800, textDecoration: 'none', mr: 2 }}
          >
            {brand.logoText}
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' }, ml: 1, color: 'text.primary' }}>
              {brand.productName}
            </Box>
          </Typography>

          <Stack direction="row" spacing={0.5} sx={{ display: { xs: 'none', md: 'flex' }, flexGrow: 1 }} component="nav">
            {items.map((item) => (
              <Button
                key={item.to}
                component={NavLink}
                to={item.to}
                end={item.to === '/'}
                color="inherit"
                sx={{ '&.active': { color: 'primary.main' } }}
              >
                {item.label}
              </Button>
            ))}
          </Stack>
          <Box sx={{ flexGrow: { xs: 1, md: 0 } }} />

          <ToggleButtonGroup
            size="small"
            exclusive
            value={lang}
            onChange={(_, value: Language | null) => value && setLanguage(value)}
            aria-label={t('nav.language')}
          >
            {LANGUAGES.map((l) => (
              <ToggleButton key={l} value={l} sx={{ px: 1, py: 0.25 }}>
                {l.toUpperCase()}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          <Tooltip title={mode === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}>
            <IconButton onClick={toggle} color="inherit" aria-label={mode === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}>
              {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tooltip>

          <Tooltip title={t('nav.notifications')}>
            <IconButton color="inherit" onClick={() => navigate('/notifications')} aria-label={t('nav.notifications')}>
              <Badge color="error" badgeContent={user?.unread_notifications ?? 0} max={99}>
                <NotificationsIcon />
              </Badge>
            </IconButton>
          </Tooltip>

          <IconButton
            color="inherit"
            sx={{ display: { md: 'none' } }}
            onClick={(e) => setMenuAnchor(e.currentTarget)}
            aria-label={t('nav.menu')}
          >
            <MenuIcon />
          </IconButton>
          <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
            {items.map((item) => (
              <MenuItem
                key={item.to}
                onClick={() => {
                  setMenuAnchor(null)
                  navigate(item.to)
                }}
              >
                {item.label}
              </MenuItem>
            ))}
          </Menu>

          {user && (
            <Stack direction="row" alignItems="center" spacing={1} sx={{ ml: 1 }}>
              <ListItemText
                sx={{ display: { xs: 'none', lg: 'block' }, m: 0, textAlign: 'right' }}
                primary={user.display_name}
                secondary={atLeast(user, 'creator') ? t(`role.${user.role}`) : undefined}
                primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                secondaryTypographyProps={{ variant: 'caption' }}
              />
              <Button size="small" variant="outlined" onClick={() => void logout()}>
                {t('nav.logout')}
              </Button>
            </Stack>
          )}
        </Toolbar>
      </AppBar>

      <Box component="main" sx={{ flexGrow: 1 }}>
        <Outlet />
      </Box>

      <Divider />
      <Box component="footer" sx={{ py: 3, bgcolor: 'background.paper' }}>
        <Container maxWidth="lg">
          <Stack spacing={0.5}>
            <Typography variant="body2" color="text.secondary">
              {t('home.footerCli')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('home.footerContact')}
            </Typography>
          </Stack>
        </Container>
      </Box>
    </Box>
  )
}
