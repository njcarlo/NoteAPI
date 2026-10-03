export * from './constants';
export * from './permissions';
export * from './phone';
export * from './age';
export * from './errors';
export * from './schemas/common';
export * from './schemas/auth';
export * from './schemas/patients';
export * from './schemas/staff';
export * from './schemas/audit';
export * from './schemas/platform';

export interface Paginated<T> {
  items: T[];
  total: number;
}
