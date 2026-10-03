import {
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  ListOrdered,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { hasPermission, type Permission, type Role, type SessionUser } from '@clinic/shared';
import { t } from '@/i18n';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
  permission?: Permission;
}

const NAV: NavItem[] = [
  { to: '/today', label: t.nav.today, icon: LayoutDashboard, roles: ['secretary'] },
  { to: '/queue', label: t.nav.queue, icon: ListOrdered, roles: ['doctor'] },
  { to: '/calendar', label: t.nav.calendar, icon: CalendarDays, permission: 'appointments:manage' },
  { to: '/patients', label: t.nav.patients, icon: Users, permission: 'patients:read' },
  { to: '/staff', label: t.nav.staff, icon: ClipboardList, permission: 'staff:manage' },
  { to: '/audit', label: t.nav.audit, icon: ShieldCheck, permission: 'audit:read' },
  { to: '/settings', label: t.nav.settings, icon: Settings, permission: 'settings:manage' },
];

export function navFor(user: SessionUser): NavItem[] {
  return NAV.filter(
    (item) =>
      (!item.roles || item.roles.some((role) => user.roles.includes(role))) &&
      (!item.permission || hasPermission(user.roles, item.permission)),
  );
}

/** Where each role lands after sign-in. */
export function homePathFor(user: SessionUser): string {
  if (user.roles.includes('doctor')) return '/queue';
  if (user.roles.includes('secretary')) return '/today';
  return '/staff';
}
