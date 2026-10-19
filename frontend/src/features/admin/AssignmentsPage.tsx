import {
  Alert, Box, Button, Card, Checkbox, Chip, FormControlLabel, Radio, Stack, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import { adminKeys, bulkAssign, fetchUsers, unassignVersion } from '../../api/admin'
import { ApiError } from '../../api/client'
import { fetchQueue, reviewKeys } from '../../api/reviews'
import type { QueueItemData } from '../../api/types'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'
import { itemPath, waitingDays } from '../reviews/ReviewQueuePage'

type Filter = 'all' | 'unassigned' | 'assigned'
const keyOf = (i: QueueItemData) => `${i.kind}-${i.id}`

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
  const [notice, setNotice] = useState<string | null>(null)
  const [reviewerId, setReviewerId] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

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
  const managers = useQuery({
    queryKey: adminKeys.users({ role: 'manager' }),
    queryFn: () => fetchUsers({ role: 'manager', page_size: 100 }),
  })
  const assignees = [...(reviewers.data?.items ?? []), ...(managers.data?.items ?? [])].filter(
    (u, i, a) => a.findIndex((x) => x.id === u.id) === i,
  )
  const chosen = assignees.find((u) => u.id === reviewerId) ?? null

  const all = useMemo(() => queue.data ?? [], [queue.data])
  const load = useMemo(() => workloads(all), [all])
  const items = all
    .filter(
      (i) =>
        (filter === 'all' || (filter === 'unassigned' ? i.assigned_to === null : i.assigned_to !== null)) &&
        (!overdueOnly || i.overdue || i.unassigned_overdue) &&
        (!kind || i.kind === kind),
    )
    .sort((a, b) => Number(b.unassigned_overdue || b.overdue) - Number(a.unassigned_overdue || a.overdue))
  const picked = all.filter((i) => selected.has(keyOf(i)))
  const toAssign = picked.filter((i) => i.assigned_to !== reviewerId)
  const toUnassign = picked.filter((i) => i.assigned_to === reviewerId && i.kind === 'version')
  const allShown = items.length > 0 && items.every((i) => selected.has(keyOf(i)))

  const refresh = () => {
    setSelected(new Set())
    void queryClient.invalidateQueries({ queryKey: adminKeys.assignQueue })
    void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard })
    void queryClient.invalidateQueries({ queryKey: reviewKeys.all })
  }
  const assign = useMutation({
    mutationFn: () => bulkAssign(reviewerId as number, toAssign.map((i) => ({ kind: i.kind, id: i.id }))),
    onSuccess: (results) => {
      const failed = results.filter((r) => r.error).length
      setError(failed ? t('admin.bulkPartial', { failed, total: results.length }) : null)
      setNotice(failed ? null : t('admin.bulkDone', { count: results.length, name: chosen?.display_name }))
      refresh()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('state.error')),
  })
  const unassign = useMutation({
    mutationFn: () => Promise.all(toUnassign.map((i) => unassignVersion(i.id))),
    onSuccess: () => {
      setError(null)
      setNotice(null)
      refresh()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('state.error')),
  })
  const busy = assign.isPending || unassign.isPending

  function setFilter(next: Filter) {
    const p = new URLSearchParams(params)
    if (next === 'all') p.delete('filter')
    else p.set('filter', next)
    setParams(p)
  }
  function toggle(key: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }
  function toggleAll(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const i of items) {
        if (on) next.add(keyOf(i))
        else next.delete(keyOf(i))
      }
      return next
    })
  }

  return (
    <Stack spacing={2.5}>
      <Typography variant="h5" component="h1">
        {t('admin.tab.assignments')}
      </Typography>

      {reviewers.data && reviewers.data.items.length === 0 && <Alert severity="warning">{t('admin.noReviewers')}</Alert>}

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t('admin.pickReviewer')}
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ rowGap: 1 }} role="radiogroup" aria-label={t('admin.reviewerLoad')}>
          {assignees.map((r) => (
            <Card key={r.id} variant="outlined" sx={{ px: 1.5, borderColor: r.id === reviewerId ? 'primary.main' : undefined }}>
              <FormControlLabel
                control={<Radio size="small" checked={r.id === reviewerId} onChange={() => setReviewerId(r.id)} />}
                label={`${r.display_name}: ${t('admin.loadCount', { count: load.get(r.id) ?? 0 })}`}
              />
            </Card>
          ))}
        </Stack>
      </Box>

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
        {items.length > 0 && (
          <FormControlLabel
            sx={{ ml: 'auto' }}
            control={<Checkbox size="small" checked={allShown} onChange={(_, on) => toggleAll(on)} />}
            label={t('admin.selectAll', { count: items.length })}
          />
        )}
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}
      {queue.isPending && <LoadingState />}
      {queue.isError && <ErrorState onRetry={() => void queue.refetch()} />}
      {queue.data && items.length === 0 && <EmptyState>{t('reviews.queueEmpty')}</EmptyState>}

      <Stack spacing={1.5} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {items.map((item) => {
          const late = item.overdue || item.unassigned_overdue
          return (
            <Card
              key={keyOf(item)}
              component="li"
              sx={{ p: 2, borderColor: late ? 'warning.main' : undefined, borderLeftWidth: item.assigned_to === null ? 4 : 1 }}
            >
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Checkbox
                  checked={selected.has(keyOf(item))}
                  onChange={(_, on) => toggle(keyOf(item), on)}
                  inputProps={{ 'aria-label': t('admin.selectItem', { name: item.skill_name }) }}
                />
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
                <Chip
                  size="small"
                  variant={item.assigned_to === null ? 'outlined' : 'filled'}
                  color={item.assigned_to === null ? 'default' : 'primary'}
                  label={item.assigned_to === null ? t('reviews.unassigned') : (item.assigned_to_name ?? '')}
                />
              </Stack>
            </Card>
          )
        })}
      </Stack>

      {selected.size > 0 && (
        <Card
          elevation={4}
          sx={{ position: 'sticky', bottom: 16, p: 1.5, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Typography sx={{ flexGrow: 1 }}>
            {chosen ? t('admin.selectedFor', { count: selected.size, name: chosen.display_name }) : t('admin.selectedNoReviewer', { count: selected.size })}
          </Typography>
          <Button size="small" onClick={() => setSelected(new Set())}>
            {t('admin.clearSelection')}
          </Button>
          {toUnassign.length > 0 && (
            <Button size="small" color="inherit" variant="outlined" disabled={busy} onClick={() => unassign.mutate()}>
              {t('admin.unassignN', { count: toUnassign.length })}
            </Button>
          )}
          <Button variant="contained" disabled={busy || !chosen || toAssign.length === 0} onClick={() => assign.mutate()}>
            {t('admin.assignN', { count: toAssign.length })}
          </Button>
        </Card>
      )}
    </Stack>
  )
}
