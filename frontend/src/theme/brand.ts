// Nơi duy nhất giữ màu thương hiệu, tên sản phẩm và logo (D37). Đổi ở đây là đổi cả theme sáng/tối.
export const brand = {
  productName: 'Vita-skill',
  /** Chữ hiển thị cạnh logo khi chưa có file logo. */
  logoText: 'VSF',
  primary: '#1f6feb',
  secondary: '#7c4dff',
  /** Dải màu nền cho biểu tượng mặc định sinh từ tên skill (skill không có ảnh, D39). */
  avatarPalette: ['#1f6feb', '#7c4dff', '#0e8a6b', '#d97706', '#c2410c', '#be185d', '#0f766e', '#4d7c0f'],
} as const
