import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DownloadIcon from '@mui/icons-material/Download'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import { alpha } from '@mui/material/styles'
import { Alert, Box, Button, Card, CircularProgress, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchSkillFileContent, fetchSkillFiles, requestDownload, skillKeys } from '../../api/skills'
import type { SkillFile } from '../../api/types'
import { MarkdownView } from '../../components/MarkdownView'
import { startDownload } from '../../utils/download'

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const SKILL_MD = 'SKILL.md'
const PANEL_HEIGHT = { xs: 'auto', md: 720 }

const scrollbar = {
  scrollbarWidth: 'thin' as const,
  '&::-webkit-scrollbar': { width: 8, height: 8 },
  '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 4 },
}

function FileIcon({ path }: { path: string }) {
  const sx = { fontSize: 16, color: 'text.secondary' }
  if (/\.(png|jpe?g|gif|webp|svg|ico)$/i.test(path)) return <ImageOutlinedIcon sx={sx} />
  if (/\.(md|markdown|txt)$/i.test(path) || /^(LICENSE|README)/i.test(path.split('/').pop() ?? ''))
    return <DescriptionOutlinedIcon sx={sx} />
  return <InsertDriveFileOutlinedIcon sx={sx} />
}

interface TreeNode {
  name: string
  path: string
  file?: SkillFile
  children: TreeNode[]
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function buildTree(files: SkillFile[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] }
  for (const file of files) {
    let node = root
    const parts = file.path.split('/')
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/')
      let child = node.children.find((c) => c.path === path)
      if (!child) {
        child = { name: part, path, children: [] }
        node.children.push(child)
      }
      if (i === parts.length - 1) child.file = file
      node = child
    })
  }
  // SKILL.md đứng đầu, sau đó thư mục rồi file, mỗi nhóm theo tên.
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.path === SKILL_MD) return -1
      if (b.path === SKILL_MD) return 1
      const ad = a.file ? 1 : 0
      const bd = b.file ? 1 : 0
      return ad - bd || a.name.localeCompare(b.name)
    })
    nodes.forEach((n) => sort(n.children))
  }
  sort(root.children)
  return root.children
}

/** Tách khối frontmatter `---` đầu SKILL.md thành bảng khoá/giá trị và phần thân. */
export function splitFrontmatter(source: string): { fields: [string, string][]; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (!m) return { fields: [], body: source }
  const fields: [string, string][] = []
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (kv) fields.push([kv[1], kv[2].replace(/^["']|["']$/g, '')])
    else if (fields.length && /^\s+\S/.test(line)) fields[fields.length - 1][1] += ` ${line.trim()}`
  }
  return { fields, body: source.slice(m[0].length) }
}

function TreeRows({
  nodes, depth, selected, collapsed, onSelect, onToggle,
}: {
  nodes: TreeNode[]
  depth: number
  selected: string
  collapsed: Set<string>
  onSelect: (path: string) => void
  onToggle: (path: string) => void
}) {
  return (
    <>
      {nodes.map((n) => {
        const isDir = !n.file
        const open = !collapsed.has(n.path)
        return (
          <Box key={n.path}>
            <Box
              component="button"
              type="button"
              onClick={() => (isDir ? onToggle(n.path) : onSelect(n.path))}
              aria-current={n.path === selected ? 'true' : undefined}
              title={n.path}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.75, width: '100%', border: 0, cursor: 'pointer',
                textAlign: 'left', color: 'text.primary', fontFamily: MONO, fontSize: '0.8rem',
                py: 0.75, pr: 1, pl: 1 + depth * 1.75, borderRadius: 1, bgcolor: 'transparent',
                ...(n.path === selected && {
                  bgcolor: (th) => alpha(th.palette.primary.main, 0.14),
                  '& svg': { color: 'primary.main' },
                }),
                '&:hover': { bgcolor: (th) => alpha(th.palette.primary.main, n.path === selected ? 0.18 : 0.08) },
              }}
            >
              {isDir ? (
                <>
                  {open ? <ExpandMoreIcon sx={{ fontSize: 16 }} /> : <ChevronRightIcon sx={{ fontSize: 16 }} />}
                  <FolderOpenIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                </>
              ) : (
                <Box component="span" sx={{ display: 'flex', ml: 2.5 }}><FileIcon path={n.path} /></Box>
              )}
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {n.name}
              </Box>
            </Box>
            {isDir && open && (
              <TreeRows
                nodes={n.children} depth={depth + 1} selected={selected} collapsed={collapsed}
                onSelect={onSelect} onToggle={onToggle}
              />
            )}
          </Box>
        )
      })}
    </>
  )
}

function FileViewer({
  skillId, skillName, version, file, skillMd, synthetic,
}: {
  skillId: number; skillName: string; version: string; file: SkillFile; skillMd: string | null; synthetic: boolean
}) {
  const { t } = useTranslation()
  const q = useQuery({
    queryKey: ['skill-file', skillId, version, file.path],
    queryFn: () => fetchSkillFileContent(skillId, version, file.path),
    enabled: file.is_text && !synthetic,
    retry: false,
  })
  // SKILL.md lưu trong DB đã bị cắt frontmatter: ưu tiên bản gốc trong gói, bản đã cắt chỉ để dự phòng.
  const fallbackMd = file.path === SKILL_MD ? skillMd : null
  const text = (q.data && !q.data.too_large ? q.data.content : null) ?? fallbackMd
  const isMarkdown = /\.(md|markdown)$/i.test(file.path)

  let body: React.ReactNode
  if (!file.is_text) body = <Typography color="text.secondary">{t('detail.binaryFile')}</Typography>
  else if (!text && !synthetic && q.isPending) body = <CircularProgress size={22} />
  else if (!text && q.isError) body = <Alert severity="error">{t('detail.fileFailed')}</Alert>
  else if (!text && q.data?.too_large) body = <Typography color="text.secondary">{t('detail.tooLarge')}</Typography>
  else if (!text) body = <Typography color="text.secondary">{t('detail.emptyFile')}</Typography>
  else if (isMarkdown) {
    const { fields, body: md } = splitFrontmatter(text)
    body = (
      <Stack spacing={2}>
        {fields.length > 0 && (
          <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, px: 2.5, py: 2, fontFamily: MONO, fontSize: '0.78rem' }}>
            {fields.map(([k, v]) => (
              <Box key={k} sx={{ display: 'grid', gridTemplateColumns: '96px minmax(0, 1fr)', gap: 2, py: 0.4 }}>
                <Box sx={{ color: 'primary.main' }}>{k}</Box>
                <Box sx={{ overflowWrap: 'anywhere', color: 'text.secondary' }}>{v}</Box>
              </Box>
            ))}
          </Box>
        )}
        <Box
          sx={{
            '&& blockquote': {
              borderLeft: 3, borderColor: 'primary.main', pl: 2, py: 0.25, my: 1, color: 'text.primary',
              '& p': { my: 0.75 },
            },
            '&& pre': {
              borderRadius: 1, border: 1, borderColor: 'divider', bgcolor: 'action.hover', p: 2,
              whiteSpace: 'pre', overflowWrap: 'normal', overflowX: 'auto', ...scrollbar,
            },
            '&& :not(pre) > code': {
              bgcolor: 'action.hover', px: 0.75, py: 0.25, borderRadius: 1, fontSize: '0.85em',
            },
          }}
        >
          <MarkdownView source={md} />
        </Box>
      </Stack>
    )
  } else {
    body = (
      <Box component="pre" sx={{ m: 0, fontFamily: MONO, fontSize: '0.8rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {text}
      </Box>
    )
  }

  return (
    <Stack sx={{ minWidth: 0, flexGrow: 1, minHeight: 0 }}>
      <Stack
        direction="row" alignItems="center" spacing={1}
        sx={{ px: 2.5, py: 1.25, borderBottom: 1, borderColor: 'divider', fontFamily: MONO, fontSize: '0.78rem' }}
      >
        <Box sx={{ flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'text.secondary' }}>
          {skillName}/{file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/') + 1) : ''}
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 700 }}>{file.path.split('/').pop()}</Box>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {formatSize(file.size)}
        </Typography>
        {text && (
          <Tooltip title={t('detail.copyFile')}>
            <IconButton
              size="small" aria-label={t('detail.copyFile')}
              onClick={() => void navigator.clipboard?.writeText(text).catch(() => undefined)}
            >
              <ContentCopyIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      <Box sx={{ p: 2.5, overflow: 'auto', flexGrow: 1, minHeight: { xs: 280, md: 0 }, ...scrollbar }}>{body}</Box>
    </Stack>
  )
}

interface Props {
  skillId: number
  skillName: string
  version: string
  skillMd: string | null
  canDownload: boolean
}

/** Bảng xem nội dung skill: cây thư mục bên trái, nội dung file đang chọn bên phải. */
export function SkillFilesPanel({ skillId, skillName, version, skillMd, canDownload }: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const files = useQuery({
    queryKey: skillKeys.files(skillId, version),
    queryFn: () => fetchSkillFiles(skillId, version),
    retry: false,
  })
  const [chosen, setChosen] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  // Không lấy được danh sách file (lỗi/rỗng): vẫn giữ nguyên bố cục, cây chỉ có SKILL.md.
  const real = files.data?.length ? files.data : undefined
  const synthetic = !real && !!skillMd
  const list: SkillFile[] | undefined = real ?? (skillMd ? [{ path: SKILL_MD, size: new Blob([skillMd]).size, is_text: true }] : files.data)
  const tree = useMemo(() => buildTree(list ?? []), [list])
  const total = (list ?? []).reduce((sum, f) => sum + f.size, 0)
  const selected =
    list?.find((f) => f.path === chosen) ?? list?.find((f) => f.path === SKILL_MD) ?? list?.[0]

  function toggle(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }

  async function downloadFolder() {
    setFailed(false)
    setBusy(true)
    try {
      const info = await requestDownload(skillId, version, 'zip')
      startDownload(info.url)
      void queryClient.invalidateQueries({ queryKey: skillKeys.myInstalls })
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card sx={{ overflow: 'hidden', minWidth: 0, borderRadius: 2, display: 'flex', flexDirection: 'column', height: PANEL_HEIGHT }}>
      <Stack
        direction="row" alignItems="center" spacing={1.5} flexWrap="wrap"
        sx={{ px: 3, py: 2 }}
      >
        <FolderOpenIcon color="primary" fontSize="small" />
        <Typography component="h2" sx={{ fontFamily: MONO, fontWeight: 700, overflowWrap: 'anywhere' }}>
          {skillName}/
        </Typography>
        {list && (
          <Typography variant="caption" color="text.secondary">
            {t('detail.files', { count: list.length })} · {formatSize(total)}
          </Typography>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button
          size="small" variant="contained" color="inherit" disableElevation startIcon={<DownloadIcon />}
          onClick={() => void downloadFolder()} disabled={!canDownload || busy}
          sx={{ borderRadius: 1, px: 2, bgcolor: 'action.hover', color: 'text.primary', textTransform: 'none' }}
        >
          {t('detail.downloadFolder')}
        </Button>
      </Stack>
      {failed && <Alert severity="error" sx={{ m: 1.5 }}>{t('install.downloadFailed')}</Alert>}

      {files.isPending ? (
        <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>
      ) : !selected ? (
        <Alert severity="info" sx={{ m: 2 }}>{files.isError ? t('detail.filesFailed') : t('detail.noContent')}</Alert>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, flexGrow: 1, minHeight: 0, borderTop: 1, borderColor: 'divider' }}>
          <Box
            sx={{
              width: { md: 260 }, flexShrink: 0, p: 1.5, overflow: 'auto', maxHeight: { xs: 220, md: 'none' },
              borderRight: { md: 1 }, borderBottom: { xs: 1, md: 0 }, borderColor: 'divider', ...scrollbar,
            }}
          >
            <TreeRows
              nodes={tree} depth={0} selected={selected.path} collapsed={collapsed}
              onSelect={setChosen} onToggle={toggle}
            />
          </Box>
          <FileViewer skillId={skillId} skillName={skillName} version={version} file={selected} skillMd={skillMd} synthetic={synthetic} />
        </Box>
      )}
    </Card>
  )
}
