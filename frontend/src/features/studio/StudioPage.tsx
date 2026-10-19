import AddIcon from '@mui/icons-material/Add'
import { Alert, Box, Button, Card, CardContent, Chip, Container, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import { fetchMine, studioKeys } from '../../api/studio'
import type { OwnerVersionData, SkillMineData } from '../../api/types'
import { SkillIcon } from '../../components/SkillCard'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'

function VersionStatus({ version }: { version: OwnerVersionData }) {
  const { t } = useTranslation()
  const color = ({ published: 'success', pending: 'info', rejected: 'error', revoked: 'warning' } as const)[
    version.status as 'published'
  ]
  return <Chip size="small" color={color ?? 'default'} label={t(`studio.status.${version.status}`)} />
}

function StudioCard({ skill }: { skill: SkillMineData }) {
  const { t } = useTranslation()
  const v = skill.latest_draft_version
  const editable = v && (v.status === 'draft' || v.status === 'rejected')
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, height: '100%' }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <SkillIcon skill={{ id: skill.id, name: skill.name, has_icon: false }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={600} noWrap title={skill.name}>
              {skill.name}
            </Typography>
            <Stack direction="row" spacing={0.75} alignItems="center">
              {v && <Typography variant="caption" color="text.secondary">v{v.version}</Typography>}
              {v && <VersionStatus version={v} />}
              {skill.status === 'removed' && <Chip size="small" color="error" label={t('studio.status.removed')} />}
            </Stack>
          </Box>
        </Stack>

        {v?.status === 'pending' && (
          <Typography variant="body2" color="text.secondary">
            {v.assigned_to_name
              ? t('studio.assignedTo', { name: v.assigned_to_name })
              : t('studio.waitingAssignment')}
          </Typography>
        )}
        {v?.status === 'rejected' && (
          <Alert severity="error" sx={{ '& .MuiAlert-message': { overflowWrap: 'anywhere' } }}>
            <strong>{t('studio.reviewerComment')}</strong> {v.review_comment}
          </Alert>
        )}

        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 'auto', pt: 0.5, rowGap: 0.5 }}>
          {editable && (
            <Button size="small" variant="contained" component={RouterLink} to={`/studio/${skill.id}?version=${encodeURIComponent(v.version)}`}>
              {t('studio.continue')}
            </Button>
          )}
          {skill.status === 'published' && (
            <Button size="small" variant="outlined" component={RouterLink} to={`/studio/${skill.id}?mode=new-version`}>
              {t('studio.newVersion')}
            </Button>
          )}
          {skill.status !== 'draft' && skill.status !== 'removed' && (
            <Button size="small" component={RouterLink} to={`/skills/${skill.id}`}>
              {t('mySkills.details')}
            </Button>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}

export function StudioPage() {
  const { t } = useTranslation()
  const mine = useQuery({ queryKey: studioKeys.mine, queryFn: fetchMine })

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack spacing={3}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h5" component="h1">
            {t('studio.title')}
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} component={RouterLink} to="/studio/new">
            {t('studio.create')}
          </Button>
        </Stack>

        {mine.isPending && <LoadingState />}
        {mine.isError && <ErrorState onRetry={() => void mine.refetch()} />}
        {mine.data?.length === 0 && <EmptyState>{t('studio.empty')}</EmptyState>}
        {mine.data && mine.data.length > 0 && (
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {mine.data.map((skill) => (
              <StudioCard key={skill.id} skill={skill} />
            ))}
          </Box>
        )}
      </Stack>
    </Container>
  )
}
