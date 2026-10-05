import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { SessionProvider } from '@/auth/session';
import { RequireAccess } from '@/components/RequirePermission';
import { AppShell } from '@/layouts/AppShell';
import { ApiError } from '@/lib/api';
import { HomeRedirect } from '@/pages/HomeRedirect';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PageSkeleton } from '@/pages/PageSkeleton';
import './index.css';

/** Each page is its own chunk: patients opening the booking page do not download the staff app. */
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

const LoginPage = page(() => import('@/pages/LoginPage'), 'LoginPage');
const SelectClinicPage = page(() => import('@/pages/SelectClinicPage'), 'SelectClinicPage');
const BookingPage = page(() => import('@/features/public/BookingPage'), 'BookingPage');
const CancelPage = page(() => import('@/features/public/CancelPage'), 'CancelPage');
const PrivacyPage = page(() => import('@/features/public/PrivacyPage'), 'PrivacyPage');
const RxSharePage = page(() => import('@/features/public/RxSharePage'), 'RxSharePage');
const OptOutPage = page(() => import('@/features/public/OptOutPage'), 'OptOutPage');
const TodayPage = page(() => import('@/features/queue/TodayPage'), 'TodayPage');
const QueuePage = page(() => import('@/features/queue/QueuePage'), 'QueuePage');
const ConsultPage = page(() => import('@/features/consult/ConsultPage'), 'ConsultPage');
const CalendarPage = page(() => import('@/features/calendar/CalendarPage'), 'CalendarPage');
const PatientsPage = page(() => import('@/features/patients/PatientsPage'), 'PatientsPage');
const PatientFormPage = page(
  () => import('@/features/patients/PatientFormPage'),
  'PatientFormPage',
);
const PatientDetailPage = page(
  () => import('@/features/patients/PatientDetailPage'),
  'PatientDetailPage',
);
const StaffPage = page(() => import('@/features/staff/StaffPage'), 'StaffPage');
const AuditPage = page(() => import('@/features/audit/AuditPage'), 'AuditPage');
const SettingsPage = page(() => import('@/features/settings/SettingsPage'), 'SettingsPage');
const PlatformPage = page(() => import('@/features/platform/PlatformPage'), 'PlatformPage');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/c/:slug', element: <BookingPage /> },
  { path: '/cancel/:token', element: <CancelPage /> },
  { path: '/privacy', element: <PrivacyPage /> },
  { path: '/rx/:token', element: <RxSharePage /> },
  { path: '/u/:token', element: <OptOutPage /> },
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomeRedirect /> },
      {
        path: 'consult/:appointmentId',
        element: (
          <RequireAccess permission="clinical:read">
            <ConsultPage />
          </RequireAccess>
        ),
      },
      { path: 'select-clinic', element: <SelectClinicPage /> },
      {
        path: 'platform',
        element: (
          <RequireAccess platform>
            <PlatformPage />
          </RequireAccess>
        ),
      },
      {
        path: 'today',
        element: (
          <RequireAccess permission="queue:manage">
            <TodayPage />
          </RequireAccess>
        ),
      },
      {
        path: 'queue',
        element: (
          <RequireAccess role="doctor">
            <QueuePage />
          </RequireAccess>
        ),
      },
      {
        path: 'calendar',
        element: (
          <RequireAccess permission="appointments:manage">
            <CalendarPage />
          </RequireAccess>
        ),
      },
      {
        path: 'patients',
        children: [
          {
            index: true,
            element: (
              <RequireAccess permission="patients:read">
                <PatientsPage />
              </RequireAccess>
            ),
          },
          {
            path: 'new',
            element: (
              <RequireAccess permission="patients:write">
                <PatientFormPage />
              </RequireAccess>
            ),
          },
          {
            path: ':id',
            element: (
              <RequireAccess permission="patients:read">
                <PatientDetailPage />
              </RequireAccess>
            ),
          },
          {
            path: ':id/edit',
            element: (
              <RequireAccess permission="patients:write">
                <PatientFormPage />
              </RequireAccess>
            ),
          },
        ],
      },
      {
        path: 'staff',
        element: (
          <RequireAccess permission="staff:manage">
            <StaffPage />
          </RequireAccess>
        ),
      },
      {
        path: 'audit',
        element: (
          <RequireAccess permission="audit:read">
            <AuditPage />
          </RequireAccess>
        ),
      },
      {
        path: 'settings',
        element: (
          <RequireAccess permission="settings:manage">
            <SettingsPage />
          </RequireAccess>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <Suspense fallback={<PageSkeleton />}>
          <RouterProvider router={router} />
        </Suspense>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
