import PDFDocument from 'pdfkit';
import type { ReferralUrgency } from '@clinic/shared';

export interface ReferralPdfData {
  clinic: { name: string; address: string | null; contactNumber: string | null };
  doctor: { name: string; specialty: string | null; prcNo: string; ptrNo: string | null };
  /** Addressee: a named doctor and/or facility, always with the specialty. */
  to: { doctor: string | null; facility: string | null; specialty: string };
  patient: { name: string; age: number | null; sex: string | null; allergies: string | null };
  date: string;
  urgency: ReferralUrgency;
  reason: string;
  clinicalSummary: string | null;
  medicines: string[];
  logo?: Buffer | null;
  signature?: Buffer | null;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;

const URGENCY_LABEL: Record<ReferralUrgency, string> = {
  routine: 'Routine',
  urgent: 'URGENT',
  emergency: 'EMERGENCY — please see immediately',
};

/** Renders an A4 referral letter from the referring doctor to a specialist. */
export function renderReferralPdf(data: ReferralPdfData): Promise<Buffer> {
  // Uncompressed like prescriptions: small files, and the text stays verifiable in tests.
  const doc = new PDFDocument({
    size: A4,
    margin: MARGIN,
    compress: false,
    info: { Title: 'Referral', Producer: data.clinic.name },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = A4[0] - MARGIN * 2;
  const rule = () => {
    doc.moveDown(0.5);
    doc
      .moveTo(MARGIN, doc.y)
      .lineTo(A4[0] - MARGIN, doc.y)
      .lineWidth(0.7)
      .stroke('#444444');
    doc.moveDown(0.8);
  };

  // Letterhead.
  if (data.logo) doc.image(data.logo, MARGIN, MARGIN - 6, { fit: [56, 56] });
  doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .fillColor('#111111')
    .text(data.clinic.name, { align: 'center', width });
  doc.font('Helvetica').fontSize(9.5);
  if (data.clinic.address) doc.text(data.clinic.address, { align: 'center', width });
  if (data.clinic.contactNumber)
    doc.text(`Tel./Mobile: ${data.clinic.contactNumber}`, { align: 'center', width });
  rule();

  doc.font('Helvetica-Bold').fontSize(13).text('REFERRAL', { align: 'center', width });
  doc.moveDown(0.8);
  doc.font('Helvetica').fontSize(10.5).text(data.date, { align: 'right', width });
  doc.moveDown(0.6);

  // Addressee.
  doc.font('Helvetica-Bold').text('To:');
  doc.font('Helvetica');
  if (data.to.doctor) doc.text(data.to.doctor);
  doc.text(data.to.doctor ? data.to.specialty : `The attending ${data.to.specialty} specialist`);
  if (data.to.facility) doc.text(data.to.facility);
  doc.moveDown(0.8);

  const field = (label: string, value: string) => {
    doc.font('Helvetica-Bold').fontSize(10.5).text(`${label}: `, { continued: true });
    doc.font('Helvetica').text(value);
  };
  field('Patient', data.patient.name);
  field(
    'Age/Sex',
    [data.patient.age !== null ? `${data.patient.age}` : '—', data.patient.sex ?? '—'].join(' / '),
  );
  field('Allergies', data.patient.allergies ?? 'None known');
  field('Urgency', URGENCY_LABEL[data.urgency]);
  doc.moveDown(0.8);

  doc.font('Helvetica').fontSize(10.5).text('Dear Doctor,');
  doc.moveDown(0.5);
  doc.text(
    `Respectfully referring the above patient to your ${data.to.specialty} service for evaluation and management.`,
    { width },
  );
  doc.moveDown(0.8);

  const section = (title: string, body: string) => {
    doc.font('Helvetica-Bold').fontSize(10.5).text(title);
    doc.font('Helvetica').fontSize(10.5).text(body, { width });
    doc.moveDown(0.7);
  };
  section('Reason for referral', data.reason);
  if (data.clinicalSummary) section('Clinical summary', data.clinicalSummary);
  if (data.medicines.length) section('Current medications', data.medicines.join('\n'));
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10.5).text('Thank you very much.', { width });

  // Signature block, pinned near the bottom.
  const footerTop = A4[1] - MARGIN - 80;
  if (doc.y > footerTop - 50) doc.addPage();
  const x = A4[0] - MARGIN - 200;
  if (data.signature)
    doc.image(data.signature, x + 40, footerTop - 40, {
      fit: [120, 50],
      align: 'center',
      valign: 'bottom',
    });
  doc
    .moveTo(x, footerTop + 14)
    .lineTo(A4[0] - MARGIN, footerTop + 14)
    .lineWidth(0.5)
    .stroke('#444444');
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(data.doctor.name, x, footerTop + 18, { width: 200, align: 'center' });
  doc.font('Helvetica').fontSize(9);
  const lines = [
    data.doctor.specialty,
    `PRC Lic. No. ${data.doctor.prcNo}`,
    data.doctor.ptrNo && `PTR No. ${data.doctor.ptrNo}`,
  ];
  for (const text of lines.filter(Boolean))
    doc.text(text as string, x, doc.y, { width: 200, align: 'center' });

  doc.end();
  return done;
}
