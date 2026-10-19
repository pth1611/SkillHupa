import {
  Alert, Autocomplete, Box, Button, Card, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Pagination, Snackbar, Stack, TextField, Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import {
  adminKeys, approveTag, createTag, deleteTag, fetchAdminTags, mergeTags, rejectTag, tagKeys,
} from '../../api/admin'
import { ApiError } from '../../api/client'
import type { AdminTagData, TagStatus } from '../../api/types'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'

const STATUSES: TagStatus[] = ['pending', 'approved', 'rejected']
const PAGE_SIZE = 50

function RejectDialog({ tag, onClose, onDone, fail }: { tag: AdminTagData; onClose: () => void; onDone: () => void; fail: (m: string) => void }) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const mutation = useMutation({
    mutationFn: () => rejectTag(tag.id, reason.trim()),
    onSuccess: onDone,
    onError: (e) => fail(e instanceof ApiError ? e.message : t('state.error')),
  })
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('admin.tags.rejectTitle', { name: tag.name })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {tag.usage_count > 0 && <Alert severity="warning">{t('admin.tags.rejectImpact', { count: tag.usage_count })}</Alert>}
          <TextField label={t('admin.reason')} required multiline minRows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button color="error" variant="contained" disabled={!reason.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
          {t('admin.tags.reject')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function MergeDialog({
  sources, targets, onClose, onDone, fail,
}: { sources: AdminTagData[]; targets: AdminTagData[]; onClose: () => void; onDone: () => void; fail: (m: string) => void }) {
  const { t } = useTranslation()
  const [into, setInto] = useState<AdminTagData | null>(null)
  const mutation = useMutation({
    mutationFn: () => mergeTags(sources.map((s) => s.id), into!.id),
    onSuccess: onDone,
    onError: (e) => fail(e instanceof ApiError ? e.message : t('state.error')),
  })
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('admin.tags.mergeTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography>{t('admin.tags.mergeFrom', { names: sources.map((s) => s.name).join(', ') })}</Typography>
          <Autocomplete
            options={targets.filter((x) => !sources.some((s) => s.id === x.id))}
            getOptionLabel={(o) => o.name}
            value={into}
            onChange={(_, v) => setInto(v)}
            renderInput={(params) => <TextField {...params} label={t('admin.tags.mergeInto')} />}
          />
          <Typography variant="body2" color="text.secondary">{t('admin.tags.mergeInfo')}</Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={!into || mutation.isPending} onClick={() => mutation.mutate()}>
          {t('admin.tags.merge')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function TagsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const status = STATUSES.find((s) => s === params.get('status'))
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [q, setQ] = useState('')
  const [newName, setNewName] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [rejecting, setRejecting] = useState<AdminTagData | null>(null)
  const [merging, setMerging] = useState(false)
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null)

  const query = { status, q: q.trim() || undefined, page, page_size: PAGE_SIZE }
  const tags = useQuery({ queryKey: tagKeys.list(query), queryFn: () => fetchAdminTags(query) })
  const approvedAll = useQuery({
    queryKey: tagKeys.list({ status: 'approved', all: true }),
    queryFn: () => fetchAdminTags({ status: 'approved', page_size: 100 }),
    enabled: merging,
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: tagKeys.all })
    void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard })
  }
  const ok = (text: string) => {
    setMessage({ severity: 'success', text })
    setSelected(new Set())
    refresh()
  }
  const fail = (text: string) => setMessage({ severity: 'error', text })
  const errText = (e: unknown) => (e instanceof ApiError ? e.message : t('state.error'))

  const create = useMutation({
    mutationFn: () => createTag(newName.trim()),
    onSuccess: () => {
      setNewName('')
      ok(t('admin.done'))
    },
    onError: (e) => fail(errText(e)),
  })
  const approve = useMutation({ mutationFn: approveTag, onSuccess: () => ok(t('admin.done')), onError: (e) => fail(errText(e)) })
  const remove = useMutation({ mutationFn: deleteTag, onSuccess: () => ok(t('admin.done')), onError: (e) => fail(errText(e)) })

  const items = tags.data?.items ?? []
  const chosen = items.filter((i) => selected.has(i.id))
  const pages = Math.max(1, Math.ceil((tags.data?.total ?? 0) / PAGE_SIZE))

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Stack spacing={2.5}>
      <Typography variant="h5" component="h1">{t('admin.tab.tags')}</Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField size="small" label={t('admin.tags.search')} value={q} onChange={(e) => setQ(e.target.value)} sx={{ flexGrow: 1 }} />
        <TextField
          size="small" select label={t('admin.status')} value={status ?? ''} sx={{ minWidth: 180 }}
          onChange={(e) => {
            const next = new URLSearchParams()
            if (e.target.value) next.set('status', e.target.value)
            setParams(next)
          }}
        >
          <MenuItem value="">{t('reviews.filterAll')}</MenuItem>
          {STATUSES.map((s) => (
            <MenuItem key={s} value={s}>{t(`admin.tags.status.${s}`)}</MenuItem>
          ))}
        </TextField>
      </Stack>

      <Stack
        direction={{ xs: 'column', sm: 'row' }} spacing={1.5} component="form"
        onSubmit={(e) => {
          e.preventDefault()
          if (newName.trim()) create.mutate()
        }}
      >
        <TextField size="small" label={t('admin.tags.newName')} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Button type="submit" variant="outlined" disabled={!newName.trim() || create.isPending}>{t('admin.tags.create')}</Button>
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="contained" disabled={chosen.length < 1} onClick={() => setMerging(true)}>
          {t('admin.tags.mergeSelected', { count: chosen.length })}
        </Button>
      </Stack>

      {tags.isPending && <LoadingState />}
      {tags.isError && <ErrorState onRetry={() => void tags.refetch()} />}
      {tags.data && items.length === 0 && <EmptyState>{t('admin.tags.empty')}</EmptyState>}

      <Stack component="ul" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {items.map((tag) => (
          <Card key={tag.id} component="li" sx={{ px: 1.5, py: 0.75 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ rowGap: 0.5 }}>
              <Checkbox
                checked={selected.has(tag.id)}
                onChange={() => toggle(tag.id)}
                inputProps={{ 'aria-label': t('admin.tags.select', { name: tag.name }) }}
              />
              <Typography fontWeight={600}>{tag.name}</Typography>
              <Chip
                size="small"
                color={tag.status === 'approved' ? 'success' : tag.status === 'pending' ? 'warning' : 'error'}
                label={t(`admin.tags.status.${tag.status}`)}
              />
              <Typography variant="caption" color="text.secondary">
                {t('admin.tags.usage', { count: tag.usage_count })}
              </Typography>
              <Box sx={{ flexGrow: 1 }} />
              {tag.status === 'pending' && (
                <>
                  <Button size="small" color="success" disabled={approve.isPending} onClick={() => approve.mutate(tag.id)}>
                    {t('admin.tags.approve')}
                  </Button>
                  <Button size="small" color="error" onClick={() => setRejecting(tag)}>{t('admin.tags.reject')}</Button>
                </>
              )}
              {tag.usage_count === 0 && (
                <Button size="small" color="inherit" disabled={remove.isPending} onClick={() => remove.mutate(tag.id)}>
                  {t('admin.tags.delete')}
                </Button>
              )}
            </Stack>
          </Card>
        ))}
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

      {rejecting && (
        <RejectDialog tag={rejecting} onClose={() => setRejecting(null)} fail={fail}
          onDone={() => { setRejecting(null); ok(t('admin.done')) }} />
      )}
      {merging && (
        <MergeDialog
          sources={chosen}
          targets={approvedAll.data?.items ?? []}
          onClose={() => setMerging(false)}
          fail={fail}
          onDone={() => { setMerging(false); ok(t('admin.done')) }}
        />
      )}
      <Snackbar open={!!message} autoHideDuration={4000} onClose={() => setMessage(null)}>
        {message ? <Alert severity={message.severity} onClose={() => setMessage(null)}>{message.text}</Alert> : undefined}
      </Snackbar>
    </Stack>
  )
}
