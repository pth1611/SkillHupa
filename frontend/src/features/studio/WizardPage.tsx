import { Container, Step, StepButton, Stepper, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { fetchCategories, fetchSkill, fetchTags, skillKeys } from '../../api/skills'
import {
  addVersion, createSkill, deleteVersion, fetchMyTagProposals, fetchOwnerVersions, fetchValidation,
  patchSkill, patchVersion, replaceIcon, replacePackage, studioKeys, submitVersion,
} from '../../api/studio'
import type { Finding, Prefill, SkillCardData, ValidationData, VersionWithValidation } from '../../api/types'
import { useAuth } from '../../auth/AuthProvider'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ErrorState, LoadingState } from '../../components/StateViews'
import { NotFoundPage } from '../common/pages'
import { InfoStep, type InfoValues, type Suggested } from './InfoStep'
import { PackageStep } from './PackageStep'
import { ReviewStep } from './ReviewStep'
import { ValidationList } from './ValidationList'

const EDITABLE = new Set(['draft', 'rejected'])
const prefillKey = (id: number, version: string) => ['studio', 'prefill', id, version] as const

function bumpPatch(version: string | undefined): string {
  const m = version?.match(/^(\d+)\.(\d+)\.(\d+)$/)
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : '1.0.0'
}

export function WizardPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { id } = useParams()
  const skillId = id ? Number(id) : null
  const [params, setParams] = useSearchParams()
  const versionParam = params.get('version')
  const newVersionMode = params.get('mode') === 'new-version'
  const step = Math.min(3, Math.max(1, Number(params.get('step')) || 1))

  const [error, setError] = useState<string | null>(null)
  const [iconFindings, setIconFindings] = useState<Finding[]>([])
  const [missing, setMissing] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)

  const valid = skillId === null || (Number.isInteger(skillId) && skillId > 0)
  const detail = useQuery({
    queryKey: skillKeys.detail(skillId ?? 0, versionParam ?? undefined),
    queryFn: () => fetchSkill(skillId!, versionParam ?? undefined),
    enabled: skillId !== null && valid,
    retry: false,
  })
  const versions = useQuery({
    queryKey: studioKeys.versions(skillId ?? 0),
    queryFn: () => fetchOwnerVersions(skillId!),
    enabled: skillId !== null && valid,
  })
  const categories = useQuery({ queryKey: skillKeys.categories, queryFn: fetchCategories })
  const tags = useQuery({ queryKey: skillKeys.tags(''), queryFn: () => fetchTags('') })
  const proposals = useQuery({ queryKey: studioKeys.myTags, queryFn: fetchMyTagProposals })

  const allVersions = versions.data ?? []
  const target =
    versionParam ??
    (newVersionMode ? null : (allVersions.slice().reverse().find((v) => EDITABLE.has(v.status))?.version ?? null))
  const targetVersion = allVersions.find((v) => v.version === target) ?? null

  const validation = useQuery({
    queryKey: studioKeys.validation(skillId ?? 0, target ?? ''),
    queryFn: () => fetchValidation(skillId!, target!),
    enabled: skillId !== null && target !== null,
  })

  function go(nextStep: number, version: string | null = target, replace = false) {
    const next = new URLSearchParams()
    if (version) next.set('version', version)
    if (nextStep > 1) next.set('step', String(nextStep))
    setParams(next, { replace })
  }

  function failure(e: unknown): string {
    return e instanceof ApiError ? e.message : t('state.error')
  }

  function cacheResult(sid: number, result: VersionWithValidation) {
    queryClient.setQueryData(studioKeys.validation(sid, result.version.version), result.validation)
    queryClient.setQueryData<Prefill>(prefillKey(sid, result.version.version), result.prefill)
    void queryClient.invalidateQueries({ queryKey: studioKeys.versions(sid) })
    void queryClient.invalidateQueries({ queryKey: ['skills', 'detail', sid] })
    void queryClient.invalidateQueries({ queryKey: studioKeys.mine })
  }

  const upload = useMutation({
    mutationFn: async (v: { pkg: File; icon: File | null; version: string; changelog: string }) => {
      if (skillId === null) {
        const created = await createSkill(v.pkg, v.icon)
        return { sid: created.skill.id, result: created as VersionWithValidation }
      }
      return { sid: skillId, result: await addVersion(skillId, v.pkg, v.icon, v.version, v.changelog) }
    },
    onSuccess: ({ sid, result }) => {
      setError(null)
      cacheResult(sid, result)
      navigate(`/studio/${sid}?version=${encodeURIComponent(result.version.version)}`, { replace: true })
    },
    onError: (e) => setError(failure(e)),
  })

  const replacePkg = useMutation({
    mutationFn: (pkg: File) => replacePackage(skillId!, target!, pkg),
    onSuccess: (result) => {
      setError(null)
      cacheResult(skillId!, result)
    },
    onError: (e) => setError(failure(e)),
  })

  const replaceImg = useMutation({
    mutationFn: (icon: File) => replaceIcon(skillId!, target!, icon),
    onSuccess: (result: ValidationData) => {
      setError(null)
      setIconFindings(result.results)
      void queryClient.invalidateQueries({ queryKey: ['skills', 'detail', skillId] })
    },
    onError: (e) => setError(failure(e)),
  })

  const remove = useMutation({
    mutationFn: () => deleteVersion(skillId!, target!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: studioKeys.mine })
      navigate('/studio', { replace: true })
    },
    onError: (e) => {
      setConfirmDelete(false)
      setError(failure(e))
    },
  })

  const saveInfo = useMutation({
    mutationFn: async (values: InfoValues) => {
      const d = detail.data!
      if (d.status === 'draft') {
        await patchSkill(skillId!, {
          name: values.name,
          summary: values.summary,
          category_id: Number(values.category_id),
          department: values.department,
          visibility: values.visibility,
          tag_ids: values.tag_ids,
          output_types: values.output_types,
          ecosystems: values.ecosystems,
        })
      }
      const changed = values.version !== target || values.changelog !== (targetVersion?.changelog ?? '')
      if (!changed) return null
      return patchVersion(skillId!, target!, { version: values.version, changelog: values.changelog || null })
    },
    onSuccess: (result) => {
      setError(null)
      setMissing([])
      void queryClient.invalidateQueries({ queryKey: ['skills', 'detail', skillId] })
      void queryClient.invalidateQueries({ queryKey: studioKeys.mine })
      if (result) {
        cacheResult(skillId!, result)
        go(3, result.version.version)
      } else {
        go(3)
      }
    },
    onError: (e) => setError(failure(e)),
  })

  const submit = useMutation({
    mutationFn: () => submitVersion(skillId!, target!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: studioKeys.mine })
      navigate('/studio', { replace: true })
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'VALIDATION_FAILED') {
        const results = (e.details.results ?? []) as Finding[]
        queryClient.setQueryData<ValidationData>(studioKeys.validation(skillId!, target!), {
          phase: 'submit', ok: false, results,
        })
        setError(t('studio.submitFailed'))
        go(1)
      } else if (e instanceof ApiError && e.code === 'SUBMISSION_INCOMPLETE') {
        setMissing((e.details.fields ?? []) as string[])
        setError(null)
        go(2)
      } else {
        setError(failure(e))
      }
    },
  })

  if (!valid) return <NotFoundPage />
  if (skillId !== null) {
    if (detail.error instanceof ApiError && detail.error.status === 404) return <NotFoundPage />
    if (detail.isPending || versions.isPending) return <LoadingState fullPage />
    if (detail.isError || versions.isError) return <ErrorState fullPage onRetry={() => void detail.refetch()} />
    if (detail.data.owner_id !== user?.id) return <NotFoundPage />
  }

  const skill = detail.data
  const published = skill?.status === 'published'
  const askVersion = skillId !== null && published && target === null
  const released = allVersions.filter((v) => v.status === 'published' || v.status === 'revoked').map((v) => v.version)
  const prefill = skillId !== null && target ? queryClient.getQueryData<Prefill>(prefillKey(skillId, target)) : undefined

  const suggestedCategoryId =
    skill?.category_id == null ? (categories.data?.find((c) => c.slug === prefill?.category_slug)?.id ?? null) : null
  const suggested: Suggested = {
    name: prefill?.name_suggestion ?? null,
    category_id: suggestedCategoryId,
    output_types: skill?.output_types?.length ? (skill.auto_output_types ?? []) : (prefill?.output_types ?? []),
    ecosystems: skill?.ecosystems?.length ? (skill.auto_ecosystems ?? []) : (prefill?.ecosystems ?? []),
  }

  const defaults: InfoValues = {
    name: skill && skill.name !== 'Chưa đặt tên' ? skill.name : (prefill?.name ?? ''),
    summary: skill?.summary ?? prefill?.description ?? '',
    category_id: skill?.category_id ?? suggestedCategoryId ?? '',
    department: skill?.department ?? user?.department ?? '',
    visibility: skill?.visibility ?? 'company',
    tag_ids: skill?.tag_ids ?? [],
    output_types: skill?.output_types?.length ? skill.output_types : (prefill?.output_types ?? []),
    ecosystems: skill?.ecosystems?.length ? skill.ecosystems : (prefill?.ecosystems ?? []),
    version: target ?? '',
    changelog: targetVersion?.changelog ?? '',
  }

  const tagNames = new Map<number, string>([
    ...(tags.data ?? []).map((x) => [x.id, x.name] as [number, string]),
    ...(proposals.data ?? []).map((x) => [x.id, x.name] as [number, string]),
  ])
  const card: SkillCardData = {
    id: skillId ?? 0,
    name: skill?.name ?? defaults.name,
    summary: skill?.summary ?? null,
    category_id: skill?.category_id ?? null,
    department: skill?.department ?? null,
    visibility: skill?.visibility ?? 'company',
    origin: 'internal',
    source_name: null,
    license: null,
    latest_version: target,
    has_icon: false,
    tags: (skill?.tag_ids ?? []).map((tid) => tagNames.get(tid)).filter((n): n is string => !!n),
    output_types: skill?.output_types ?? [],
    ecosystems: skill?.ecosystems ?? [],
    install_count: 0,
    download_count: 0,
    published_at: null,
  }
  const categoryName = categories.data?.find((c) => c.id === card.category_id)?.name

  const hasVersion = target !== null && skillId !== null
  const maxStep = hasVersion ? 3 : 1
  const labels = [t('studio.stepPackage'), t('studio.stepInfo'), t('studio.stepReview')]

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Typography variant="h5" component="h1" gutterBottom>
        {newVersionMode || askVersion ? t('studio.newVersion') : skillId ? t('studio.edit') : t('studio.create')}
        {categoryName ? ` · ${categoryName}` : ''}
      </Typography>

      <Stepper nonLinear activeStep={step - 1} sx={{ my: 3 }}>
        {labels.map((label, index) => (
          <Step key={label} completed={index + 1 < step}>
            <StepButton disabled={index + 1 > maxStep} onClick={() => go(index + 1)}>
              {label}
            </StepButton>
          </Step>
        ))}
      </Stepper>

      {step === 1 && (
        <>
          {iconFindings.length > 0 && <ValidationList results={iconFindings} />}
          <PackageStep
            hasVersion={hasVersion}
            validation={validation.data}
            busy={upload.isPending || replacePkg.isPending || replaceImg.isPending}
            error={error}
            askVersion={askVersion}
            suggestedVersion={bumpPatch(released.slice().sort().at(-1))}
            onUpload={(pkg, icon, version, changelog) => upload.mutate({ pkg, icon, version, changelog })}
            onReplacePackage={(pkg) => replacePkg.mutate(pkg)}
            onReplaceIcon={(icon) => replaceImg.mutate(icon)}
            onNext={() => go(2)}
            onDelete={targetVersion && EDITABLE.has(targetVersion.status) ? () => setConfirmDelete(true) : undefined}
          />
        </>
      )}

      {step === 2 && hasVersion && skill && (
        <InfoStep
          key={`${target}-${skill.updated_at}`}
          defaults={defaults}
          suggested={suggested}
          skillFieldsEditable={skill.status === 'draft'}
          nameEditable={skill.status === 'draft'}
          releasedVersions={released}
          busy={saveInfo.isPending}
          error={error}
          missingFields={missing}
          onSubmit={(values) => saveInfo.mutate(values)}
          onBack={() => go(1)}
        />
      )}

      {step === 3 && hasVersion && skill && (
        <ReviewStep
          card={card}
          skillMd={skill.skill_md}
          validation={validation.data}
          busy={submit.isPending}
          error={error}
          onSubmit={() => submit.mutate()}
          onBack={() => go(2)}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={t('studio.deleteDraft')}
        message={t('studio.deleteDraftMessage')}
        confirmLabel={t('studio.deleteDraft')}
        busy={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
      />
    </Container>
  )
}
