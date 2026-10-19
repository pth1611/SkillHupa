import { zodResolver } from '@hookform/resolvers/zod'
import {
  Alert, Autocomplete, Box, Button, Chip, FormControlLabel, MenuItem, Radio, RadioGroup, Stack, TextField, Typography,
} from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { fetchCategories, fetchDepartments, fetchTags, skillKeys } from '../../api/skills'
import { fetchMyTagProposals, proposeTag, studioKeys } from '../../api/studio'

export interface InfoValues {
  name: string
  summary: string
  category_id: number | ''
  department: string
  visibility: 'company' | 'department'
  tag_ids: number[]
  version: string
  changelog: string
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function semverKey(v: string): number[] {
  return v.split('.').map(Number)
}

export function isGreater(candidate: string, existing: string[]): boolean {
  const a = semverKey(candidate)
  return existing.every((e) => {
    const b = semverKey(e)
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
    return false
  })
}

interface Props {
  defaults: InfoValues
  /** Chỉ skill chưa từng đăng mới sửa được thông tin skill; bản mới của skill đã đăng chỉ hỏi số phiên bản và changelog. */
  skillFieldsEditable: boolean
  nameEditable: boolean
  releasedVersions: string[]
  busy: boolean
  error: string | null
  missingFields: string[]
  onSubmit: (values: InfoValues) => void
  onBack: () => void
}

export function InfoStep({
  defaults, skillFieldsEditable, nameEditable, releasedVersions, busy, error, missingFields, onSubmit, onBack,
}: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [proposal, setProposal] = useState('')
  const [proposalError, setProposalError] = useState(false)

  const categories = useQuery({ queryKey: skillKeys.categories, queryFn: fetchCategories })
  const departments = useQuery({ queryKey: skillKeys.departments, queryFn: fetchDepartments })
  const tags = useQuery({ queryKey: skillKeys.tags(''), queryFn: () => fetchTags('') })
  const mine = useQuery({ queryKey: studioKeys.myTags, queryFn: fetchMyTagProposals })

  const schema = z.object({
    name: skillFieldsEditable && nameEditable ? z.string().trim().min(1, t('studio.required')).max(100) : z.string(),
    summary: skillFieldsEditable ? z.string().trim().min(1, t('studio.required')).max(200, t('studio.summaryMax')) : z.string(),
    category_id: skillFieldsEditable ? z.number({ message: t('studio.required') }) : z.any(),
    department: skillFieldsEditable ? z.string().trim().min(1, t('studio.required')) : z.string(),
    visibility: z.enum(['company', 'department']),
    tag_ids: z.array(z.number()).max(10, t('studio.tagsMax')),
    version: z
      .string()
      .trim()
      .regex(SEMVER, t('studio.versionInvalid'))
      .refine((v) => isGreater(v, releasedVersions), t('studio.versionNotGreater', { versions: releasedVersions.join(', ') })),
    changelog: z.string(),
  })

  const { control, handleSubmit, formState: { errors }, watch } = useForm<InfoValues>({
    defaultValues: defaults,
    resolver: zodResolver(schema) as never,
  })
  const summary = watch('summary')

  const options = [
    ...(tags.data ?? []).map((tg) => ({ id: tg.id, name: tg.name, pending: false })),
    ...(mine.data ?? []).filter((p) => p.status === 'pending').map((p) => ({ id: p.id, name: p.name, pending: true })),
  ]

  async function addProposal(current: number[], set: (ids: number[]) => void) {
    const name = proposal.trim()
    if (!name) return
    setProposalError(false)
    try {
      const tag = await proposeTag(name)
      await queryClient.invalidateQueries({ queryKey: studioKeys.myTags })
      set([...new Set([...current, tag.id])])
      setProposal('')
    } catch {
      setProposalError(true)
    }
  }

  return (
    <Box component="form" noValidate onSubmit={handleSubmit(onSubmit)}>
      <Stack spacing={2.5}>
        {error && <Alert severity="error">{error}</Alert>}
        {missingFields.length > 0 && (
          <Alert severity="warning">{t('studio.missingFields', { fields: missingFields.join(', ') })}</Alert>
        )}

        {skillFieldsEditable && (
          <>
            <Controller
              name="name"
              control={control}
              render={({ field }) => (
                <TextField {...field} required label={t('studio.name')} disabled={!nameEditable}
                  error={!!errors.name} helperText={errors.name?.message ?? t('studio.fromPackage')} />
              )}
            />
            <Controller
              name="summary"
              control={control}
              render={({ field }) => (
                <TextField {...field} required multiline minRows={2} label={t('studio.summary')}
                  error={!!errors.summary}
                  helperText={errors.summary?.message ?? `${summary.length}/200`} inputProps={{ maxLength: 400 }} />
              )}
            />
            <Controller
              name="category_id"
              control={control}
              render={({ field }) => (
                <TextField {...field} select required label={t('studio.category')} error={!!errors.category_id}
                  helperText={errors.category_id ? t('studio.required') : undefined}
                  onChange={(e) => field.onChange(Number(e.target.value))}>
                  {(categories.data ?? []).map((c) => (
                    <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                  ))}
                </TextField>
              )}
            />
            <Controller
              name="department"
              control={control}
              render={({ field }) =>
                (departments.data ?? []).length > 0 ? (
                  <TextField {...field} select required label={t('studio.department')} error={!!errors.department}>
                    {(departments.data ?? []).map((d) => (
                      <MenuItem key={d} value={d}>{d}</MenuItem>
                    ))}
                  </TextField>
                ) : (
                  <TextField {...field} required label={t('studio.department')} error={!!errors.department}
                    helperText={errors.department?.message} />
                )
              }
            />
            <Controller
              name="visibility"
              control={control}
              render={({ field }) => (
                <Box>
                  <Typography variant="subtitle2">{t('studio.visibility')}</Typography>
                  <RadioGroup {...field} row>
                    <FormControlLabel value="company" control={<Radio />} label={t('studio.visibilityCompany')} />
                    <FormControlLabel value="department" control={<Radio />} label={t('studio.visibilityDepartment')} />
                  </RadioGroup>
                </Box>
              )}
            />
            <Controller
              name="tag_ids"
              control={control}
              render={({ field }) => (
                <Stack spacing={1}>
                  <Autocomplete
                    multiple
                    options={options}
                    getOptionLabel={(o) => o.name}
                    isOptionEqualToValue={(a, b) => a.id === b.id}
                    value={options.filter((o) => field.value.includes(o.id))}
                    onChange={(_, value) => field.onChange(value.map((v) => v.id))}
                    renderTags={(value, getTagProps) =>
                      value.map((o, index) => (
                        <Chip size="small" color={o.pending ? 'warning' : 'default'}
                          label={o.pending ? `${o.name} (${t('studio.tagPending')})` : o.name}
                          {...getTagProps({ index })} key={o.id} />
                      ))
                    }
                    renderInput={(params) => (
                      <TextField {...params} label={t('studio.tags')} error={!!errors.tag_ids} helperText={errors.tag_ids?.message} />
                    )}
                  />
                  <Stack direction="row" spacing={1}>
                    <TextField size="small" label={t('studio.proposeTag')} value={proposal}
                      onChange={(e) => setProposal(e.target.value)} error={proposalError}
                      helperText={proposalError ? t('studio.proposeFailed') : t('studio.proposeHelp')} />
                    <Button onClick={() => void addProposal(field.value, field.onChange)} disabled={!proposal.trim()}>
                      {t('studio.proposeButton')}
                    </Button>
                  </Stack>
                </Stack>
              )}
            />
          </>
        )}

        <Controller
          name="version"
          control={control}
          render={({ field }) => (
            <TextField {...field} required label={t('studio.version')} error={!!errors.version}
              helperText={errors.version?.message ?? t('studio.versionHelp')} />
          )}
        />
        <Controller
          name="changelog"
          control={control}
          render={({ field }) => (
            <TextField {...field} multiline minRows={3} label={t('studio.changelog')} />
          )}
        />

        <Stack direction="row" spacing={1}>
          <Button onClick={onBack}>{t('studio.back')}</Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {t('studio.next')}
          </Button>
        </Stack>
      </Stack>
    </Box>
  )
}
