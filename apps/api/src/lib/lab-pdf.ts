import { A5, A5_MARGIN, slipHeader, slipSignature, startPdf, type SlipData } from './pdf';

export interface LabPdfData extends SlipData {
  facility: string | null;
  tests: string[];
  fasting: boolean;
  clinicalImpression: string | null;
  notes: string | null;
}

/** Renders an A5 laboratory request slip the patient brings to the laboratory. */
export function renderLabRequestPdf(data: LabPdfData): Promise<Buffer> {
  const { doc, done } = startPdf('Laboratory request', data.clinic.name, A5, A5_MARGIN);
  const width = A5[0] - A5_MARGIN * 2;
  slipHeader(doc, data);

  doc.font('Helvetica-Bold').fontSize(13).text('LABORATORY REQUEST', A5_MARGIN, doc.y, {
    width,
    align: 'center',
  });
  doc.moveDown(0.4);
  if (data.facility) {
    doc.font('Helvetica-Bold').fontSize(9).text('To: ', { continued: true });
    doc.font('Helvetica').text(data.facility);
    doc.moveDown(0.3);
  }

  doc.font('Helvetica').fontSize(10);
  data.tests.forEach((test) => {
    const top = doc.y;
    doc
      .rect(A5_MARGIN + 2, top + 1, 8, 8)
      .lineWidth(0.7)
      .stroke('#444444');
    doc.text(test, A5_MARGIN + 16, top, { width: width - 16 });
    doc.moveDown(0.25);
  });
  doc.moveDown(0.4);

  const field = (label: string, value: string) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(`${label}: `, A5_MARGIN, doc.y, { continued: true });
    doc.font('Helvetica').text(value, { width });
  };
  if (data.clinicalImpression) field('Clinical impression', data.clinicalImpression);
  if (data.fasting) field('Preparation', 'Fast for 8–10 hours before the test (water is allowed).');
  if (data.notes) field('Notes', data.notes);

  slipSignature(doc, data);
  doc.end();
  return done;
}
