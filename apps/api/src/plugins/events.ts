import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import postgres from 'postgres';
import { env } from '../config/env';
import { connectionOptions } from '../db/connect';
import { clinicEvents, EVENTS_CHANNEL, type ClinicEventEnvelope } from '../lib/events';
import { doctorScope, requireActiveClinic } from './auth';

const HEARTBEAT_MS = 25_000;
/** Streams are closed periodically; EventSource reconnects and the session is re-checked. */
const MAX_STREAM_MS = env.SSE_MAX_STREAM_SECONDS * 1000;

export default fp(async (app: FastifyInstance) => {
  const { url, path } = connectionOptions(env.DATABASE_URL);
  const listener = postgres(url, { max: 1, onnotice: () => undefined, ...(path ? { path } : {}) });
  const subscription = await listener.listen(EVENTS_CHANNEL, (payload) => {
    try {
      const envelope = JSON.parse(payload) as ClinicEventEnvelope;
      clinicEvents.emit(envelope.clinicId, envelope.event);
    } catch {
      app.log.warn('Ignored malformed clinic event');
    }
  });
  const streams = new Set<ServerResponse>();
  app.addHook('onClose', async () => {
    for (const res of streams) res.end();
    await subscription.unlisten();
    await listener.end({ timeout: 1 });
  });

  app.get('/api/events', async (request, reply) => {
    const { clinic } = requireActiveClinic(request);
    const scope = doctorScope(request);

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    streams.add(res);

    const onEvent = (event: ClinicEventEnvelope['event']) => {
      if (scope && !scope.includes(event.doctorId)) return;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    clinicEvents.on(clinic.id, onEvent);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    const expiry = setTimeout(() => res.end(), MAX_STREAM_MS);

    const cleanup = () => {
      clearInterval(heartbeat);
      clearTimeout(expiry);
      clinicEvents.off(clinic.id, onEvent);
      streams.delete(res);
    };
    request.raw.on('close', cleanup);
  });
});
