import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app';
import { appointments, patients } from '../src/db/schema';
import { referenceCode } from '../src/lib/reference';
import {
  createClinicFixture,
  owner,
  signIn,
  startApp,
  type ClinicFixture,
  type SignedIn,
} from './helpers';

/** A valid 1×1 PNG. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const NOT_PNG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');

let app: App;
let clinic: ClinicFixture;
let admin: SignedIn;

beforeAll(async () => {
  app = await startApp();
  clinic = await createClinicFixture('profile');
  admin = await signIn(app, clinic.emails.doctor);
});
afterAll(() => app.close());

describe('clinic profile', () => {
  it('is readable by staff and editable by admins only', async () => {
    const secretary = await signIn(app, clinic.emails.secretary);
    expect((await secretary.agent.get('/api/clinic')).body).toMatchObject({
      slug: clinic.slug,
      hasLogo: false,
    });
    const denied = await secretary.agent
      .put('/api/clinic')
      .set('x-csrf-token', secretary.csrf)
      .send({ name: 'Nope' });
    expect(denied.status).toBe(403);

    const res = await admin.agent.put('/api/clinic').set('x-csrf-token', admin.csrf).send({
      name: 'Renamed Clinic',
      address: '1 Main St.',
      contactNumber: '0917 222 3333',
      email: 'desk@example.com',
      smsSenderName: 'RENAMED',
    });
    expect(res.body).toMatchObject({
      name: 'Renamed Clinic',
      contactNumber: '+639172223333',
      smsSenderName: 'RENAMED',
    });

    const landline = await admin.agent
      .put('/api/clinic')
      .set('x-csrf-token', admin.csrf)
      .send({ name: 'Renamed Clinic', contactNumber: '(046) 123 4567' });
    expect(landline.body.contactNumber).toBe('(046) 123 4567');
    const bad = await admin.agent
      .put('/api/clinic')
      .set('x-csrf-token', admin.csrf)
      .send({ name: 'X Clinic', smsSenderName: 'WAY-TOO-LONG-NAME' });
    expect(bad.status).toBe(400);
  });

  it('serves an uploaded logo publicly, and only real images are accepted', async () => {
    const fake = await admin.agent
      .put('/api/clinic/logo')
      .set('x-csrf-token', admin.csrf)
      .send({ contentType: 'image/png', data: NOT_PNG });
    expect(fake.status).toBe(400);

    const ok = await admin.agent
      .put('/api/clinic/logo')
      .set('x-csrf-token', admin.csrf)
      .send({ contentType: 'image/png', data: PNG });
    expect(ok.body.hasLogo).toBe(true);
    const pub = await request(app.server).get(`/api/public/clinics/${clinic.slug}`);
    expect(pub.body.logoUrl).toBe(`/api/public/clinics/${clinic.slug}/logo`);
    const logo = await request(app.server).get(pub.body.logoUrl);
    expect(logo.status).toBe(200);
    expect(logo.headers['content-type']).toBe('image/png');
    expect(logo.headers['cache-control']).toBe('public, max-age=3600');
  });
});

describe('doctor signature', () => {
  it('is printed on prescriptions together with the logo', async () => {
    const sig = await admin.agent
      .put(`/api/doctors/${clinic.userIds.doctor}/signature`)
      .set('x-csrf-token', admin.csrf)
      .send({ contentType: 'image/png', data: PNG });
    expect(sig.body.hasSignature).toBe(true);

    const [patient] = await owner.db
      .insert(patients)
      .values({
        clinicId: clinic.clinicId,
        firstName: 'Sig',
        lastName: 'Test',
        mobile: '+639170005555',
      })
      .returning();
    const startAt = new Date(Date.now() - 10 * 60_000);
    const [appt] = await owner.db
      .insert(appointments)
      .values({
        clinicId: clinic.clinicId,
        doctorId: clinic.userIds.doctor,
        patientId: patient!.id,
        startAt,
        endAt: new Date(startAt.getTime() + 15 * 60_000),
        type: 'walk_in',
        status: 'in_consult',
        referenceCode: referenceCode(),
      })
      .returning();
    const finish = await admin.agent
      .post(`/api/consult/${appt!.id}/finish`)
      .set('x-csrf-token', admin.csrf)
      .send({
        soap: {},
        rx: { items: [{ genericName: 'Cetirizine', sig: '1 tab at bedtime', quantity: '7' }] },
      });
    const pdf = await admin.agent
      .get(`/api/prescriptions/${finish.body.prescription.id}/pdf`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect((pdf.body as Buffer).toString('latin1').match(/\/Subtype \/Image/g)).toHaveLength(2);
  });

  it('cannot be changed from another clinic', async () => {
    const other = await createClinicFixture('profile-other');
    const otherAdmin = await signIn(app, other.emails.doctor);
    const res = await otherAdmin.agent
      .put(`/api/doctors/${clinic.userIds.doctor}/signature`)
      .set('x-csrf-token', otherAdmin.csrf)
      .send({ contentType: 'image/png', data: PNG });
    expect(res.status).toBe(404);
  });
});
