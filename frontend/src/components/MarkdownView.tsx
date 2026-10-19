import { Box, Link } from '@mui/material'
import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * SKILL.md do người khác viết nên coi như không tin cậy (mục 8, "Làm sạch Markdown"):
 * - react-markdown không dựng HTML thô, nên không có script/iframe;
 * - chỉ cho liên kết http(s) và mailto, mở ngoài với rel="noopener noreferrer";
 * - không tải ảnh từ URL ngoài (tránh theo dõi người xem): chỉ hiện văn bản thay thế.
 */
const SAFE_LINK = /^(https?:|mailto:)/i

export function safeUrl(url: string): string {
  return SAFE_LINK.test(url.trim()) ? url : ''
}

const components: Components = {
  a({ href, children }) {
    const safe = href ? safeUrl(href) : ''
    if (!safe) return <span>{children}</span>
    return (
      <Link href={safe} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </Link>
    )
  },
  img({ alt }) {
    return <em>{alt ? `[${alt}]` : '[image]'}</em>
  },
}

export function MarkdownView({ source }: { source: string }) {
  return (
    <Box
      sx={{
        overflowWrap: 'anywhere',
        '& pre': { p: 1.5, borderRadius: 1, overflow: 'auto', bgcolor: 'action.hover' },
        '& code': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.875em' },
        '& table': { borderCollapse: 'collapse' },
        '& th, & td': { border: 1, borderColor: 'divider', px: 1, py: 0.5 },
        '& blockquote': { m: 0, pl: 2, borderLeft: 3, borderColor: 'divider', color: 'text.secondary' },
        '& h1': { fontSize: '1.5rem' },
        '& h2': { fontSize: '1.25rem' },
        '& h3': { fontSize: '1.1rem' },
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        skipHtml
        urlTransform={(url) => safeUrl(url)}
      >
        {source}
      </ReactMarkdown>
    </Box>
  )
}
