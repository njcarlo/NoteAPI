import { CheckCircle2, Copy, FileText, Link2 } from 'lucide-react';
import { useState } from 'react';
import { AMENDABLE_FIELDS, SOAP_FIELDS, type Consult } from '@clinic/shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useSession } from '@/auth/session';
import { t } from '@/i18n';
import { ApiError, errorMessage } from '@/lib/api';
import { dateLabel, manilaDateTime, vitalsSummary } from '@/lib/format';
import { useAmend, useShareLink } from './api';

const c = t.consult;
const fieldLabel = (field: string) =>
  field === 'followUpDate'
    ? c.followUpField
    : ((c.soapLabels as Record<string, string>)[field] ?? field);

export function FinishedVisit({ consult }: { consult: Consult }) {
  const { user, can } = useSession();
  const { visit } = consult;
  const isAuthor = user?.id === visit.doctorId;
  const share = useShareLink();
  const [copied, setCopied] = useState(false);
  const shareUrl = share.data ? `${window.location.origin}/rx/${share.data.token}` : null;

  return (
    <div className="space-y-6">
      <Alert variant="success" className="flex items-center gap-2">
        <CheckCircle2 className="size-4" />
        {visit.finishedAt ? c.finishedOn(manilaDateTime(visit.finishedAt)) : c.finished}
      </Alert>
      <p className="text-sm text-muted-foreground">{c.locked}</p>

      <Card className="space-y-4 p-4">
        <p className="text-sm">
          <span className="font-semibold">{c.vitals}: </span>
          {vitalsSummary(visit.vitals) ?? t.vitals.none}
        </p>
        <dl className="grid gap-4 md:grid-cols-2">
          {SOAP_FIELDS.map((field) => (
            <div key={field}>
              <dt className="text-xs font-semibold text-muted-foreground uppercase">
                {c.soapLabels[field]}
              </dt>
              <dd className="text-sm whitespace-pre-wrap">{visit.soap[field] ?? '—'}</dd>
            </div>
          ))}
        </dl>
        {visit.followUpDate && (
          <p className="text-sm">
            <span className="font-semibold">{c.followUpField}: </span>
            {dateLabel(visit.followUpDate, 'long')}
          </p>
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">{c.rx}</h2>
        {!visit.prescription ? (
          <p className="text-sm text-muted-foreground">{c.noPrescription}</p>
        ) : (
          <>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              {visit.prescription.items.map((i) => (
                <li key={i.id}>
                  <span className="font-medium">
                    {i.genericName}
                    {i.brandName && ` (${i.brandName})`} {i.strength} {i.form}
                  </span>{' '}
                  <span className="text-muted-foreground">#{i.quantity}</span>
                  <br />
                  <span className="text-muted-foreground">Sig: {i.sig}</span>
                </li>
              ))}
            </ol>
            {visit.prescription.notes && (
              <p className="text-sm italic">{visit.prescription.notes}</p>
            )}
            {can('prescriptions:read') && (
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <a
                    href={`/api/prescriptions/${visit.prescription.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FileText />
                    {c.openPdf}
                  </a>
                </Button>
                {can('prescriptions:write') && (
                  <Button
                    variant="outline"
                    disabled={share.isPending}
                    onClick={() => share.mutate(visit.prescription!.id)}
                  >
                    <Link2 />
                    {c.share}
                  </Button>
                )}
              </div>
            )}
            {shareUrl && (
              <div className="space-y-1">
                <div className="flex gap-2">
                  <Input readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
                  <Button
                    variant="outline"
                    onClick={() =>
                      void navigator.clipboard.writeText(shareUrl).then(() => setCopied(true))
                    }
                  >
                    <Copy />
                    {copied ? c.copied : c.copy}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{c.shareHint}</p>
              </div>
            )}
            {share.isError && (
              <Alert variant="destructive">
                {errorMessage(share.error, t.common.genericError)}
              </Alert>
            )}
          </>
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">{c.amendments}</h2>
        {visit.amendments.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {visit.amendments.map((a) => (
              <li key={a.id} className="rounded-md border border-border p-3">
                <p className="font-medium">{fieldLabel(a.field)}</p>
                <p className="text-muted-foreground line-through">{a.oldValue ?? '—'}</p>
                <p>{a.newValue ?? '—'}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  “{a.reason}” · {c.amendedBy(a.authorName, manilaDateTime(a.createdAt))}
                </p>
              </li>
            ))}
          </ul>
        )}
        {isAuthor && <AmendForm consult={consult} />}
      </Card>
    </div>
  );
}

function AmendForm({ consult }: { consult: Consult }) {
  const { visit } = consult;
  const amend = useAmend(visit.appointmentId, visit.id);
  const [field, setField] = useState<(typeof AMENDABLE_FIELDS)[number]>('assessment');
  const current = field === 'followUpDate' ? visit.followUpDate : visit.soap[field];
  const [value, setValue] = useState(current ?? '');
  const [reason, setReason] = useState('');
  const errors = amend.error instanceof ApiError ? amend.error.fieldErrors : {};

  return (
    <div className="space-y-3 rounded-md border border-dashed border-border p-3">
      <p className="text-sm font-medium">{c.amend}</p>
      <label className="block text-xs text-muted-foreground">
        {c.amendField}
        <Select
          value={field}
          onChange={(e) => {
            const next = e.target.value as typeof field;
            setField(next);
            setValue((next === 'followUpDate' ? visit.followUpDate : visit.soap[next]) ?? '');
          }}
        >
          {AMENDABLE_FIELDS.map((f) => (
            <option key={f} value={f}>
              {fieldLabel(f)}
            </option>
          ))}
        </Select>
      </label>
      <label className="block text-xs text-muted-foreground">
        {c.amendValue}
        {field === 'followUpDate' ? (
          <Input type="date" value={value} onChange={(e) => setValue(e.target.value)} />
        ) : (
          <Textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} />
        )}
      </label>
      <label className="block text-xs text-muted-foreground">
        {c.amendReason}
        <Input
          value={reason}
          aria-invalid={!!errors.reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {errors.reason && <span className="text-destructive">{errors.reason}</span>}
      </label>
      {amend.isError && !errors.reason && (
        <Alert variant="destructive">{errorMessage(amend.error, t.common.genericError)}</Alert>
      )}
      <Button
        size="sm"
        disabled={amend.isPending}
        onClick={() =>
          amend.mutate(
            { field, newValue: value || null, reason },
            { onSuccess: () => setReason('') },
          )
        }
      >
        {c.amendSubmit}
      </Button>
    </div>
  );
}
