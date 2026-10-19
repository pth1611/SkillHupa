import { Alert, Box, Button, Card, CardContent, Chip, Container, Stack, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import { fetchMyInstalls, hideInstall, installKeys } from '../../api/installs'
import type { InstallItem, InstallState } from '../../api/types'
import { CommandBox } from '../../components/CommandBox'
import { SkillIcon } from '../../components/SkillCard'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'
import { skillRef } from '../skill-detail/InstallPanel'

type Group = 'attention' | 'update' | 'ok'

const GROUP_OF: Record<InstallState, Group> = {
  revoked: 'attention',
  removed: 'attention',
  no_access: 'attention',
  update_available: 'update',
  up_to_date: 'ok',
}
const GROUP_ORDER: Group[] = ['attention', 'update', 'ok']

export interface SkillEntry {
  /** Bản ghi đại diện (nguồn cli được ưu tiên hơn zip, rồi tới mức khẩn). */
  item: InstallItem
  targets: string[]
  group: Group
}

/** Một skill vừa cài bằng CLI vừa tải .zip chỉ hiện một thẻ (ưu tiên cli). */
export function groupBySkill(items: InstallItem[]): SkillEntry[] {
  const urgency = (i: InstallItem) => GROUP_ORDER.indexOf(GROUP_OF[i.state])
  const bySkill = new Map<number, InstallItem[]>()
  for (const item of items) bySkill.set(item.skill_id, [...(bySkill.get(item.skill_id) ?? []), item])
  return [...bySkill.values()]
    .map((entries) => {
      const sorted = entries.slice().sort(
        (a, b) => Number(a.source === 'zip') - Number(b.source === 'zip') || urgency(a) - urgency(b),
      )
      const worst = entries.slice().sort((a, b) => urgency(a) - urgency(b))[0]
      const item = sorted[0].state === worst.state ? sorted[0] : { ...sorted[0], state: worst.state }
      return { item, targets: [...new Set(sorted.map((e) => e.target))], group: GROUP_OF[worst.state] }
    })
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.item.name.localeCompare(b.item.name))
}

function stateChip(item: InstallItem, t: TFunction) {
  switch (item.state) {
    case 'revoked':
      return <Chip size="small" color="warning" label={`⚠ ${t('mySkills.stateRevoked')}`} />
    case 'removed':
      return <Chip size="small" color="warning" label={`⚠ ${t('mySkills.stateRemoved')}`} />
    case 'no_access':
      return <Chip size="small" color="warning" label={`⚠ ${t('mySkills.stateNoAccess')}`} />
    case 'update_available':
      return <Chip size="small" color="info" label={`⬆ ${t('mySkills.stateUpdate', { version: item.latest_version })}`} />
    default:
      return <Chip size="small" color="success" variant="outlined" label={`✓ ${t('mySkills.stateOk')}`} />
  }
}

/** Lệnh gợi ý theo trạng thái; nguồn zip không có lệnh vì hệ thống không biết gói nằm đâu (D41). */
export function suggestedCommand(entry: SkillEntry): string | null {
  if (entry.item.source === 'zip') return null
  const ref = skillRef(entry.item.skill_id)
  switch (entry.item.state) {
    case 'revoked':
    case 'update_available':
      return `skillmkt update ${ref}`
    case 'removed':
    case 'no_access':
      return `skillmkt uninstall ${ref}`
    default:
      return null
  }
}

function SkillEntryCard({ entry }: { entry: SkillEntry }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { item } = entry
  const command = suggestedCommand(entry)
  const hide = useMutation({
    mutationFn: () => hideInstall(item.skill_id, 'zip'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: installKeys.me }),
  })

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, height: '100%' }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <SkillIcon skill={{ id: item.skill_id, name: item.name, has_icon: item.has_icon }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={600} noWrap title={item.name}>
              {item.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {item.state === 'update_available' && item.latest_version
                ? t('mySkills.versionArrow', { from: item.installed_version, to: item.latest_version })
                : `${t('mySkills.installed')} ${item.installed_version}`}
            </Typography>
          </Box>
        </Stack>

        <Stack direction="row" spacing={0.75} flexWrap="wrap" sx={{ rowGap: 0.5 }}>
          {stateChip(item, t)}
          {item.source === 'zip' && <Chip size="small" variant="outlined" label={t('mySkills.sourceZip')} />}
          {item.source === 'cli' &&
            entry.targets.map((target) => <Chip key={target} size="small" variant="outlined" label={target} />)}
        </Stack>

        {item.source === 'zip' && (
          <Typography variant="body2" color="text.secondary">
            {t('mySkills.zipExplain')}
            {item.state === 'revoked' || item.state === 'update_available' ? ` ${t('mySkills.zipRevoked')}` : ''}
          </Typography>
        )}
        {command && <CommandBox command={command} />}
        {hide.isError && <Alert severity="error">{t('mySkills.hideFailed')}</Alert>}

        <Stack direction="row" spacing={1} sx={{ mt: 'auto', pt: 0.5 }}>
          {item.state !== 'removed' && item.state !== 'no_access' && (
            <Button size="small" component={RouterLink} to={`/skills/${item.skill_id}`}>
              {t('mySkills.details')}
            </Button>
          )}
          {item.source === 'zip' && (
            <Button size="small" color="inherit" disabled={hide.isPending} onClick={() => hide.mutate()}>
              {t('mySkills.hide')}
            </Button>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}

export function MySkillsPage() {
  const { t } = useTranslation()
  const installs = useQuery({ queryKey: installKeys.me, queryFn: fetchMyInstalls })
  const [filter, setFilter] = useState<Group | 'all'>('all')

  const entries = groupBySkill(installs.data ?? [])
  const count = (g: Group) => entries.filter((e) => e.group === g).length
  const visible = entries.filter((e) => filter === 'all' || e.group === filter)

  const chips: { key: Group | 'all'; label: string }[] = [
    { key: 'all', label: t('mySkills.filterAll', { count: entries.length }) },
    { key: 'attention', label: t('mySkills.filterAttention', { count: count('attention') }) },
    { key: 'update', label: t('mySkills.filterUpdate', { count: count('update') }) },
    { key: 'ok', label: t('mySkills.filterOk', { count: count('ok') }) },
  ]

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack spacing={3}>
        <Typography variant="h5" component="h1">
          {t('mySkills.title')}
        </Typography>

        {installs.isPending && <LoadingState />}
        {installs.isError && <ErrorState onRetry={() => void installs.refetch()} />}

        {installs.data && entries.length === 0 && (
          <Stack spacing={2} alignItems="flex-start">
            <EmptyState>{t('mySkills.empty')}</EmptyState>
            <Button component={RouterLink} to="/skills" variant="contained">
              {t('mySkills.browse')}
            </Button>
          </Stack>
        )}

        {entries.length > 0 && (
          <>
            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ rowGap: 1 }} role="group">
              {chips.map((chip) => (
                <Chip
                  key={chip.key}
                  label={chip.label}
                  clickable
                  color={filter === chip.key ? 'primary' : 'default'}
                  variant={filter === chip.key ? 'filled' : 'outlined'}
                  onClick={() => setFilter(chip.key)}
                  aria-pressed={filter === chip.key}
                />
              ))}
            </Stack>

            {visible.length === 0 && <EmptyState>{t('mySkills.emptyFilter')}</EmptyState>}

            {GROUP_ORDER.map((group) => {
              const inGroup = visible.filter((e) => e.group === group)
              if (inGroup.length === 0) return null
              return (
                <Box component="section" key={group} aria-label={t(`mySkills.group${group[0].toUpperCase()}${group.slice(1)}`)}>
                  <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>
                    {t(`mySkills.group${group[0].toUpperCase()}${group.slice(1)}`)}
                  </Typography>
                  <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                    {inGroup.map((entry) => (
                      <SkillEntryCard key={entry.item.skill_id} entry={entry} />
                    ))}
                  </Box>
                </Box>
              )
            })}
          </>
        )}
      </Stack>
    </Container>
  )
}
