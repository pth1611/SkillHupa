import type { TFunction } from 'i18next'

/** Nhãn hiển thị của một giá trị phân loại cố định (D52); thiếu bản dịch thì hiện chính slug. */
export const taxonomyLabel = (t: TFunction, kind: 'output' | 'ecosystem', slug: string) =>
  t(`taxonomy.${kind}.${slug}`, { defaultValue: slug })
