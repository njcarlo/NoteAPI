import { FileText, Send } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  REFERRAL_URGENCIES,
  SOAP_FIELDS,
  SPECIALTIES,
  type Referral,
  type ReferralStatus,
  type ReferralUrgency,
  type ReferredFrom,
  type Soap,
  type Specialty,
} from '@clinic/shared';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useSession } from '@/auth/session';
import { useDoctors, useSlots } from '@/features/calendar/api';
import { t } from '@/i18n';
import { ApiError, errorMessage } from '@/lib/api';
import { manilaDateTime, manilaTime, todayManila } from '@/lib/format';
import { referralPdfUrl, useCreateReferral, useReferralAction } from './api';

const r = t.referrals;

const STATUS_VARIANT = {
  pending: 'warning',
  scheduled: 'default',
  completed: 'success',
  declined: 'destructive',
  cancelled: 'muted',
} as const satisfies Record<ReferralStatus, string>;

const URGENCY_VARIANT = {
  routine: 'muted',
  urgent: 'warning',
  emergency: 'destructive',
} as const satisfies Record<ReferralUrgency, string>;

export function ReferralStatusBadge({ status }: { status: ReferralStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{r.statuses[status]}</Badge>;
}

export function UrgencyBadge({ urgency }: { urgency: ReferralUrgency }) {
  return <Badge variant={URGENCY_VARIANT[urgency]}>{r.urgencies[urgency]}</Badge>;
}

/** Prefills the letter's clinical summary from the visit notes; the doctor edits it freely. */
export const summaryFromSoap = (soap: Soap) =>
  SOAP_FIELDS.filter((field) => soap[field]?.trim())
    .map((field) => `${t.consult.soapLabels[field]}: ${soap[field]!.trim()}`)
    .join('\n');

const addressee = (ref: Referral) =>
  ref.toDoctorName ??
  ([ref.externalDoctor, ref.externalFacility].filter(Boolean).join(', ') ||
    r.toSpecialist(ref.specialty));

/**
 * One referral. `show` picks the context line: who it went to (sent lists, the visit) or who sent
 * it (incoming, front desk). Actions appear only for the people allowed to take them.
 */
export function ReferralItem({
  referral: ref,
  show = 'to',
  withPatient = false,
}: {
  referral: Referral;
  show?: 'to' | 'from';
  withPatient?: boolean;
}) {
  const { user, can } = useSession();
  const [mode, setMode] = useState<'decline' | 'book' | null>(null);
  const action = useReferralAction();
  const pending = ref.status === 'pending';
  const isSender = user?.id === ref.fromDoctorId;
  const isReceiver = user?.id === ref.toDoctorId;
  const canBook = pending && Boolean(ref.toDoctorId) && can('appointments:manage');

  return (
    <li className="space-y-2 rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{ref.specialty}</span>
        <UrgencyBadge urgency={ref.urgency} />
        <ReferralStatusBadge status={ref.status} />
        <span className="ml-auto text-xs text-muted-foreground">
          {manilaDateTime(ref.createdAt)}
        </span>
      </div>
      {withPatient && (
        <p className="font-medium">
          <Link to={`/patients/${ref.patient.id}`} className="hover:text-primary">
            {ref.patient.lastName}, {ref.patient.firstName}
          </Link>
        </p>
      )}
      <p className="text-muted-foreground">
        {show === 'to' ? r.to(addressee(ref)) : r.from(ref.fromDoctorName)}
        {show === 'from' && ref.toDoctorName && ` → ${ref.toDoctorName}`}
      </p>
      {ref.reason && <p>{ref.reason}</p>}
      {ref.clinicalSummary && (
        <p className="whitespace-pre-wrap text-muted-foreground">{ref.clinicalSummary}</p>
      )}
      {ref.scheduledStartAt && ref.status === 'scheduled' && (
        <p className="font-medium">{r.bookedFor(manilaDateTime(ref.scheduledStartAt))}</p>
      )}
      {ref.status === 'declined' && ref.responseNote && (
        <p className="text-destructive">{r.declinedNote(ref.responseNote)}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {can('clinical:read') && (
          <Button asChild variant="outline" size="sm">
            <a href={referralPdfUrl(ref.id)} target="_blank" rel="noreferrer">
              <FileText />
              {r.letter}
            </a>
          </Button>
        )}
        {can('clinical:read') && show === 'from' && (
          <Button asChild variant="ghost" size="sm">
            <Link to={`/consult/${ref.appointmentId}`}>{r.consultLink}</Link>
          </Button>
        )}
        {canBook && mode !== 'book' && (
          <Button size="sm" onClick={() => setMode('book')}>
            {r.book}
          </Button>
        )}
        {pending && isReceiver && mode !== 'decline' && (
          <Button variant="ghost" size="sm" onClick={() => setMode('decline')}>
            {r.decline}
          </Button>
        )}
        {pending && isSender && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            disabled={action.isPending}
            onClick={() => action.mutate({ kind: 'cancel', id: ref.id })}
          >
            {r.cancel}
          </Button>
        )}
      </div>

      {mode === 'book' && ref.toDoctorId && (
        <BookReferral referral={ref} doctorId={ref.toDoctorId} onClose={() => setMode(null)} />
      )}
      {mode === 'decline' && <DeclineReferral id={ref.id} onClose={() => setMode(null)} />}
      {action.isError && (
        <Alert variant="destructive">{errorMessage(action.error, t.common.genericError)}</Alert>
      )}
    </li>
  );
}

function BookReferral({
  referral,
  doctorId,
  onClose,
}: {
  referral: Referral;
  doctorId: string;
  onClose: () => void;
}) {
  const [date, setDate] = useState(todayManila());
  const [startAt, setStartAt] = useState('');
  const slots = useSlots(doctorId, date);
  const action = useReferralAction();
  return (
    <div className="space-y-2 rounded-md border border-dashed border-border p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">
          {r.bookDate}
          <Input
            type="date"
            min={todayManila()}
            value={date}
            onChange={(e) => (setDate(e.target.value), setStartAt(''))}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          {r.bookTime}
          <Select value={startAt} onChange={(e) => setStartAt(e.target.value)}>
            <option value="">{slots.data?.length ? '—' : r.noSlots}</option>
            {slots.data?.map((s) => (
              <option key={s.startAt} value={s.startAt}>
                {manilaTime(s.startAt)}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {action.isError && (
        <Alert variant="destructive">{errorMessage(action.error, t.common.genericError)}</Alert>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!startAt || action.isPending}
          onClick={() =>
            action.mutate({ kind: 'schedule', id: referral.id, startAt }, { onSuccess: onClose })
          }
        >
          {action.isPending ? t.common.saving : r.bookSubmit}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t.common.cancel}
        </Button>
      </div>
    </div>
  );
}

function DeclineReferral({ id, onClose }: { id: string; onClose: () => void }) {
  const [note, setNote] = useState('');
  const action = useReferralAction();
  const errors = action.error instanceof ApiError ? action.error.fieldErrors : {};
  return (
    <div className="space-y-2 rounded-md border border-dashed border-border p-3">
      <label className="block text-xs text-muted-foreground">
        {r.declineNote}
        <Input
          value={note}
          aria-invalid={!!errors.note}
          onChange={(e) => setNote(e.target.value)}
        />
        {errors.note && <span className="text-destructive">{errors.note}</span>}
      </label>
      {action.isError && !errors.note && (
        <Alert variant="destructive">{errorMessage(action.error, t.common.genericError)}</Alert>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={action.isPending}
          onClick={() => action.mutate({ kind: 'decline', id, note }, { onSuccess: onClose })}
        >
          {r.declineSubmit}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t.common.cancel}
        </Button>
      </div>
    </div>
  );
}

/** Writing a referral: specialty first, then a matching doctor here or a specialist elsewhere. */
export function ReferralForm({
  visitId,
  defaultSummary,
  onDone,
}: {
  visitId: string;
  defaultSummary: string;
  onDone: () => void;
}) {
  const { user } = useSession();
  const doctors = useDoctors();
  const create = useCreateReferral(visitId);
  const [specialty, setSpecialty] = useState<Specialty | ''>('');
  // Explicit choices only; the defaults below follow the doctor list, which may still be loading.
  const [whereChoice, setWhere] = useState<'in' | 'out' | null>(null);
  const [doctorChoice, setToDoctorId] = useState('');
  const [externalDoctor, setExternalDoctor] = useState('');
  const [externalFacility, setExternalFacility] = useState('');
  const [urgency, setUrgency] = useState<ReferralUrgency>('routine');
  const [reason, setReason] = useState('');
  const [clinicalSummary, setClinicalSummary] = useState(defaultSummary);
  const errors = create.error instanceof ApiError ? create.error.fieldErrors : {};

  const matching = (doctors.data ?? []).filter(
    (d) => specialty && d.specialty === specialty && d.id !== user?.id,
  );
  // In the clinic when someone matches; with a single match, that doctor.
  const where = whereChoice ?? (matching.length ? 'in' : 'out');
  const inClinic = where === 'in' && matching.length > 0;
  const toDoctorId =
    matching.find((d) => d.id === doctorChoice)?.id ??
    (matching.length === 1 ? matching[0]!.id : '');

  const pickSpecialty = (value: Specialty | '') => {
    setSpecialty(value);
    setToDoctorId('');
    setWhere(null);
  };

  const submit = () =>
    create.mutate(
      {
        specialty: specialty as Specialty,
        toDoctorId: inClinic ? toDoctorId || null : null,
        externalDoctor: inClinic ? null : externalDoctor,
        externalFacility: inClinic ? null : externalFacility,
        urgency,
        reason,
        clinicalSummary,
      },
      { onSuccess: onDone },
    );

  return (
    <div className="space-y-3 rounded-md border border-dashed border-border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          {r.specialty}
          <Select
            className="mt-1"
            value={specialty}
            aria-invalid={!!errors.specialty}
            onChange={(e) => pickSpecialty(e.target.value as Specialty | '')}
          >
            <option value="">{r.chooseSpecialty}</option>
            {SPECIALTIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          {errors.specialty && <span className="text-xs text-destructive">{errors.specialty}</span>}
        </label>
        <label className="text-sm">
          {r.urgency}
          <Select
            className="mt-1"
            value={urgency}
            onChange={(e) => setUrgency(e.target.value as ReferralUrgency)}
          >
            {REFERRAL_URGENCIES.map((u) => (
              <option key={u} value={u}>
                {r.urgencies[u]}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {specialty && (
        <fieldset className="space-y-2">
          <legend className="text-sm">{r.where}</legend>
          {matching.length === 0 ? (
            <p className="text-xs text-muted-foreground">{r.noDoctorFor(specialty)}</p>
          ) : (
            <div className="flex flex-wrap gap-4 text-sm">
              {(['in', 'out'] as const).map((value) => (
                <label key={value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`where-${visitId}`}
                    checked={where === value}
                    onChange={() => setWhere(value)}
                  />
                  {value === 'in' ? r.inClinic : r.outside}
                </label>
              ))}
            </div>
          )}
          {inClinic ? (
            <Select
              aria-label={r.receivingDoctor}
              value={toDoctorId}
              onChange={(e) => setToDoctorId(e.target.value)}
            >
              <option value="">{r.chooseDoctor}</option>
              {matching.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                aria-label={r.externalDoctor}
                placeholder={r.externalDoctor}
                value={externalDoctor}
                onChange={(e) => setExternalDoctor(e.target.value)}
              />
              <Input
                aria-label={r.externalFacility}
                placeholder={r.externalFacility}
                value={externalFacility}
                onChange={(e) => setExternalFacility(e.target.value)}
              />
            </div>
          )}
        </fieldset>
      )}

      <label className="block text-sm">
        {r.reason}
        <Input
          className="mt-1"
          placeholder={r.reasonHint}
          aria-invalid={!!errors.reason}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {errors.reason && <span className="text-xs text-destructive">{errors.reason}</span>}
      </label>
      <label className="block text-sm">
        {r.clinicalSummary}
        <Textarea
          className="mt-1"
          rows={3}
          value={clinicalSummary}
          onChange={(e) => setClinicalSummary(e.target.value)}
        />
      </label>
      {create.isError && !errors.reason && !errors.specialty && (
        <Alert variant="destructive">{errorMessage(create.error, t.common.genericError)}</Alert>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!specialty || (inClinic && !toDoctorId) || create.isPending}
          onClick={submit}
        >
          <Send />
          {create.isPending ? r.submitting : r.submit}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t.common.cancel}
        </Button>
      </div>
    </div>
  );
}

/** The referrals card on a consultation, open or finished. */
export function VisitReferrals({
  visitId,
  referrals,
  canWrite,
  defaultSummary,
}: {
  visitId: string;
  referrals: Referral[];
  canWrite: boolean;
  defaultSummary: string;
}) {
  const [writing, setWriting] = useState(false);
  return (
    <div className="space-y-3">
      {referrals.length === 0 && !writing && (
        <p className="text-sm text-muted-foreground">{r.none}</p>
      )}
      {referrals.length > 0 && (
        <ul className="space-y-2">
          {referrals.map((ref) => (
            <ReferralItem key={ref.id} referral={ref} />
          ))}
        </ul>
      )}
      {canWrite &&
        (writing ? (
          <ReferralForm
            visitId={visitId}
            defaultSummary={defaultSummary}
            onDone={() => setWriting(false)}
          />
        ) : (
          <Button variant="outline" size="sm" onClick={() => setWriting(true)}>
            <Send />
            {r.refer}
          </Button>
        ))}
    </div>
  );
}

/** Banner for the receiving doctor: why this patient was sent to them. */
export function ReferredFromBanner({ referral }: { referral: ReferredFrom }) {
  return (
    <Alert className="space-y-1">
      <p className="flex flex-wrap items-center gap-2 font-semibold">
        {r.referredBy(referral.fromDoctorName, referral.specialty)}
        <UrgencyBadge urgency={referral.urgency} />
      </p>
      <p>{referral.reason}</p>
      {referral.clinicalSummary && (
        <p className="whitespace-pre-wrap text-muted-foreground">{referral.clinicalSummary}</p>
      )}
      <a
        href={referralPdfUrl(referral.id)}
        target="_blank"
        rel="noreferrer"
        className="text-xs underline"
      >
        {r.letter}
      </a>
    </Alert>
  );
}
