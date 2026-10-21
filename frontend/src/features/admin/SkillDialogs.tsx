import {
  Alert, Autocomplete, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { categoryLabel } from '../../i18n/taxonomyLabels'
import {
  adminKeys, fetchAdminVersions, fetchImpact, fetchUsers, patchImportedSkill, removeSkill, restoreSkill, revokeVersion,
  transferSkill,
} from '../../api/admin'
import { autoClassify } from '../../api/reviews'
import { fetchCategories, fetchDepartments, fetchSkill, fetchTags, skillKeys } from '../../api/skills'
import { ApiError } from '../../api/client'
import type { AdminSkillItem, UserData } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { LoadingState } from '../../components/StateViews'

/** Từ ngưỡng này, người gỡ phải gõ lại tên skill để xác nhận (cấu hình được ở backend sau; mục 8). */
export const TYPE_NAME_THRESHOLD = 20

export type DialogKind = 'remove' | 'restore' | 'revoke' | 'transfer' | 'edit'

interface Props {
  kind: DialogKind
  skill: AdminSkillItem
  onClose: () => void
  onDone: () => void
}

function useDone(onDone: () => void) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.skillsAll })
    void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard })
    onDone()
  }
}

function errorMessage(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

function ImpactSummary({ installed, zip, note }: { installed: number; zip: number; note?: string }) {
  const { t } = useTranslation()
  return (
    <Alert severity="warning">
      {t('admin.impact', { installed, zip })}
      {note ? ` ${note}` : ''}
    </Alert>
  )
}

function RemoveDialog({ skill, onClose, onDone }: Omit<Props, 'kind'>) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const done = useDone(onDone)
  const impact = useQuery({ queryKey: adminKeys.impact(skill.id), queryFn: () => fetchImpact(skill.id) })
  const mutation = useMutation({
    mutationFn: () => removeSkill(skill.id, reason.trim()),
    onSuccess: done,
    onError: (e) => setError(errorMessage(e, t('state.error'))),
  })
  const needsName = (impact.data?.installed_users ?? 0) >= TYPE_NAME_THRESHOLD
  const ready = reason.trim().length > 0 && (!needsName || typed === skill.name) && !!impact.data

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('admin.removeTitle', { name: skill.name })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {impact.isPending && <LoadingState />}
          {impact.data && <ImpactSummary installed={impact.data.installed_users} zip={impact.data.zip_users} />}
          <Typography variant="body2" color="text.secondary">{t('admin.removeInfo')}</Typography>
          <TextField label={t('admin.reason')} required multiline minRows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          {needsName && (
            <TextField
              label={t('admin.typeName', { name: skill.name })}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              error={typed.length > 0 && typed !== skill.name}
            />
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button color="error" variant="contained" disabled={!ready || mutation.isPending} onClick={() => mutation.mutate()}>
          {t('admin.actionRemove')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function RevokeDialog({ skill, onClose, onDone }: Omit<Props, 'kind'>) {
  const { t } = useTranslation()
  const [version, setVersion] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const done = useDone(onDone)
  const versions = useQuery({ queryKey: adminKeys.versions(skill.id), queryFn: () => fetchAdminVersions(skill.id) })
  const published = (versions.data ?? []).filter((v) => v.status === 'published')
  const impact = useQuery({
    queryKey: adminKeys.impact(skill.id, version),
    queryFn: () => fetchImpact(skill.id, version),
    enabled: !!version,
  })
  const mutation = useMutation({
    mutationFn: () => revokeVersion(skill.id, version, reason.trim()),
    onSuccess: done,
    onError: (e) => setError(errorMessage(e, t('state.error'))),
  })
  const onlyOne = versions.isSuccess && published.length <= 1
  const ready = !!version && reason.trim().length > 0 && !onlyOne

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('admin.revokeTitle', { name: skill.name })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {versions.isPending && <LoadingState />}
          {onlyOne && <Alert severity="info">{t('admin.lastVersion')}</Alert>}
          <TextField select label={t('admin.versionToRevoke')} value={version} onChange={(e) => setVersion(e.target.value)} disabled={onlyOne}>
            {published.map((v) => (
              <MenuItem key={v.id} value={v.version}>{v.version}</MenuItem>
            ))}
          </TextField>
          {impact.data && (
            <ImpactSummary
              installed={impact.data.installed_users}
              zip={impact.data.zip_users}
              note={t('admin.latestAfterRevoke', { version: impact.data.latest_after_revoke ?? '—' })}
            />
          )}
          <TextField label={t('admin.reason')} required multiline minRows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Typography variant="body2" color="text.secondary">{t('admin.revokeInfo')}</Typography>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button color="error" variant="contained" disabled={!ready || mutation.isPending} onClick={() => mutation.mutate()}>
          {t('admin.actionRevoke')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function TransferDialog({ skill, onClose, onDone }: Omit<Props, 'kind'>) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [owner, setOwner] = useState<UserData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const done = useDone(onDone)
  const users = useQuery({
    queryKey: adminKeys.users({ role: 'creator', q: text }),
    queryFn: () => fetchUsers({ role: 'creator', q: text || undefined, page_size: 20 }),
  })
  const mutation = useMutation({
    mutationFn: () => transferSkill(skill.id, owner!.id),
    onSuccess: done,
    onError: (e) => setError(errorMessage(e, t('state.error'))),
  })

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('admin.transferTitle', { name: skill.name })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">{t('admin.transferInfo')}</Typography>
          <Autocomplete
            options={(users.data?.items ?? []).filter((u) => u.id !== skill.owner_id)}
            value={owner}
            loading={users.isFetching}
            filterOptions={(options) => options}
            getOptionLabel={(u) => `${u.display_name} (${u.email})`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            onInputChange={(_, value, reason) => reason === 'input' && setText(value)}
            onChange={(_, value) => setOwner(value)}
            renderInput={(params) => <TextField {...params} label={t('admin.newOwner')} />}
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={!owner || mutation.isPending} onClick={() => mutation.mutate()}>
          {t('admin.actionTransfer')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function RestoreDialog({ skill, onClose, onDone }: Omit<Props, 'kind'>) {
  const { t } = useTranslation()
  const done = useDone(onDone)
  const mutation = useMutation({ mutationFn: () => restoreSkill(skill.id), onSuccess: done })
  return (
    <>
      <ConfirmDialog
        open
        title={t('admin.restoreTitle', { name: skill.name })}
        message={mutation.isError ? errorMessage(mutation.error, t('state.error')) : t('admin.restoreInfo')}
        confirmLabel={t('admin.actionRestore')}
        busy={mutation.isPending}
        onCancel={onClose}
        onConfirm={() => mutation.mutate()}
      />
    </>
  )
}

function EditDialog({ skill, onClose, onDone }: Omit<Props, 'kind'>) {
  const { t } = useTranslation()
  const detail = useQuery({ queryKey: skillKeys.detail(skill.id), queryFn: () => fetchSkill(skill.id) })
  const categories = useQuery({ queryKey: skillKeys.categories, queryFn: fetchCategories })
  const departments = useQuery({ queryKey: skillKeys.departments, queryFn: fetchDepartments })
  const tags = useQuery({ queryKey: skillKeys.tags(''), queryFn: () => fetchTags('') })
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('admin.editTitle', { name: skill.name })}</DialogTitle>
      {detail.isPending ? (
        <DialogContent><LoadingState /></DialogContent>
      ) : detail.data ? (
        <EditForm
          skillId={skill.id}
          initial={{
            summary: detail.data.summary ?? '',
            category_id: detail.data.category_id ?? '',
            department: detail.data.department ?? '',
            visibility: detail.data.visibility,
            tag_ids: detail.data.tag_ids,
          }}
          categories={categories.data ?? []}
          departments={departments.data ?? []}
          tags={tags.data ?? []}
          onClose={onClose}
          onDone={onDone}
        />
      ) : (
        <DialogContent><Alert severity="error">{t('state.error')}</Alert></DialogContent>
      )}
    </Dialog>
  )
}

function EditForm({
  skillId, initial, categories, departments, tags, onClose, onDone,
}: {
  skillId: number
  initial: { summary: string; category_id: number | ''; department: string; visibility: 'company' | 'department'; tag_ids: number[] }
  categories: { id: number; name: string; slug: string }[]
  departments: string[]
  tags: { id: number; name: string }[]
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [v, setV] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const done = useDone(onDone)
  const [autoMsg, setAutoMsg] = useState<string | null>(null)
  const auto = useMutation({
    mutationFn: () => autoClassify(skillId, false),
    onSuccess: (d) => {
      if (d.category_id) setV((prev) => ({ ...prev, category_id: d.category_id as number }))
      setAutoMsg(d.applied ? t('reviews.classifyAutoDone') : t('reviews.classifyNone'))
    },
    onError: (e) => setError(errorMessage(e, t('state.error'))),
  })
  const mutation = useMutation({
    mutationFn: () =>
      patchImportedSkill(skillId, {
        summary: v.summary.trim(),
        category_id: v.category_id === '' ? undefined : v.category_id,
        department: v.department.trim() || undefined,
        visibility: v.visibility,
        tag_ids: v.tag_ids,
      }),
    onSuccess: done,
    onError: (e) => setError(errorMessage(e, t('state.error'))),
  })
  return (
    <>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">{t('admin.editInfo')}</Typography>
          <TextField label={t('studio.summary')} multiline minRows={2} value={v.summary} inputProps={{ maxLength: 1000 }}
            onChange={(e) => setV({ ...v, summary: e.target.value })} helperText={`${v.summary.length}/1000`} />
          <TextField select label={t('studio.category')} value={v.category_id}
            onChange={(e) => setV({ ...v, category_id: Number(e.target.value) })}>
            {categories.map((c) => <MenuItem key={c.id} value={c.id}>{categoryLabel(t, c)}</MenuItem>)}
          </TextField>
          {departments.length > 0 ? (
            <TextField select label={t('studio.department')} value={v.department}
              onChange={(e) => setV({ ...v, department: e.target.value })}>
              {departments.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
            </TextField>
          ) : (
            <TextField label={t('studio.department')} value={v.department}
              onChange={(e) => setV({ ...v, department: e.target.value })} />
          )}
          <TextField select label={t('studio.visibility')} value={v.visibility}
            onChange={(e) => setV({ ...v, visibility: e.target.value as 'company' | 'department' })}>
            <MenuItem value="company">{t('studio.visibilityCompany')}</MenuItem>
            <MenuItem value="department">{t('studio.visibilityDepartment')}</MenuItem>
          </TextField>
          <Autocomplete
            multiple
            options={tags}
            getOptionLabel={(o) => o.name}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            value={tags.filter((x) => v.tag_ids.includes(x.id))}
            onChange={(_, value) => setV({ ...v, tag_ids: value.map((x) => x.id) })}
            renderInput={(params) => <TextField {...params} label={t('studio.tags')} />}
          />
          {autoMsg && <Alert severity="info">{autoMsg}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={auto.isPending} onClick={() => auto.mutate()} sx={{ mr: 'auto' }}>
          {t('reviews.classifyAuto')}
        </Button>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {t('admin.sources.save')}
        </Button>
      </DialogActions>
    </>
  )
}

export function SkillDialog({ kind, ...rest }: Props) {
  if (kind === 'edit') return <EditDialog {...rest} />
  if (kind === 'remove') return <RemoveDialog {...rest} />
  if (kind === 'revoke') return <RevokeDialog {...rest} />
  if (kind === 'transfer') return <TransferDialog {...rest} />
  return <RestoreDialog {...rest} />
}
