import { and, count, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { auditListQuery, auditLogSchema } from '@clinic/shared';
import { auditLogs, users } from '../../db/schema';
import { iso } from '../../lib/sql';
import { requirePermission } from '../../plugins/auth';

export const auditRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preHandler: requirePermission('audit:read'),
      schema: {
        querystring: auditListQuery,
        response: { 200: z.object({ items: z.array(auditLogSchema), total: z.number() }) },
      },
    },
    (request) =>
      request.tenant(async (t) => {
        const { entityType, entityId, limit, offset } = request.query;
        const where = t.where(
          auditLogs,
          and(
            entityType ? eq(auditLogs.entityType, entityType) : undefined,
            entityId ? eq(auditLogs.entityId, entityId) : undefined,
          ),
        );
        const [rows, [total]] = await Promise.all([
          t.tx
            .select({ log: auditLogs, userName: users.name })
            .from(auditLogs)
            .leftJoin(users, eq(users.id, auditLogs.userId))
            .where(where)
            .orderBy(desc(auditLogs.createdAt))
            .limit(limit)
            .offset(offset),
          t.tx.select({ value: count() }).from(auditLogs).where(where),
        ]);
        return {
          items: rows.map(({ log, userName }) => ({
            id: log.id,
            userId: log.userId,
            userName,
            action: log.action,
            entityType: log.entityType,
            entityId: log.entityId,
            metadata: log.metadata,
            ip: log.ip,
            createdAt: iso(log.createdAt),
          })),
          total: total?.value ?? 0,
        };
      }),
  );
};
