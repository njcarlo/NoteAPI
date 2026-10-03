-- Runs once when the docker Postgres volume is first created.
-- clinic_app is the least-privileged role the API and worker connect as (subject to RLS).
CREATE ROLE clinic_app LOGIN PASSWORD 'clinic_app';
CREATE DATABASE clinic_test OWNER clinic;
