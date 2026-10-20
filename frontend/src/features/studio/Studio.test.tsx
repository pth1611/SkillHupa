import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Finding, OwnerVersionData, SkillDetailData, SkillMineData } from '../../api/types'
import { me, mockApi, renderApp } from '../../test/utils'
import { isGreater } from './InfoStep'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const ver = (over: Partial<OwnerVersionData> = {}): OwnerVersionData => ({
  id: 1, version: '1.0.0', status: 'draft', changelog: null, checksum: null, size_bytes: 10,
  created_at: '2026-01-01T00:00:00Z', submitted_at: null, review_decision: null, review_comment: null,
  assigned_to_name: null, ...over,
})

const mineItem = (over: Partial<SkillMineData>): SkillMineData => ({
  id: 7, name: 'Báo cáo', summary: null, category_id: null, department: 'Kế toán', visibility: 'company',
  status: 'draft', origin: 'internal', latest_version_id: null, output_types: [], ecosystems: [], download_count: 0,
  updated_at: '2026-01-01T00:00:00Z', latest_draft_version: ver(), ...over,
})

const finding = (result: Finding['result'], detail: string): Finding => ({
  check: 'x.' + result, result, detail, file_path: null, line: null,
})

const detail = (over: Partial<SkillDetailData> = {}): SkillDetailData => ({
  id: 7, name: 'Báo cáo', summary: null, category_id: null, department: 'Kế toán', visibility: 'company',
  status: 'draft', origin: 'internal', owner_id: 1, owner_name: 'An', has_icon: false, latest_version_id: null,
  latest_version: null, viewing_version: null, skill_md: '# Xin chào', tags: [], tag_ids: [], output_types: [], ecosystems: [], install_count: 0,
  download_count: 0, source_url: null, source_name: null, upstream_author: null, license: null,
  upstream_status: null, updated_at: '2026-01-01T00:00:00Z', ...over,
})

const common = {
  '/api/auth/me': () => me('creator'),
  '/api/categories': () => [{ id: 10, name: 'Báo cáo', slug: 'bao-cao' }],
  '/api/departments': () => ['Kế toán', 'Nhân sự'],
  '/api/tags': () => [{ id: 1, name: 'excel', status: 'approved', usage_count: 1 }],
  '/api/tags/proposals/mine': () => [],
}

describe('isGreater', () => {
  it('so sánh semver theo số', () => {
    expect(isGreater('1.0.10', ['1.0.9'])).toBe(true)
    expect(isGreater('1.0.0', ['1.0.0'])).toBe(false)
    expect(isGreater('0.9.0', ['1.0.0'])).toBe(false)
    expect(isGreater('1.0.0', [])).toBe(true)
  })
})

describe('StudioPage', () => {
  it('hiện trạng thái, góp ý bị từ chối, người được giao và hành động', async () => {
    mockApi({
      ...common,
      '/api/skills/mine': () => [
        mineItem({ id: 1, name: 'Nháp', latest_draft_version: ver({ status: 'draft' }) }),
        mineItem({ id: 2, name: 'Chờ', latest_draft_version: ver({ status: 'pending', assigned_to_name: 'Bình' }) }),
        mineItem({ id: 3, name: 'Bị loại', latest_draft_version: ver({ status: 'rejected', review_comment: 'Thiếu mô tả' }) }),
        mineItem({ id: 4, name: 'Đã đăng', status: 'published', latest_draft_version: ver({ status: 'published' }) }),
      ],
    })
    renderApp('/studio')
    expect(await screen.findByText('Nháp')).toBeInTheDocument()
    expect(screen.getByText('Đang được Bình duyệt')).toBeInTheDocument()
    expect(screen.getByText(/Thiếu mô tả/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Phát hành phiên bản mới' })).toHaveAttribute('href', '/studio/4?mode=new-version')
    expect(screen.getAllByRole('link', { name: 'Tiếp tục' })[0]).toHaveAttribute('href', '/studio/1?version=1.0.0')
    expect(screen.getByRole('link', { name: 'Tạo skill mới' })).toHaveAttribute('href', '/studio/new')
  })

  it('trạng thái rỗng', async () => {
    mockApi({ ...common, '/api/skills/mine': () => [] })
    renderApp('/studio')
    expect(await screen.findByText('Bạn chưa tạo skill nào.')).toBeInTheDocument()
  })

  it('người thường bị chuyển về trang chủ', async () => {
    mockApi({ ...common, '/api/auth/me': () => me('user'), '/api/skills/featured': () => [], '/api/skills': () => ({ items: [], total: 0, page: 1, page_size: 8 }) })
    renderApp('/studio')
    expect(await screen.findByRole('heading', { name: 'Skill giúp agent của bạn sống động hơn' })).toBeInTheDocument()
  })
})

describe('Wizard', () => {
  it('bước 1: tải gói lên, gửi multipart, hiện kết quả kiểm tra và chặn khi có lỗi', async () => {
    const { calls } = mockApi({
      ...common,
      '/api/skills': (_u, init) => {
        expect(init.method).toBe('POST')
        return json({
          skill: { id: 7, name: 'Báo cáo' },
          version: ver(),
          validation: { phase: 'preview', ok: false, results: [finding('fail', 'Thiếu SKILL.md'), finding('pass', 'Cấu trúc hợp lệ')] },
          prefill: { name: 'Báo cáo', description: 'Mô tả từ gói', version: '1.0.0' },
        }, 201)
      },
      '/api/skills/7': () => detail(),
      '/api/skills/7/versions': () => [ver()],
      '/api/skills/7/versions/1.0.0/validation': () => ({
        phase: 'preview', ok: false, results: [finding('fail', 'Thiếu SKILL.md'), finding('pass', 'Cấu trúc hợp lệ')],
      }),
    })
    renderApp('/studio/new')
    const file = new File(['zip'], 'skill.zip', { type: 'application/zip' })
    await userEvent.upload(await screen.findByTestId('package-input'), file)
    await userEvent.click(screen.getByRole('button', { name: 'Tải lên và kiểm tra' }))

    expect(await screen.findByText('Thiếu SKILL.md')).toBeInTheDocument()
    expect(screen.getByText('Còn lỗi chặn gửi duyệt. Hãy sửa gói rồi thay lại.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled()
    const post = calls.find((c) => c.url.pathname === '/api/skills' && c.init.method === 'POST')!
    expect(post.init.body).toBeInstanceOf(FormData)
    expect((post.init.body as FormData).get('package')).toBeInstanceOf(File)
  })

  it('bước 2: kiểm tra form, lưu skill và phiên bản rồi sang bước 3', async () => {
    const { calls } = mockApi({
      ...common,
      '/api/skills/7': (_u, init) => (init.method === 'PATCH' ? json({}) : json(detail({ viewing_version: ver(), summary: 'Mô tả' , category_id: 10 }))),
      '/api/skills/7/versions': () => [ver({ version: '1.0.0' })],
      '/api/skills/7/versions/1.0.0': (_u, init) => {
        expect(JSON.parse(String(init.body))).toEqual({ version: '1.2.0', changelog: 'Bản đầu' })
        return json({ version: ver({ version: '1.2.0', changelog: 'Bản đầu' }), validation: { phase: 'preview', ok: true, results: [finding('pass', 'Ổn')] }, prefill: { name: null, description: null, version: null } })
      },
      '/api/skills/7/versions/1.0.0/validation': () => ({ phase: 'preview', ok: true, results: [finding('pass', 'Ổn')] }),
    })
    renderApp('/studio/7?version=1.0.0&step=2')
    const summary = await screen.findByRole('textbox', { name: /Mô tả ngắn/ })
    await userEvent.clear(summary)
    await userEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }))
    expect(await screen.findAllByText('Bắt buộc')).not.toHaveLength(0)

    await userEvent.type(summary, 'Mô tả đã sửa')
    const version = screen.getByRole('textbox', { name: /Số phiên bản/ })
    await userEvent.clear(version)
    await userEvent.type(version, '1.2.0')
    await userEvent.type(screen.getByRole('textbox', { name: 'Ghi chú thay đổi' }), 'Bản đầu')
    await userEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }))

    expect(await screen.findByRole('heading', { name: 'Thẻ skill khi hiển thị' })).toBeInTheDocument()
    const skillPatch = calls.find((c) => c.url.pathname === '/api/skills/7' && c.init.method === 'PATCH')!
    expect(JSON.parse(String(skillPatch.init.body))).toMatchObject({ summary: 'Mô tả đã sửa', category_id: 10, visibility: 'company' })
  })

  it('bước 2: đánh nhãn giá trị do máy gợi ý (ô loại đầu ra) và nút dùng tên gợi ý', async () => {
    mockApi({
      ...common,
      '/api/taxonomy': () => ({ output_types: ['document', 'code'], ecosystems: ['github'] }),
      '/api/skills/7': () => detail({ output_types: ['document'], auto_output_types: ['document'], name: 'remotion-best-practices' }),
      '/api/skills/7/versions': () => [ver({ version: '1.0.0' })],
      '/api/skills/7/versions/1.0.0/validation': () => ({ phase: 'preview', ok: true, results: [] }),
    })
    renderApp('/studio/7?version=1.0.0&step=2')
    expect(await screen.findByText(/Tự động gợi ý, hãy kiểm tra lại/)).toBeInTheDocument()
  })

  it('bước 2: số phiên bản không lớn hơn bản đã đăng bị chặn ngay trên form', async () => {
    mockApi({
      ...common,
      '/api/skills/7': () => detail({ status: 'published', summary: 'x', category_id: 10 }),
      '/api/skills/7/versions': () => [ver({ id: 1, version: '1.0.0', status: 'published' }), ver({ id: 2, version: '1.1.0', status: 'draft' })],
      '/api/skills/7/versions/1.1.0/validation': () => ({ phase: 'preview', ok: true, results: [] }),
    })
    renderApp('/studio/7?version=1.1.0&step=2')
    const version = await screen.findByRole('textbox', { name: /Số phiên bản/ })
    await userEvent.clear(version)
    await userEvent.type(version, '1.0.0')
    await userEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }))
    expect(await screen.findByText(/Phải lớn hơn mọi bản đã đăng \(1\.0\.0\)/)).toBeInTheDocument()
    // skill đã đăng: không hỏi lại tên/danh mục
    expect(screen.queryByRole('textbox', { name: /Tên skill/ })).toBeNull()
  })

  it('bước 3: thiếu thông tin khi gửi thì quay về bước 2 và báo trường thiếu', async () => {
    mockApi({
      ...common,
      '/api/skills/7': () => detail({ viewing_version: ver(), summary: 'x', category_id: 10 }),
      '/api/skills/7/versions': () => [ver()],
      '/api/skills/7/versions/1.0.0/validation': () => ({ phase: 'preview', ok: true, results: [finding('warn', 'Chưa có changelog')] }),
      '/api/skills/7/versions/1.0.0/submit': () =>
        json({ error: { code: 'SUBMISSION_INCOMPLETE', message: 'x', details: { fields: ['summary', 'category_id'] } } }, 422),
    })
    renderApp('/studio/7?version=1.0.0&step=3')
    await userEvent.click(await screen.findByRole('button', { name: 'Gửi duyệt' }))
    expect(await screen.findByText(/Cần điền thêm trước khi gửi duyệt: summary, category_id/)).toBeInTheDocument()
  })

  it('bước 3: kiểm tra chính thức thất bại thì quay về bước 1 kèm kết quả', async () => {
    mockApi({
      ...common,
      '/api/skills/7': () => detail({ viewing_version: ver(), summary: 'x', category_id: 10 }),
      '/api/skills/7/versions': () => [ver()],
      '/api/skills/7/versions/1.0.0/validation': () => ({ phase: 'preview', ok: true, results: [] }),
      '/api/skills/7/versions/1.0.0/submit': () =>
        json({ error: { code: 'VALIDATION_FAILED', message: 'x', details: { results: [finding('fail', 'Tên skill đã được dùng')] } } }, 422),
    })
    renderApp('/studio/7?version=1.0.0&step=3')
    await userEvent.click(await screen.findByRole('button', { name: 'Gửi duyệt' }))
    expect(await screen.findByText('Tên skill đã được dùng')).toBeInTheDocument()
    expect(screen.getByText(/Kiểm tra tự động phát hiện lỗi khi gửi duyệt/)).toBeInTheDocument()
  })

  it('gửi duyệt thành công quay về Studio', async () => {
    const { calls } = mockApi({
      ...common,
      '/api/skills/mine': () => [],
      '/api/skills/7': () => detail({ viewing_version: ver(), summary: 'x', category_id: 10 }),
      '/api/skills/7/versions': () => [ver()],
      '/api/skills/7/versions/1.0.0/validation': () => ({ phase: 'preview', ok: true, results: [] }),
      '/api/skills/7/versions/1.0.0/submit': () =>
        json({ version: ver({ status: 'pending' }), validation: { phase: 'submit', ok: true, results: [] }, prefill: { name: null, description: null, version: null } }),
    })
    renderApp('/studio/7?version=1.0.0&step=3')
    await userEvent.click(await screen.findByRole('button', { name: 'Gửi duyệt' }))
    expect(await screen.findByRole('heading', { name: 'Skill tôi đã tạo' })).toBeInTheDocument()
    await waitFor(() => expect(calls.some((c) => c.url.pathname.endsWith('/submit'))).toBe(true))
  })

  it('người không phải chủ skill nhận 404', async () => {
    mockApi({
      ...common,
      '/api/skills/7': () => detail({ owner_id: 999 }),
      '/api/skills/7/versions': () => [],
    })
    renderApp('/studio/7')
    expect(await screen.findByText('Không tìm thấy trang này.')).toBeInTheDocument()
  })
})
