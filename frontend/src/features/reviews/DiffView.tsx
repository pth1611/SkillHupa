import { Box, Typography } from '@mui/material'

interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk'
  text: string
  oldNo: number | null
  newNo: number | null
}

/** Phân tích unified diff thành từng dòng kèm số dòng cũ/mới (bỏ hai dòng tiêu đề ---/+++). */
export function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = []
  let oldNo = 0
  let newNo = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('--- ') || raw.startsWith('+++ ')) continue
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      oldNo = Number(hunk[1])
      newNo = Number(hunk[2])
      lines.push({ kind: 'hunk', text: raw, oldNo: null, newNo: null })
    } else if (raw.startsWith('+')) {
      lines.push({ kind: 'add', text: raw.slice(1), oldNo: null, newNo: newNo++ })
    } else if (raw.startsWith('-')) {
      lines.push({ kind: 'del', text: raw.slice(1), oldNo: oldNo++, newNo: null })
    } else if (raw.startsWith(' ')) {
      lines.push({ kind: 'ctx', text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ })
    }
  }
  return lines
}

const BG = {
  add: 'rgba(46, 160, 67, 0.15)',
  del: 'rgba(248, 81, 73, 0.15)',
  hunk: 'rgba(56, 139, 253, 0.15)',
  ctx: 'transparent',
} as const

/** Văn bản thuần đã thoát ký tự (React tự escape); không bao giờ dựng thành HTML (D44). */
export function DiffView({
  diff, warningsByLine,
}: { diff: string; warningsByLine: Map<number, string[]> }) {
  const lines = parseUnifiedDiff(diff)
  return (
    <Box component="pre" sx={{ m: 0, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.8rem', overflow: 'auto' }}>
      {lines.map((line, index) => {
        const notes = line.newNo !== null ? warningsByLine.get(line.newNo) : undefined
        return (
          <Box
            key={index}
            data-kind={line.kind}
            sx={{ display: 'flex', bgcolor: BG[line.kind], outline: notes ? '1px solid' : 'none', outlineColor: 'warning.main' }}
          >
            <Box component="span" sx={{ width: 44, textAlign: 'right', pr: 1, color: 'text.disabled', flexShrink: 0, userSelect: 'none' }}>
              {line.oldNo ?? ''}
            </Box>
            <Box component="span" sx={{ width: 44, textAlign: 'right', pr: 1, color: 'text.disabled', flexShrink: 0, userSelect: 'none' }}>
              {line.newNo ?? ''}
            </Box>
            <Box component="span" sx={{ width: 16, flexShrink: 0 }}>
              {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ''}
            </Box>
            <Box component="span" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', flexGrow: 1 }}>
              {line.text}
            </Box>
            {notes && (
              <Typography component="span" variant="caption" color="warning.main" sx={{ pl: 1, flexShrink: 0 }}>
                ⚠ {notes.join('; ')}
              </Typography>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

/** Hiển thị nguyên văn một phiên bản của file, có số dòng và đánh dấu cảnh báo. */
export function PlainView({ text, warningsByLine }: { text: string; warningsByLine: Map<number, string[]> }) {
  const lines = text.split('\n')
  return (
    <Box component="pre" sx={{ m: 0, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.8rem', overflow: 'auto' }}>
      {lines.map((line, index) => {
        const notes = warningsByLine.get(index + 1)
        return (
          <Box key={index} sx={{ display: 'flex', outline: notes ? '1px solid' : 'none', outlineColor: 'warning.main' }}>
            <Box component="span" sx={{ width: 44, textAlign: 'right', pr: 1, color: 'text.disabled', flexShrink: 0, userSelect: 'none' }}>
              {index + 1}
            </Box>
            <Box component="span" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', flexGrow: 1 }}>
              {line}
            </Box>
            {notes && (
              <Typography component="span" variant="caption" color="warning.main" sx={{ pl: 1, flexShrink: 0 }}>
                ⚠ {notes.join('; ')}
              </Typography>
            )}
          </Box>
        )
      })}
    </Box>
  )
}
