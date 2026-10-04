import type { NotificationChannel, NotificationEvent } from './constants';

/**
 * The only values a template can use. There is deliberately no variable for the visit reason,
 * diagnosis or medicines: patient messages must never carry clinical details.
 */
export const TEMPLATE_VARIABLES = [
  'firstName',
  'clinicName',
  'clinicPhone',
  'date',
  'time',
  'referenceCode',
  'cancelLink',
  'bookingLink',
  'rxLink',
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateValues = Partial<Record<TemplateVariable, string>>;

/** Events patients receive messages for (staff alerts are separate). */
export const PATIENT_EVENTS = [
  'appointment.booked',
  'appointment.rescheduled',
  'appointment.cancelled',
  'appointment.reminder',
  'visit.finished',
  'followup.reminder',
] as const satisfies readonly NotificationEvent[];
export type PatientEvent = (typeof PATIENT_EVENTS)[number];

export interface TemplateText {
  subject: string | null;
  body: string;
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

export const DEFAULT_TEMPLATES: Record<PatientEvent, Record<NotificationChannel, TemplateText>> = {
  'appointment.booked': {
    sms: {
      subject: null,
      body: "Hi {{firstName}}, you're booked at {{clinicName}} on {{date}}, {{time}}. Ref {{referenceCode}}. To cancel: {{cancelLink}}",
    },
    email: {
      subject: 'Your appointment at {{clinicName}} ({{referenceCode}})',
      body: "Hi {{firstName}},\n\nYou're booked at {{clinicName}} on {{date}} at {{time}}.\nReference code: {{referenceCode}}\n\nPlease arrive 10 minutes early. If you can't make it, cancel here: {{cancelLink}}\n\n{{clinicName}} · {{clinicPhone}}",
    },
  },
  'appointment.rescheduled': {
    sms: {
      subject: null,
      body: 'Hi {{firstName}}, your appointment at {{clinicName}} is now on {{date}}, {{time}}. Ref {{referenceCode}}. To cancel: {{cancelLink}}',
    },
    email: {
      subject: 'Your appointment was moved ({{referenceCode}})',
      body: 'Hi {{firstName}},\n\nYour appointment at {{clinicName}} is now on {{date}} at {{time}}.\nReference code: {{referenceCode}}\n\nTo cancel: {{cancelLink}}\n\n{{clinicName}} · {{clinicPhone}}',
    },
  },
  'appointment.cancelled': {
    sms: {
      subject: null,
      body: 'Hi {{firstName}}, your {{date}}, {{time}} appointment at {{clinicName}} (ref {{referenceCode}}) is cancelled. Book again: {{bookingLink}}',
    },
    email: {
      subject: 'Appointment cancelled ({{referenceCode}})',
      body: 'Hi {{firstName}},\n\nYour appointment at {{clinicName}} on {{date}} at {{time}} has been cancelled.\n\nYou can book again anytime: {{bookingLink}}\n\n{{clinicName}} · {{clinicPhone}}',
    },
  },
  'appointment.reminder': {
    sms: {
      subject: null,
      body: 'Reminder: {{firstName}}, you have an appointment at {{clinicName}} on {{date}}, {{time}}. Ref {{referenceCode}}. To cancel: {{cancelLink}}',
    },
    email: {
      subject: 'Reminder: {{clinicName}} on {{date}}',
      body: 'Hi {{firstName}},\n\nThis is a reminder of your appointment at {{clinicName}} on {{date}} at {{time}}.\nReference code: {{referenceCode}}\n\nIf you can no longer come, please cancel: {{cancelLink}}\n\n{{clinicName}} · {{clinicPhone}}',
    },
  },
  'visit.finished': {
    sms: {
      subject: null,
      body: 'Thank you for visiting {{clinicName}}, {{firstName}}. Your prescription: {{rxLink}} (enter your birthdate to open).',
    },
    email: {
      subject: 'Your prescription from {{clinicName}}',
      body: 'Hi {{firstName}},\n\nThank you for visiting {{clinicName}}. You can view and download your prescription here: {{rxLink}}\n\nFor your privacy, the page asks for your birthdate. The link works for 14 days.\n\n{{clinicName}} · {{clinicPhone}}',
    },
  },
  'followup.reminder': {
    sms: {
      subject: null,
      body: 'Hi {{firstName}}, {{clinicName}} recommends a follow-up visit on {{date}}. Book here: {{bookingLink}}',
    },
    email: {
      subject: 'Time for your follow-up at {{clinicName}}',
      body: 'Hi {{firstName}},\n\nYour doctor recommended a follow-up visit on {{date}}. You can book a time here: {{bookingLink}}\n\n{{clinicName}} · {{clinicPhone}}',
    },
  },
};

/** Placeholders used in a template that are not allowed (empty when the template is valid). */
export function unknownVariables(text: string): string[] {
  const allowed = new Set<string>(TEMPLATE_VARIABLES);
  return [
    ...new Set(
      [...text.matchAll(PLACEHOLDER)].map((m) => m[1]!).filter((name) => !allowed.has(name)),
    ),
  ];
}

export const usedVariables = (text: string): TemplateVariable[] => [
  ...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] as TemplateVariable)),
];

/** Fills placeholders; missing values render as empty strings. */
export function renderTemplate(text: string, values: TemplateValues): string {
  return text.replace(PLACEHOLDER, (_, name: string) => values[name as TemplateVariable] ?? '');
}

/** GSM-7 messages split at 160 characters (153 per part when longer); others at 70 (67). */
export function smsSegments(text: string): number {
  // eslint-disable-next-line no-control-regex
  const gsm = /^[\x0A\x0D\x20-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€]*$/.test(text);
  const [single, multi] = gsm ? [160, 153] : [70, 67];
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
}
