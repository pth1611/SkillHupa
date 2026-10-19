import {
  Alert, Box, Button, Card, CardContent, Container, Divider, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { devLogin, ssoLoginUrl } from '../../api/auth'
import type { Role } from '../../api/types'
import { ME_KEY, useAuth } from '../../auth/AuthProvider'
import { brand } from '../../theme/brand'

const ROLES: Role[] = ['user', 'creator', 'reviewer', 'manager']

/** Chỉ cho phép quay về đường dẫn nội bộ, tránh chuyển hướng ra ngoài. */
export function safeNext(raw: string | null): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/login') ? raw : '/'
}

export function LoginPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  if (user) return <Navigate to={next} replace />

  return (
    <Container maxWidth="xs" sx={{ py: 10 }}>
      <Stack spacing={3}>
        <Box textAlign="center">
          <Typography variant="h4" component="h1" fontWeight={800} color="primary">
            {brand.productName}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {t('login.subtitle')}
          </Typography>
        </Box>
        {params.get('error') && <Alert severity="error">{t('login.errorSso')}</Alert>}
        <Button variant="contained" size="large" href={ssoLoginUrl(next)}>
          {t('login.sso')}
        </Button>
        {import.meta.env.DEV && (
          <>
            <Divider />
            <DevLogin next={next} />
          </>
        )}
      </Stack>
    </Container>
  )
}

function DevLogin({ next }: { next: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('dev@example.com')
  const [role, setRole] = useState<Role>('manager')
  const [department, setDepartment] = useState('')
  const [failed, setFailed] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setFailed(false)
    try {
      await devLogin({ email, role, department: department || undefined })
      await queryClient.invalidateQueries({ queryKey: ME_KEY })
      navigate(next, { replace: true })
    } catch {
      setFailed(true)
    }
  }

  return (
    <Card>
      <CardContent>
        <Box component="form" onSubmit={submit}>
          <Stack spacing={2}>
            <Typography variant="subtitle2">{t('login.devTitle')}</Typography>
            <TextField size="small" label={t('login.devEmail')} value={email} onChange={(e) => setEmail(e.target.value)} />
            <TextField size="small" select label={t('login.devRole')} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <MenuItem key={r} value={r}>
                  {t(`role.${r}`)}
                </MenuItem>
              ))}
            </TextField>
            <TextField size="small" label={t('login.devDepartment')} value={department} onChange={(e) => setDepartment(e.target.value)} />
            {failed && <Alert severity="warning">{t('login.devFailed')}</Alert>}
            <Button type="submit" variant="outlined">
              {t('login.devSubmit')}
            </Button>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  )
}
