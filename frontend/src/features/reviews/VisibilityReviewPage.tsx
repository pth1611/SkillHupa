import { Alert, Button, Card, CardContent, Container, Stack, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { decideRequest, fetchVisibilityRequest, reviewKeys } from '../../api/reviews'
import { useAuth } from '../../auth/AuthProvider'
import { ErrorState, LoadingState } from '../../components/StateViews'
import { NotFoundPage } from '../common/pages'
import { DecisionPanel } from './DecisionPanel'

function scope(visibility: string, department: string | null, t: (k: string, o?: Record<string, string>) => string) {
  return visibility === 'department'
    ? t('detail.departmentOnly', { department: department ?? '' })
    : t('detail.companyWide')
}

export function VisibilityReviewPage() {
  const { t } = useTranslation()
  const { requestId } = useParams()
  const id = Number(requestId)
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const valid = Number.isInteger(id) && id > 0

  const request = useQuery({ queryKey: reviewKeys.request(id), queryFn: () => fetchVisibilityRequest(id), enabled: valid, retry: false })
  const decide = useMutation({
    mutationFn: (v: { decision: 'approved' | 'rejected'; comment: string | null }) => decideRequest(id, v.decision, v.comment),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: reviewKeys.all })
      navigate('/reviews', { replace: true })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('state.error')),
  })

  if (!valid || (request.error instanceof ApiError && request.error.status === 404)) return <NotFoundPage />
  if (request.isPending) return <LoadingState fullPage />
  if (request.isError) return <ErrorState fullPage onRetry={() => void request.refetch()} />

  const r = request.data
  const canDecide = user?.role === 'reviewer' && r.status === 'pending'

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Stack spacing={2.5}>
        <Button component={RouterLink} to="/reviews" size="small" sx={{ alignSelf: 'flex-start' }}>
          ← {t('reviews.backToQueue')}
        </Button>
        <Typography variant="h5" component="h1">
          {t('reviews.visibilityTitle', { name: r.skill_name })}
        </Typography>
        {r.summary && <Typography color="text.secondary">{r.summary}</Typography>}
        <Card>
          <CardContent>
            <Stack spacing={1}>
              <Typography>
                {t('reviews.currentScope')}: <strong>{scope(r.from_visibility, r.from_department, t)}</strong>
              </Typography>
              <Typography>
                {t('reviews.requestedScope')}: <strong>{scope(r.to_visibility, r.to_department, t)}</strong>
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {new Date(r.created_at).toLocaleString()}
              </Typography>
            </Stack>
          </CardContent>
        </Card>
        <Button component={RouterLink} to={`/skills/${r.skill_id}`} sx={{ alignSelf: 'flex-start' }}>
          {t('mySkills.details')}
        </Button>
        {r.status !== 'pending' && <Alert severity="info">{t('reviews.notPending')}</Alert>}
        {canDecide ? (
          <DecisionPanel busy={decide.isPending} error={error} onSubmit={(decision, comment) => decide.mutate({ decision, comment })} />
        ) : (
          user?.role === 'manager' && <Alert severity="info">{t('reviews.managerReadOnly')}</Alert>
        )}
      </Stack>
    </Container>
  )
}
