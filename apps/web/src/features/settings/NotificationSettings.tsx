import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  PATIENT_EVENTS,
  renderTemplate,
  smsSegments,
  TEMPLATE_VARIABLES,
  type NotificationLog,
  type NotificationTemplate,
  type PatientEvent,
  type TemplateValues,
} from '@clinic/shared';
import { ErrorState, TableSkeleton } from '@/components/States';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { useSession } from '@/auth/session';
import { t } from '@/i18n';
import { api, ApiError, errorMessage } from '@/lib/api';
import { manilaDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const n = t.notifications;

const SAMPLE: TemplateValues = {
  firstName: 'Juan',
  clinicName: 'Your Clinic',
  clinicPhone: '0917 000 0000',
  date: 'Mon, Oct 12',
  time: '9:30 AM',
  referenceCode: 'K7Q-M2XP',
  cancelLink: 'https://clinic.ph/cancel/aBcD1234eFgH5678iJkL',
  bookingLink: 'https://clinic.ph/c/your-clinic',
  rxLink: 'https://clinic.ph/rx/aBcD1234eFgH5678iJkLmNoP',
};
/** Rough length of the opt-out line appended to every SMS. */
const OPT_OUT_SUFFIX = '\nStop SMS: https://clinic.ph/u/abcdefghijklmnopqrstuvwxyz012345';

export function NotificationSettings() {
  const { activeClinic } = useSession();
  const templates = useQuery({
    queryKey: ['notification-templates'],
    queryFn: () => api<NotificationTemplate[]>('/notification-templates'),
  });
  const [event, setEvent] = useState<PatientEvent>('appointment.booked');

  if (templates.isLoading) return <TableSkeleton rows={6} />;
  if (templates.isError || !templates.data)
    return <ErrorState error={templates.error} onRetry={() => templates.refetch()} />;
  const sample = { ...SAMPLE, clinicName: activeClinic?.name ?? SAMPLE.clinicName };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{n.templatesTitle}</CardTitle>
          <CardDescription>{n.templatesHint}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-[14rem_1fr]">
          <nav className="flex flex-col gap-1">
            {PATIENT_EVENTS.map((e) => {
              const custom = templates.data.some((x) => x.event === e && x.isCustom);
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEvent(e)}
                  className={cn(
                    'rounded-md px-3 py-2 text-left text-sm hover:bg-muted',
                    event === e && 'bg-primary/10 font-medium text-primary',
                  )}
                >
                  {n.events[e].split(' (')[0]}
                  {custom && <span className="ml-1 text-xs text-muted-foreground">•</span>}
                </button>
              );
            })}
          </nav>
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">{n.events[event]}</p>
            {(['sms', 'email'] as const).map((channel) => {
              const tpl = templates.data.find((x) => x.event === event && x.channel === channel)!;
              return <TemplateEditor key={`${event}-${channel}`} template={tpl} sample={sample} />;
            })}
          </div>
        </CardContent>
      </Card>
      <NotificationLogTable />
    </div>
  );
}

function TemplateEditor({
  template,
  sample,
}: {
  template: NotificationTemplate;
  sample: TemplateValues;
}) {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState(template.subject ?? '');
  const [body, setBody] = useState(template.body);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const url = `/notification-templates/${template.event}/${template.channel}`;
  const onSaved = (saved: NotificationTemplate) =>
    queryClient.setQueryData<NotificationTemplate[]>(['notification-templates'], (list) =>
      list?.map((x) => (x.event === saved.event && x.channel === saved.channel ? saved : x)),
    );
  const save = useMutation({
    mutationFn: () =>
      api<NotificationTemplate>(url, {
        method: 'PUT',
        body: { subject: template.channel === 'email' ? subject : null, body },
      }),
    onSuccess: onSaved,
  });
  const reset = useMutation({
    mutationFn: () => api<NotificationTemplate>(`${url}/reset`, { method: 'POST' }),
    onSuccess: (saved) => {
      onSaved(saved);
      setBody(saved.body);
      setSubject(saved.subject ?? '');
    },
  });

  const insert = (variable: string) => {
    const el = bodyRef.current;
    const token = `{{${variable}}}`;
    if (!el) return setBody(body + token);
    const next = body.slice(0, el.selectionStart) + token + body.slice(el.selectionEnd);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = el.selectionStart + token.length;
    });
  };

  const preview = renderTemplate(body, sample);
  const smsText = preview + OPT_OUT_SUFFIX;
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const dirty =
    body !== template.body ||
    (template.channel === 'email' && subject !== (template.subject ?? ''));

  return (
    <section className="space-y-3 rounded-md border border-border p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{n.channels[template.channel]}</h3>
        {template.isCustom && <Badge variant="muted">{n.custom}</Badge>}
      </div>
      {template.channel === 'email' && (
        <label className="block text-xs text-muted-foreground">
          {n.subject}
          <Input
            value={subject}
            aria-invalid={!!errors.subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          {errors.subject && <span className="text-destructive">{errors.subject}</span>}
        </label>
      )}
      <label className="block text-xs text-muted-foreground">
        {n.body}
        <Textarea
          ref={bodyRef}
          rows={template.channel === 'sms' ? 3 : 7}
          value={body}
          aria-invalid={!!errors.body}
          onChange={(e) => setBody(e.target.value)}
        />
        {errors.body && <span className="text-destructive">{errors.body}</span>}
      </label>
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs text-muted-foreground">{n.variables}:</span>
        {TEMPLATE_VARIABLES.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => insert(v)}
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-primary/10"
          >
            {`{{${v}}}`}
          </button>
        ))}
      </div>
      <div className="rounded-md bg-muted/60 p-3 text-sm">
        <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase">{n.preview}</p>
        {template.channel === 'email' && (
          <p className="font-medium">{renderTemplate(subject, sample)}</p>
        )}
        <p className="whitespace-pre-wrap">{template.channel === 'sms' ? smsText : preview}</p>
        {template.channel === 'sms' && (
          <p
            className={cn(
              'mt-2 text-xs',
              smsSegments(smsText) > 2 ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {n.smsLength(smsText.length, smsSegments(smsText))} · {n.optOutNote}
          </p>
        )}
      </div>
      {save.isSuccess && !dirty && <Alert variant="success">{n.saved}</Alert>}
      {save.isError && !Object.keys(errors).length && (
        <Alert variant="destructive">{errorMessage(save.error, t.common.genericError)}</Alert>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? t.common.saving : t.common.save}
        </Button>
        {template.isCustom && (
          <Button
            size="sm"
            variant="ghost"
            disabled={reset.isPending}
            onClick={() => reset.mutate()}
          >
            {n.reset}
          </Button>
        )}
      </div>
    </section>
  );
}

const STATUS_VARIANT = {
  queued: 'muted',
  sent: 'success',
  failed: 'destructive',
  skipped: 'muted',
} as const;

function NotificationLogTable() {
  const logs = useQuery({
    queryKey: ['notification-logs'],
    queryFn: () => api<NotificationLog[]>('/notification-logs?limit=50'),
    refetchInterval: 15_000,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{n.logTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        {logs.isLoading ? (
          <TableSkeleton rows={4} />
        ) : logs.isError ? (
          <ErrorState error={logs.error} onRetry={() => logs.refetch()} />
        ) : !logs.data?.length ? (
          <p className="text-sm text-muted-foreground">{n.logEmpty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4 font-medium">{n.logColumns.when}</th>
                  <th className="py-2 pr-4 font-medium">{n.logColumns.event}</th>
                  <th className="py-2 pr-4 font-medium">{n.logColumns.to}</th>
                  <th className="py-2 font-medium">{n.logColumns.status}</th>
                </tr>
              </thead>
              <tbody>
                {logs.data.map((log) => (
                  <tr key={log.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4 whitespace-nowrap tabular-nums">
                      {manilaDateTime(log.sentAt ?? log.createdAt)}
                    </td>
                    <td className="py-2 pr-4">
                      {n.eventShort[log.event] ?? log.event} · {n.channels[log.channel]}
                      {log.patientName && (
                        <span className="block text-xs text-muted-foreground">
                          {log.patientName}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">{log.recipient}</td>
                    <td className="py-2">
                      <Badge variant={STATUS_VARIANT[log.status]}>{n.status[log.status]}</Badge>
                      {log.error && (
                        <span className="block text-xs text-muted-foreground">{log.error}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
