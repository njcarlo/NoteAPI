import {
  Building2,
  CalendarDays,
  ClipboardList,
  FlaskConical,
  LayoutDashboard,
  ListOrdered,
  Send,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  hasPermission,
  type ActiveClinic,
  type ClinicMembership,
  type Permission,
  type Role,
  type SessionUser,
} from '@clinic/shared';
import { t } from '@/i18n';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
  permission?: Permission;
}

const CLINIC_NAV: NavItem[] = [
  // Doctors get Today too: in a solo practice there is no secretary to check patients in.
  { to: '/today', label: t.nav.today, icon: LayoutDashboard, permission: 'queue:manage' },
  { to: '/queue', label: t.nav.queue, icon: ListOrdered, roles: ['doctor'] },
  { to: '/calendar', label: t.nav.calendar, icon: CalendarDays, permission: 'appointments:manage' },
  { to: '/referrals', label: t.nav.referrals, icon: Send, permission: 'appointments:manage' },
  { to: '/labs', label: t.nav.labs, icon: FlaskConical, permission: 'patients:write' },
  { to: '/patients', label: t.nav.patients, icon: Users, permission: 'patients:read' },
  { to: '/staff', label: t.nav.staff, icon: ClipboardList, permission: 'staff:manage' },
  { to: '/audit', label: t.nav.audit, icon: ShieldCheck, permission: 'audit:read' },
  { to: '/settings', label: t.nav.settings, icon: Settings, permission: 'settings:manage' },
];

const PLATFORM_NAV: NavItem = { to: '/platform', label: t.nav.platform, icon: Building2 };

export function navFor(user: SessionUser, clinic: ActiveClinic | null): NavItem[] {
  const items = clinic
    ? CLINIC_NAV.filter(
        (item) =>
          (!item.roles || item.roles.some((role) => clinic.roles.includes(role))) &&
          (!item.permission || hasPermission(clinic.roles, item.permission)),
      )
    : [];
  return user.isPlatformAdmin ? [...items, PLATFORM_NAV] : items;
}

/** Where a user lands after sign-in or switching clinics. */
export function homePathFor(session: {
  user: SessionUser;
  clinics: ClinicMembership[];
  activeClinic: ActiveClinic | null;
}): string {
  const clinic = session.activeClinic;
  if (!clinic) return session.clinics.length ? '/select-clinic' : '/platform';
  if (clinic.roles.includes('doctor')) return '/queue';
  if (clinic.roles.includes('secretary')) return '/today';
  return '/staff';
}
