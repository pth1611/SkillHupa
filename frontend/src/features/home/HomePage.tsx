import SearchIcon from '@mui/icons-material/Search'
import {
  Box, Button, Card, CardContent, Container, InputAdornment, Link, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom'
import { fetchCategories, fetchFeatured, searchSkills, skillKeys, type SkillQuery } from '../../api/skills'
import type { Category, SkillCardData } from '../../api/types'
import { useAuth } from '../../auth/AuthProvider'
import { SkillGrid } from '../../components/SkillCard'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'

const BLOCK_SIZE = 8
const CATEGORY_BLOCK_SIZE = 4
const MAX_CATEGORY_BLOCKS = 6

function Section({ title, viewAllTo, children }: { title: string; viewAllTo: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <Box component="section" aria-label={title}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 1.5 }}>
        <Typography variant="h5" component="h2">
          {title}
        </Typography>
        <Link component={RouterLink} to={viewAllTo} underline="hover">
          {t('home.viewAll')} →
        </Link>
      </Stack>
      {children}
    </Box>
  )
}

function SearchBox() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [text, setText] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    const q = text.trim()
    navigate(q ? `/skills?q=${encodeURIComponent(q)}` : '/skills')
  }

  return (
    <Box component="form" onSubmit={submit} role="search" sx={{ width: '100%', maxWidth: 640 }}>
      <TextField
        fullWidth
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('home.searchPlaceholder')}
        inputProps={{ 'aria-label': t('home.search') }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon />
            </InputAdornment>
          ),
          endAdornment: (
            <Button type="submit" variant="contained" size="small">
              {t('home.search')}
            </Button>
          ),
          sx: { bgcolor: 'background.paper', pr: 0.75 },
        }}
      />
    </Box>
  )
}

function Banner() {
  const { t } = useTranslation()
  return (
    <Box
      sx={{
        py: { xs: 5, md: 8 },
        px: 2,
        background: (theme) =>
          `linear-gradient(135deg, ${theme.palette.primary.main}22, ${theme.palette.secondary.main}22)`,
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Container maxWidth="lg">
        <Stack spacing={2.5} alignItems="flex-start">
          <Typography variant="h3" component="h1" sx={{ fontSize: { xs: '2rem', md: '2.75rem' } }}>
            {t('home.bannerTitle')}
          </Typography>
          <Typography variant="h6" color="text.secondary" fontWeight={400}>
            {t('app.tagline')}
          </Typography>
          <SearchBox />
        </Stack>
      </Container>
    </Box>
  )
}

function CallToAction() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const canCreate = user?.role === 'creator' || user?.role === 'manager'
  return (
    <Card sx={{ bgcolor: 'action.hover' }}>
      <CardContent>
        <Stack spacing={1.5} alignItems="flex-start">
          <Typography variant="h5" component="h2">
            {t('home.ctaTitle')}
          </Typography>
          <Typography color="text.secondary">{canCreate ? t('home.ctaCreator') : t('home.ctaOthers')}</Typography>
          {canCreate && (
            <Button component={RouterLink} to="/studio/new" variant="contained">
              {t('home.ctaCreatorButton')}
            </Button>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}

function CategoryTabs({ categories, value }: { categories: Category[]; value: number | null }) {
  const { t } = useTranslation()
  const [, setParams] = useSearchParams()
  return (
    <Tabs
      value={value ?? 'all'}
      onChange={(_, next: number | 'all') => setParams(next === 'all' ? {} : { category: String(next) })}
      variant="scrollable"
      scrollButtons="auto"
      aria-label={t('home.tabAll')}
    >
      <Tab value="all" label={t('home.tabAll')} />
      {categories.map((c) => (
        <Tab key={c.id} value={c.id} label={c.name} />
      ))}
    </Tabs>
  )
}

export function HomePage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const rawCategory = Number(params.get('category'))
  const categoryId = Number.isInteger(rawCategory) && rawCategory > 0 ? rawCategory : null

  const categories = useQuery({ queryKey: skillKeys.categories, queryFn: fetchCategories })
  const featured = useQuery({ queryKey: skillKeys.featured, queryFn: () => fetchFeatured(BLOCK_SIZE * 2) })
  const newestQuery: SkillQuery = { sort: 'newest', page_size: BLOCK_SIZE, category: categoryId ?? undefined }
  const newest = useQuery({ queryKey: skillKeys.search(newestQuery), queryFn: () => searchSkills(newestQuery) })

  const shown: Category[] = (categories.data ?? []).filter((c) => categoryId === null || c.id === categoryId)
  // Tab một danh mục: khối "Mới đăng" đã là danh mục đó nên không lặp lại khối theo danh mục.
  const blockCategories = categoryId === null ? shown.slice(0, MAX_CATEGORY_BLOCKS) : []
  const blocks = useQueries({
    queries: blockCategories.map((c) => {
      const query: SkillQuery = { category: c.id, sort: 'newest', page_size: CATEGORY_BLOCK_SIZE }
      return { queryKey: skillKeys.search(query), queryFn: () => searchSkills(query) }
    }),
  })

  const featuredItems: SkillCardData[] = (featured.data ?? [])
    .filter((s) => categoryId === null || s.category_id === categoryId)
    .slice(0, BLOCK_SIZE)
  const newestItems = newest.data?.items ?? []

  const loading = featured.isPending || newest.isPending || categories.isPending
  const failed = featured.isError || newest.isError || categories.isError
  const nothing = !loading && !failed && featuredItems.length === 0 && newestItems.length === 0

  return (
    <>
      <Banner />
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack spacing={4}>
          {categories.data && categories.data.length > 0 && (
            <CategoryTabs categories={categories.data} value={categoryId} />
          )}

          {loading && <LoadingState />}
          {failed && (
            <ErrorState
              onRetry={() => {
                void categories.refetch()
                void featured.refetch()
                void newest.refetch()
              }}
            />
          )}
          {nothing && <EmptyState>{t('home.emptyAll')}</EmptyState>}

          {featuredItems.length > 0 && (
            <Section title={t('home.featured')} viewAllTo="/skills?sort=popular">
              <SkillGrid skills={featuredItems} />
            </Section>
          )}

          {newestItems.length > 0 && (
            <Section
              title={t('home.newest')}
              viewAllTo={categoryId ? `/skills?sort=newest&category=${categoryId}` : '/skills?sort=newest'}
            >
              <SkillGrid skills={newestItems} />
            </Section>
          )}

          {blockCategories.map((category, index) => {
            const items = blocks[index]?.data?.items ?? []
            if (items.length === 0) return null // khối rỗng thì ẩn, không hiện khung trống
            return (
              <Section key={category.id} title={category.name} viewAllTo={`/skills?category=${category.id}`}>
                <SkillGrid skills={items} />
              </Section>
            )
          })}

          <CallToAction />
        </Stack>
      </Container>
    </>
  )
}
