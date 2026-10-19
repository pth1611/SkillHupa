import { Alert, Box, Button, FormControlLabel, Paper, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  busy: boolean
  error: string | null
  /** Số file có cảnh báo mà Reviewer chưa mở xem; chỉ nhắc, không chặn (D44). */
  unseenWarnings?: number
  onSubmit: (decision: 'approved' | 'rejected', comment: string | null) => void
}

export function DecisionPanel({ busy, error, unseenWarnings = 0, onSubmit }: Props) {
  const { t } = useTranslation()
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved')
  const [comment, setComment] = useState('')
  const [touched, setTouched] = useState(false)
  const needComment = decision === 'rejected' && !comment.trim()

  function submit() {
    setTouched(true)
    if (needComment) return
    onSubmit(decision, comment.trim() || null)
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, position: 'sticky', bottom: 0, zIndex: 1 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t('reviews.decision')}
        </Typography>
        {unseenWarnings > 0 && <Alert severity="info">{t('reviews.unseenWarnings', { count: unseenWarnings })}</Alert>}
        {error && <Alert severity="error">{error}</Alert>}
        <RadioGroup row value={decision} onChange={(e) => setDecision(e.target.value as 'approved' | 'rejected')}>
          <FormControlLabel value="approved" control={<Radio />} label={t('reviews.approve')} />
          <FormControlLabel value="rejected" control={<Radio />} label={t('reviews.reject')} />
        </RadioGroup>
        <TextField
          multiline
          minRows={2}
          label={t('reviews.comment')}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          required={decision === 'rejected'}
          error={touched && needComment}
          helperText={touched && needComment ? t('reviews.commentRequired') : t('reviews.commentHelp')}
        />
        <Box>
          <Button
            variant="contained"
            color={decision === 'approved' ? 'success' : 'error'}
            disabled={busy}
            onClick={submit}
          >
            {t('reviews.send')}
          </Button>
        </Box>
      </Stack>
    </Paper>
  )
}
