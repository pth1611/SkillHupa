import { Alert, Button, Card, CardContent, Stack, Tab, Tabs, Typography } from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CommandBox } from '../../components/CommandBox'
import { requestDownload, skillKeys } from '../../api/skills'
import { startDownload } from '../../utils/download'

export type InstallTarget = 'claude-code' | 'cursor' | 'zip'
const TARGETS: InstallTarget[] = ['claude-code', 'cursor', 'zip']
const STORAGE_KEY = 'skillmkt.installTarget'

function readTarget(): InstallTarget {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && (TARGETS as string[]).includes(stored)) return stored as InstallTarget
  } catch {
    /* bỏ qua */
  }
  return 'claude-code'
}

/** CLI nhận skill theo id (tên có thể có dấu cách/tiếng Việt và đổi được, id thì ổn định). */
export function skillRef(id: number): string {
  return String(id)
}

export function installCommand(opts: {
  id: number
  target: Exclude<InstallTarget, 'zip'>
  version?: string
}): string {
  const base = `skillmkt install ${skillRef(opts.id)} --target ${opts.target}`
  return opts.version ? `${base} --version ${opts.version}` : base
}

interface Props {
  skillId: number
  /** Phiên bản đang xem; chỉ thêm --version khi không phải bản mới nhất. */
  version: string
  isLatest: boolean
  disabled: boolean
}

export function InstallPanel({ skillId, version, isLatest, disabled }: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [target, setTarget] = useState<InstallTarget>(readTarget)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  function choose(next: InstallTarget) {
    setTarget(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* bỏ qua */
    }
  }

  const command =
    target === 'zip' ? '' : installCommand({ id: skillId, target, version: isLatest ? undefined : version })

  async function downloadZip() {
    setFailed(false)
    setBusy(true)
    try {
      const info = await requestDownload(skillId, version, 'zip')
      startDownload(info.url)
      void queryClient.invalidateQueries({ queryKey: skillKeys.myInstalls })
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6" component="h2">
            {t('install.title')}
          </Typography>
          <Tabs value={target} onChange={(_, v: InstallTarget) => choose(v)} variant="fullWidth">
            <Tab value="claude-code" label={t('install.claudeCode')} />
            <Tab value="cursor" label={t('install.cursor')} />
            <Tab value="zip" label={t('install.zip')} />
          </Tabs>

          {target !== 'zip' ? (
            <>
              <CommandBox command={command} disabled={disabled} />
              <Typography variant="caption" color="text.secondary">
                {t('install.requirements')}
              </Typography>
            </>
          ) : (
            <Stack spacing={1.5} alignItems="flex-start">
              <Button variant="contained" onClick={() => void downloadZip()} disabled={disabled || busy}>
                {t('install.downloadZip')}
              </Button>
              <Typography variant="body2" color="text.secondary">
                {t('install.zipHelp')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('install.zipNote')}
              </Typography>
              {failed && <Alert severity="error">{t('install.downloadFailed')}</Alert>}
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}
