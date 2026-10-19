import { Box, Container, Tab, Tabs } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, Outlet, useLocation } from 'react-router-dom'

const TABS = [
  { to: '/admin', key: 'dashboard' },
  { to: '/admin/assignments', key: 'assignments' },
  { to: '/admin/skills', key: 'skills' },
  { to: '/admin/tags', key: 'tags' },
  { to: '/admin/audit', key: 'audit' },
  { to: '/admin/sources', key: 'sources' },
] as const

export function AdminLayout() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  // Khớp tab dài nhất là tiền tố của đường dẫn hiện tại ('/admin' chỉ khớp chính nó).
  const current = TABS.filter((tab) => (tab.to === '/admin' ? pathname === '/admin' : pathname.startsWith(tab.to)))
    .sort((a, b) => b.to.length - a.to.length)[0]

  return (
    <Container maxWidth="lg" sx={{ pt: 2, pb: 4 }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={current?.to ?? false} variant="scrollable" scrollButtons="auto" aria-label={t('nav.admin')}>
          {TABS.map((tab) => (
            <Tab key={tab.to} value={tab.to} label={t(`admin.tab.${tab.key}`)} component={RouterLink} to={tab.to} />
          ))}
        </Tabs>
      </Box>
      <Outlet />
    </Container>
  )
}
