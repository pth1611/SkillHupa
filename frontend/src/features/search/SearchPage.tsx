import {
  Autocomplete, Box, Button, Chip, Container, MenuItem, Pagination, Stack, TextField, Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import {
  fetchCategories, fetchDepartments, fetchTags, searchSkills, skillKeys, type SkillQuery,
} from '../../api/skills'
import type { SkillSort } from '../../api/types'
import { SkillGrid } from '../../components/SkillCard'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'

const PAGE_SIZE = 12
const SORTS: SkillSort[] = ['newest', 'popular', 'name']

function parseQuery(params: URLSearchParams): SkillQuery {
  const category = Number(params.get('category'))
  const page = Number(params.get('page'))
  const sort = params.get('sort') as SkillSort | null
  return {
    q: params.get('q') ?? undefined,
    category: Number.isInteger(category) && category > 0 ? category : undefined,
    department: params.get('department') ?? undefined,
    tag: params.getAll('tag'),
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
  useEffect(() => setText(params.get('q') ?? ''), [params])

  const categories = useQuery({ queryKey: skillKeys.categories, queryFn: fetchCategories })
  const departments = useQuery({ queryKey: skillKeys.departments, queryFn: fetchDepartments })
  const tags = useQuery({ queryKey: skillKeys.tags(''), queryFn: () => fetchTags('') })
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
  const hasFilters = !!(query.q || query.category || query.department || query.tag?.length)

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack spacing={3}>
        <Typography variant="h5" component="h1">
          {t('search.title')}
        </Typography>

        <Box
          component="form"
          onSubmit={submit}
          role="search"
          sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' } }}
        >
          <TextField
            sx={{ gridColumn: { md: '1 / -1' } }}
            label={t('search.query')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => text.trim() !== (query.q ?? '') && update({ q: text.trim() || undefined })}
          />
          <TextField
            select
            label={t('search.category')}
            value={query.category ?? ''}
            onChange={(e) => update({ category: e.target.value ? String(e.target.value) : undefined })}
          >
            <MenuItem value="">{t('search.allCategories')}</MenuItem>
            {(categories.data ?? []).map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
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
            options={(tags.data ?? []).map((tg) => tg.name)}
            value={query.tag ?? []}
            onChange={(_, value) => update({ tag: value })}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => <Chip size="small" label={option} {...getTagProps({ index })} key={option} />)
            }
            renderInput={(inputParams) => <TextField {...inputParams} label={t('search.tags')} />}
          />
          <TextField
            select
            label={t('search.sort')}
            value={query.sort}
            onChange={(e) => update({ sort: e.target.value === 'newest' ? undefined : e.target.value })}
          >
            <MenuItem value="newest">{t('search.sortNewest')}</MenuItem>
            <MenuItem value="popular">{t('search.sortPopular')}</MenuItem>
            <MenuItem value="name">{t('search.sortName')}</MenuItem>
          </TextField>
          <Stack direction="row" spacing={1} sx={{ gridColumn: { md: '1 / -1' } }}>
            <Button type="submit" variant="contained">
              {t('search.apply')}
            </Button>
            {hasFilters && (
              <Button onClick={() => setParams(new URLSearchParams())}>{t('search.reset')}</Button>
            )}
          </Stack>
        </Box>

        {results.isPending && <LoadingState />}
        {results.isError && <ErrorState onRetry={() => void results.refetch()} />}
        {results.data && (
          <>
            <Typography color="text.secondary" aria-live="polite">
              {t('search.results', { count: total })}
            </Typography>
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
    </Container>
  )
}
