import { lazy, Suspense, useEffect } from 'react';
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

/**
 * WHAT IS IN THE FIRST BUNDLE, AND WHY (NFR-1.2, 250 KB gzipped).
 *
 * The eager imports below are the club-officer path — sign in, the dashboard, clubs,
 * activities, reporting, membership, and the pending queue. Those screens are the reason the
 * system exists, they are opened on metered data from a phone, and a member should never
 * wait on a second request to reach the one they came for.
 *
 * Everything the DISTRICT ADMINISTRATION uses is lazy. Positions, appointments, committees,
 * invitations, the audit log, rollover, activity types, clusters — a club secretary loads
 * none of them, ever, and the officers who do are usually at a desk. Splitting them out is
 * the cheapest 40% this bundle will ever give up.
 *
 * The rule for anything added later: **if a club secretary uses it on a phone, it is eager;
 * otherwise it is lazy.**
 */
import {
  ActivitiesPage,
  ActivityCalendarPage,
  ActivityDetailPage,
} from './features/activities/ActivityPages';
import { ReportPage } from './features/activities/ReportPage';
import { ClubProfilePage } from './features/clubs/ClubProfilePage';
import { ClubsPage } from './features/clubs/ClubsPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
// Both membership screens together: they share a module, so making one lazy would split
// nothing and only add a request. Transitions is on a club officer's own navigation anyway.
import { MembershipHistoryPage, TransitionsPage } from './features/membership/MembershipPages';
import { RecordEventPage } from './features/membership/RecordEventPage';
import { PendingPage } from './features/offline/PendingPage';

/*
 * Finance is LAZY. A club treasurer uses it and a secretary reads it, so it is not quite an
 * admin screen — but it is not on the path a member opens at eleven at night to file a
 * report either, and that path is what the eager bundle is for.
 */
const BudgetPage = lazy(() =>
  import('./features/finance/BudgetPage').then((m) => ({ default: m.BudgetPage })),
);
const DuesPage = lazy(() =>
  import('./features/finance/DuesPage').then((m) => ({ default: m.DuesPage })),
);
const TransactionsPage = lazy(() =>
  import('./features/finance/TransactionsPage').then((m) => ({ default: m.TransactionsPage })),
);
const TrfPage = lazy(() =>
  import('./features/finance/TrfPage').then((m) => ({ default: m.TrfPage })),
);
const ActivityTypesPage = lazy(() =>
  import('./features/activities/ActivityTypesPage').then((m) => ({ default: m.ActivityTypesPage })),
);
const ClubFormPage = lazy(() =>
  import('./features/clubs/ClubFormPage').then((m) => ({ default: m.ClubFormPage })),
);
const ClustersPage = lazy(() =>
  import('./features/clubs/ClustersPage').then((m) => ({ default: m.ClustersPage })),
);
const AuditPage = lazy(() =>
  import('./features/governance/AdminPages').then((m) => ({ default: m.AuditPage })),
);
const InvitationsPage = lazy(() =>
  import('./features/governance/AdminPages').then((m) => ({ default: m.InvitationsPage })),
);
const RolloverPage = lazy(() =>
  import('./features/governance/AdminPages').then((m) => ({ default: m.RolloverPage })),
);
const AppointmentsPage = lazy(() =>
  import('./features/governance/AppointmentsPage').then((m) => ({ default: m.AppointmentsPage })),
);
const CommitteesPage = lazy(() =>
  import('./features/governance/CommitteesPage').then((m) => ({ default: m.CommitteesPage })),
);
// Lazy: procurement and auditors look for this page by name, but no club secretary opens
// it mid-report, so it has no business in the initial payload.
const AccessibilityPage = lazy(() =>
  import('./features/help/AccessibilityPage').then((m) => ({ default: m.AccessibilityPage })),
);
const PositionsPage = lazy(() =>
  import('./features/governance/PositionsPage').then((m) => ({ default: m.PositionsPage })),
);

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

  // The Suspense boundary sits INSIDE the shell, so a lazy admin screen loading leaves the
  // navigation and the connection banner on screen. A boundary around the whole shell would
  // blank the application for the length of a request on a slow connection.
  return (
    <AppShell>
      <Suspense fallback={<SkeletonList rows={4} />}>{children}</Suspense>
    </AppShell>
  );
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
        {/*
          Deliberately OUTSIDE RequireAuth. An accessibility statement that can only be read
          by somebody already signed in cannot be checked by the procurement officer deciding
          whether the system is usable in the first place.
        */}
        <Route path="/accessibility" element={<AccessibilityPage />} />
        <Route
          path="/finance/transactions"
          element={
            <RequireAuth>
              <TransactionsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/finance/budget"
          element={
            <RequireAuth>
              <BudgetPage />
            </RequireAuth>
          }
        />
        <Route
          path="/finance/dues"
          element={
            <RequireAuth>
              <DuesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/finance/trf"
          element={
            <RequireAuth>
              <TrfPage />
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
