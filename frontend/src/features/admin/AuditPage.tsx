import DownloadIcon from '@mui/icons-material/FileDownloadOutlined'
import {
  Alert, Box, Button, Card, Chip, Collapse, MenuItem, Pagination, Stack, TextField, Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { auditKeys, exportAudit, fetchAudit, type AuditQuery } from '../../api/admin'
import { ApiError } from '../../api/client'
import type { AuditItemData } from '../../api/types'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'
import { saveTextFile } from '../../utils/download'

const PAGE_SIZE = 25
const TARGET_TYPES = ['skill', 'skill_version', 'tag', 'source', 'review', 'visibility_request', 'audit_log']

/** `datetime-local` (giờ máy) → ISO UTC cho backend. */
export function toIso(local: string | null): string | undefined {
  if (!local) return undefined
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function AuditRow({ item }: { item: AuditItemData }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <Card component="li">
      <Box
        component="button"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        sx={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%', boxSizing: 'border-box', p: 1.5 }}
      >
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ rowGap: 0.5 }}>
          <Chip size="small" label={item.action} />
          <Typography variant="body2">
            {item.target_type}
            {item.target_id !== null ? ` #${item.target_id}` : ''}
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="caption" color="text.secondary">
            {item.actor_name ?? t('admin.audit.system')} · {new Date(item.created_at).toLocaleString()}
          </Typography>
        </Stack>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box component="pre" sx={{ m: 0, px: 1.5, pb: 1.5, fontSize: '0.8rem', overflow: 'auto' }}>
          {JSON.stringify({ actor_email: item.actor_email, detail: item.detail }, null, 2)}
        </Box>
      </Collapse>
    </Card>
  )
}

export function AuditPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const targetId = Number(params.get('target_id'))
  const filter: AuditQuery = {
    action: params.get('action') || undefined,
    target_type: params.get('target_type') || undefined,
    target_id: Number.isInteger(targetId) && targetId > 0 ? targetId : undefined,
    from: toIso(params.get('from')),
    to: toIso(params.get('to')),
  }
  const query = { ...filter, page, page_size: PAGE_SIZE }
  const logs = useQuery({ queryKey: auditKeys.list(query), queryFn: () => fetchAudit(query) })
  const pages = Math.max(1, Math.ceil((logs.data?.total ?? 0) / PAGE_SIZE))

  function set(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('page')
    setParams(next)
  }

  async function exportCsv() {
    setError(null)
    setExporting(true)
    try {
      const csv = await exportAudit(filter)
      saveTextFile(`audit-logs-${new Date().toISOString().slice(0, 10)}.csv`, csv)
    } catch (e) {
      setError(e instanceof ApiError && e.status === 413 ? t('admin.audit.tooLarge') : t('state.error'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="h5" component="h1">{t('admin.tab.audit')}</Typography>
        <Button startIcon={<DownloadIcon />} variant="outlined" disabled={exporting} onClick={() => void exportCsv()}>
          {t('admin.audit.export')}
        </Button>
      </Stack>

      <Box component="form" role="search" onSubmit={(e) => e.preventDefault()}
        sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(5, 1fr)' } }}>
        <TextField size="small" label={t('admin.audit.action')} value={params.get('action') ?? ''}
          onChange={(e) => set('action', e.target.value.trim())} />
        <TextField size="small" select label={t('admin.audit.targetType')} value={params.get('target_type') ?? ''}
          onChange={(e) => set('target_type', e.target.value)}>
          <MenuItem value="">{t('reviews.filterAll')}</MenuItem>
          {TARGET_TYPES.map((x) => <MenuItem key={x} value={x}>{x}</MenuItem>)}
        </TextField>
        <TextField size="small" type="number" label={t('admin.audit.targetId')} value={params.get('target_id') ?? ''}
          onChange={(e) => set('target_id', e.target.value)} />
        <TextField size="small" type="datetime-local" label={t('admin.audit.from')} value={params.get('from') ?? ''}
          onChange={(e) => set('from', e.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField size="small" type="datetime-local" label={t('admin.audit.to')} value={params.get('to') ?? ''}
          onChange={(e) => set('to', e.target.value)} InputLabelProps={{ shrink: true }} />
      </Box>

      {error && <Alert severity="error">{error}</Alert>}
      {logs.isPending && <LoadingState />}
      {logs.isError && <ErrorState onRetry={() => void logs.refetch()} />}
      {logs.data && (
        <Typography color="text.secondary" aria-live="polite">{t('search.results', { count: logs.data.total })}</Typography>
      )}
      {logs.data?.items.length === 0 && <EmptyState>{t('admin.audit.empty')}</EmptyState>}
      <Stack component="ul" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {logs.data?.items.map((item) => <AuditRow key={item.id} item={item} />)}
      </Stack>
      {pages > 1 && (
        <Pagination
          sx={{ alignSelf: 'center' }} count={pages} page={Math.min(page, pages)}
          onChange={(_, p) => {
            const next = new URLSearchParams(params)
            if (p === 1) next.delete('page')
            else next.set('page', String(p))
            setParams(next)
          }}
        />
      )}
    </Stack>
  )
}
