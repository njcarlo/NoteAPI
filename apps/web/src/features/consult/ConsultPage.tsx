import { AlertTriangle, ArrowLeft, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ERROR_CODES,
  findAllergyMatches,
  SOAP_FIELDS,
  type Consult,
  type ConsultDraft,
  type SlotDto,
  type Soap,
  type Vitals,
} from '@clinic/shared';
import { ErrorState, TableSkeleton } from '@/components/States';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useSession } from '@/auth/session';
import { useSlots } from '@/features/calendar/api';
import { t } from '@/i18n';
import { ApiError, errorMessage } from '@/lib/api';
import { ConsultLabs } from '@/features/labs/components';
import {
  ReferredFromBanner,
  summaryFromSoap,
  VisitReferrals,
} from '@/features/referrals/components';
import { ageFrom, dateLabel, fullName, manilaTime, todayManila } from '@/lib/format';
import { useConsult, useFinishVisit, useSaveDraft, useTemplateActions, useTemplates } from './api';
import { FinishedVisit } from './FinishedVisit';
import { RxBuilder, withKey, type DraftItem } from './RxBuilder';

const c = t.consult;

export function ConsultPage() {
  const { appointmentId = '' } = useParams();
  const consult = useConsult(appointmentId);
  if (consult.isLoading) return <TableSkeleton rows={8} />;
  if (consult.isError || !consult.data)
    return <ErrorState error={consult.error} onRetry={() => consult.refetch()} />;
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <PatientSidebar consult={consult.data} />
      <div className="min-w-0 flex-1">
        {consult.data.referredFrom && (
          <div className="mb-6">
            <ReferredFromBanner referral={consult.data.referredFrom} />
          </div>
        )}
        {consult.data.visit.locked ? (
          <FinishedVisit consult={consult.data} />
        ) : (
          <ConsultEditor key={consult.data.visit.id} consult={consult.data} />
        )}
      </div>
    </div>
  );
}

function PatientSidebar({ consult }: { consult: Consult }) {
  const { patient, history } = consult;
  const age = ageFrom(patient.birthdate);
  return (
    <aside className="w-full shrink-0 space-y-4 lg:sticky lg:top-4 lg:w-80">
      <Button asChild variant="ghost" size="sm" className="-ml-3">
        <Link to="/queue">
          <ArrowLeft />
          {c.backToQueue}
        </Link>
      </Button>
      <Card className="space-y-3 p-4">
        <div>
          <h1 className="text-xl font-semibold">{fullName(patient)}</h1>
          <p className="text-sm text-muted-foreground">
            {[age !== null && t.patients.years(age), patient.sex && t.patients.sex[patient.sex]]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {patient.allergies ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive">
            <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
              <AlertTriangle className="size-4" />
              {c.allergies}
            </p>
            <p className="mt-1 font-semibold">{patient.allergies}</p>
          </div>
        ) : (
          <Badge variant="muted">{c.noAllergies}</Badge>
        )}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase">{c.conditions}</p>
          <p className="text-sm">{patient.conditions ?? c.noConditions}</p>
        </div>
      </Card>
      <details
        className="group rounded-lg border border-border bg-card"
        open={history.length > 0 && history.length <= 3}
      >
        <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-semibold">
          {c.history} ({history.length})
          <ChevronDown className="size-4 transition group-open:rotate-180" />
        </summary>
        <div className="divide-y divide-border border-t border-border">
          {history.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">{c.noHistory}</p>
          )}
          {history.map((h) => (
            <Link
              key={h.id}
              to={`/consult/${h.appointmentId}`}
              className="block px-4 py-3 text-sm hover:bg-muted/50"
            >
              <span className="flex justify-between text-xs text-muted-foreground">
                <span>{dateLabel(h.date)}</span>
                <span>{h.doctorName}</span>
              </span>
              <span className="block font-medium">{h.assessment ?? '—'}</span>
              {h.medicines.length > 0 && (
                <span className="block text-xs text-muted-foreground">
                  {h.medicines.join(', ')}
                </span>
              )}
            </Link>
          ))}
        </div>
      </details>
    </aside>
  );
}

type VitalsState = Partial<Record<keyof Vitals, number | null>>;
const VITAL_FIELDS: [keyof Vitals, string, string][] = [
  ['bpSystolic', t.vitals.systolic, '1'],
  ['bpDiastolic', t.vitals.diastolic, '1'],
  ['temperatureC', t.vitals.temperatureC, '0.1'],
  ['heartRate', t.vitals.heartRate, '1'],
  ['respiratoryRate', t.vitals.respiratoryRate, '1'],
  ['o2Sat', t.vitals.o2Sat, '1'],
  ['weightKg', t.vitals.weightKg, '0.1'],
  ['heightCm', t.vitals.heightCm, '0.1'],
];

function ConsultEditor({ consult }: { consult: Consult }) {
  const { user } = useSession();
  const { visit, patient } = consult;
  const isMine = user?.id === visit.doctorId && visit.status === 'in_consult';
  const draft = visit.draft;

  const [soap, setSoap] = useState<Soap>(draft?.soap ?? visit.soap);
  const [vitals, setVitals] = useState<VitalsState>({ ...visit.vitals, ...draft?.vitals });
  const [items, setItems] = useState<DraftItem[]>(() =>
    (draft?.rx?.items ?? []).map((i) => withKey({ genericName: '', sig: '', quantity: '', ...i })),
  );
  const [notes, setNotes] = useState(draft?.rx?.notes ?? '');
  const [followUpDate, setFollowUpDate] = useState(draft?.followUpDate ?? visit.followUpDate ?? '');
  const [followUpSlot, setFollowUpSlot] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  const saveDraft = useSaveDraft(visit.appointmentId);
  const finish = useFinishVisit(visit.appointmentId);
  const matches = useMemo(
    () => findAllergyMatches(items.map((i) => i.genericName).filter(Boolean), patient.allergies),
    [items, patient.allergies],
  );

  const currentDraft = useCallback(
    (): ConsultDraft => ({
      soap,
      vitals: vitals as Vitals,
      followUpDate: followUpDate || null,
      rx: { items: items.map(({ key: _key, ...rest }) => rest), notes: notes || null },
    }),
    [soap, vitals, followUpDate, items, notes],
  );

  // Autosave 1.5 s after the last change.
  const firstRender = useRef(true);
  const { mutate: saveDraftNow } = saveDraft;
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!isMine) return;
    const timer = setTimeout(() => saveDraftNow(currentDraft()), 1500);
    return () => clearTimeout(timer);
  }, [currentDraft, isMine, saveDraftNow]);

  const submit = useCallback(() => {
    finish.mutate({
      soap,
      vitals: vitals as Vitals,
      followUpDate: followUpDate || null,
      followUpStartAt: followUpSlot || null,
      rx: items.length
        ? { items: items.map(({ key: _key, ...rest }) => rest), notes: notes || null }
        : null,
      allergyAcknowledged: acknowledged,
    });
  }, [finish, soap, vitals, followUpDate, followUpSlot, items, notes, acknowledged]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && isMine) {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submit, isMine]);

  const fieldErrors = finish.error instanceof ApiError ? finish.error.fieldErrors : {};
  const allergyBlocked = matches.length > 0 && !acknowledged;

  return (
    <div className="space-y-6 pb-24">
      {!isMine && <Alert>{c.readOnlyColleague}</Alert>}

      <Card className="p-4">
        <h2 className="mb-3 font-semibold">{c.vitals}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {VITAL_FIELDS.map(([name, label, step]) => (
            <label key={name} className="text-xs text-muted-foreground">
              {label}
              <Input
                type="number"
                inputMode="decimal"
                step={step}
                disabled={!isMine}
                aria-invalid={!!fieldErrors[`vitals.${name}`]}
                value={vitals[name] ?? ''}
                onChange={(e) =>
                  setVitals({
                    ...vitals,
                    [name]: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
              {fieldErrors[`vitals.${name}`] && (
                <span className="text-destructive">{fieldErrors[`vitals.${name}`]}</span>
              )}
            </label>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{c.soap}</h2>
          {isMine && <TemplateMenu soap={soap} onApply={(next) => setSoap({ ...soap, ...next })} />}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {SOAP_FIELDS.map((field, i) => (
            <label key={field} className="text-sm font-medium">
              {c.soapLabels[field]}
              <Textarea
                autoFocus={i === 0 && isMine}
                rows={field === 'assessment' ? 2 : 4}
                placeholder={c.soapHints[field]}
                disabled={!isMine}
                className="mt-1 font-normal"
                value={soap[field] ?? ''}
                onChange={(e) => setSoap({ ...soap, [field]: e.target.value })}
              />
            </label>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 font-semibold">{c.rx}</h2>
        <RxBuilder
          items={items}
          onChange={setItems}
          notes={notes}
          onNotesChange={setNotes}
          matches={matches}
          acknowledged={acknowledged}
          onAcknowledge={setAcknowledged}
          errors={fieldErrors}
          disabled={!isMine}
        />
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 font-semibold">{t.labs.section}</h2>
        <ConsultLabs
          visitId={visit.id}
          labs={consult.labRequests}
          canWrite={isMine}
          defaultImpression={soap.assessment ?? ''}
        />
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 font-semibold">{t.referrals.section}</h2>
        <VisitReferrals
          visitId={visit.id}
          referrals={visit.referrals}
          canWrite={isMine}
          defaultSummary={summaryFromSoap(soap)}
        />
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 font-semibold">{c.followUp}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            {c.followUpDate}
            <Input
              type="date"
              min={todayManila()}
              className="mt-1"
              value={followUpDate}
              onChange={(e) => (setFollowUpDate(e.target.value), setFollowUpSlot(''))}
            />
          </label>
          {followUpDate && (
            <FollowUpSlots
              doctorId={visit.doctorId}
              date={followUpDate}
              value={followUpSlot}
              onChange={setFollowUpSlot}
            />
          )}
        </div>
      </Card>

      {isMine && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 px-4 py-3 backdrop-blur md:left-60">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {saveDraft.isPending
                ? c.saving
                : saveDraft.data
                  ? c.savedAt(manilaTime(saveDraft.data.savedAt))
                  : saveDraft.isError
                    ? errorMessage(saveDraft.error, t.common.genericError)
                    : ''}
            </span>
            <div className="flex items-center gap-3">
              {finish.isError &&
                !(
                  finish.error instanceof ApiError &&
                  finish.error.code === ERROR_CODES.ALLERGY_WARNING
                ) && (
                  <span className="text-sm text-destructive">
                    {errorMessage(finish.error, t.common.genericError)}
                  </span>
                )}
              <span className="hidden text-xs text-muted-foreground sm:inline">{c.finishHint}</span>
              <Button size="lg" disabled={finish.isPending || allergyBlocked} onClick={submit}>
                {finish.isPending ? c.finishing : c.finish}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FollowUpSlots({
  doctorId,
  date,
  value,
  onChange,
}: {
  doctorId: string;
  date: string;
  value: string;
  onChange: (startAt: string) => void;
}) {
  const slots = useSlots(doctorId, date);
  return (
    <label className="text-sm">
      {c.followUpSlot}
      <Select className="mt-1" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{c.noFollowUpSlot}</option>
        {slots.data?.map((s: SlotDto) => (
          <option key={s.startAt} value={s.startAt}>
            {manilaTime(s.startAt)}
          </option>
        ))}
      </Select>
    </label>
  );
}

function TemplateMenu({ soap, onApply }: { soap: Soap; onApply: (soap: Soap) => void }) {
  const templates = useTemplates();
  const { create, remove } = useTemplateActions();
  const [naming, setNaming] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(templates.data?.length ?? 0) > 0 && (
        <Select
          className="h-9 w-auto"
          aria-label={c.applyTemplate}
          value=""
          onChange={(e) => {
            const tpl = templates.data?.find((x) => x.id === e.target.value);
            if (!tpl) return;
            const next: Soap = {};
            for (const field of SOAP_FIELDS) {
              if (tpl[field]) next[field] = [soap[field], tpl[field]].filter(Boolean).join('\n');
            }
            onApply(next);
          }}
        >
          <option value="">{c.applyTemplate}</option>
          {templates.data?.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>
              {tpl.name}
            </option>
          ))}
        </Select>
      )}
      {naming === null ? (
        <Button variant="ghost" size="sm" onClick={() => setNaming('')}>
          {c.saveTemplate}
        </Button>
      ) : (
        <>
          <Input
            className="h-9 w-44"
            autoFocus
            placeholder={c.templateName}
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!naming.trim() || create.isPending}
            onClick={() =>
              create.mutate({ name: naming, ...soap }, { onSuccess: () => setNaming(null) })
            }
          >
            {t.common.save}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setNaming(null)}>
            {t.common.cancel}
          </Button>
        </>
      )}
      {(templates.data?.length ?? 0) > 0 && (
        <details className="relative">
          <summary className="cursor-pointer text-xs text-muted-foreground">{c.templates}</summary>
          <ul className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-border bg-card p-1 shadow-lg">
            {templates.data?.map((tpl) => (
              <li key={tpl.id} className="flex items-center justify-between px-2 py-1 text-sm">
                {tpl.name}
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-destructive"
                  onClick={() => remove.mutate(tpl.id)}
                >
                  {c.deleteTemplate}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
