import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CloseIcon from '@mui/icons-material/Close'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import FilterListIcon from '@mui/icons-material/FilterList'
import {
  Autocomplete, Box, Button, Checkbox, Chip, Container, Drawer, FormControlLabel, FormGroup, IconButton, List,
  ListItemButton, ListItemText, MenuItem, Pagination, Stack, TextField, Typography, useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { categoryLabel, subcategoryLabel } from '../../i18n/taxonomyLabels'
import { useSearchParams } from 'react-router-dom'
import {
  fetchCategories, fetchDepartments, fetchFacets, fetchTags, fetchTaxonomy, searchSkills, skillKeys, type SkillQuery,
} from '../../api/skills'
import type { SkillSort } from '../../api/types'
import { SkillGrid } from '../../components/SkillCard'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'
import { taxonomyLabel } from '../../utils/taxonomy'

const PAGE_SIZE = 12
const SORTS: SkillSort[] = ['newest', 'popular', 'name']

function parseQuery(params: URLSearchParams): SkillQuery {
  const category = Number(params.get('category'))
  const subcategory = Number(params.get('subcategory'))
  const page = Number(params.get('page'))
  const sort = params.get('sort') as SkillSort | null
  return {
    q: params.get('q') ?? undefined,
    category: Number.isInteger(category) && category > 0 ? category : undefined,
    subcategory: Number.isInteger(subcategory) && subcategory > 0 ? subcategory : undefined,
    department: params.get('department') ?? undefined,
    tag: params.getAll('tag'),
    output_type: params.getAll('output_type'),
    ecosystem: params.getAll('ecosystem'),
    sort: sort && SORTS.includes(sort) ? sort : 'newest',
    page: Number.isInteger(page) && page > 0 ? page : 1,
    page_size: PAGE_SIZE,
  }
}

export function SearchPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const query = parseQuery(params)
  const [text, setText] = useState(query.q ?? '')
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [expanded, setExpanded] = useState<number[]>([])
  useEffect(() => setText(params.get('q') ?? ''), [params])

  const categories = useQuery({ queryKey: skillKeys.categories, queryFn: fetchCategories })
  const departments = useQuery({ queryKey: skillKeys.departments, queryFn: fetchDepartments })
  const tags = useQuery({ queryKey: skillKeys.tags(''), queryFn: () => fetchTags('') })
  const taxonomy = useQuery({ queryKey: skillKeys.taxonomy, queryFn: fetchTaxonomy })
  const facets = useQuery({ queryKey: skillKeys.facets(query), queryFn: () => fetchFacets(query) })
  const results = useQuery({ queryKey: skillKeys.search(query), queryFn: () => searchSkills(query) })

  /** Cập nhật URL (nguồn sự thật của bộ lọc); đổi bộ lọc thì về trang 1. */
  function update(changes: Record<string, string | string[] | undefined>, keepPage = false) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      next.delete(key)
      if (Array.isArray(value)) value.forEach((v) => next.append(key, v))
      else if (value) next.set(key, value)
    }
    if (!keepPage) next.delete('page')
    setParams(next)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    update({ q: text.trim() || undefined })
  }

  const total = results.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters = !!(
    query.q || query.category || query.subcategory || query.department || query.tag?.length || query.output_type?.length || query.ecosystem?.length
  )

  /** Nhóm hộp chọn nhiều giá trị; số đếm cho biết chọn thêm giá trị đó còn bao nhiêu skill. */
  function facetGroup(param: 'output_type' | 'ecosystem') {
    const kind = param === 'output_type' ? 'output' : 'ecosystem'
    const slugs = taxonomy.data?.[param === 'output_type' ? 'output_types' : 'ecosystems'] ?? []
    const counts = facets.data?.[param === 'output_type' ? 'output_types' : 'ecosystems'] ?? {}
    const selected = query[param] ?? []
    // Chỉ hiện giá trị có skill hoặc đang được chọn, tránh một dãy mục "0".
    const shown = slugs.filter((s) => (counts[s] ?? 0) > 0 || selected.includes(s))
    if (shown.length === 0) return null
    return (
      <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }}>
        <Typography component="legend" variant="subtitle2" sx={{ mb: 0.5 }}>
          {t(param === 'output_type' ? 'search.outputType' : 'search.ecosystem')}
        </Typography>
        <FormGroup>
          {shown.map((slug) => (
            <FormControlLabel
              key={slug}
              control={
                <Checkbox
                  size="small"
                  checked={selected.includes(slug)}
                  onChange={(_, on) => update({ [param]: on ? [...selected, slug] : selected.filter((s) => s !== slug) })}
                />
              }
              label={`${taxonomyLabel(t, kind, slug)} (${counts[slug] ?? 0})`}
              sx={{ mr: 2 }}
            />
          ))}
        </FormGroup>
      </Box>
    )
  }


  /** Cây danh mục: "Tất cả skill" → danh mục → nhóm công việc nhỏ; số đếm theo các bộ lọc khác. */
  function categoryTree() {
    const catCounts = facets.data?.categories ?? {}
    const subCounts = facets.data?.subcategories ?? {}
    const allSelected = !query.category && !query.subcategory
    return (
      <Box component="nav" aria-label={t('search.categoryTree')}>
        <List dense disablePadding>
          <ListItemButton
            selected={allSelected}
            onClick={() => update({ category: undefined, subcategory: undefined })}
            sx={{ borderRadius: 1 }}
          >
            <ListItemText
              primary={t('search.allSkills')}
              secondary={facets.data ? facets.data.total : undefined}
              primaryTypographyProps={{ fontWeight: 600 }}
              secondaryTypographyProps={{ sx: { ml: 1 } }}
              sx={{ display: 'flex', justifyContent: 'space-between', my: 0 }}
            />
          </ListItemButton>
          {(categories.data ?? []).map((c) => {
            const subs = (c.subcategories ?? []).filter(
              (sc) => (subCounts[sc.id] ?? 0) > 0 || query.subcategory === sc.id,
            )
            const open = expanded.includes(c.id) || query.category === c.id
            const catSelected = query.category === c.id && !query.subcategory
            return (
              <Box key={c.id}>
                <Stack direction="row" alignItems="center">
                  <IconButton
                    size="small"
                    disabled={subs.length === 0}
                    aria-label={t(open ? 'search.collapseCategory' : 'search.expandCategory', { name: categoryLabel(t, c) })}
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? expanded.filter((id) => id !== c.id) : [...expanded, c.id])}
                    sx={{ visibility: subs.length === 0 ? 'hidden' : 'visible' }}
                  >
                    {open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
                  </IconButton>
                  <ListItemButton
                    selected={catSelected}
                    onClick={() => {
                      update({ category: String(c.id), subcategory: undefined })
                      if (subs.length && !open) setExpanded([...expanded, c.id])
                    }}
                    sx={{ borderRadius: 1, py: 0.5 }}
                  >
                    <ListItemText
                      primary={categoryLabel(t, c)}
                      secondary={facets.data ? (catCounts[c.id] ?? 0) : undefined}
                      sx={{ display: 'flex', justifyContent: 'space-between', my: 0 }}
                      secondaryTypographyProps={{ sx: { ml: 1 } }}
                    />
                  </ListItemButton>
                </Stack>
                {open &&
                  subs.map((sc) => (
                    <ListItemButton
                      key={sc.id}
                      selected={query.subcategory === sc.id}
                      onClick={() => update({ category: String(c.id), subcategory: String(sc.id) })}
                      sx={{ borderRadius: 1, py: 0.25, ml: 5 }}
                    >
                      <ListItemText
                        primary={subcategoryLabel(t, sc)}
                        secondary={facets.data ? (subCounts[sc.id] ?? 0) : undefined}
                        sx={{ display: 'flex', justifyContent: 'space-between', my: 0 }}
                        primaryTypographyProps={{ variant: 'body2' }}
                        secondaryTypographyProps={{ sx: { ml: 1 } }}
                      />
                    </ListItemButton>
                  ))}
              </Box>
            )
          })}
        </List>
      </Box>
    )
  }

  const filters = (
    <Stack component="form" onSubmit={submit} role="search" spacing={2.5}>
      <TextField
        size="small"
        label={t('search.query')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== (query.q ?? '') && update({ q: text.trim() || undefined })}
      />
      <Stack direction="row" spacing={1}>
        <Button type="submit" variant="contained" size="small">
          {t('search.apply')}
        </Button>
        {hasFilters && <Button size="small" onClick={() => setParams(new URLSearchParams())}>{t('search.reset')}</Button>}
      </Stack>
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          {t('search.category')}
        </Typography>
        {categoryTree()}
      </Box>
      <TextField
        select
        size="small"
        label={t('search.department')}
        value={query.department ?? ''}
        onChange={(e) => update({ department: e.target.value || undefined })}
      >
        <MenuItem value="">{t('search.allDepartments')}</MenuItem>
        {(departments.data ?? []).map((d) => (
          <MenuItem key={d} value={d}>
            {d}
          </MenuItem>
        ))}
      </TextField>
      <Autocomplete
        multiple
        size="small"
        options={(tags.data ?? []).map((tg) => tg.name)}
        value={query.tag ?? []}
        onChange={(_, value) => update({ tag: value })}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => <Chip size="small" label={option} {...getTagProps({ index })} key={option} />)
        }
        renderInput={(inputParams) => <TextField {...inputParams} label={t('search.tags')} />}
      />
      {facetGroup('output_type')}
      {facetGroup('ecosystem')}
    </Stack>
  )

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h5" component="h1">
          {t('search.title')}
        </Typography>
        {isMobile && (
          <Button startIcon={<FilterListIcon />} variant="outlined" onClick={() => setDrawerOpen(true)}>
            {t('search.showFilters')}
          </Button>
        )}
      </Stack>

      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '300px minmax(0, 1fr)' }, alignItems: 'start' }}>
        {!isMobile && (
          <Box
            sx={{
              position: 'sticky', top: 80, maxHeight: 'calc(100vh - 100px)', overflowY: 'auto', pr: 1,
              borderRight: 1, borderColor: 'divider',
            }}
          >
            {filters}
          </Box>
        )}
        {isMobile && (
          <Drawer anchor="left" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
            <Box sx={{ width: 320, maxWidth: '90vw', p: 2 }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography variant="h6">{t('search.filters')}</Typography>
                <IconButton aria-label={t('search.closeFilters')} onClick={() => setDrawerOpen(false)}>
                  <CloseIcon />
                </IconButton>
              </Stack>
              {filters}
            </Box>
          </Drawer>
        )}

        <Stack spacing={2.5}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
            <Typography color="text.secondary" aria-live="polite">
              {results.data ? t('search.results', { count: total }) : ''}
            </Typography>
            <TextField
              select
              size="small"
              sx={{ minWidth: 160 }}
              label={t('search.sort')}
              value={query.sort}
              onChange={(e) => update({ sort: e.target.value === 'newest' ? undefined : e.target.value })}
            >
              <MenuItem value="newest">{t('search.sortNewest')}</MenuItem>
              <MenuItem value="popular">{t('search.sortPopular')}</MenuItem>
              <MenuItem value="name">{t('search.sortName')}</MenuItem>
            </TextField>
          </Stack>

          {results.isPending && <LoadingState />}
          {results.isError && <ErrorState onRetry={() => void results.refetch()} />}
          {results.data && (
            <>
              {results.data.items.length === 0 ? (
                <EmptyState>{t('search.noResults')}</EmptyState>
              ) : (
                <SkillGrid skills={results.data.items} />
              )}
              {pages > 1 && (
                <Pagination
                  sx={{ alignSelf: 'center' }}
                  count={pages}
                  page={Math.min(query.page ?? 1, pages)}
                  onChange={(_, page) => update({ page: page === 1 ? undefined : String(page) }, true)}
                />
              )}
            </>
          )}
        </Stack>
      </Box>
    </Container>
  )
}
