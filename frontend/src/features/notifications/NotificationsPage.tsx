import { Alert, Box, Button, Card, CardActionArea, Container, Pagination, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { fetchNotifications, markAllRead, markRead, notificationKeys } from '../../api/notifications'
import type { NotificationData } from '../../api/types'
import { ME_KEY } from '../../auth/AuthProvider'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'

/** Chỉ đi theo liên kết nội bộ; thông báo do hệ thống tạo nhưng vẫn không tin để chuyển hướng ra ngoài. */
export function internalLink(link: string | null): string | null {
  return link && link.startsWith('/') && !link.startsWith('//') ? link : null
}

export function NotificationsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [page, setPage] = useState(1)

  const list = useQuery({
    queryKey: notificationKeys.list(unreadOnly, page),
    queryFn: () => fetchNotifications(unreadOnly, page),
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: notificationKeys.all })
    void queryClient.invalidateQueries({ queryKey: ME_KEY }) // số chưa đọc trên chuông
  }
  const read = useMutation({ mutationFn: markRead, onSuccess: refresh })
  const readAll = useMutation({ mutationFn: markAllRead, onSuccess: refresh })

  async function open(n: NotificationData) {
    if (!n.is_read) {
      try {
        await read.mutateAsync(n.id)
      } catch {
        /* vẫn mở liên kết; lần sau sẽ thử đánh dấu lại */
      }
    }
    const to = internalLink(n.link)
    if (to) navigate(to)
  }

  const total = list.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / 20))

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Stack spacing={2.5}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" sx={{ rowGap: 1 }}>
          <Typography variant="h5" component="h1">
            {t('notifications.title')}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <ToggleButtonGroup
              size="small"
              exclusive
              value={unreadOnly ? 'unread' : 'all'}
              onChange={(_, v: 'all' | 'unread' | null) => {
                if (v) {
                  setUnreadOnly(v === 'unread')
                  setPage(1)
                }
              }}
            >
              <ToggleButton value="all">{t('notifications.all')}</ToggleButton>
              <ToggleButton value="unread">{t('notifications.unread')}</ToggleButton>
            </ToggleButtonGroup>
            <Button size="small" disabled={readAll.isPending} onClick={() => readAll.mutate()}>
              {t('notifications.markAllRead')}
            </Button>
          </Stack>
        </Stack>

        {(read.isError || readAll.isError) && <Alert severity="error">{t('notifications.markFailed')}</Alert>}
        {list.isPending && <LoadingState />}
        {list.isError && <ErrorState onRetry={() => void list.refetch()} />}
        {list.data && list.data.items.length === 0 && (
          <EmptyState>{unreadOnly ? t('notifications.emptyUnread') : t('notifications.empty')}</EmptyState>
        )}

        <Stack spacing={1} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {list.data?.items.map((n) => (
            <Box component="li" key={n.id}>
              <Card
                sx={{
                  borderLeft: 4,
                  borderLeftColor: n.is_read ? 'transparent' : 'primary.main',
                  bgcolor: n.is_read ? 'background.paper' : 'action.hover',
                }}
              >
                <CardActionArea onClick={() => void open(n)} sx={{ p: 1.75 }}>
                  <Typography fontWeight={n.is_read ? 400 : 600}>{n.message}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(n.created_at).toLocaleString()}
                  </Typography>
                </CardActionArea>
              </Card>
            </Box>
          ))}
        </Stack>

        {pages > 1 && <Pagination sx={{ alignSelf: 'center' }} count={pages} page={page} onChange={(_, p) => setPage(p)} />}
      </Stack>
    </Container>
  )
}
