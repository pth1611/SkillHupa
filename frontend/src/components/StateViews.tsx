import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

const wrap = (fullPage?: boolean) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  py: fullPage ? 0 : 6,
  minHeight: fullPage ? '60vh' : undefined,
})

export function LoadingState({ fullPage }: { fullPage?: boolean }) {
  const { t } = useTranslation()
  return (
    <Box sx={wrap(fullPage)} role="status" aria-live="polite">
      <Stack alignItems="center" spacing={1}>
        <CircularProgress size={28} />
        <Typography variant="body2" color="text.secondary">
          {t('state.loading')}
        </Typography>
      </Stack>
    </Box>
  )
}

export function ErrorState({ onRetry, fullPage }: { onRetry?: () => void; fullPage?: boolean }) {
  const { t } = useTranslation()
  return (
    <Box sx={wrap(fullPage)}>
      <Alert
        severity="error"
        action={
          onRetry ? (
            <Button color="inherit" size="small" onClick={onRetry}>
              {t('state.retry')}
            </Button>
          ) : undefined
        }
      >
        {t('state.error')}
      </Alert>
    </Box>
  )
}

export function EmptyState({ children }: { children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <Box sx={wrap()}>
      <Typography color="text.secondary">{children ?? t('state.empty')}</Typography>
    </Box>
  )
}
