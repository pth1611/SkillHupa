import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth, RequireRole } from './auth/AuthProvider'
import { AppLayout } from './components/AppLayout'
import { NotFoundPage } from './features/common/pages'
import { HomePage } from './features/home/HomePage'
import { LoginPage } from './features/login/LoginPage'
import { MySkillsPage } from './features/my-skills/MySkillsPage'
import { NotificationsPage } from './features/notifications/NotificationsPage'
import { ReviewQueuePage } from './features/reviews/ReviewQueuePage'
import { SearchPage } from './features/search/SearchPage'
import { StudioPage } from './features/studio/StudioPage'
import { LoadingState } from './components/StateViews'

// Trang nặng (Markdown) tách thành chunk riêng, chỉ tải khi vào.
const SkillDetailPage = lazy(() =>
  import('./features/skill-detail/SkillDetailPage').then((m) => ({ default: m.SkillDetailPage })),
)

// Khu quản trị chỉ Manager dùng nên tách chunk riêng, không làm nặng bản tải đầu của mọi người.
const AdminLayout = lazy(() => import('./features/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })))
const DashboardPage = lazy(() => import('./features/admin/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const AssignmentsPage = lazy(() =>
  import('./features/admin/AssignmentsPage').then((m) => ({ default: m.AssignmentsPage })),
)
const AdminSkillsPage = lazy(() =>
  import('./features/admin/AdminSkillsPage').then((m) => ({ default: m.AdminSkillsPage })),
)
const TagsPage = lazy(() => import('./features/admin/TagsPage').then((m) => ({ default: m.TagsPage })))
const AuditPage = lazy(() => import('./features/admin/AuditPage').then((m) => ({ default: m.AuditPage })))
const SourcesPage = lazy(() => import('./features/admin/SourcesPage').then((m) => ({ default: m.SourcesPage })))
const ReviewDetailPage = lazy(() =>
  import('./features/reviews/ReviewDetailPage').then((m) => ({ default: m.ReviewDetailPage })),
)
const VisibilityReviewPage = lazy(() =>
  import('./features/reviews/VisibilityReviewPage').then((m) => ({ default: m.VisibilityReviewPage })),
)
const WizardPage = lazy(() =>
  import('./features/studio/WizardPage').then((m) => ({ default: m.WizardPage })),
)

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="skills" element={<SearchPage />} />
          <Route
            path="skills/:id"
            element={
              <Suspense fallback={<LoadingState />}>
                <SkillDetailPage />
              </Suspense>
            }
          />
          <Route path="my-skills" element={<MySkillsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />

          <Route element={<RequireRole roles={['creator', 'manager']} />}>
            <Route path="studio" element={<StudioPage />} />
            <Route
              path="studio/new"
              element={
                <Suspense fallback={<LoadingState />}>
                  <WizardPage />
                </Suspense>
              }
            />
            <Route
              path="studio/:id"
              element={
                <Suspense fallback={<LoadingState />}>
                  <WizardPage />
                </Suspense>
              }
            />
          </Route>

          <Route element={<RequireRole roles={['reviewer', 'manager']} />}>
            <Route path="reviews" element={<ReviewQueuePage />} />
            <Route
              path="reviews/:versionId"
              element={
                <Suspense fallback={<LoadingState />}>
                  <ReviewDetailPage />
                </Suspense>
              }
            />
            <Route
              path="reviews/visibility/:requestId"
              element={
                <Suspense fallback={<LoadingState />}>
                  <VisibilityReviewPage />
                </Suspense>
              }
            />
          </Route>

          <Route element={<RequireRole roles={['manager']} />}>
            <Route
              path="admin"
              element={
                <Suspense fallback={<LoadingState />}>
                  <AdminLayout />
                </Suspense>
              }
            >
              <Route index element={
                  <Suspense fallback={<LoadingState />}>
                    <DashboardPage />
                  </Suspense>
                } />
              <Route path="assignments" element={
                  <Suspense fallback={<LoadingState />}>
                    <AssignmentsPage />
                  </Suspense>
                } />
              <Route path="skills" element={
                  <Suspense fallback={<LoadingState />}>
                    <AdminSkillsPage />
                  </Suspense>
                } />
              <Route
                path="tags"
                element={
                  <Suspense fallback={<LoadingState />}>
                    <TagsPage />
                  </Suspense>
                }
              />
              <Route
                path="audit"
                element={
                  <Suspense fallback={<LoadingState />}>
                    <AuditPage />
                  </Suspense>
                }
              />
              <Route
                path="sources"
                element={
                  <Suspense fallback={<LoadingState />}>
                    <SourcesPage />
                  </Suspense>
                }
              />
            </Route>
          </Route>

          <Route path="home" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
