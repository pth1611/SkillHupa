import SearchIcon from '@mui/icons-material/Search'
import {
  alpha, Box, Card, CardContent, Chip, Container, IconButton, InputAdornment, Link, Stack, Tab, Tabs, TextField,
  Typography,
} from '@mui/material'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { categoryLabel } from '../../i18n/taxonomyLabels'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom'
import { fetchCategories, fetchDepartments, fetchFeatured, searchSkills, skillKeys, type SkillQuery } from '../../api/skills'
import type { Category, SkillCardData } from '../../api/types'
import { useAuth } from '../../auth/AuthProvider'
import { SkillGrid } from '../../components/SkillCard'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'

const BLOCK_SIZE = 8
const CATEGORY_BLOCK_SIZE = 4
const MAX_CATEGORY_BLOCKS = 6

function Section({
  title, subtitle, viewAllTo, children,
}: { title: string; subtitle?: string; viewAllTo: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <Box component="section" aria-label={title}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-end" sx={{ mb: 2.5 }}>
        <Box>
          <Typography variant="h5" component="h2" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
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
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function submit(event: FormEvent) {
    event.preventDefault()
    const q = text.trim()
    navigate(q ? `/skills?q=${encodeURIComponent(q)}` : '/skills')
  }

  return (
    <Stack
      component="form"
      direction="row"
      spacing={1.5}
      alignItems="center"
      onSubmit={submit}
      role="search"
      sx={{ width: '100%', maxWidth: 720 }}
    >
      <TextField
        fullWidth
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('home.searchPlaceholder')}
        inputProps={{ 'aria-label': t('home.search') }}
        inputRef={inputRef}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon />
            </InputAdornment>
          ),
          endAdornment: (
            <InputAdornment position="end">
              <Chip size="small" label="⌘K" sx={{ borderRadius: 1, fontWeight: 600, display: { xs: 'none', sm: 'flex' } }} />
            </InputAdornment>
          ),
          sx: { bgcolor: 'background.paper', borderRadius: 2, height: 60, pl: 2.5, pr: 2 },
        }}
        sx={{ '& fieldset': { borderColor: 'divider' } }}
      />
      <IconButton
        type="submit"
        aria-label={t('home.search')}
        sx={{
          width: 60, height: 60, flexShrink: 0, bgcolor: 'primary.main', color: 'primary.contrastText',
          '&:hover': { bgcolor: 'primary.light' },
        }}
      >
        <SearchIcon />
      </IconButton>
    </Stack>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <Box sx={{ textAlign: 'center', minWidth: 110 }}>
      <Typography sx={{ fontSize: { xs: '1.6rem', md: '2rem' }, fontWeight: 800, lineHeight: 1.1 }}>
        {value.toLocaleString()}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Box>
  )
}

function Banner({ stats }: { stats: { skills: number; categories: number; departments: number } | null }) {
  const { t } = useTranslation()
  return (
    <Box
      sx={(theme) => ({
        position: 'relative',
        overflow: 'hidden',
        py: { xs: 7, md: 12 },
        px: 2,
        borderBottom: 1,
        borderColor: 'divider',
        backgroundImage: `
          radial-gradient(60% 50% at 15% 0%, ${alpha(theme.palette.primary.main, 0.18)}, transparent 70%),
          radial-gradient(55% 50% at 90% 10%, ${alpha(theme.palette.secondary.main, 0.16)}, transparent 70%),
          linear-gradient(${alpha(theme.palette.text.primary, 0.04)} 1px, transparent 1px),
          linear-gradient(90deg, ${alpha(theme.palette.text.primary, 0.04)} 1px, transparent 1px)`,
        backgroundSize: 'auto, auto, 56px 56px, 56px 56px',
      })}
    >
      <Container maxWidth="lg">
        <Stack spacing={3.5} alignItems="center" textAlign="center">
          <Typography
            variant="h3"
            component="h1"
            sx={{ fontSize: { xs: '2.5rem', md: '4.25rem' }, lineHeight: 1.1, maxWidth: 900 }}
          >
            {t('home.heroLine1')}{' '}
            <Box
              component="span"
              sx={(theme) => ({
                backgroundImage: `linear-gradient(90deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
                display: 'inline-block',
              })}
            >
              {t('home.heroAccent')}
            </Box>
          </Typography>
          <Typography variant="h6" color="text.secondary" fontWeight={400} sx={{ maxWidth: 720 }}>
            {t('home.heroSubtitle')}
          </Typography>
          <SearchBox />
          {stats && (
            <Stack direction="row" spacing={{ xs: 3, md: 8 }} sx={{ pt: 3 }}>
              <Stat value={stats.skills} label={t('home.statSkills')} />
              <Stat value={stats.categories} label={t('home.statCategories')} />
              <Stat value={stats.departments} label={t('home.statDepartments')} />
            </Stack>
          )}
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
    <Card sx={{ bgcolor: 'action.hover', borderRadius: 2 }}>
      <CardContent>
        <Stack spacing={1.5} alignItems="flex-start">
          <Typography variant="h5" component="h2">
            {t('home.ctaTitle')}
          </Typography>
          <Typography color="text.secondary">{canCreate ? t('home.ctaCreator') : t('home.ctaOthers')}</Typography>
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
        <Tab key={c.id} value={c.id} label={categoryLabel(t, c)} />
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
  const departments = useQuery({ queryKey: skillKeys.departments, queryFn: fetchDepartments })
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

  const categoryNames = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, categoryLabel(t, c)])), [categories.data, t])
  const stats =
    categories.data && newest.data && departments.data
      ? { skills: newest.data.total, categories: categories.data.length, departments: departments.data.length }
      : null

  const loading = featured.isPending || newest.isPending || categories.isPending
  const failed = featured.isError || newest.isError || categories.isError
  const nothing = !loading && !failed && featuredItems.length === 0 && newestItems.length === 0

  return (
    <>
      <Banner stats={categoryId === null ? stats : null} />
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
            <Section title={t('home.featured')} subtitle={t('home.featuredSubtitle')} viewAllTo="/skills?sort=popular">
              <SkillGrid skills={featuredItems} categoryNames={categoryNames} />
            </Section>
          )}

          {newestItems.length > 0 && (
            <Section
              title={t('home.newest')}
              viewAllTo={categoryId ? `/skills?sort=newest&category=${categoryId}` : '/skills?sort=newest'}
            >
              <SkillGrid skills={newestItems} categoryNames={categoryNames} />
            </Section>
          )}

          {blockCategories.map((category, index) => {
            const items = blocks[index]?.data?.items ?? []
            if (items.length === 0) return null // khối rỗng thì ẩn, không hiện khung trống
            return (
              <Section key={category.id} title={categoryLabel(t, category)} viewAllTo={`/skills?category=${category.id}`}>
                <SkillGrid skills={items} categoryNames={categoryNames} />
              </Section>
            )
          })}

          <CallToAction />
        </Stack>
      </Container>
    </>
  )
}
