import { Navigate } from 'react-router';
import { useSession } from '@/auth/session';
import { homePathFor } from '@/layouts/nav';

export function HomeRedirect() {
  const { user, clinics, activeClinic } = useSession();
  return <Navigate to={user ? homePathFor({ user, clinics, activeClinic }) : '/login'} replace />;
}
