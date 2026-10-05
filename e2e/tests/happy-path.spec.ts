import { expect, test, type Browser, type Page } from '@playwright/test';

const PATIENT = {
  first: 'Elena',
  last: 'Endtoend',
  birthdate: '1984-06-15',
  mobile: '09175550123',
};

async function signIn(browser: Browser, email: string, password: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  return page;
}

test('book online → check in → consult → prescription', async ({ browser }) => {
  // 1. The patient books on their phone.
  const phone = await (
    await browser.newContext({ ...{ viewport: { width: 390, height: 844 } } })
  ).newPage();
  await phone.goto('/c/sample-family-clinic');
  await phone.getByRole('button', { name: /Maria Demo Santos/ }).click();
  await phone.locator('button:has-text(" open"):not([disabled])').first().click();
  await phone.locator('.grid button.tabular-nums').first().click();
  await phone.getByLabel('First name').fill(PATIENT.first);
  await phone.getByLabel('Last name').fill(PATIENT.last);
  await phone.getByLabel('Birthdate').fill(PATIENT.birthdate);
  await phone.getByLabel('Mobile number').fill(PATIENT.mobile);
  await phone.getByLabel('Reason for visit (optional)').fill('Sore throat');
  await phone.getByRole('checkbox', { name: /privacy notice/ }).check();
  await phone.getByRole('button', { name: 'Book appointment' }).click();
  const reference = (await phone.getByTestId('reference-code').textContent())!.trim();
  expect(reference).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{4}$/);

  // 2. The secretary checks the patient in with vitals.
  const desk = await signIn(browser, 'secretary@sample.clinic', 'DemoSecretary#2026');
  await desk.waitForURL('**/today');
  const row = desk
    .locator('div', { hasText: `${PATIENT.last}, ${PATIENT.first}` })
    .filter({ hasText: reference })
    .last();
  await row.getByRole('button', { name: 'Check in' }).click();
  await desk.getByLabel('Systolic').fill('118');
  await desk.getByLabel('Diastolic').fill('76');
  await desk.getByLabel('Temp (°C)').fill('37.8');
  await desk.locator('form').getByRole('button', { name: 'Check in' }).click();
  await expect(desk.getByText(/Checked in\. Queue number #\d+/)).toBeVisible();

  // 3. The doctor calls the patient, writes notes and a prescription, and finishes the visit.
  const doctor = await signIn(browser, 'doctor@sample.clinic', 'DemoDoctor#2026');
  await doctor.waitForURL('**/select-clinic');
  await doctor
    .locator('main')
    .getByRole('button', { name: /Sample Family Clinic/ })
    .click();
  await doctor.waitForURL('**/queue');
  const queueRow = doctor.locator('tbody tr', { hasText: `${PATIENT.last}, ${PATIENT.first}` });
  await expect(queueRow).toContainText('BP 118/76');
  await queueRow.getByRole('button', { name: 'Call' }).click();
  await doctor.waitForURL('**/consult/**');
  await doctor
    .getByPlaceholder('Complaints, history, symptoms')
    .fill('Sore throat for 2 days, no cough.');
  await doctor.getByPlaceholder('Exam findings').fill('Inflamed tonsils with exudates.');
  await doctor.getByPlaceholder('Diagnosis or impression').fill('Acute tonsillopharyngitis');
  await doctor
    .getByPlaceholder('Treatment, advice, labs')
    .fill('Antibiotics, warm saline gargles.');
  const search = doctor.getByRole('combobox', { name: 'Search generic or brand name' });
  await search.fill('amoxicillin');
  await expect(doctor.getByRole('option', { name: /Amoxicillin \(Amoxil\)/ })).toBeVisible();
  await search.press('Enter');
  await doctor
    .getByLabel('Sig (dose, frequency, duration)')
    .fill('1 capsule 3 times a day for 7 days');
  await doctor.getByLabel('Qty').fill('21');
  await doctor.getByRole('button', { name: 'Finish visit' }).click();
  await expect(doctor.getByText(/Finished/)).toBeVisible();

  // 4. The prescription PDF and a share link the patient can open with their birthdate.
  const pdfHref = await doctor
    .getByRole('link', { name: 'Open prescription PDF' })
    .getAttribute('href');
  const pdf = await doctor.request.get(pdfHref!);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');

  await doctor.getByRole('button', { name: 'Create share link' }).click();
  const shareUrl = await doctor.locator('input[readonly]').inputValue();
  await phone.goto(shareUrl);
  await phone.locator('input[type=date]').fill(PATIENT.birthdate);
  await phone.getByRole('button', { name: 'View prescription' }).click();
  await expect(phone.getByRole('link', { name: 'Download PDF' })).toBeVisible();

  // 5. The visit is done everywhere.
  await desk.reload();
  await expect(desk.locator('section', { hasText: 'Done' })).toContainText(
    `${PATIENT.last}, ${PATIENT.first}`,
  );
});
