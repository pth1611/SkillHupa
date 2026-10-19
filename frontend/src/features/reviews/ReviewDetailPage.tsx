import {
  Alert, Avatar, Box, Button, Chip, Container, List, ListItemButton, ListItemText, Paper, Stack, Tab, Tabs,
  ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import {
  decideVersion, fetchReview, fetchReviewFile, fetchReviewFiles, reviewIconUrl, reviewKeys, reviewPackageUrl,
} from '../../api/reviews'
import type { ReviewFileEntry } from '../../api/types'
import { useAuth } from '../../auth/AuthProvider'
import { MarkdownView } from '../../components/MarkdownView'
import { ErrorState, LoadingState } from '../../components/StateViews'
import { NotFoundPage } from '../common/pages'
import { ValidationList } from '../studio/ValidationList'
import { DecisionPanel } from './DecisionPanel'
import { DiffView, PlainView } from './DiffView'
import { waitingDays } from './ReviewQueuePage'

const MARK = { added: '+', modified: '~', removed: '−', unchanged: '' } as const
type FileFilter = 'all' | 'changed' | 'warnings'

function FileViewer({ versionId, file, onViewed }: { versionId: number; file: ReviewFileEntry; onViewed: (path: string) => void }) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'diff' | 'new' | 'old'>('diff')
  const content = useQuery({
    queryKey: reviewKeys.content(versionId, file.path),
    queryFn: () => fetchReviewFile(versionId, file.path),
  })
  const loaded = content.isSuccess
  useEffect(() => {
    if (loaded) onViewed(file.path)
  }, [loaded, file.path, onViewed])

  if (content.isPending) return <LoadingState />
  if (content.isError) return <ErrorState onRetry={() => void content.refetch()} />
  const c = content.data
  const warnings = new Map<number, string[]>()
  for (const w of c.warnings) {
    if (w.line) warnings.set(w.line, [...(warnings.get(w.line) ?? []), w.detail])
  }
  const fileWarnings = c.warnings.filter((w) => !w.line)

  if (!c.is_text || c.too_large) {
    return (
      <Stack spacing={1}>
        <Alert severity="info">{c.too_large ? t('reviews.tooLarge') : t('reviews.binary')}</Alert>
        <Typography variant="body2">{t('reviews.fileSize', { size: c.size })}</Typography>
        <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>sha256: {c.sha256}</Typography>
      </Stack>
    )
  }

  return (
    <Stack spacing={1}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
        <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>{c.path}</Typography>
        {c.warnings.length > 0 && <Chip size="small" color="warning" label={`⚠ ${c.warnings.length}`} />}
      </Stack>
      {fileWarnings.map((w, i) => (
        <Alert key={i} severity="warning">{w.detail}</Alert>
      ))}
      <Tabs value={mode} onChange={(_, v: typeof mode) => setMode(v)}>
        <Tab value="diff" label={t('reviews.viewDiff')} />
        <Tab value="new" label={t('reviews.viewNew')} disabled={c.new === null} />
        <Tab value="old" label={t('reviews.viewOld')} disabled={c.old === null} />
      </Tabs>
      <Paper variant="outlined" sx={{ p: 1, maxHeight: 520, overflow: 'auto' }}>
        {mode === 'diff' && (c.diff ? <DiffView diff={c.diff} warningsByLine={warnings} /> : <Typography variant="body2" color="text.secondary">{t('reviews.noChanges')}</Typography>)}
        {mode === 'new' && c.new !== null && <PlainView text={c.new} warningsByLine={warnings} />}
        {mode === 'old' && c.old !== null && <PlainView text={c.old} warningsByLine={new Map()} />}
      </Paper>
    </Stack>
  )
}

export function ReviewDetailPage() {
  const { t } = useTranslation()
  const { versionId } = useParams()
  const id = Number(versionId)
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<FileFilter>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [viewed, setViewed] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const valid = Number.isInteger(id) && id > 0
  const detail = useQuery({ queryKey: reviewKeys.detail(id), queryFn: () => fetchReview(id), enabled: valid, retry: false })
  const files = useQuery({ queryKey: reviewKeys.files(id), queryFn: () => fetchReviewFiles(id), enabled: valid && detail.isSuccess })

  const decide = useMutation({
    mutationFn: (v: { decision: 'approved' | 'rejected'; comment: string | null }) => decideVersion(id, v.decision, v.comment),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: reviewKeys.all })
      navigate('/reviews', { replace: true })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('state.error')),
  })

  const markViewed = useCallback((path: string) => setViewed((prev) => (prev.has(path) ? prev : new Set(prev).add(path))), [])

  const shownFiles = useMemo(() => {
    const all = files.data ?? []
    if (filter === 'changed') return all.filter((f) => f.status !== 'unchanged')
    if (filter === 'warnings') return all.filter((f) => f.warnings > 0)
    return all
  }, [files.data, filter])

  if (!valid || (detail.error instanceof ApiError && detail.error.status === 404)) return <NotFoundPage />
  if (detail.isPending) return <LoadingState fullPage />
  if (detail.isError) return <ErrorState fullPage onRetry={() => void detail.refetch()} />

  const d = detail.data
  const current = files.data?.find((f) => f.path === selected) ?? null
  const unseen = (files.data ?? []).filter((f) => f.warnings > 0 && !viewed.has(f.path)).length
  const canDecide = user?.role === 'reviewer' && d.status === 'pending'
  const waiting = d.submitted_at ? waitingDays(d.submitted_at) : 0

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack spacing={2.5}>
        <Box>
          <Button component={RouterLink} to="/reviews" size="small">← {t('reviews.backToQueue')}</Button>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            {d.has_icon && <Avatar variant="rounded" src={reviewIconUrl(d.version_id)} alt="" sx={{ width: 48, height: 48 }} />}
            <Typography variant="h5" component="h1">
              {d.skill_name}
            </Typography>
            <Chip label={`v${d.version}`} />
            {d.base_version && (
              <Typography variant="body2" color="text.secondary">
                {t('reviews.comparedTo', { version: d.base_version })}
              </Typography>
            )}
            {d.origin === 'imported' && <Chip size="small" variant="outlined" label={t('card.external')} />}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {[
              d.owner_name && t('reviews.owner', { name: d.owner_name }),
              d.department,
              d.assigned_by_name && t('reviews.assignedBy', { name: d.assigned_by_name }),
              t('reviews.waiting', { count: waiting }),
            ].filter(Boolean).join(' · ')}
          </Typography>
          {d.summary && <Typography sx={{ mt: 1 }}>{d.summary}</Typography>}
          {d.changelog && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
              {t('studio.changelog')}: {d.changelog}
            </Typography>
          )}
          <Button size="small" component="a" href={reviewPackageUrl(d.version_id)} sx={{ mt: 0.5 }}>
            {t('reviews.downloadPackage')}
          </Button>
        </Box>

        {d.status !== 'pending' && <Alert severity="info">{t('reviews.notPending')}</Alert>}

        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '320px minmax(0, 1fr)' } }}>
          <Paper variant="outlined" sx={{ alignSelf: 'start' }}>
            <Box sx={{ p: 1 }}>
              <ToggleButtonGroup size="small" exclusive fullWidth value={filter} onChange={(_, v: FileFilter | null) => v && setFilter(v)}>
                <ToggleButton value="all">{t('reviews.filterAll')}</ToggleButton>
                <ToggleButton value="changed">{t('reviews.filterChanged')}</ToggleButton>
                <ToggleButton value="warnings">{t('reviews.filterWarnings')}</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            {files.isPending && <LoadingState />}
            <List dense disablePadding sx={{ maxHeight: 520, overflow: 'auto' }}>
              {shownFiles.map((f) => (
                <ListItemButton key={f.path} selected={f.path === selected} onClick={() => setSelected(f.path)}>
                  <ListItemText
                    primary={f.path}
                    primaryTypographyProps={{ sx: { overflowWrap: 'anywhere', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.8rem' } }}
                  />
                  {MARK[f.status] && <Chip size="small" label={MARK[f.status]} sx={{ ml: 0.5 }} />}
                  {f.warnings > 0 && <Chip size="small" color="warning" label={`⚠${f.warnings}`} sx={{ ml: 0.5 }} />}
                </ListItemButton>
              ))}
            </List>
          </Paper>

          <Box sx={{ minWidth: 0 }}>
            {current ? (
              <FileViewer
                key={current.path}
                versionId={id}
                file={current}
                onViewed={markViewed}
              />
            ) : (
              <Stack spacing={2}>
                <Typography color="text.secondary">{t('reviews.pickFile')}</Typography>
                {d.skill_md && (
                  <>
                    <Typography variant="h6" component="h2">{t('detail.content')}</Typography>
                    <MarkdownView source={d.skill_md} />
                  </>
                )}
              </Stack>
            )}
          </Box>
        </Box>

        <Box component="section">
          <Typography variant="h6" component="h2" gutterBottom>{t('studio.validationTitle')}</Typography>
          <ValidationList results={d.validation} />
        </Box>

        {canDecide ? (
          <DecisionPanel
            busy={decide.isPending}
            error={error}
            unseenWarnings={unseen}
            onSubmit={(decision, comment) => decide.mutate({ decision, comment })}
          />
        ) : (
          user?.role === 'manager' && <Alert severity="info">{t('reviews.managerReadOnly')}</Alert>
        )}
      </Stack>
    </Container>
  )
}
