import DownloadIcon from '@mui/icons-material/DownloadOutlined'
import { Avatar, Box, Card, CardActionArea, CardContent, Chip, Stack, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import { skillIconUrl } from '../api/skills'
import type { SkillCardData } from '../api/types'
import { taxonomyLabel } from '../utils/taxonomy'
import { brand } from '../theme/brand'

/** Biểu tượng mặc định: chữ cái đầu trên màu cố định theo tên (skill chưa có ảnh, D39). */
function fallbackColor(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0
  return brand.avatarPalette[hash % brand.avatarPalette.length]
}

export function SkillIcon({ skill, size = 48 }: { skill: Pick<SkillCardData, 'id' | 'name' | 'has_icon'>; size?: number }) {
  const sx = { width: size, height: size, bgcolor: fallbackColor(skill.name), fontWeight: 700 }
  if (skill.has_icon) {
    return <Avatar variant="rounded" src={skillIconUrl(skill.id)} alt="" imgProps={{ loading: 'lazy' }} sx={sx} />
  }
  return (
    <Avatar variant="rounded" sx={sx} aria-hidden>
      {skill.name.trim().charAt(0).toUpperCase() || '?'}
    </Avatar>
  )
}

export function SkillCard({ skill }: { skill: SkillCardData }) {
  const { t } = useTranslation()
  return (
    <Card sx={{ height: '100%' }}>
      <CardActionArea component={RouterLink} to={`/skills/${skill.id}`} sx={{ height: '100%' }}>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, height: '100%' }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <SkillIcon skill={skill} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={600} noWrap title={skill.name}>
                {skill.name}
              </Typography>
              <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                {skill.latest_version && (
                  <Typography variant="caption" color="text.secondary">
                    {t('card.version', { version: skill.latest_version })}
                  </Typography>
                )}
                {skill.origin === 'imported' && (
                  <Chip size="small" variant="outlined" label={skill.source_name ?? t('card.external')} />
                )}
                {skill.visibility === 'department' && (
                  <Chip size="small" variant="outlined" color="warning" label={t('card.department')} />
                )}
              </Stack>
            </Box>
          </Stack>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          >
            {skill.summary || t('card.noSummary')}
          </Typography>

          <Stack direction="row" spacing={0.5} sx={{ mt: 'auto', flexWrap: 'wrap', rowGap: 0.5 }}>
            {skill.output_types.slice(0, 2).map((slug) => (
              <Chip key={slug} size="small" variant="outlined" color="primary" label={taxonomyLabel(t, 'output', slug)} />
            ))}
            {skill.tags.slice(0, 3).map((tag) => (
              <Chip key={tag} size="small" label={tag} />
            ))}
          </Stack>

          <Stack direction="row" spacing={0.5} alignItems="center" color="text.secondary">
            <DownloadIcon fontSize="inherit" />
            <Typography variant="caption">{t('card.installs', { count: skill.install_count })}</Typography>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

export function SkillGrid({ skills }: { skills: SkillCardData[] }) {
  return (
    <Box
      sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
      role="list"
    >
      {skills.map((skill) => (
        <Box key={skill.id} role="listitem">
          <SkillCard skill={skill} />
        </Box>
      ))}
    </Box>
  )
}
