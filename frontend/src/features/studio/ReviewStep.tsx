import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { SkillCardData, ValidationData } from '../../api/types'
import { MarkdownView } from '../../components/MarkdownView'
import { SkillCard } from '../../components/SkillCard'
import { ValidationList } from './ValidationList'

interface Props {
  card: SkillCardData
  skillMd: string | null
  validation: ValidationData | undefined
  busy: boolean
  error: string | null
  onSubmit: () => void
  onBack: () => void
}

export function ReviewStep({ card, skillMd, validation, busy, error, onSubmit, onBack }: Props) {
  const { t } = useTranslation()
  const hasFail = validation?.results.some((r) => r.result === 'fail') ?? false
  return (
    <Stack spacing={3}>
      {error && <Alert severity="error">{error}</Alert>}

      <Box component="section">
        <Typography variant="h6" component="h2" gutterBottom>
          {t('studio.previewCard')}
        </Typography>
        {/* Xem trước đúng như thẻ ở trang chủ; vô hiệu liên kết vì bản nháp chưa có trang công khai. */}
        <Box sx={{ maxWidth: 320, pointerEvents: 'none' }} aria-hidden>
          <SkillCard skill={card} />
        </Box>
      </Box>

      <Box component="section">
        <Typography variant="h6" component="h2" gutterBottom>
          {t('detail.content')}
        </Typography>
        {skillMd ? <MarkdownView source={skillMd} /> : <Typography color="text.secondary">{t('detail.noContent')}</Typography>}
      </Box>

      <Box component="section">
        <Typography variant="h6" component="h2" gutterBottom>
          {t('studio.validationTitle')}
        </Typography>
        {validation && <ValidationList results={validation.results} />}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {t('studio.previewNote')}
        </Typography>
      </Box>

      <Stack direction="row" spacing={1}>
        <Button onClick={onBack}>{t('studio.back')}</Button>
        <Button variant="contained" disabled={busy || hasFail} onClick={onSubmit}>
          {t('studio.submit')}
        </Button>
      </Stack>
    </Stack>
  )
}
