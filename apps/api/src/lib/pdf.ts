import PDFDocument from 'pdfkit';

/** A5 slips (prescriptions, lab requests) share the letterhead, patient block and signature. */
export const A5: [number, number] = [419.53, 595.28];
export const A5_MARGIN = 32;
const WIDTH = A5[0] - A5_MARGIN * 2;

export interface SlipDoctor {
  name: string;
  specialty: string | null;
  prcNo: string;
  ptrNo: string | null;
  s2No?: string | null;
}

export interface SlipData {
  clinic: { name: string; address: string | null; contactNumber: string | null };
  doctor: SlipDoctor;
  patient: { name: string; age: number | null; sex: string | null; address: string | null };
  date: string;
  /** Optional images (PNG/JPEG bytes). */
  logo?: Buffer | null;
  signature?: Buffer | null;
}

/** Starts an uncompressed document (small files; the text stays verifiable in tests). */
export function startPdf(title: string, producer: string, size: [number, number], margin: number) {
  const doc = new PDFDocument({
    size,
    margin,
    compress: false,
    info: { Title: title, Producer: producer },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  return { doc, done };
}

export function slipRule(doc: PDFKit.PDFDocument) {
  doc.moveDown(0.4);
  doc
    .moveTo(A5_MARGIN, doc.y)
    .lineTo(A5[0] - A5_MARGIN, doc.y)
    .lineWidth(0.7)
    .stroke('#444444');
  doc.moveDown(0.6);
}

/** Doctor, then clinic. The logo sits at the top left without shifting the centered text. */
export function slipHeader(doc: PDFKit.PDFDocument, data: SlipData) {
  if (data.logo) doc.image(data.logo, A5_MARGIN, A5_MARGIN - 4, { fit: [44, 44] });
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor('#111111')
    .text(data.doctor.name, { align: 'center', width: WIDTH });
  if (data.doctor.specialty)
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(data.doctor.specialty, { align: 'center', width: WIDTH });
  doc.moveDown(0.3);
  doc
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .text(data.clinic.name, { align: 'center', width: WIDTH });
  doc.font('Helvetica').fontSize(8.5);
  if (data.clinic.address) doc.text(data.clinic.address, { align: 'center', width: WIDTH });
  if (data.clinic.contactNumber)
    doc.text(`Tel./Mobile: ${data.clinic.contactNumber}`, { align: 'center', width: WIDTH });
  slipRule(doc);

  const label = (text: string) =>
    doc.font('Helvetica-Bold').fontSize(9).text(text, { continued: true });
  const value = (text: string) => doc.font('Helvetica').fontSize(9).text(text);
  label('Patient: ');
  value(data.patient.name);
  label('Age/Sex: ');
  value(
    [data.patient.age !== null ? `${data.patient.age}` : '—', data.patient.sex ?? '—'].join(' / '),
  );
  label('Address: ');
  value(data.patient.address ?? '—');
  label('Date: ');
  value(data.date);
  slipRule(doc);
}

/** Signature line and credentials, pinned to the bottom of the page. */
export function slipSignature(doc: PDFKit.PDFDocument, data: SlipData) {
  const footerTop = A5[1] - A5_MARGIN - 70;
  if (doc.y > footerTop - 10) doc.addPage();
  const x = A5[0] - A5_MARGIN - 170;
  if (data.signature)
    doc.image(data.signature, x + 25, footerTop - 36, {
      fit: [120, 46],
      align: 'center',
      valign: 'bottom',
    });
  doc
    .moveTo(x, footerTop + 12)
    .lineTo(A5[0] - A5_MARGIN, footerTop + 12)
    .lineWidth(0.5)
    .stroke('#444444');
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(data.doctor.name, x, footerTop + 16, { width: 170, align: 'center' });
  doc.font('Helvetica').fontSize(8);
  const creds = [
    `PRC Lic. No. ${data.doctor.prcNo}`,
    data.doctor.ptrNo && `PTR No. ${data.doctor.ptrNo}`,
    data.doctor.s2No && `S2 No. ${data.doctor.s2No}`,
  ];
  for (const c of creds.filter(Boolean))
    doc.text(c as string, x, doc.y, { width: 170, align: 'center' });
}
