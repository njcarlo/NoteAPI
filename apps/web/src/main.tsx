import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { SessionProvider } from '@/auth/session';
import { RequireAccess } from '@/components/RequirePermission';
import { AuditPage } from '@/features/audit/AuditPage';
import { PatientDetailPage } from '@/features/patients/PatientDetailPage';
import { PatientFormPage } from '@/features/patients/PatientFormPage';
import { PatientsPage } from '@/features/patients/PatientsPage';
import { PlatformPage } from '@/features/platform/PlatformPage';
import { StaffPage } from '@/features/staff/StaffPage';
import { t } from '@/i18n';
import { AppShell } from '@/layouts/AppShell';
import { ApiError } from '@/lib/api';
import { ComingSoonPage } from '@/pages/ComingSoonPage';
import { HomeRedirect } from '@/pages/HomeRedirect';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { SelectClinicPage } from '@/pages/SelectClinicPage';
import './index.css';

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
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomeRedirect /> },
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
          <RequireAccess role="secretary">
            <ComingSoonPage title={t.nav.today} />
          </RequireAccess>
        ),
      },
      {
        path: 'queue',
        element: (
          <RequireAccess role="doctor">
            <ComingSoonPage title={t.nav.queue} />
          </RequireAccess>
        ),
      },
      {
        path: 'calendar',
        element: (
          <RequireAccess permission="appointments:manage">
            <ComingSoonPage title={t.nav.calendar} />
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
            <ComingSoonPage title={t.nav.settings} />
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
        <RouterProvider router={router} />
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
