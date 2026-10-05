import { describe, expect, it } from 'vitest';
import { connectionOptions } from '../src/db/connect';

describe('database connection strings', () => {
  it('passes ordinary TCP URLs through', () => {
    expect(connectionOptions('postgres://u:p@db.internal:5432/clinic')).toEqual({
      url: 'postgres://u:p@db.internal:5432/clinic',
    });
  });

  it('turns ?host=/cloudsql/... into a unix socket path (Cloud SQL on Cloud Run)', () => {
    expect(
      connectionOptions('postgres://u:p@localhost/clinic?host=/cloudsql/proj:asia-southeast1:db'),
    ).toEqual({
      url: 'postgres://u:p@localhost/clinic',
      path: '/cloudsql/proj:asia-southeast1:db/.s.PGSQL.5432',
    });
  });
});
