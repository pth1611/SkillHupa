import { Alert, Box, Card, CardContent, Container, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CommandBox } from '../../components/CommandBox'

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card component="section" id={id} aria-label={title}>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h5" component="h2">
            {title}
          </Typography>
          {children}
        </Stack>
      </CardContent>
    </Card>
  )
}

function Commands({ items }: { items: { label?: string; command: string }[] }) {
  return (
    <Stack spacing={1.5}>
      {items.map(({ label, command }) => (
        <Box key={command}>
          {label && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {label}
            </Typography>
          )}
          <CommandBox command={command} />
        </Box>
      ))}
    </Stack>
  )
}

export function DocsPage() {
  const { t } = useTranslation()
  const server = window.location.origin

  return (
    <Container maxWidth="md" sx={{ py: 5 }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h3" component="h1" sx={{ fontSize: { xs: '2rem', md: '2.5rem' } }}>
            {t('docs.title')}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {t('docs.intro')}
          </Typography>
        </Box>

        <Section id="methods" title={t('docs.methodsTitle')}>
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            <li>{t('docs.methodClaude')}</li>
            <li>{t('docs.methodCursor')}</li>
            <li>{t('docs.methodZip')}</li>
          </Box>
        </Section>

        <Section id="prepare" title={t('docs.prepareTitle')}>
          <Typography>{t('docs.prepareNode')}</Typography>
          <Typography>{t('docs.prepareBuild')}</Typography>
          <Commands
            items={[
              { command: 'cd cli && npm ci && npm run build && npm link' },
              { label: t('docs.prepareCheck'), command: 'skillmkt --help' },
            ]}
          />
          <Typography>{t('docs.prepareLogin')}</Typography>
          <Commands items={[{ command: `skillmkt login --server ${server}` }]} />
          <Alert severity="info">{t('docs.prepareDevNote')}</Alert>
        </Section>

        <Section id="claude-code" title={t('docs.claudeTitle')}>
          <Typography>{t('docs.claudeIntro')}</Typography>
          <Commands
            items={[
              { label: t('docs.globalLabel'), command: 'skillmkt install 12 --target claude-code' },
              { label: t('docs.projectLabel'), command: 'skillmkt install 12 --target claude-code --project' },
              { label: t('docs.versionLabel'), command: 'skillmkt install 12 --target claude-code --version 1.2.0' },
            ]}
          />
          <Typography variant="body2" color="text.secondary">
            {t('docs.claudePaths')}
          </Typography>
        </Section>

        <Section id="cursor" title={t('docs.cursorTitle')}>
          <Typography>{t('docs.cursorIntro')}</Typography>
          <Commands
            items={[
              { label: t('docs.globalLabel'), command: 'skillmkt install 12 --target cursor' },
              { label: t('docs.projectLabel'), command: 'skillmkt install 12 --target cursor --project' },
            ]}
          />
          <Typography variant="body2" color="text.secondary">
            {t('docs.cursorPaths')}
          </Typography>
        </Section>

        <Section id="zip" title={t('docs.zipTitle')}>
          <Typography>{t('docs.zipIntro')}</Typography>
          <Box component="ol" sx={{ m: 0, pl: 3 }}>
            <li>{t('docs.zipStep1')}</li>
            <li>{t('docs.zipStep2')}</li>
            <li>{t('docs.zipStep3')}</li>
          </Box>
          <Typography>{t('docs.zipCli')}</Typography>
          <Commands items={[{ command: 'skillmkt install 12 --target zip --out ./downloads' }]} />
          <Alert severity="warning">{t('docs.zipWarn')}</Alert>
        </Section>

        <Section id="manage" title={t('docs.manageTitle')}>
          <Commands
            items={[
              { label: t('docs.manageList'), command: 'skillmkt list' },
              { label: t('docs.manageOutdated'), command: 'skillmkt outdated' },
              { label: t('docs.manageUpdate'), command: 'skillmkt update' },
              { label: t('docs.manageUninstall'), command: 'skillmkt uninstall 12' },
            ]}
          />
        </Section>

        <Section id="faq" title={t('docs.faqTitle')}>
          <Typography>
            <strong>{t('docs.faqIdQ')}</strong> {t('docs.faqIdA')}
          </Typography>
          <Typography>
            <strong>{t('docs.faqExistsQ')}</strong> {t('docs.faqExistsA')}
          </Typography>
          <Typography>
            <strong>{t('docs.faqLoginQ')}</strong> {t('docs.faqLoginA')}
          </Typography>
        </Section>
      </Stack>
    </Container>
  )
}
