import { useEffect, useState, type ReactNode } from 'react';
import { BACKEND, currentAccount, signIn } from '../store/server';

/** In server mode, shows the app only to a signed-in account; otherwise renders it straight away. */
export function AccountGate({ onSignedIn, children }: { onSignedIn: () => void; children: ReactNode }) {
  const [account, setAccount] = useState<string | null | undefined>(BACKEND ? undefined : '');
  useEffect(() => {
    if (BACKEND) void currentAccount().then(setAccount);
  }, []);
  useEffect(() => {
    if (BACKEND && account) onSignedIn();
  }, [account, onSignedIn]);

  if (account === undefined) return null;
  if (account === null) return <LoginForm onSignedIn={setAccount} />;
  return <>{children}</>;
}

function LoginForm({ onSignedIn }: { onSignedIn: (email: string) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(mode, email, password);
      onSignedIn(email.trim().toLowerCase());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <form className="login" onSubmit={(e) => void submit(e)} data-testid="login-form">
      <h1>Living Writing</h1>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus data-testid="login-email" />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required data-testid="login-password" />
      </label>
      {error && <div className="login-error" role="alert" data-testid="login-error">{error}</div>}
      <button className="btn" type="submit" disabled={busy} data-testid="login-submit">
        {mode === 'login' ? 'Log in' : 'Create account'}
      </button>
      <button className="btn btn-sm" type="button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')} data-testid="login-switch">
        {mode === 'login' ? 'New here? Create an account' : 'Have an account? Log in'}
      </button>
    </form>
  );
}
