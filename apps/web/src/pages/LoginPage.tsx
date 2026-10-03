import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { loginSchema, type LoginInput, type SessionResponse } from '@clinic/shared';
import { FormField } from '@/components/FormField';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { applySession, useSession } from '@/auth/session';
import { homePathFor } from '@/layouts/nav';
import { t } from '@/i18n';
import { api, errorMessage } from '@/lib/api';

export function LoginPage() {
  const { user, clinics, activeClinic } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const login = useMutation({
    mutationFn: (input: LoginInput) =>
      api<SessionResponse>('/auth/login', { method: 'POST', body: input }),
    onSuccess: (session) => {
      applySession(queryClient, session);
      const from = (location.state as { from?: string } | null)?.from;
      const home = homePathFor(session);
      navigate(from && from !== '/login' && session.activeClinic ? from : home, { replace: true });
    },
  });

  if (user) return <Navigate to={homePathFor({ user, clinics, activeClinic })} replace />;
  const { errors } = form.formState;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t.login.title}</CardTitle>
          <CardDescription>{t.login.subtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => login.mutate(values))}
            noValidate
          >
            {login.isError && (
              <Alert variant="destructive">
                {errorMessage(login.error, t.common.genericError)}
              </Alert>
            )}
            <FormField id="email" label={t.login.email} error={errors.email?.message}>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                autoFocus
                aria-invalid={!!errors.email}
                {...form.register('email')}
              />
            </FormField>
            <FormField id="password" label={t.login.password} error={errors.password?.message}>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!errors.password}
                {...form.register('password')}
              />
            </FormField>
            <Button type="submit" className="w-full" disabled={login.isPending}>
              {login.isPending ? t.login.submitting : t.login.submit}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
