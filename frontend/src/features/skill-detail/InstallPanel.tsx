import { Alert, Box, Button, Card, CardContent, Chip, Stack, Tab, Tabs, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CommandBox } from '../../components/CommandBox'
import { requestDownload, skillKeys } from '../../api/skills'
import { startDownload } from '../../utils/download'

export type InstallTarget = 'claude-code' | 'cursor'
export type InstallScope = 'project' | 'global'
type Method = 'cli' | 'manual' | 'agent'
const TARGETS: InstallTarget[] = ['claude-code', 'cursor']
const SKILLS_DIR: Record<InstallTarget, string> = { 'claude-code': '.claude/skills', cursor: '.cursor/skills' }
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
  target: InstallTarget
  scope?: InstallScope
  version?: string
}): string {
  let cmd = `skillmkt install ${skillRef(opts.id)} --target ${opts.target}`
  if (opts.scope === 'project') cmd += ' --project'
  return opts.version ? `${cmd} --version ${opts.version}` : cmd
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
  const [scope, setScope] = useState<InstallScope>('global')
  const [method, setMethod] = useState<Method>('cli')
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

  const command = installCommand({ id: skillId, target, scope, version: isLatest ? undefined : version })
  const targetLabel = target === 'cursor' ? t('install.cursor') : t('install.claudeCode')
  const root = `${scope === 'global' ? '~/' : ''}${SKILLS_DIR[target]}/`

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
    <Card sx={{ borderRadius: 2 }}>
      <CardContent>
        <Stack spacing={2}>
          <Box>
            <Typography variant="subtitle1" component="h2" fontWeight={700}>
              {t('install.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">{t('install.subtitle')}</Typography>
          </Box>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap role="group" aria-label={t('install.agent')}>
            {TARGETS.map((x) => (
              <Chip
                key={x} role="tab" aria-selected={x === target}
                label={x === 'cursor' ? t('install.cursor') : t('install.claudeCode')}
                color={x === target ? 'primary' : 'default'} onClick={() => choose(x)}
                sx={{ fontWeight: 600 }}
              />
            ))}
          </Stack>

          <ToggleButtonGroup
            exclusive fullWidth size="small" value={scope} aria-label={t('install.scope')}
            onChange={(_, v: InstallScope | null) => v && setScope(v)}
            sx={{ '& .MuiToggleButton-root': { borderRadius: 1, textTransform: 'none' } }}
          >
            <ToggleButton value="project">{t('install.scopeProject')}</ToggleButton>
            <ToggleButton value="global">{t('install.scopeGlobal')}</ToggleButton>
          </ToggleButtonGroup>

          <Tabs value={method} onChange={(_, v: Method) => setMethod(v)} variant="fullWidth">
            <Tab value="cli" label={t('install.methodCli')} />
            <Tab value="manual" label={t('install.methodManual')} />
            <Tab value="agent" label={t('install.methodAgent')} />
          </Tabs>

          {method === 'cli' && (
            <>
              <CommandBox command={command} disabled={disabled} />
              <Typography variant="caption" color="text.secondary">
                {t('install.installsTo', { path: root })}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('install.requirements')}
              </Typography>
            </>
          )}
          {method === 'manual' && (
            <Stack spacing={1.5} alignItems="flex-start">
              <Button variant="contained" onClick={() => void downloadZip()} disabled={disabled || busy}>
                {t('install.downloadZip')}
              </Button>
              <Typography variant="body2" color="text.secondary">
                {t('install.zipHelp', { path: root })}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('install.zipNote')}
              </Typography>
              {failed && <Alert severity="error">{t('install.downloadFailed')}</Alert>}
            </Stack>
          )}
          {method === 'agent' && (
            <>
              <CommandBox command={t('install.agentPrompt', { command })} disabled={disabled} />
              <Typography variant="caption" color="text.secondary">{t('install.agentHelp')}</Typography>
            </>
          )}

          <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 2 }}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>{t('install.thenTitle')}</Typography>
            <Box component="ol" sx={{ m: 0, pl: 2.5, color: 'text.secondary', typography: 'body2', '& li': { mb: 0.5 } }}>
              <li>{t('install.step1', { agent: targetLabel })}</li>
              <li>{t('install.step2')}</li>
            </Box>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  )
}
