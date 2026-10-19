import { Alert, Box, Button, Card, Chip, MenuItem, Pagination, Snackbar, Stack, TextField, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import { adminKeys, fetchAdminSkills, type AdminSkillQuery } from '../../api/admin'
import type { AdminSkillItem, SkillStatus } from '../../api/types'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'
import { SkillDialog, type DialogKind } from './SkillDialogs'

const STATUSES: SkillStatus[] = ['published', 'draft', 'removed']
const PAGE_SIZE = 20

function SkillRow({ skill, onAction }: { skill: AdminSkillItem; onAction: (kind: DialogKind) => void }) {
  const { t } = useTranslation()
  const color = ({ published: 'success', draft: 'default', removed: 'error' } as const)[skill.status]
  return (
    <Card component="li" sx={{ p: 2 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ rowGap: 0.5 }}>
            <Typography
              component={RouterLink}
              to={`/skills/${skill.id}`}
              fontWeight={600}
              sx={{ color: 'text.primary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
            >
              {skill.name}
            </Typography>
            <Chip size="small" color={color} label={t(`studio.status.${skill.status}`)} />
            {skill.latest_version && <Chip size="small" variant="outlined" label={`v${skill.latest_version}`} />}
            {skill.origin === 'imported' && <Chip size="small" variant="outlined" label={t('card.external')} />}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {[
              skill.department,
              t('detail.installs', { count: skill.install_count }),
              t('detail.downloads', { count: skill.download_count }),
            ].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ rowGap: 0.5 }}>
          {skill.status === 'published' && (
            <>
              <Button size="small" color="warning" onClick={() => onAction('revoke')}>{t('admin.actionRevoke')}</Button>
              <Button size="small" color="error" onClick={() => onAction('remove')}>{t('admin.actionRemove')}</Button>
            </>
          )}
          {skill.status === 'removed' && (
            <Button size="small" onClick={() => onAction('restore')}>{t('admin.actionRestore')}</Button>
          )}
          {skill.origin === 'imported' && skill.status !== 'removed' && (
            <Button size="small" onClick={() => onAction('edit')}>{t('admin.actionEdit')}</Button>
          )}
          {skill.origin === 'internal' && skill.owner_id !== null && (
            <Button size="small" onClick={() => onAction('transfer')}>{t('admin.actionTransfer')}</Button>
          )}
        </Stack>
      </Stack>
    </Card>
  )
}

export function AdminSkillsPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') as SkillStatus | null) ?? undefined
  const q = params.get('q') ?? ''
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [text, setText] = useState(q)
  const [dialog, setDialog] = useState<{ kind: DialogKind; skill: AdminSkillItem } | null>(null)
  const [done, setDone] = useState(false)
  useEffect(() => setText(q), [q])

  const query: AdminSkillQuery = {
    status: STATUSES.includes(status as SkillStatus) ? status : undefined,
    q: q || undefined,
    page,
    page_size: PAGE_SIZE,
  }
  const skills = useQuery({ queryKey: adminKeys.skills(query), queryFn: () => fetchAdminSkills(query) })
  const pages = Math.max(1, Math.ceil((skills.data?.total ?? 0) / PAGE_SIZE))

  function update(changes: Record<string, string | undefined>, keepPage = false) {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (!keepPage) next.delete('page')
    setParams(next)
  }

  return (
    <Stack spacing={2.5}>
      <Typography variant="h5" component="h1">{t('admin.tab.skills')}</Typography>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        component="form"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          update({ q: text.trim() || undefined })
        }}
      >
        <TextField size="small" label={t('search.query')} value={text} onChange={(e) => setText(e.target.value)} sx={{ flexGrow: 1 }} />
        <TextField
          size="small"
          select
          label={t('admin.status')}
          value={query.status ?? ''}
          onChange={(e) => update({ status: e.target.value || undefined })}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">{t('reviews.filterAll')}</MenuItem>
          {STATUSES.map((s) => (
            <MenuItem key={s} value={s}>{t(`studio.status.${s}`)}</MenuItem>
          ))}
        </TextField>
        <Button type="submit" variant="contained">{t('search.apply')}</Button>
      </Stack>

      {skills.isPending && <LoadingState />}
      {skills.isError && <ErrorState onRetry={() => void skills.refetch()} />}
      {skills.data?.items.length === 0 && <EmptyState>{t('search.noResults')}</EmptyState>}

      <Stack component="ul" spacing={1.5} sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {skills.data?.items.map((skill) => (
          <SkillRow key={skill.id} skill={skill} onAction={(kind) => setDialog({ kind, skill })} />
        ))}
      </Stack>

      {pages > 1 && (
        <Pagination
          sx={{ alignSelf: 'center' }}
          count={pages}
          page={Math.min(page, pages)}
          onChange={(_, p) => update({ page: p === 1 ? undefined : String(p) }, true)}
        />
      )}

      {dialog && (
        <SkillDialog
          kind={dialog.kind}
          skill={dialog.skill}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            setDone(true)
          }}
        />
      )}
      <Snackbar open={done} autoHideDuration={3000} onClose={() => setDone(false)}>
        <Alert severity="success" onClose={() => setDone(false)}>{t('admin.done')}</Alert>
      </Snackbar>
    </Stack>
  )
}
