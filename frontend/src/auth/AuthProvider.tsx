import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { fetchMe, logout as logoutRequest } from '../api/auth'
import { ApiError, setUnauthorizedHandler } from '../api/client'
import type { Me, Role } from '../api/types'
import { LoadingState, ErrorState } from '../components/StateViews'

export const ME_KEY = ['me'] as const

interface AuthValue {
  user: Me | null
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthValue>({ user: null, logout: async () => undefined })

/** Vai trò từ thấp đến cao; một người một vai trò (D1) nhưng menu cho phép "từ vai trò này trở lên". */
const RANK: Record<Role, number> = { user: 0, creator: 1, reviewer: 2, manager: 3 }

export function hasRole(user: Me | null, allowed: Role[]): boolean {
  return !!user && allowed.includes(user.role)
}

export function atLeast(user: Me | null, role: Role): boolean {
  return !!user && RANK[user.role] >= RANK[role]
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const query = useQuery<Me | null>({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await fetchMe()
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
    staleTime: 60_000,
    refetchInterval: 120_000, // làm mới số thông báo chưa đọc; chưa dùng đẩy thời gian thực
    retry: false,
  })

  // Hết phiên giữa chừng: xoá người dùng để RequireAuth chuyển tới /login và quay lại đúng chỗ.
  useEffect(() => {
    setUnauthorizedHandler(() => queryClient.setQueryData(ME_KEY, null))
    return () => setUnauthorizedHandler(null)
  }, [queryClient])

  const logout = useCallback(async () => {
    try {
      await logoutRequest()
    } catch {
      // Phiên đã hết hạn (401) thì coi như đã đăng xuất; vẫn dọn trạng thái phía client.
    } finally {
      // Không dùng queryClient.clear(): nó gỡ query ['me'] khỏi cache khi AuthProvider còn đang quan sát,
      // khiến trang kẹt ở trạng thái đang tải.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] })
      queryClient.setQueryData(ME_KEY, null)
    }
  }, [queryClient])

  const value = useMemo<AuthValue>(() => ({ user: query.data ?? null, logout }), [query.data, logout])

  if (query.isPending) return <LoadingState fullPage />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} fullPage />
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)

/** Bọc các route cần đăng nhập. */
export function RequireAuth() {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) {
    const next = location.pathname + location.search
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }
  return <Outlet />
}

/** Chỉ là tiện lợi cho giao diện; quyền thật do backend chặn (mục 8). */
export function RequireRole({ roles }: { roles: Role[] }) {
  const { user } = useAuth()
  if (!hasRole(user, roles)) return <Navigate to="/" replace />
  return <Outlet />
}
