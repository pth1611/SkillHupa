import { Button, Container, Stack, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'

export function ComingSoonPage({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation()
  return (
    <Container maxWidth="md" sx={{ py: 8 }}>
      <Stack spacing={2} alignItems="flex-start">
        <Typography variant="h5" component="h1">
          {t(titleKey)}
        </Typography>
        <Typography color="text.secondary">{t('state.comingSoon')}</Typography>
        <Button component={RouterLink} to="/" variant="outlined">
          {t('state.backHome')}
        </Button>
      </Stack>
    </Container>
  )
}

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <Container maxWidth="md" sx={{ py: 8 }}>
      <Stack spacing={2} alignItems="flex-start">
        <Typography variant="h5" component="h1">
          404
        </Typography>
        <Typography color="text.secondary">{t('state.notFound')}</Typography>
        <Button component={RouterLink} to="/" variant="outlined">
          {t('state.backHome')}
        </Button>
      </Stack>
    </Container>
  )
}
