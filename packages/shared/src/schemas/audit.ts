import { z } from 'zod';
import { paginationQuery } from './common';

export const auditListQuery = paginationQuery.extend({
  entityType: z.string().max(50).optional(),
  entityId: z.uuid().optional(),
});

export const auditLogSchema = z.object({
  id: z.uuid(),
  userId: z.uuid().nullable(),
  userName: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditLog = z.infer<typeof auditLogSchema>;
