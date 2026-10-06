import { A5, A5_MARGIN, slipHeader, slipSignature, startPdf, type SlipData } from './pdf';

export interface RxPdfData extends SlipData {
  items: {
    genericName: string;
    brandName: string | null;
    strength: string | null;
    form: string | null;
    sig: string;
    quantity: string;
  }[];
  notes: string | null;
}

/** Renders an A5 prescription. Generic names lead (Generics Act); brands follow in parentheses. */
export function renderPrescriptionPdf(data: RxPdfData): Promise<Buffer> {
  const { doc, done } = startPdf('Prescription', data.clinic.name, A5, A5_MARGIN);
  const width = A5[0] - A5_MARGIN * 2;
  slipHeader(doc, data);

  doc.font('Helvetica-Bold').fontSize(22).text('Rx', A5_MARGIN, doc.y);
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
      .text(name, A5_MARGIN, top, { width: width - 50 });
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .text(`#${item.quantity}`, A5_MARGIN + width - 45, top, { width: 45, align: 'right' });
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .text(`Sig: ${item.sig}`, A5_MARGIN + 14, doc.y, { width: width - 14 });
    doc.moveDown(0.6);
  });
  if (data.notes) {
    doc.moveDown(0.2);
    doc.font('Helvetica-Oblique').fontSize(9).text(data.notes, A5_MARGIN, doc.y, { width });
  }

  slipSignature(doc, data);
  doc.end();
  return done;
}
