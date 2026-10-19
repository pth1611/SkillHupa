import { Alert, Box, Button, Card, CardContent, Chip, Container, Link, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { fetchMyInstalls } from '../../api/installs'
import { fetchCategories, fetchSkill, fetchVersions, skillKeys } from '../../api/skills'
import type { InstallItem, SkillDetailData, VersionData } from '../../api/types'
import { MarkdownView, safeUrl } from '../../components/MarkdownView'
import { SkillIcon } from '../../components/SkillCard'
import { ErrorState, LoadingState } from '../../components/StateViews'
import { skillRef, InstallPanel } from './InstallPanel'
import { NotFoundPage } from '../common/pages'

function InstallWarning({ skill, install }: { skill: SkillDetailData; install: InstallItem | undefined }) {
  const { t } = useTranslation()
  if (!install) return null
  const ref = skillRef(skill.id)
  if (install.state === 'revoked')
    return (
      <Alert severity="warning">
        {t('detail.warnRevoked', { version: install.installed_version })}{' '}
        <code>skillmkt update {ref}</code>
      </Alert>
    )
  if (install.state === 'removed')
    return (
      <Alert severity="warning">
        {t('detail.warnRemoved')} <code>skillmkt uninstall {ref}</code>
      </Alert>
    )
  if (install.state === 'no_access')
    return (
      <Alert severity="warning">
        {t('detail.warnNoAccess')} <code>skillmkt uninstall {ref}</code>
      </Alert>
    )
  if (install.state === 'update_available')
    return (
      <Alert severity="info">
        {t('detail.infoUpdate', { installed: install.installed_version, latest: install.latest_version })}{' '}
        <code>skillmkt update {ref}</code>
      </Alert>
    )
  return null
}

function VersionList({
  versions, viewing, latest, onSelect,
}: {
  versions: VersionData[]
  viewing: string | undefined
  latest: string | undefined
  onSelect: (version: string | null) => void
}) {
  const { t } = useTranslation()
  const shown = versions.filter((v) => v.status === 'published' || v.status === 'revoked').slice().reverse()
  return (
    <Stack spacing={1.5}>
      {shown.map((v) => (
        <Card key={v.id} sx={v.version === viewing ? { borderColor: 'primary.main' } : undefined}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Typography fontWeight={600}>{v.version}</Typography>
              {v.version === latest && <Chip size="small" color="success" label={t('detail.latest')} />}
              {v.status === 'revoked' && <Chip size="small" color="warning" label={t('detail.revoked')} />}
              <Typography variant="caption" color="text.secondary">
                {new Date(v.created_at).toLocaleDateString()}
              </Typography>
              <Box sx={{ flexGrow: 1 }} />
              {v.version !== viewing && (
                <Button size="small" onClick={() => onSelect(v.version === latest ? null : v.version)}>
                  {t('detail.viewVersion')}
                </Button>
              )}
            </Stack>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
            >
              {v.changelog || t('detail.noChangelog')}
            </Typography>
          </CardContent>
        </Card>
      ))}
    </Stack>
  )
}

export function SkillDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const skillId = Number(id)
  const [params, setParams] = useSearchParams()
  const version = params.get('version') ?? undefined

  const valid = Number.isInteger(skillId) && skillId > 0
  const skill = useQuery({
    queryKey: skillKeys.detail(skillId, version),
    queryFn: () => fetchSkill(skillId, version),
    enabled: valid,
    retry: false,
  })
  const versions = useQuery({ queryKey: skillKeys.versions(skillId), queryFn: () => fetchVersions(skillId), enabled: valid && skill.isSuccess })
  const categories = useQuery({ queryKey: skillKeys.categories, queryFn: fetchCategories })
  const installs = useQuery({ queryKey: skillKeys.myInstalls, queryFn: fetchMyInstalls })

  if (!valid || (skill.error instanceof ApiError && skill.error.status === 404)) return <NotFoundPage />
  if (skill.isPending) return <LoadingState fullPage />
  if (skill.isError) return <ErrorState fullPage onRetry={() => void skill.refetch()} />

  const data = skill.data
  const viewing = data.viewing_version
  const latest = data.latest_version
  const category = categories.data?.find((c) => c.id === data.category_id)?.name
  const install = installs.data?.find((i) => i.skill_id === data.id)
  const sourceUrl = data.source_url ? safeUrl(data.source_url) : ''
  const installable = data.status === 'published' && !!viewing && viewing.status === 'published'

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack spacing={3}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} alignItems={{ sm: 'center' }}>
          <SkillIcon skill={{ id: data.id, name: data.name, has_icon: data.has_icon }} size={72} />
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Typography variant="h4" component="h1" sx={{ overflowWrap: 'anywhere' }}>
                {data.name}
              </Typography>
              {viewing && <Chip label={`v${viewing.version}`} />}
              {viewing && latest && viewing.id === latest.id && (
                <Chip size="small" color="success" label={t('detail.latest')} />
              )}
              {data.status === 'removed' && <Chip size="small" color="error" label={t('detail.revoked')} />}
            </Stack>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {data.origin === 'imported'
                ? [
                    data.upstream_author && `${t('detail.upstreamAuthor')}: ${data.upstream_author}`,
                    data.license && `${t('detail.license')}: ${data.license}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : data.owner_name && `${t('detail.owner')}: ${data.owner_name}`}
              {category && ` · ${category}`}
              {` · ${
                data.visibility === 'department'
                  ? t('detail.departmentOnly', { department: data.department })
                  : t('detail.companyWide')
              }`}
            </Typography>
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" sx={{ mt: 1 }}>
              {data.tags.map((tag) => (
                <Chip key={tag} size="small" label={tag} component={RouterLink} to={`/skills?tag=${encodeURIComponent(tag)}`} clickable />
              ))}
              <Typography variant="body2" color="text.secondary">
                {t('detail.installs', { count: data.install_count })} ·{' '}
                {t('detail.downloads', { count: data.download_count })}
              </Typography>
              {sourceUrl && (
                <Link href={sourceUrl} target="_blank" rel="noopener noreferrer" variant="body2">
                  {t('detail.viewAtSource')}
                </Link>
              )}
            </Stack>
          </Box>
        </Stack>

        {data.status === 'removed' && <Alert severity="error">{t('detail.removedBanner')}</Alert>}
        {data.upstream_status && data.upstream_status !== 'ok' && (
          <Alert severity="warning">{t('detail.upstreamProblem', { status: data.upstream_status })}</Alert>
        )}
        {viewing?.status === 'revoked' && <Alert severity="warning">{t('detail.revokedVersionNote')}</Alert>}
        <InstallWarning skill={data} install={install} />
        {!latest && data.status !== 'removed' && <Alert severity="info">{t('detail.notPublished')}</Alert>}

        <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 2fr) minmax(0, 1fr)' } }}>
          <Stack spacing={3} sx={{ minWidth: 0 }}>
            <Box component="section">
              <Typography variant="h6" component="h2" gutterBottom>
                {t('detail.summary')}
              </Typography>
              <Typography>{data.summary}</Typography>
            </Box>

            <Box component="section">
              <Typography variant="h6" component="h2" gutterBottom>
                {t('detail.content')}
              </Typography>
              {data.skill_md ? (
                <MarkdownView source={data.skill_md} />
              ) : (
                <Typography color="text.secondary">{t('detail.noContent')}</Typography>
              )}
            </Box>

            {versions.data && versions.data.length > 0 && (
              <Box component="section">
                <Typography variant="h6" component="h2" gutterBottom>
                  {t('detail.versions')}
                </Typography>
                <VersionList
                  versions={versions.data}
                  viewing={viewing?.version}
                  latest={latest?.version}
                  onSelect={(v) => setParams(v ? { version: v } : {})}
                />
              </Box>
            )}
          </Stack>

          <Box sx={{ alignSelf: 'start', position: { md: 'sticky' }, top: { md: 88 } }}>
            {viewing && (
              <InstallPanel
                skillId={data.id}
                version={viewing.version}
                isLatest={!!latest && viewing.id === latest.id}
                disabled={!installable}
              />
            )}
          </Box>
        </Box>
      </Stack>
    </Container>
  )
}
