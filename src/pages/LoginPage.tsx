import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { Eye, EyeOff } from 'lucide-react';
import { auth } from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';

function mapAuthError(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Invalid email or password.';
    case 'auth/network-request-failed':
      return 'Could not reach server. Check your connection.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Try again later.';
    default:
      return 'Sign in failed. Try again.';
  }
}

export function LoginPage() {
  const navigate = useNavigate();
  const { currentUser, authError, setAuthError } = useAuthStore();

  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [loading, setLoading]         = useState(false);
  const [resetting, setResetting]     = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const { showToast, ToastComponent } = useToast();

  // Already authenticated — redirect in effect, not during render
  useEffect(() => {
    if (currentUser) {
      navigate('/dashboard', { replace: true });
    }
  }, [currentUser, navigate]);

  // Don't render the form while redirecting
  if (currentUser) return null;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      setError(mapAuthError(code));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setError('Enter your email address first.');
      return;
    }

    setResetting(true);

    try {
      await sendPasswordResetEmail(auth, email.toLowerCase().trim());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      // Swallow all errors — including user-not-found — so the UI never
      // reveals whether an email address is registered (anti-enumeration).
      console.warn('[ForgotPassword] attempt:', err.code);
    } finally {
      setResetting(false);
    }

    // Always show the same message regardless of outcome.
    showToast(
      'If this email is registered, you will receive a reset link shortly. Check your spam folder.',
      'success',
    );
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-brand-background px-4">
      {ToastComponent}

      <div className="mb-8 text-center">
        {/* Styled logo text */}
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-brand-blue mb-4">
          <span className="text-2xl font-extrabold text-white leading-none">RS</span>
        </div>
        <h1 className="text-3xl font-extrabold text-brand-navy leading-tight">
          FieldOps
        </h1>
        <p className="text-sm text-gray-500 mt-1">Rite Solar</p>
      </div>

      <Card className="w-full max-w-sm shadow-md">
        <CardContent className="pt-6">
          <form onSubmit={handleSignIn} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@ritesolar.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setAuthError(null); }}
                required
                autoComplete="email"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setAuthError(null); }}
                  required
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(prev => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {(error || authError) && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red border border-red-200">
                {error || authError}
              </p>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Signing in…
                </span>
              ) : (
                'Sign In'
              )}
            </Button>

            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={resetting}
              className="text-center text-sm text-brand-blue hover:underline disabled:opacity-50"
            >
              {resetting ? 'Sending…' : 'Forgot password?'}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
