import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { Box, IconButton, Stack, Tooltip } from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Một dòng lệnh có nút sao chép (dùng ở trang chi tiết và "Skill của tôi"). */
export function CommandBox({ command, disabled }: { command: string; disabled?: boolean }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* trình duyệt chặn clipboard: người dùng vẫn chọn và sao chép tay được */
    }
  }

  return (
    <Stack direction="row" alignItems="center" sx={{ bgcolor: 'action.hover', borderRadius: 1, pl: 1.5, pr: 0.5, py: 0.5 }}>
      <Box component="code" data-testid="install-command" sx={{ flexGrow: 1, fontSize: '0.85rem', overflowWrap: 'anywhere' }}>
        {command}
      </Box>
      <Tooltip title={copied ? t('install.copied') : t('install.copy')}>
        <span>
          <IconButton onClick={() => void copy()} disabled={disabled} aria-label={t('install.copy')} size="small">
            {copied ? <CheckIcon color="success" fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  )
}
