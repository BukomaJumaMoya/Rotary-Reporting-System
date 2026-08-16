import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppShell } from './components/layout/AppShell';
import { SkeletonList, ToastProvider } from './components/ui';
import { setUnauthenticatedHandler } from './lib/api';
import { useAuth, useClearAuth } from './features/auth/useAuth';
import { LoginPage } from './features/auth/LoginPage';
import {
  AcceptInvitePage,
  ForgotPasswordPage,
  ResetPasswordPage,
} from './features/auth/PasswordPages';
import {
  ActivitiesPage,
  ActivityCalendarPage,
  ActivityDetailPage,
} from './features/activities/ActivityPages';
import { ActivityTypesPage } from './features/activities/ActivityTypesPage';
import { ReportPage } from './features/activities/ReportPage';
import { ClubFormPage } from './features/clubs/ClubFormPage';
import { ClubProfilePage } from './features/clubs/ClubProfilePage';
import { ClubsPage } from './features/clubs/ClubsPage';
import { ClustersPage } from './features/clubs/ClustersPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { MembershipHistoryPage, TransitionsPage } from './features/membership/MembershipPages';
import { RecordEventPage } from './features/membership/RecordEventPage';
import { PendingPage } from './features/offline/PendingPage';
import { AuditPage, InvitationsPage, RolloverPage } from './features/governance/AdminPages';
import { AppointmentsPage } from './features/governance/AppointmentsPage';
import { CommitteesPage } from './features/governance/CommitteesPage';
import { PositionsPage } from './features/governance/PositionsPage';

/**
 * Everything behind `RequireAuth` needs a session. The guard redirects rather than
 * rendering an error, because "you are not signed in" is not a failure — it is the
 * expected state of a browser that has been closed since yesterday.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isSignedIn } = useAuth();

  if (isLoading) {
    return (
      <div className="p-6">
        <SkeletonList rows={4} />
      </div>
    );
  }
  if (!isSignedIn) return <Navigate to="/login" replace />;

  return <AppShell>{children}</AppShell>;
}

/**
 * Hooks the API client's 401 handling to the router.
 *
 * Registered here rather than imported into `lib/api`, so the fetch wrapper stays free of
 * navigation and can be used from anywhere — including a test.
 */
function useSessionExpiryRedirect(): void {
  const navigate = useNavigate();
  const clearAuth = useClearAuth();

  useEffect(() => {
    setUnauthenticatedHandler(() => {
      clearAuth();
      navigate('/login', { replace: true });
    });
  }, [navigate, clearAuth]);
}

export function App() {
  useSessionExpiryRedirect();

  return (
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot" element={<ForgotPasswordPage />} />
        <Route path="/reset/:token" element={<ResetPasswordPage />} />
        <Route path="/invite/:token" element={<AcceptInvitePage />} />

        <Route
          path="/"
          element={
            <RequireAuth>
              <DashboardPage />
            </RequireAuth>
          }
        />

        {/*
          `/clubs/new` is declared BEFORE `/clubs/:id`. React Router 7 ranks static
          segments above dynamic ones so the order does not actually decide it — but the
          reader should not have to know that to be sure which one wins.
        */}
        <Route
          path="/clubs"
          element={
            <RequireAuth>
              <ClubsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/clubs/new"
          element={
            <RequireAuth>
              <ClubFormPage mode="create" />
            </RequireAuth>
          }
        />
        <Route
          path="/clubs/:id"
          element={
            <RequireAuth>
              <ClubProfilePage />
            </RequireAuth>
          }
        />
        <Route
          path="/clubs/:id/edit"
          element={
            <RequireAuth>
              <ClubFormPage mode="edit" />
            </RequireAuth>
          }
        />
        <Route
          path="/clubs/:id/membership"
          element={
            <RequireAuth>
              <MembershipHistoryPage />
            </RequireAuth>
          }
        />
        <Route
          path="/membership/record"
          element={
            <RequireAuth>
              <RecordEventPage />
            </RequireAuth>
          }
        />
        {/*
          `/report` is the most important route in the system. One segment, no nesting: it
          is what a secretary types, and what a notification links to.
        */}
        <Route
          path="/report"
          element={
            <RequireAuth>
              <ReportPage />
            </RequireAuth>
          }
        />
        {/*
          Reachable whether or not the badge is showing. A member who remembers filing
          something and wants to check on it should be able to type the address.
        */}
        <Route
          path="/pending"
          element={
            <RequireAuth>
              <PendingPage />
            </RequireAuth>
          }
        />
        <Route
          path="/activities"
          element={
            <RequireAuth>
              <ActivitiesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/activities/calendar"
          element={
            <RequireAuth>
              <ActivityCalendarPage />
            </RequireAuth>
          }
        />
        <Route
          path="/activities/:id"
          element={
            <RequireAuth>
              <ActivityDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="/membership/transitions"
          element={
            <RequireAuth>
              <TransitionsPage />
            </RequireAuth>
          }
        />

        {/*
          Every admin screen gates on <Can> INSIDE itself as well as being routed here.
          The route is convenience; the server is the boundary, and it refuses regardless.
        */}
        <Route
          path="/admin/activity-types"
          element={
            <RequireAuth>
              <ActivityTypesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/clusters"
          element={
            <RequireAuth>
              <ClustersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/positions"
          element={
            <RequireAuth>
              <PositionsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/appointments"
          element={
            <RequireAuth>
              <AppointmentsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/committees"
          element={
            <RequireAuth>
              <CommitteesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/invitations"
          element={
            <RequireAuth>
              <InvitationsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/audit"
          element={
            <RequireAuth>
              <AuditPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/rollover"
          element={
            <RequireAuth>
              <RolloverPage />
            </RequireAuth>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}
