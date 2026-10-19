import UploadIcon from '@mui/icons-material/UploadFileOutlined'
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { useRef, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { ValidationData } from '../../api/types'
import { ValidationList } from './ValidationList'

export interface PackageStepProps {
  /** Đã có phiên bản nháp (đang xem kết quả) hay chưa (chọn gói lần đầu). */
  hasVersion: boolean
  validation: ValidationData | undefined
  busy: boolean
  error: string | null
  /** Chế độ phát hành bản mới: cần nhập số phiên bản và changelog ngay lúc tải. */
  askVersion: boolean
  suggestedVersion: string
  onUpload: (pkg: File, icon: File | null, version: string, changelog: string) => void
  onReplacePackage: (pkg: File) => void
  onReplaceIcon: (icon: File) => void
  onNext: () => void
  onDelete?: () => void
}

function FilePicker({
  label, accept, file, onPick, testId,
}: { label: string; accept: string; file: File | null; onPick: (f: File) => void; testId: string }) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  function drop(event: DragEvent) {
    event.preventDefault()
    setOver(false)
    const f = event.dataTransfer.files?.[0]
    if (f) onPick(f)
  }

  return (
    <Box
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      sx={{
        border: 2, borderStyle: 'dashed', borderColor: over ? 'primary.main' : 'divider', borderRadius: 2,
        p: 2.5, textAlign: 'center', bgcolor: over ? 'action.hover' : 'transparent',
      }}
    >
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        data-testid={testId}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onPick(f)
          e.target.value = ''
        }}
      />
      <Stack spacing={1} alignItems="center">
        <UploadIcon color="action" />
        <Typography variant="body2">{file ? file.name : label}</Typography>
        <Button size="small" onClick={() => input.current?.click()}>
          {t('studio.chooseFile')}
        </Button>
      </Stack>
    </Box>
  )
}

export function PackageStep(props: PackageStepProps) {
  const { t } = useTranslation()
  const [pkg, setPkg] = useState<File | null>(null)
  const [icon, setIcon] = useState<File | null>(null)
  const [version, setVersion] = useState(props.suggestedVersion)
  const [changelog, setChangelog] = useState('')
  const hasFail = props.validation?.results.some((r) => r.result === 'fail') ?? false
  const versionOk = !props.askVersion || /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)

  return (
    <Stack spacing={3}>
      {props.error && <Alert severity="error">{props.error}</Alert>}

      {props.askVersion && !props.hasVersion && (
        <Stack spacing={2}>
          <TextField
            label={t('studio.version')}
            value={version}
            onChange={(e) => setVersion(e.target.value.trim())}
            error={!versionOk}
            helperText={versionOk ? t('studio.versionHelp') : t('studio.versionInvalid')}
          />
          <TextField
            label={t('studio.changelog')}
            value={changelog}
            onChange={(e) => setChangelog(e.target.value)}
            multiline
            minRows={2}
          />
        </Stack>
      )}

      {!props.hasVersion ? (
        <>
          <FilePicker label={t('studio.dropPackage')} accept=".zip,application/zip" file={pkg} onPick={setPkg} testId="package-input" />
          <FilePicker label={t('studio.dropIcon')} accept="image/png,image/jpeg,image/webp" file={icon} onPick={setIcon} testId="icon-input" />
          <Typography variant="caption" color="text.secondary">
            {t('studio.packageHelp')}
          </Typography>
          <Box>
            <Button
              variant="contained"
              disabled={!pkg || props.busy || !versionOk}
              onClick={() => pkg && props.onUpload(pkg, icon, version, changelog)}
            >
              {t('studio.uploadAndCheck')}
            </Button>
          </Box>
        </>
      ) : (
        <>
          <Typography variant="h6" component="h2">
            {t('studio.validationTitle')}
          </Typography>
          {props.validation ? <ValidationList results={props.validation.results} /> : null}
          {hasFail && <Alert severity="error">{t('studio.fixToContinue')}</Alert>}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Box sx={{ flex: 1 }}>
              <FilePicker label={t('studio.replacePackage')} accept=".zip,application/zip" file={null} onPick={props.onReplacePackage} testId="replace-package-input" />
            </Box>
            <Box sx={{ flex: 1 }}>
              <FilePicker label={t('studio.replaceIcon')} accept="image/png,image/jpeg,image/webp" file={null} onPick={props.onReplaceIcon} testId="replace-icon-input" />
            </Box>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" disabled={hasFail || props.busy || !props.validation} onClick={props.onNext}>
              {t('studio.next')}
            </Button>
            {props.onDelete && (
              <Button color="error" onClick={props.onDelete}>
                {t('studio.deleteDraft')}
              </Button>
            )}
          </Stack>
        </>
      )}
    </Stack>
  )
}
