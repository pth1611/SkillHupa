import CancelIcon from '@mui/icons-material/CancelOutlined'
import CheckIcon from '@mui/icons-material/CheckCircleOutline'
import WarningIcon from '@mui/icons-material/WarningAmber'
import { Box, Chip, Stack, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { Finding } from '../../api/types'

const ICON = {
  pass: <CheckIcon color="success" fontSize="small" />,
  warn: <WarningIcon color="warning" fontSize="small" />,
  fail: <CancelIcon color="error" fontSize="small" />,
} as const

/** Kết quả kiểm tra tự động: lỗi (chặn) trước, rồi cảnh báo, rồi các mục đạt. */
export function ValidationList({ results }: { results: Finding[] }) {
  const { t } = useTranslation()
  const order = { fail: 0, warn: 1, pass: 2 } as const
  const sorted = results.slice().sort((a, b) => order[a.result] - order[b.result])
  const count = (r: Finding['result']) => results.filter((x) => x.result === r).length

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} aria-label={t('studio.validationSummary')}>
        <Chip size="small" color="error" variant={count('fail') ? 'filled' : 'outlined'} label={t('studio.countFail', { count: count('fail') })} />
        <Chip size="small" color="warning" variant={count('warn') ? 'filled' : 'outlined'} label={t('studio.countWarn', { count: count('warn') })} />
        <Chip size="small" color="success" variant="outlined" label={t('studio.countPass', { count: count('pass') })} />
      </Stack>
      <Stack component="ul" spacing={0.75} sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {sorted.map((f, index) => (
          <Stack component="li" key={`${f.check}-${f.file_path}-${f.line}-${index}`} direction="row" spacing={1} alignItems="flex-start" data-result={f.result}>
            <Box sx={{ pt: 0.25 }}>{ICON[f.result]}</Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2">{f.detail}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                {f.check}
                {f.file_path ? ` · ${f.file_path}${f.line ? `:${f.line}` : ''}` : ''}
              </Typography>
            </Box>
          </Stack>
        ))}
      </Stack>
    </Stack>
  )
}
