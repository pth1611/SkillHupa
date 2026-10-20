import DownloadIcon from '@mui/icons-material/DownloadOutlined'
import FolderIcon from '@mui/icons-material/FolderOpenOutlined'
import VerifiedIcon from '@mui/icons-material/CheckCircleOutline'
import { Avatar, Box, Card, CardActionArea, CardContent, Chip, Stack, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import { skillIconUrl } from '../api/skills'
import type { SkillCardData } from '../api/types'
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

export function SkillCard({ skill, categoryName }: { skill: SkillCardData; categoryName?: string }) {
  const { t } = useTranslation()
  const byline = skill.source_name ?? skill.department
  return (
    <Card
      sx={{
        height: '100%',
        borderRadius: 4,
        transition: 'border-color .2s, transform .2s',
        '&:hover': { borderColor: 'primary.main', transform: 'translateY(-2px)' },
      }}
    >
      <CardActionArea component={RouterLink} to={`/skills/${skill.id}`} sx={{ height: '100%' }}>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%', p: 2.5 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <SkillIcon skill={skill} size={52} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={700} noWrap title={skill.name}>
                {skill.name}
              </Typography>
              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'text.secondary', minWidth: 0 }}>
                <VerifiedIcon sx={{ fontSize: 15, color: 'primary.main' }} aria-hidden />
                <Typography variant="caption" noWrap>
                  {byline ?? t('card.version', { version: skill.latest_version ?? '—' })}
                </Typography>
                {skill.visibility === 'department' && (
                  <Chip size="small" variant="outlined" color="warning" label={t('card.department')} sx={{ height: 18 }} />
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

          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 'auto', pt: 0.5 }}>
            {categoryName ? (
              <Chip size="small" label={categoryName} sx={{ bgcolor: 'action.hover', fontWeight: 600 }} />
            ) : (
              <span />
            )}
            <Stack direction="row" spacing={1.5} alignItems="center" color="text.secondary">
              {skill.latest_version && (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <FolderIcon sx={{ fontSize: 16 }} aria-hidden />
                  <Typography variant="caption">{t('card.version', { version: skill.latest_version })}</Typography>
                </Stack>
              )}
              <Stack direction="row" spacing={0.5} alignItems="center">
                <DownloadIcon sx={{ fontSize: 16 }} aria-hidden />
                <Typography variant="caption">{t('card.installs', { count: skill.install_count })}</Typography>
              </Stack>
            </Stack>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

export function SkillGrid({ skills, categoryNames }: { skills: SkillCardData[]; categoryNames?: Map<number, string> }) {
  return (
    <Box
      sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}
      role="list"
    >
      {skills.map((skill) => (
        <Box key={skill.id} role="listitem">
          <SkillCard skill={skill} categoryName={skill.category_id ? categoryNames?.get(skill.category_id) : undefined} />
        </Box>
      ))}
    </Box>
  )
}
