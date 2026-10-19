import { Box, Card, CardActionArea, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import { adminKeys, fetchDashboard } from '../../api/admin'
import type { DashboardData } from '../../api/types'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'

interface Tile {
  key: keyof DashboardData & string
  to: string
  urgent?: boolean
}

// Xếp theo mức khẩn (mục 8, "Trang quản trị"): chưa giao → quá hạn → tag → phạm vi → nguồn.
const TILES: Tile[] = [
  { key: 'unassigned', to: '/admin/assignments?filter=unassigned' },
  { key: 'unassigned_overdue', to: '/admin/assignments?filter=unassigned&overdue=1', urgent: true },
  { key: 'review_overdue', to: '/admin/assignments?filter=assigned&overdue=1', urgent: true },
  { key: 'tags_pending', to: '/admin/tags?status=pending' },
  { key: 'visibility_requests_pending', to: '/admin/assignments?kind=visibility' },
  { key: 'sources_with_problems', to: '/admin/sources', urgent: true },
]

export function DashboardPage() {
  const { t } = useTranslation()
  const dashboard = useQuery({ queryKey: adminKeys.dashboard, queryFn: fetchDashboard, refetchInterval: 60_000 })

  if (dashboard.isPending) return <LoadingState />
  if (dashboard.isError) return <ErrorState onRetry={() => void dashboard.refetch()} />
  const d = dashboard.data

  return (
    <Stack spacing={4}>
      <Box component="section" aria-label={t('admin.todo')}>
        <Typography variant="h6" component="h2" gutterBottom>
          {t('admin.todo')}
        </Typography>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {TILES.map((tile) => {
            const value = d[tile.key] as number
            return (
              <Card
                key={tile.key}
                sx={{
                  opacity: value === 0 ? 0.55 : 1,
                  borderColor: tile.urgent && value > 0 ? 'warning.main' : undefined,
                }}
              >
                <CardActionArea component={RouterLink} to={tile.to} sx={{ p: 2 }}>
                  <Typography variant="h4" component="p" fontWeight={700} color={tile.urgent && value > 0 ? 'warning.main' : 'text.primary'}>
                    {value}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t(`admin.tile.${tile.key}`)}
                  </Typography>
                </CardActionArea>
              </Card>
            )
          })}
        </Box>
      </Box>

      <Box component="section" aria-label={t('admin.recent')}>
        <Typography variant="h6" component="h2" gutterBottom>
          {t('admin.recent')}
        </Typography>
        {d.recent_events.length === 0 ? (
          <EmptyState>{t('admin.noRecent')}</EmptyState>
        ) : (
          <Stack component="ul" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0 }}>
            {d.recent_events.map((e, index) => (
              <Card key={index} component="li">
                <Stack sx={{ p: 1.5 }} direction="row" spacing={1} alignItems="baseline" flexWrap="wrap">
                  <Typography fontWeight={600}>{t(`admin.event.${e.action}`, { defaultValue: e.action })}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {String(e.detail.name ?? e.detail.version ?? `#${e.target_id ?? ''}`)}
                    {e.detail.reason ? ` — ${String(e.detail.reason)}` : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                    {e.actor_name} · {new Date(e.created_at).toLocaleString()}
                  </Typography>
                </Stack>
              </Card>
            ))}
          </Stack>
        )}
      </Box>

      <Box component="section" aria-label={t('admin.overview')}>
        <Typography variant="h6" component="h2" gutterBottom>
          {t('admin.overview')}
        </Typography>
        <Stack direction="row" spacing={3} flexWrap="wrap" sx={{ rowGap: 1 }}>
          {Object.entries(d.overview).map(([key, value]) => (
            <Typography key={key} color="text.secondary">
              {t(`admin.stat.${key}`, { defaultValue: key })}: <strong>{value}</strong>
            </Typography>
          ))}
        </Stack>
      </Box>
    </Stack>
  )
}
