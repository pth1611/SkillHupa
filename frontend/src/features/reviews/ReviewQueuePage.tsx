import {
  Alert, Box, Button, Card, CardActionArea, Checkbox, Chip, Container, Dialog, DialogActions, DialogContent, DialogContentText,
  DialogTitle, FormControlLabel, IconButton, Pagination, Stack, Tab, Tabs, Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import { decideVersion, fetchHistory, fetchQueue, reviewKeys, type QueueParams } from '../../api/reviews'
import type { QueueItemData } from '../../api/types'
import { useAuth } from '../../auth/AuthProvider'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'
import { ReviewDetailView } from './ReviewDetailPage'
import { VisibilityReviewView } from './VisibilityReviewPage'

export function waitingDays(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000))
}

export function itemPath(item: Pick<QueueItemData, 'kind' | 'id'>): string {
  return item.kind === 'version' ? `/reviews/${item.id}` : `/reviews/visibility/${item.id}`
}

interface QueueCardProps {
  item: QueueItemData
  isManager: boolean
  checked: boolean
  onCheck: (on: boolean) => void
  onOpen: () => void
}

function QueueCard({ item, isManager, checked, onCheck, onOpen }: QueueCardProps) {
  const { t } = useTranslation()
  const days = waitingDays(item.submitted_at)
  return (
    <Card sx={{ display: 'flex', alignItems: 'center', ...(item.overdue || item.unassigned_overdue ? { borderColor: 'warning.main' } : {}) }}>
      {item.kind === 'version' ? (
        <Checkbox
          sx={{ ml: 1 }}
          checked={checked}
          onChange={(_, on) => onCheck(on)}
          inputProps={{ 'aria-label': t('admin.selectItem', { name: item.skill_name }) }}
        />
      ) : (
        <Box sx={{ width: 58, flexShrink: 0 }} />
      )}
      <CardActionArea onClick={onOpen} sx={{ p: 2, pl: 0.5 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ rowGap: 0.5 }}>
          <Typography fontWeight={600}>{item.skill_name}</Typography>
          {item.kind === 'version' ? (
            <Chip size="small" label={`v${item.version}`} />
          ) : (
            <Chip size="small" color="secondary" label={t('reviews.kindVisibility')} />
          )}
          {item.origin === 'imported' && <Chip size="small" variant="outlined" label={t('card.external')} />}
          {item.kind === 'visibility' && (
            <Typography variant="caption" color="text.secondary">
              {item.from_visibility} → {item.to_visibility}
            </Typography>
          )}
          <Box sx={{ flexGrow: 1 }} />
          {(item.overdue || item.unassigned_overdue) && (
            <Chip size="small" color="warning" label={`⚠ ${t('reviews.overdue')}`} />
          )}
          <Typography variant="caption" color="text.secondary">
            {t('reviews.waiting', { count: days })}
          </Typography>
        </Stack>
        {isManager && (
          <Typography variant="caption" color="text.secondary">
            {item.assigned_to_name ? t('reviews.assignedTo', { name: item.assigned_to_name }) : t('reviews.unassigned')}
          </Typography>
        )}
      </CardActionArea>
    </Card>
  )
}

function Queue({ isManager }: { isManager: boolean }) {
  const { t } = useTranslation()
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const [page, setPage] = useState(1)
  const params: QueueParams = {
    page,
    page_size: 20,
    overdue: onlyOverdue || undefined,
    assigned: onlyUnassigned ? false : undefined,
  }
  const queue = useQuery({ queryKey: reviewKeys.queue(params), queryFn: () => fetchQueue(params) })
  const pages = Math.max(1, Math.ceil((queue.data?.total ?? 0) / 20))
  const queryClient = useQueryClient()
  const [open, setOpen] = useState<Pick<QueueItemData, 'kind' | 'id'> | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null)
  const versionItems = (queue.data?.items ?? []).filter((i) => i.kind === 'version')
  const allPicked = versionItems.length > 0 && versionItems.every((i) => picked.has(i.id))

  const approveMany = useMutation({
    mutationFn: async (ids: number[]) => {
      const results = await Promise.allSettled(ids.map((id) => decideVersion(id, 'approved', null)))
      return { ok: results.filter((r) => r.status === 'fulfilled').length, total: ids.length }
    },
    onSuccess: ({ ok, total }) => {
      setConfirming(false)
      setPicked(new Set())
      setMessage(
        ok === total
          ? { severity: 'success', text: t('reviews.bulkApproved', { count: ok }) }
          : { severity: 'error', text: t('reviews.bulkApprovePartial', { ok, total }) },
      )
      void queryClient.invalidateQueries({ queryKey: reviewKeys.all })
    },
  })
  function togglePick(id: number, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }
  function closeDialog() {
    setOpen(null)
    void queryClient.invalidateQueries({ queryKey: reviewKeys.all })
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} flexWrap="wrap">
        <Chip
          label={t('reviews.filterOverdue')}
          clickable
          color={onlyOverdue ? 'primary' : 'default'}
          variant={onlyOverdue ? 'filled' : 'outlined'}
          onClick={() => {
            setOnlyOverdue((v) => !v)
            setPage(1)
          }}
        />
        {isManager && (
          <Chip
            label={t('reviews.filterUnassigned')}
            clickable
            color={onlyUnassigned ? 'primary' : 'default'}
            variant={onlyUnassigned ? 'filled' : 'outlined'}
            onClick={() => {
              setOnlyUnassigned((v) => !v)
              setPage(1)
            }}
          />
        )}
      </Stack>
      {message && <Alert severity={message.severity} onClose={() => setMessage(null)}>{message.text}</Alert>}
      {queue.isPending && <LoadingState />}
      {queue.isError && <ErrorState onRetry={() => void queue.refetch()} />}
      {queue.data?.items.length === 0 && <EmptyState>{t('reviews.queueEmpty')}</EmptyState>}
      {versionItems.length > 0 && (
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={allPicked}
              onChange={(_, on) => setPicked(on ? new Set(versionItems.map((i) => i.id)) : new Set())}
            />
          }
          label={t('admin.selectAll', { count: versionItems.length })}
        />
      )}
      <Stack spacing={1.5} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {queue.data?.items.map((item) => (
          <li key={`${item.kind}-${item.id}`}>
            <QueueCard
              item={item}
              isManager={isManager}
              checked={picked.has(item.id)}
              onCheck={(on) => togglePick(item.id, on)}
              onOpen={() => setOpen({ kind: item.kind, id: item.id })}
            />
          </li>
        ))}
      </Stack>
      {pages > 1 && <Pagination sx={{ alignSelf: 'center' }} count={pages} page={page} onChange={(_, p) => setPage(p)} />}

      {picked.size > 0 && (
        <Card elevation={4} sx={{ position: 'sticky', bottom: 16, p: 1.5, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography sx={{ flexGrow: 1 }}>{t('reviews.pickedCount', { count: picked.size })}</Typography>
          <Button size="small" onClick={() => setPicked(new Set())}>{t('admin.clearSelection')}</Button>
          <Button variant="contained" color="success" onClick={() => setConfirming(true)}>
            {t('reviews.quickApprove', { count: picked.size })}
          </Button>
        </Card>
      )}

      <Dialog open={confirming} onClose={() => !approveMany.isPending && setConfirming(false)}>
        <DialogTitle>{t('reviews.quickApprove', { count: picked.size })}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('reviews.quickApproveWarn')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={approveMany.isPending} onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" color="success" disabled={approveMany.isPending} onClick={() => approveMany.mutate([...picked])}>
            {t('reviews.confirmApprove')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={open !== null} onClose={closeDialog} fullWidth maxWidth="xl" scroll="paper">
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: 1, pt: 1 }}>
          <IconButton aria-label={t('common.close')} onClick={closeDialog}>✕</IconButton>
        </Box>
        <DialogContent>
          {open?.kind === 'version' && <ReviewDetailView embedded id={open.id} onDecided={closeDialog} />}
          {open?.kind === 'visibility' && <VisibilityReviewView embedded id={open.id} onDecided={closeDialog} />}
        </DialogContent>
      </Dialog>
    </Stack>
  )
}

function History() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const history = useQuery({ queryKey: reviewKeys.history(page), queryFn: () => fetchHistory(page) })
  const pages = Math.max(1, Math.ceil((history.data?.total ?? 0) / 20))
  return (
    <Stack spacing={1.5}>
      {history.isPending && <LoadingState />}
      {history.isError && <ErrorState onRetry={() => void history.refetch()} />}
      {history.data?.items.length === 0 && <EmptyState>{t('reviews.historyEmpty')}</EmptyState>}
      {history.data?.items.map((h) => (
        <Card key={`${h.kind}-${h.id}`}>
          <Stack sx={{ p: 2 }} spacing={0.5}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Typography fontWeight={600}>{h.skill_name}</Typography>
              {h.version && <Chip size="small" label={`v${h.version}`} />}
              <Chip
                size="small"
                color={h.decision === 'approved' ? 'success' : 'error'}
                label={t(h.decision === 'approved' ? 'reviews.approved' : 'reviews.rejected')}
              />
              <Typography variant="caption" color="text.secondary">
                {new Date(h.decided_at).toLocaleString()}
              </Typography>
            </Stack>
            {h.comment && <Typography variant="body2" color="text.secondary">{h.comment}</Typography>}
          </Stack>
        </Card>
      ))}
      {pages > 1 && <Pagination sx={{ alignSelf: 'center' }} count={pages} page={page} onChange={(_, p) => setPage(p)} />}
    </Stack>
  )
}

export function ReviewQueuePage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const isManager = user?.role === 'manager'
  const [tab, setTab] = useState<'queue' | 'history'>('queue')

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Stack spacing={2.5}>
        <Typography variant="h5" component="h1">
          {t('reviews.title')}
        </Typography>
        {isManager && (
          <Alert
            severity="info"
            action={
              <Button color="inherit" size="small" component={RouterLink} to="/admin/assignments">
                {t('reviews.goAssignments')}
              </Button>
            }
          >
            {t('reviews.managerNote')}
          </Alert>
        )}
        {(
          <Tabs value={tab} onChange={(_, v: 'queue' | 'history') => setTab(v)}>
            <Tab value="queue" label={t('reviews.tabQueue')} />
            <Tab value="history" label={t('reviews.tabHistory')} />
          </Tabs>
        )}
        {tab === 'queue' ? <Queue isManager={isManager} /> : <History />}
      </Stack>
    </Container>
  )
}
