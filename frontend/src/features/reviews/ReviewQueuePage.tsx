import { Alert, Box, Button, Card, CardActionArea, Chip, Container, Pagination, Stack, Tab, Tabs, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { fetchHistory, fetchQueue, reviewKeys, type QueueParams } from '../../api/reviews'
import type { QueueItemData } from '../../api/types'
import { useAuth } from '../../auth/AuthProvider'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'

export function waitingDays(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000))
}

export function itemPath(item: Pick<QueueItemData, 'kind' | 'id'>): string {
  return item.kind === 'version' ? `/reviews/${item.id}` : `/reviews/visibility/${item.id}`
}

function QueueCard({ item, isManager }: { item: QueueItemData; isManager: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const days = waitingDays(item.submitted_at)
  return (
    <Card sx={item.overdue || item.unassigned_overdue ? { borderColor: 'warning.main' } : undefined}>
      <CardActionArea onClick={() => navigate(itemPath(item))} sx={{ p: 2 }}>
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
      {queue.isPending && <LoadingState />}
      {queue.isError && <ErrorState onRetry={() => void queue.refetch()} />}
      {queue.data?.items.length === 0 && <EmptyState>{t('reviews.queueEmpty')}</EmptyState>}
      <Stack spacing={1.5} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {queue.data?.items.map((item) => (
          <li key={`${item.kind}-${item.id}`}>
            <QueueCard item={item} isManager={isManager} />
          </li>
        ))}
      </Stack>
      {pages > 1 && <Pagination sx={{ alignSelf: 'center' }} count={pages} page={page} onChange={(_, p) => setPage(p)} />}
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
        {!isManager && (
          <Tabs value={tab} onChange={(_, v: 'queue' | 'history') => setTab(v)}>
            <Tab value="queue" label={t('reviews.tabQueue')} />
            <Tab value="history" label={t('reviews.tabHistory')} />
          </Tabs>
        )}
        {tab === 'queue' || isManager ? <Queue isManager={isManager} /> : <History />}
      </Stack>
    </Container>
  )
}
