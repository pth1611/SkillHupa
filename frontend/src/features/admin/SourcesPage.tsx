import AddIcon from '@mui/icons-material/Add'
import {
  Alert, Box, Button, Card, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  LinearProgress, MenuItem, Pagination, Snackbar, Stack, Switch, TextField, Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { categoryLabel } from '../../i18n/taxonomyLabels'
import {
  adminKeys, createSource, deleteSource, fetchScans, fetchSources, scanSource, sourceKeys, updateSource,
  type SourceInput,
} from '../../api/admin'
import { ApiError } from '../../api/client'
import { fetchCategories, fetchDepartments, skillKeys } from '../../api/skills'
import type { ScanItemData, SourceData } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'

const OUTCOME_COLOR = { new_skill: 'success', new_version: 'success', unchanged: 'default', skipped: 'warning', error: 'error' } as const

/** Tên bí mật phải dạng SOURCE_TOKEN_<TÊN_VIẾT_HOA> (backend chỉ đọc biến có tiền tố này). */
export const CREDENTIAL_RE = /^SOURCE_TOKEN_[A-Z0-9_]{1,80}$/

function SourceForm({ source, onClose, onSaved }: { source: SourceData | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const categories = useQuery({ queryKey: skillKeys.categories, queryFn: fetchCategories })
  const departments = useQuery({ queryKey: skillKeys.departments, queryFn: fetchDepartments })
  const [url, setUrl] = useState(source?.url ?? '')
  const [name, setName] = useState(source?.name ?? '')
  const [ref, setRef] = useState(source?.ref ?? '')
  const [path, setPath] = useState(source?.path_glob ?? '')
  const [category, setCategory] = useState<number | 'auto' | ''>(source ? (source.default_category ?? 'auto') : '')
  const [department, setDepartment] = useState(source?.default_department ?? '')
  const [visibility, setVisibility] = useState<'company' | 'department'>(source?.default_visibility ?? 'company')
  const [credential, setCredential] = useState(source?.credential_name ?? '')
  const [internal, setInternal] = useState(source?.internal ?? false)
  const [error, setError] = useState<string | null>(null)

  const credentialOk = !credential || CREDENTIAL_RE.test(credential)
  const urlOk = !!source || /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/.test(url.trim())
  const ready = urlOk && category !== '' && department.trim() !== '' && credentialOk

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim() || null, ref: ref.trim() || null, path_glob: path.trim(),
        default_category: category === 'auto' ? null : Number(category), default_department: department.trim(),
        default_visibility: visibility, credential_name: credential.trim() || null, internal,
      }
      return source
        ? updateSource(source.id, body)
        : createSource({ type: 'github', url: url.trim(), ...body } as SourceInput)
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : t('state.error')),
  })

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{source ? t('admin.sources.editTitle') : t('admin.sources.addTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label={t('admin.sources.url')} required disabled={!!source} value={url}
            onChange={(e) => setUrl(e.target.value)} error={!!url && !urlOk}
            helperText={t('admin.sources.urlHelp')} />
          <TextField label={t('admin.sources.name')} value={name} onChange={(e) => setName(e.target.value)} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField fullWidth label={t('admin.sources.ref')} value={ref} onChange={(e) => setRef(e.target.value)}
              helperText={t('admin.sources.refHelp')} />
            <TextField fullWidth label={t('admin.sources.path')} value={path} onChange={(e) => setPath(e.target.value)}
              helperText={t('admin.sources.pathHelp')} />
          </Stack>
          <TextField select required label={t('studio.category')} value={category}
            onChange={(e) => setCategory(e.target.value === 'auto' ? 'auto' : Number(e.target.value))}
            helperText={category === 'auto' ? t('admin.sources.categoryAutoHelp') : undefined}>
            <MenuItem value="auto">{t('admin.sources.categoryAuto')}</MenuItem>
            {(categories.data ?? []).map((c) => <MenuItem key={c.id} value={c.id}>{categoryLabel(t, c)}</MenuItem>)}
          </TextField>
          {(departments.data ?? []).length > 0 ? (
            <TextField select required label={t('studio.department')} value={department}
              onChange={(e) => setDepartment(e.target.value)}>
              {(departments.data ?? []).map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
            </TextField>
          ) : (
            <TextField required label={t('studio.department')} value={department}
              onChange={(e) => setDepartment(e.target.value)} />
          )}
          <TextField select label={t('studio.visibility')} value={visibility}
            onChange={(e) => setVisibility(e.target.value as 'company' | 'department')}>
            <MenuItem value="company">{t('studio.visibilityCompany')}</MenuItem>
            <MenuItem value="department">{t('studio.visibilityDepartment')}</MenuItem>
          </TextField>
          <TextField label={t('admin.sources.credential')} value={credential} error={!credentialOk}
            onChange={(e) => setCredential(e.target.value.trim())}
            helperText={credentialOk ? t('admin.sources.credentialHelp') : t('admin.sources.credentialInvalid')} />
          <FormControlLabel
            control={<Checkbox checked={internal} onChange={(e) => setInternal(e.target.checked)} />}
            label={t('admin.sources.internal')}
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={!ready || save.isPending} onClick={() => save.mutate()}>
          {t('admin.sources.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** Tiến độ quét trực tiếp: hỏi lại bản quét mới nhất mỗi giây trong lúc yêu cầu quét còn treo. */
function ScanProgress({ sourceId }: { sourceId: number }) {
  const { t } = useTranslation()
  const live = useQuery({
    queryKey: [...sourceKeys.scans(sourceId, 1), 'live'],
    queryFn: () => fetchScans(sourceId, 1),
    refetchInterval: 1000,
    gcTime: 0,
  })
  const scan = live.data?.items[0]
  if (!scan || scan.status !== 'running') return <LinearProgress />
  const done = scan.items.length
  const total = scan.total
  return (
    <Stack spacing={1} role="status" aria-live="polite">
      {total ? <LinearProgress variant="determinate" value={Math.min(100, (done / total) * 100)} /> : <LinearProgress />}
      <Typography variant="caption" color="text.secondary">
        {total ? t('admin.sources.progress', { done, total }) : t('admin.sources.progressListing')}
        {scan.message ? ` · ${scan.message}` : ''}
      </Typography>
      {scan.items.slice(-8).map((item, i) => (
        <Stack key={`${done}-${i}`} direction="row" spacing={1} alignItems="baseline" flexWrap="wrap">
          <Chip size="small" color={OUTCOME_COLOR[item.outcome] ?? 'default'}
            label={t(`admin.sources.outcome.${item.outcome}`, { defaultValue: item.outcome })} />
          <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{item.path}</Typography>
          {item.version && <Typography variant="caption">v{item.version}</Typography>}
        </Stack>
      ))}
    </Stack>
  )
}

function ScanHistory({ source, onClose }: { source: SourceData; onClose: () => void }) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const scans = useQuery({ queryKey: sourceKeys.scans(source.id, page), queryFn: () => fetchScans(source.id, page) })
  const pages = Math.max(1, Math.ceil((scans.data?.total ?? 0) / 10))
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{t('admin.sources.historyTitle', { name: source.name })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {scans.isPending && <LoadingState />}
          {scans.isError && <ErrorState onRetry={() => void scans.refetch()} />}
          {scans.data?.items.length === 0 && <EmptyState>{t('admin.sources.noScans')}</EmptyState>}
          {scans.data?.items.map((scan) => (
            <Card key={scan.id} sx={{ p: 1.5 }}>
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <Chip size="small" color={scan.status === 'ok' ? 'success' : scan.status === 'running' ? 'info' : 'error'} label={scan.status} />
                  <Typography variant="caption" color="text.secondary">
                    {new Date(scan.started_at).toLocaleString()}
                    {scan.commit ? ` · ${scan.commit.slice(0, 7)}` : ''}
                  </Typography>
                  {Object.entries(scan.counts).map(([k, v]) => (
                    <Chip key={k} size="small" variant="outlined" label={`${t(`admin.sources.outcome.${k}`, { defaultValue: k })}: ${v}`} />
                  ))}
                </Stack>
                {scan.message && <Alert severity={scan.status === 'error' ? 'error' : 'info'}>{scan.message}</Alert>}
                {(scan.items as ScanItemData[]).map((item, i) => (
                  <Stack key={i} direction="row" spacing={1} alignItems="baseline" flexWrap="wrap">
                    <Chip size="small" color={OUTCOME_COLOR[item.outcome] ?? 'default'}
                      label={t(`admin.sources.outcome.${item.outcome}`, { defaultValue: item.outcome })} />
                    <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{item.path}</Typography>
                    {item.version && <Typography variant="caption">v{item.version}</Typography>}
                    {item.reason && <Typography variant="body2" color="text.secondary">{item.reason}</Typography>}
                  </Stack>
                ))}
              </Stack>
            </Card>
          ))}
          {pages > 1 && <Pagination sx={{ alignSelf: 'center' }} count={pages} page={page} onChange={(_, p) => setPage(p)} />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}

export function SourcesPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const sources = useQuery({ queryKey: sourceKeys.list, queryFn: fetchSources })
  const [form, setForm] = useState<SourceData | 'new' | null>(null)
  const [history, setHistory] = useState<SourceData | null>(null)
  const [deleting, setDeleting] = useState<SourceData | null>(null)
  const [message, setMessage] = useState<{ severity: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [scanningId, setScanningId] = useState<number | null>(null)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: sourceKeys.list })
    void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard })
    void queryClient.invalidateQueries({ queryKey: adminKeys.skillsAll })
  }
  const errText = (e: unknown) => (e instanceof ApiError ? e.message : t('state.error'))

  const toggle = useMutation({
    mutationFn: (s: SourceData) => updateSource(s.id, { is_enabled: !s.is_enabled }),
    onSuccess: refresh,
    onError: (e) => setMessage({ severity: 'error', text: errText(e) }),
  })
  const scan = useMutation({
    mutationFn: (s: SourceData) => {
      setScanningId(s.id)
      return scanSource(s.id)
    },
    onSuccess: (result) => {
      const counts = Object.entries(result.counts).map(([k, v]) => `${t(`admin.sources.outcome.${k}`, { defaultValue: k })}: ${v}`).join(', ')
      setMessage({
        severity: result.status === 'ok' ? 'success' : 'error',
        text: result.status === 'ok' ? t('admin.sources.scanDone', { counts }) : (result.message ?? t('state.error')),
      })
      refresh()
    },
    onError: (e) => setMessage({ severity: 'error', text: errText(e) }),
    onSettled: () => setScanningId(null),
  })
  const remove = useMutation({
    mutationFn: (s: SourceData) => deleteSource(s.id),
    onSuccess: () => {
      setDeleting(null)
      refresh()
    },
    onError: (e) => {
      setDeleting(null)
      setMessage({ severity: 'error', text: errText(e) })
    },
  })

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="h5" component="h1">{t('admin.tab.sources')}</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setForm('new')}>{t('admin.sources.add')}</Button>
      </Stack>

      {sources.isPending && <LoadingState />}
      {sources.isError && <ErrorState onRetry={() => void sources.refetch()} />}
      {sources.data?.length === 0 && <EmptyState>{t('admin.sources.empty')}</EmptyState>}

      <Stack component="ul" spacing={1.5} sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {sources.data?.map((s) => (
          <Card key={s.id} component="li" sx={{ p: 2, borderColor: s.last_scan_status === 'error' ? 'error.main' : undefined }}>
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ rowGap: 0.5 }}>
                <Typography fontWeight={600}>{s.name}</Typography>
                <Chip size="small" variant="outlined" label={s.type} />
                {s.internal && <Chip size="small" variant="outlined" label={t('admin.sources.internalBadge')} />}
                {s.last_scan_status && (
                  <Chip size="small" color={s.last_scan_status === 'ok' ? 'success' : 'error'}
                    label={s.last_scan_status === 'ok' ? t('admin.sources.scanOk') : t('admin.sources.scanError')} />
                )}
                <Box sx={{ flexGrow: 1 }} />
                <FormControlLabel
                  control={<Switch checked={s.is_enabled} onChange={() => toggle.mutate(s)} disabled={toggle.isPending} />}
                  label={t('admin.sources.enabled')}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                {s.url}
                {s.ref ? ` @ ${s.ref}` : ''}
                {s.path_glob ? ` / ${s.path_glob}` : ''}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('admin.sources.skillCount', { count: s.skill_count })}
                {' · '}
                {s.last_scan_at
                  ? t('admin.sources.lastScan', { time: new Date(s.last_scan_at).toLocaleString() })
                  : t('admin.sources.neverScanned')}
              </Typography>
              {s.last_scan_message && (
                <Alert severity={s.last_scan_status === 'error' ? 'error' : 'info'}>{s.last_scan_message}</Alert>
              )}
              {scanningId === s.id && <ScanProgress sourceId={s.id} />}
              <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ rowGap: 0.5 }}>
                <Button size="small" variant="contained" disabled={scanningId === s.id} onClick={() => scan.mutate(s)}>
                  {scanningId === s.id ? t('admin.sources.scanning') : t('admin.sources.scanNow')}
                </Button>
                <Button size="small" onClick={() => setHistory(s)}>{t('admin.sources.history')}</Button>
                <Button size="small" onClick={() => setForm(s)}>{t('admin.sources.edit')}</Button>
                <Button size="small" color="error" onClick={() => setDeleting(s)}>{t('admin.sources.delete')}</Button>
              </Stack>
            </Stack>
          </Card>
        ))}
      </Stack>

      {form && (
        <SourceForm
          source={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null)
            setMessage({ severity: 'success', text: t('admin.done') })
            refresh()
          }}
        />
      )}
      {history && <ScanHistory source={history} onClose={() => setHistory(null)} />}
      <ConfirmDialog
        open={!!deleting}
        title={t('admin.sources.deleteTitle', { name: deleting?.name ?? '' })}
        message={t('admin.sources.deleteInfo')}
        confirmLabel={t('admin.sources.delete')}
        busy={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
      <Snackbar open={!!message} autoHideDuration={6000} onClose={() => setMessage(null)}>
        {message ? <Alert severity={message.severity} onClose={() => setMessage(null)}>{message.text}</Alert> : undefined}
      </Snackbar>
    </Stack>
  )
}
