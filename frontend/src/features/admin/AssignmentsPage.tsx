import { Alert, Box, Card, Chip, MenuItem, Select, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import { adminKeys, assignRequest, assignVersion, fetchUsers, unassignVersion } from '../../api/admin'
import { ApiError } from '../../api/client'
import { fetchQueue, reviewKeys } from '../../api/reviews'
import type { QueueItemData } from '../../api/types'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'
import { itemPath, waitingDays } from '../reviews/ReviewQueuePage'

type Filter = 'all' | 'unassigned' | 'assigned'
const NONE = ''

/** Số việc đang giữ của từng Reviewer, tính từ cả hàng đợi (không phụ thuộc bộ lọc đang chọn). */
export function workloads(items: QueueItemData[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const item of items) {
    if (item.assigned_to !== null) map.set(item.assigned_to, (map.get(item.assigned_to) ?? 0) + 1)
  }
  return map
}

export function AssignmentsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const filter = (params.get('filter') as Filter | null) ?? 'all'
  const overdueOnly = params.get('overdue') === '1'
  const kind = params.get('kind') === 'visibility' ? 'visibility' : params.get('kind') === 'version' ? 'version' : null
  const [error, setError] = useState<string | null>(null)

  const queue = useQuery({
    queryKey: adminKeys.assignQueue,
    queryFn: async () => {
      const all: QueueItemData[] = []
      for (let page = 1; page <= 10; page++) {
        const result = await fetchQueue({ page, page_size: 100 })
        all.push(...result.items)
        if (all.length >= result.total || result.items.length === 0) break
      }
      return all
    },
  })
  const reviewers = useQuery({
    queryKey: adminKeys.users({ role: 'reviewer' }),
    queryFn: () => fetchUsers({ role: 'reviewer', page_size: 100 }),
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.assignQueue })
    void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard })
    void queryClient.invalidateQueries({ queryKey: reviewKeys.all })
  }
  const assign = useMutation({
    mutationFn: async (v: { item: QueueItemData; reviewerId: number | null }) => {
      const { item, reviewerId } = v
      if (reviewerId === null) return unassignVersion(item.id)
      return item.kind === 'version' ? assignVersion(item.id, reviewerId) : assignRequest(item.id, reviewerId)
    },
    onSuccess: () => {
      setError(null)
      refresh()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('state.error')),
  })

  const all = useMemo(() => queue.data ?? [], [queue.data])
  const load = useMemo(() => workloads(all), [all])
  const items = all.filter(
    (i) =>
      (filter === 'all' || (filter === 'unassigned' ? i.assigned_to === null : i.assigned_to !== null)) &&
      (!overdueOnly || i.overdue || i.unassigned_overdue) &&
      (!kind || i.kind === kind),
  )

  function setFilter(next: Filter) {
    const p = new URLSearchParams(params)
    if (next === 'all') p.delete('filter')
    else p.set('filter', next)
    setParams(p)
  }

  return (
    <Stack spacing={2.5}>
      <Typography variant="h5" component="h1">
        {t('admin.tab.assignments')}
      </Typography>

      {reviewers.data && (
        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ rowGap: 1 }} aria-label={t('admin.reviewerLoad')}>
          {reviewers.data.items.map((r) => (
            <Chip key={r.id} variant="outlined" label={`${r.display_name}: ${t('admin.loadCount', { count: load.get(r.id) ?? 0 })}`} />
          ))}
          {reviewers.data.items.length === 0 && <Alert severity="warning">{t('admin.noReviewers')}</Alert>}
        </Stack>
      )}

      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" sx={{ rowGap: 1 }}>
        <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_, v: Filter | null) => v && setFilter(v)}>
          <ToggleButton value="all">{t('reviews.filterAll')}</ToggleButton>
          <ToggleButton value="unassigned">{t('reviews.unassigned')}</ToggleButton>
          <ToggleButton value="assigned">{t('admin.assigned')}</ToggleButton>
        </ToggleButtonGroup>
        <Chip
          label={t('reviews.filterOverdue')}
          clickable
          color={overdueOnly ? 'primary' : 'default'}
          variant={overdueOnly ? 'filled' : 'outlined'}
          onClick={() => {
            const p = new URLSearchParams(params)
            if (overdueOnly) p.delete('overdue')
            else p.set('overdue', '1')
            setParams(p)
          }}
        />
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}
      {queue.isPending && <LoadingState />}
      {queue.isError && <ErrorState onRetry={() => void queue.refetch()} />}
      {queue.data && items.length === 0 && <EmptyState>{t('reviews.queueEmpty')}</EmptyState>}

      <Stack spacing={1.5} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {items
          .slice()
          .sort((a, b) => Number(b.unassigned_overdue || b.overdue) - Number(a.unassigned_overdue || a.overdue))
          .map((item) => {
            const late = item.overdue || item.unassigned_overdue
            return (
              <Card
                key={`${item.kind}-${item.id}`}
                component="li"
                sx={{ p: 2, borderColor: late ? 'warning.main' : undefined, borderLeftWidth: item.assigned_to === null ? 4 : 1 }}
              >
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ rowGap: 0.5 }}>
                      <Typography
                        component={RouterLink}
                        to={itemPath(item)}
                        fontWeight={600}
                        sx={{ color: 'text.primary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                      >
                        {item.skill_name}
                      </Typography>
                      {item.kind === 'version' ? (
                        <Chip size="small" label={`v${item.version}`} />
                      ) : (
                        <Chip size="small" color="secondary" label={t('reviews.kindVisibility')} />
                      )}
                      {item.origin === 'imported' && <Chip size="small" variant="outlined" label={t('card.external')} />}
                      {late && <Chip size="small" color="warning" label={`⚠ ${t('reviews.overdue')}`} />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {t('reviews.waiting', { count: waitingDays(item.submitted_at) })}
                    </Typography>
                  </Box>
                  <Select
                    size="small"
                    displayEmpty
                    value={item.assigned_to === null ? NONE : String(item.assigned_to)}
                    disabled={assign.isPending}
                    sx={{ minWidth: 220 }}
                    inputProps={{ 'aria-label': t('admin.assignTo', { name: item.skill_name }) }}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v === NONE && item.kind === 'visibility') return // không có thao tác bỏ giao cho yêu cầu phạm vi
                      assign.mutate({ item, reviewerId: v === NONE ? null : Number(v) })
                    }}
                  >
                    <MenuItem value={NONE} disabled={item.kind === 'visibility'}>
                      {t('reviews.unassigned')}
                    </MenuItem>
                    {(reviewers.data?.items ?? []).map((r) => (
                      <MenuItem key={r.id} value={String(r.id)}>
                        {r.display_name} ({load.get(r.id) ?? 0})
                      </MenuItem>
                    ))}
                  </Select>
                </Stack>
              </Card>
            )
          })}
      </Stack>
    </Stack>
  )
}
