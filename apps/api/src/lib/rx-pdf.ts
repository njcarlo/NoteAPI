import PDFDocument from 'pdfkit';

export interface RxPdfData {
  clinic: { name: string; address: string | null; contactNumber: string | null };
  doctor: {
    name: string;
    specialty: string | null;
    prcNo: string;
    ptrNo: string | null;
    s2No: string | null;
  };
  patient: { name: string; age: number | null; sex: string | null; address: string | null };
  date: string;
  items: {
    genericName: string;
    brandName: string | null;
    strength: string | null;
    form: string | null;
    sig: string;
    quantity: string;
  }[];
  notes: string | null;
  /** Optional images (PNG/JPEG bytes). */
  logo?: Buffer | null;
  signature?: Buffer | null;
}

const A5: [number, number] = [419.53, 595.28];
const MARGIN = 32;

/** Renders an A5 prescription. Generic names lead (Generics Act); brands follow in parentheses. */
export function renderPrescriptionPdf(data: RxPdfData): Promise<Buffer> {
  // Uncompressed: prescriptions are tiny, and the text stays verifiable in tests.
  const doc = new PDFDocument({
    size: A5,
    margin: MARGIN,
    compress: false,
    info: { Title: 'Prescription', Producer: data.clinic.name },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = A5[0] - MARGIN * 2;
  const line = () => {
    doc.moveDown(0.4);
    doc
      .moveTo(MARGIN, doc.y)
      .lineTo(A5[0] - MARGIN, doc.y)
      .lineWidth(0.7)
      .stroke('#444444');
    doc.moveDown(0.6);
  };

  // Header: doctor, then clinic. The logo sits at the top left without shifting the centered text.
  if (data.logo) doc.image(data.logo, MARGIN, MARGIN - 4, { fit: [44, 44] });
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor('#111111')
    .text(data.doctor.name, { align: 'center', width });
  if (data.doctor.specialty)
    doc.font('Helvetica').fontSize(9).text(data.doctor.specialty, { align: 'center', width });
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(9.5).text(data.clinic.name, { align: 'center', width });
  doc.font('Helvetica').fontSize(8.5);
  if (data.clinic.address) doc.text(data.clinic.address, { align: 'center', width });
  if (data.clinic.contactNumber)
    doc.text(`Tel./Mobile: ${data.clinic.contactNumber}`, { align: 'center', width });
  line();

  // Patient block.
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
  line();

  // Rx.
  doc.font('Helvetica-Bold').fontSize(22).text('Rx', MARGIN, doc.y);
  doc.moveDown(0.3);
  data.items.forEach((item, index) => {
    const name = [
      `${index + 1}. ${item.genericName}`,
      item.brandName ? `(${item.brandName})` : null,
      item.strength,
      item.form,
    ]
      .filter(Boolean)
      .join(' ');
    const top = doc.y;
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .text(name, MARGIN, top, { width: width - 50 });
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .text(`#${item.quantity}`, MARGIN + width - 45, top, { width: 45, align: 'right' });
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .text(`Sig: ${item.sig}`, MARGIN + 14, doc.y, { width: width - 14 });
    doc.moveDown(0.6);
  });
  if (data.notes) {
    doc.moveDown(0.2);
    doc.font('Helvetica-Oblique').fontSize(9).text(data.notes, MARGIN, doc.y, { width });
  }

  // Signature block, pinned to the bottom of the page.
  const footerTop = A5[1] - MARGIN - 70;
  if (doc.y > footerTop - 10) doc.addPage();
  const x = A5[0] - MARGIN - 170;
  if (data.signature)
    doc.image(data.signature, x + 25, footerTop - 36, {
      fit: [120, 46],
      align: 'center',
      valign: 'bottom',
    });
  doc
    .moveTo(x, footerTop + 12)
    .lineTo(A5[0] - MARGIN, footerTop + 12)
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

  doc.end();
  return done;
}
