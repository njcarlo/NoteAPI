export * from './constants';
export * from './permissions';
export * from './phone';
export * from './age';
export * from './time';
export * from './slots';
export * from './allergy';
export * from './notifications';
export * from './errors';
export * from './schemas/common';
export * from './schemas/auth';
export * from './schemas/patients';
export * from './schemas/staff';
export * from './schemas/audit';
export * from './schemas/platform';
export * from './schemas/schedules';
export * from './schemas/appointments';
export * from './schemas/public';
export * from './schemas/queue';
export * from './schemas/consult';
export * from './schemas/notifications';
export * from './schemas/clinic';
export * from './schemas/referrals';
export * from './schemas/labs';

export interface Paginated<T> {
  items: T[];
  total: number;
}
