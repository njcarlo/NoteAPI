import { FileText, FlaskConical, Paperclip } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  FASTING_TESTS,
  LAB_RESULT_MAX_BYTES,
  LAB_RESULT_TYPES,
  LAB_TEST_GROUPS,
  type LabRequest,
  type LabRequestStatus,
} from '@clinic/shared';
import { FileUpload } from '@/components/FileUpload';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useSession } from '@/auth/session';
import { t } from '@/i18n';
import { ApiError, errorMessage } from '@/lib/api';
import { manilaDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { labPdfUrl, labResultUrl, useCreateLabRequest, useFacilities, useLabAction } from './api';

const l = t.labs;

const STATUS_VARIANT = {
  requested: 'warning',
  results_in: 'default',
  reviewed: 'success',
  cancelled: 'muted',
} as const satisfies Record<LabRequestStatus, string>;

export function LabStatusBadge({ status }: { status: LabRequestStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{l.statuses[status]}</Badge>;
}

/**
 * One lab request. Doctors see the tests and open results; the front desk sees how many tests
 * and attaches results. Actions appear only for the people allowed to take them.
 */
export function LabRequestItem({
  lab,
  withPatient = false,
  currentVisitId,
}: {
  lab: LabRequest;
  withPatient?: boolean;
  currentVisitId?: string;
}) {
  const { user, can } = useSession();
  const action = useLabAction();
  const [reviewing, setReviewing] = useState(false);
  const [note, setNote] = useState('');
  const isRequester = user?.id === lab.doctorId;
  const clinical = can('clinical:read');
  const open = lab.status === 'requested' || lab.status === 'results_in';

  return (
    <li className="space-y-2 rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <FlaskConical className="size-4 text-muted-foreground" />
        <span className="font-semibold">{lab.facilityName ?? l.anyFacility}</span>
        <LabStatusBadge status={lab.status} />
        {lab.fasting && <Badge variant="muted">{l.fastingShort}</Badge>}
        {currentVisitId === lab.visitId && <Badge variant="muted">{l.thisVisit}</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">
          {manilaDateTime(lab.createdAt)} · {lab.doctorName}
        </span>
      </div>
      {withPatient && (
        <p className="font-medium">
          <Link to={`/patients/${lab.patient.id}`} className="hover:text-primary">
            {lab.patient.lastName}, {lab.patient.firstName}
          </Link>
        </p>
      )}
      <p>{clinical ? lab.tests.join(', ') : l.testCount(lab.testCount)}</p>
      {lab.clinicalImpression && (
        <p className="text-muted-foreground">
          {l.impression}: {lab.clinicalImpression}
        </p>
      )}
      {lab.reviewNote && <p className="font-medium">{l.reviewedNote(lab.reviewNote)}</p>}
      {!clinical && lab.resultCount > 0 && (
        <p className="text-muted-foreground">{l.resultCount(lab.resultCount)}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {clinical && (
          <Button asChild variant="outline" size="sm">
            <a href={labPdfUrl(lab.id)} target="_blank" rel="noreferrer">
              <FileText />
              {l.slip}
            </a>
          </Button>
        )}
        {lab.results.map((result, index) => (
          <Button key={result.id} asChild variant="outline" size="sm">
            <a
              href={labResultUrl(result.id)}
              target="_blank"
              rel="noreferrer"
              title={`${result.fileName} · ${result.uploadedByName} · ${manilaDateTime(result.createdAt)}`}
            >
              <Paperclip />
              {l.result(index + 1)}
            </a>
          </Button>
        ))}
        {open && can('patients:write') && (
          <FileUpload
            accept={LAB_RESULT_TYPES}
            maxBytes={LAB_RESULT_MAX_BYTES}
            label={action.isPending ? l.uploading : l.uploadResult}
            tooBig={l.fileTooBig}
            wrongType={l.fileWrongType}
            disabled={action.isPending}
            onFile={(file) => action.mutate({ kind: 'results', id: lab.id, file })}
          />
        )}
        {lab.status === 'results_in' && isRequester && !reviewing && (
          <Button size="sm" onClick={() => setReviewing(true)}>
            {l.review}
          </Button>
        )}
        {lab.status === 'requested' && isRequester && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            disabled={action.isPending}
            onClick={() => action.mutate({ kind: 'cancel', id: lab.id })}
          >
            {l.cancel}
          </Button>
        )}
        {clinical && withPatient && (
          <Button asChild variant="ghost" size="sm">
            <Link to={`/consult/${lab.appointmentId}`}>{l.consultLink}</Link>
          </Button>
        )}
      </div>

      {reviewing && (
        <div className="flex flex-wrap gap-2">
          <Input
            className="min-w-60 flex-1"
            aria-label={l.reviewNote}
            placeholder={l.reviewNote}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            size="sm"
            disabled={action.isPending}
            onClick={() =>
              action.mutate(
                { kind: 'review', id: lab.id, note },
                { onSuccess: () => setReviewing(false) },
              )
            }
          >
            {l.reviewSubmit}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setReviewing(false)}>
            {t.common.cancel}
          </Button>
        </div>
      )}
      {action.isSuccess && action.variables?.kind === 'results' && !clinical && (
        <Alert variant="success">{l.uploaded}</Alert>
      )}
      {action.isError && (
        <Alert variant="destructive">{errorMessage(action.error, t.common.genericError)}</Alert>
      )}
    </li>
  );
}

const OTHER = 'other';

/** Writing a lab request: where, which tests (common ones are one click), and preparation. */
export function LabRequestForm({
  visitId,
  defaultImpression,
  onDone,
}: {
  visitId: string;
  defaultImpression: string;
  onDone: () => void;
}) {
  const facilities = useFacilities();
  const create = useCreateLabRequest(visitId);
  const labs = (facilities.data ?? []).filter(
    (f) => f.kind === 'laboratory' || f.kind === 'imaging',
  );
  const [facility, setFacility] = useState<string | null>(null);
  const [otherName, setOtherName] = useState('');
  const [tests, setTests] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [fastingChoice, setFasting] = useState<boolean | null>(null);
  const [impression, setImpression] = useState(defaultImpression);
  const [notes, setNotes] = useState('');
  const errors = create.error instanceof ApiError ? create.error.fieldErrors : {};

  // Defaults: the first partner laboratory; fasting when a fasting test is ticked.
  const facilityValue = facility ?? labs[0]?.id ?? '';
  const fasting = fastingChoice ?? tests.some((test) => FASTING_TESTS.has(test));
  const toggle = (test: string) =>
    setTests((list) => (list.includes(test) ? list.filter((x) => x !== test) : [...list, test]));
  const addCustom = () => {
    const name = custom.trim();
    if (name && !tests.includes(name)) setTests([...tests, name]);
    setCustom('');
  };
  const customTests = tests.filter(
    (test) => !LAB_TEST_GROUPS.some((g) => g.tests.some((x) => x.name === test)),
  );

  return (
    <div className="space-y-3 rounded-md border border-dashed border-border p-3">
      <label className="block text-sm">
        {l.facility}
        <Select
          className="mt-1"
          value={facilityValue}
          onChange={(e) => setFacility(e.target.value)}
        >
          <option value="">{l.anyFacility}</option>
          {labs.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
          <option value={OTHER}>{l.otherFacility}</option>
        </Select>
      </label>
      {facilityValue === OTHER && (
        <Input
          aria-label={l.otherFacilityName}
          placeholder={l.otherFacilityName}
          value={otherName}
          onChange={(e) => setOtherName(e.target.value)}
        />
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm">
          {l.tests} <span className="text-muted-foreground">({l.selected(tests.length)})</span>
        </legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LAB_TEST_GROUPS.map((group) => (
            <div key={group.group}>
              <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase">
                {group.group}
              </p>
              {group.tests.map((test) => (
                <label key={test.name} className="flex items-center gap-2 py-0.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={tests.includes(test.name)}
                    onChange={() => toggle(test.name)}
                  />
                  {test.name}
                </label>
              ))}
            </div>
          ))}
        </div>
        {customTests.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {customTests.map((test) => (
              <button
                key={test}
                type="button"
                onClick={() => toggle(test)}
                className={cn('rounded-full bg-muted px-2.5 py-0.5 text-xs')}
                aria-label={`${t.consult.remove} ${test}`}
              >
                {test} ×
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            aria-label={l.otherTest}
            placeholder={l.otherTest}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustom();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addCustom} disabled={!custom.trim()}>
            {l.addTest}
          </Button>
        </div>
        {errors.tests && <p className="text-xs text-destructive">{errors.tests}</p>}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={fasting}
          onChange={(e) => setFasting(e.target.checked)}
        />
        {l.fasting}
      </label>
      <label className="block text-sm">
        {l.impression}
        <Input
          className="mt-1"
          value={impression}
          onChange={(e) => setImpression(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        {l.notes}
        <Textarea
          className="mt-1"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      {create.isError && !errors.tests && (
        <Alert variant="destructive">{errorMessage(create.error, t.common.genericError)}</Alert>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!tests.length || create.isPending}
          onClick={() =>
            create.mutate(
              {
                facilityId: facilityValue && facilityValue !== OTHER ? facilityValue : null,
                facilityName: facilityValue === OTHER ? otherName : null,
                tests,
                fasting,
                clinicalImpression: impression,
                notes,
              },
              { onSuccess: onDone },
            )
          }
        >
          <FlaskConical />
          {create.isPending ? l.submitting : l.submit}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t.common.cancel}
        </Button>
      </div>
    </div>
  );
}

/** The laboratory card on a consultation: the patient's requests from every visit, and a form. */
export function ConsultLabs({
  visitId,
  labs,
  canWrite,
  defaultImpression,
}: {
  visitId: string;
  labs: LabRequest[];
  canWrite: boolean;
  defaultImpression: string;
}) {
  const [writing, setWriting] = useState(false);
  return (
    <div className="space-y-3">
      {labs.length === 0 && !writing && <p className="text-sm text-muted-foreground">{l.none}</p>}
      {labs.length > 0 && (
        <ul className="space-y-2">
          {labs.map((lab) => (
            <LabRequestItem key={lab.id} lab={lab} currentVisitId={visitId} />
          ))}
        </ul>
      )}
      {canWrite &&
        (writing ? (
          <LabRequestForm
            visitId={visitId}
            defaultImpression={defaultImpression}
            onDone={() => setWriting(false)}
          />
        ) : (
          <Button variant="outline" size="sm" onClick={() => setWriting(true)}>
            <FlaskConical />
            {l.request}
          </Button>
        ))}
    </div>
  );
}
