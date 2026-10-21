import type { TFunction } from 'i18next'

// Danh mục và nhóm con lưu tên tiếng Việt trong DB; hiển thị theo ngôn ngữ qua slug, không có bản dịch thì dùng tên gốc.
export const categoryLabel = (t: TFunction, c: { slug: string; name: string }) =>
  t(`taxonomy.category.${c.slug}`, { defaultValue: c.name })

export const subcategoryLabel = (t: TFunction, c: { slug: string; name: string }) =>
  t(`taxonomy.subcategory.${c.slug}`, { defaultValue: c.name })
