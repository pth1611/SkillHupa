import { Alert, Autocomplete, Box, Button, Chip, Paper, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import { autoClassify, reviewKeys, saveClassification } from '../../api/reviews'
import { fetchTaxonomy, skillKeys } from '../../api/skills'
import { useAuth } from '../../auth/AuthProvider'
import { taxonomyLabel } from '../../utils/taxonomy'

interface Props {
  skillId: number
  detailId: number
  output_types: string[]
  ecosystems: string[]
}

/** Manager/Reviewer chọn tay hoặc chạy phân loại tự động loại đầu ra và ứng dụng của skill. */
export function ClassificationPanel({ skillId, detailId, ...initial }: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isManager = useAuth().user?.role === 'manager'
  const taxonomy = useQuery({ queryKey: skillKeys.taxonomy, queryFn: fetchTaxonomy })
  const [values, setValues] = useState({ output_types: initial.output_types, ecosystems: initial.ecosystems })
  const [message, setMessage] = useState<{ severity: 'success' | 'info' | 'error'; text: string } | null>(null)

  const onError = (e: unknown) => setMessage({ severity: 'error', text: e instanceof ApiError ? e.message : t('state.error') })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: reviewKeys.detail(detailId) })

  const save = useMutation({
    mutationFn: () => saveClassification(skillId, values),
    onSuccess: (d) => {
      setValues(d)
      setMessage({ severity: 'success', text: t('reviews.classifySaved') })
      refresh()
    },
    onError,
  })
  const auto = useMutation({
    mutationFn: (force: boolean) => autoClassify(skillId, force),
    onSuccess: (d) => {
      setValues({ output_types: d.output_types, ecosystems: d.ecosystems })
      setMessage(d.applied
        ? { severity: 'success', text: t('reviews.classifyAutoDone') }
        : { severity: 'info', text: t('reviews.classifyNone') })
      refresh()
    },
    onError,
  })
  const busy = save.isPending || auto.isPending

  return (
    <Paper variant="outlined" sx={{ p: 2 }} component="section">
      <Typography variant="h6" component="h2" gutterBottom>{t('reviews.classifyTitle')}</Typography>
      <Stack spacing={2}>
        {(['output_types', 'ecosystems'] as const).map((name) => {
          const kind = name === 'output_types' ? 'output' : 'ecosystem'
          return (
            <Autocomplete
              key={name}
              multiple
              size="small"
              options={taxonomy.data?.[name] ?? []}
              value={values[name]}
              onChange={(_, v) => setValues((prev) => ({ ...prev, [name]: v }))}
              getOptionLabel={(slug) => taxonomyLabel(t, kind, slug)}
              renderTags={(v, getProps) => v.map((slug, i) => (
                <Chip {...getProps({ index: i })} key={slug} size="small" label={taxonomyLabel(t, kind, slug)} />
              ))}
              renderInput={(params) => (
                <TextField {...params} label={t(`studio.${name === 'output_types' ? 'outputTypes' : 'ecosystems'}`)} />
              )}
            />
          )
        })}
        {message && <Alert severity={message.severity}>{message.text}</Alert>}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="contained" disabled={busy} onClick={() => save.mutate()}>{t('reviews.classifySave')}</Button>
          {isManager && (
            <>
              <Button variant="outlined" disabled={busy} onClick={() => auto.mutate(false)}>{t('reviews.classifyAuto')}</Button>
              <Button variant="text" disabled={busy} onClick={() => auto.mutate(true)}>{t('reviews.classifyAutoForce')}</Button>
            </>
          )}
        </Box>
      </Stack>
    </Paper>
  )
}
