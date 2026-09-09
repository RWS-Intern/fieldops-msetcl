import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
} from 'firebase/firestore';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth, db } from '@/firebase/config';
import { Button } from '@/components/ui/button';
import { Input }  from '@/components/ui/input';
import { Label }  from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

type PageState  = 'loading' | 'invalid' | 'expired' | 'already_used' | 'ready' | 'success';
type ErrorType  = 'generic' | 'existing_account' | 'partial_account' | null;

export function SignupPage() {
  const { inviteId } = useParams<{ inviteId: string }>();
  const navigate     = useNavigate();

  const [pageState, setPageState] = useState<PageState>('loading');

  // Invite metadata (populated once loaded)
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole,  setInviteRole]  = useState('');

  // Form fields
  const [name,            setName]            = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting,      setSubmitting]      = useState(false);
  const [error,           setError]           = useState<string | null>(null);
  const [errorType,       setErrorType]       = useState<ErrorType>(null);

  // ── Load and validate invite ────────────────────────────────────────────────
  useEffect(() => {
    if (!inviteId) { setPageState('invalid'); return; }

    async function loadInvite() {
      try {
        const snap = await getDoc(doc(db, 'invites', inviteId!));
        if (!snap.exists()) { setPageState('invalid'); return; }

        const data = snap.data();
        const status    = data['status']    as string;
        const expiresAt = data['expiresAt']?.toDate?.() as Date | undefined;

        if (status === 'accepted' || status === 'revoked') {
          setPageState('already_used');
          return;
        }
        if (expiresAt && expiresAt < new Date()) {
          setPageState('expired');
          return;
        }

        setInviteEmail(data['email'] ?? '');
        setInviteRole(data['role']   ?? 'field');
        setName(data['name'] ?? '');   // pre-fill name (editable)
        setPageState('ready');
      } catch {
        setPageState('invalid');
      }
    }

    loadInvite();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteId]);

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    console.log('[Signup] handleSubmit CALLED', new Date().toISOString());
    try {
      e.preventDefault();
      setError(null);
      setErrorType(null);

      if (!name.trim()) { setError('Name is required.'); return; }
      if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
      if (password !== confirmPassword) { setError('Passwords do not match.'); return; }

      setSubmitting(true);
      try {
        // Part C — Pre-check: does a complete Firestore user doc already exist?
        const existingSnap = await getDocs(
          query(collection(db, 'users'), where('email', '==', inviteEmail))
        );
        if (!existingSnap.empty) {
          setError('An account with this email already exists. Please sign in instead.');
          setErrorType('existing_account');
          return;
        }

        // 1. Create Firebase Auth account
        const cred = await createUserWithEmailAndPassword(auth, inviteEmail, password);
        const uid  = cred.user.uid;

        // 2. Write user document (local cache makes it immediately visible)
        console.log('[Signup] Writing user doc:', {
          uid,
          name:   name.trim(),
          email:  inviteEmail,
          role:   inviteRole,
          active: true,
        });
        try {
          await setDoc(doc(db, 'users', uid), {
            name:      name.trim(),
            email:     inviteEmail,
            role:      inviteRole,
            active:    true,
            createdAt: serverTimestamp(),
            createdBy: inviteId,
            deletedAt: null,
          });
        } catch (firestoreErr) {
          console.error('[Signup] Firestore write failed:', firestoreErr);
          throw firestoreErr;
        }

        // 3. Mark invite as accepted
        await updateDoc(doc(db, 'invites', inviteId!), {
          status:     'accepted',
          acceptedAt: serverTimestamp(),
        });

        // 4. Navigate into the app (useAuth will pick up the new session)
        navigate('/dashboard', { replace: true });
      } catch (err: unknown) {
        const code = (err as { code?: string }).code ?? '';

        if (code === 'auth/email-already-in-use') {
          // Parts A + B — Auth account exists; check if Firestore doc is also there.
          try {
            const dupSnap = await getDocs(
              query(collection(db, 'users'), where('email', '==', inviteEmail))
            );
            if (!dupSnap.empty) {
              // Complete account — user can just sign in.
              setError(
                'An account with this email already exists. This may happen if you tried signing up before. Please sign in with your email and password instead.'
              );
              setErrorType('existing_account');
            } else {
              // Auth account exists but no Firestore doc — previous signup was incomplete.
              setError(
                'An account was partially created with this email. Please contact your administrator to reset it.'
              );
              setErrorType('partial_account');
            }
          } catch {
            setError('An account with this email already exists. Try signing in instead.');
            setErrorType('existing_account');
          }
        } else if (code === 'auth/weak-password') {
          setError('Password must be at least 6 characters.');
        } else if (code === 'auth/network-request-failed') {
          setError('No network connection. Check your internet and try again.');
        } else {
          setError('Sign up failed. Please try again.');
        }
      } finally {
        setSubmitting(false);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error('[Signup] Full error:', {
        code:    err?.code,
        message: err?.message,
        stack:   err?.stack,
      });
      setError('Signup failed. Please try again.');
      setSubmitting(false);
    }
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  if (pageState === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-brand-background">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-blue border-t-transparent" />
      </div>
    );
  }

  if (pageState === 'invalid' || pageState === 'expired' || pageState === 'already_used') {
    const messages: Record<string, { title: string; body: string }> = {
      invalid:      { title: 'Invalid invite',    body: 'This invite link does not exist or has been removed.' },
      expired:      { title: 'Invite expired',    body: 'This invite link has expired. Ask your admin to send a new one.' },
      already_used: { title: 'Already accepted',  body: 'This invite has already been used. Try signing in instead.' },
    };
    const msg = messages[pageState];
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-brand-background px-4">
        <div className="mb-8 text-center">
          <img
            src="/rite-water-logo.png"
            alt="Rite Water Solutions"
            className="h-16 w-auto mx-auto mb-4"
          />
          <h1 className="text-3xl font-extrabold text-brand-navy leading-tight">FieldOps</h1>
          <p className="text-sm text-gray-500 mt-1">MSETCL Substation · by Rite Water Solutions</p>
        </div>
        <Card className="w-full max-w-sm shadow-md">
          <CardContent className="pt-6 text-center flex flex-col gap-3">
            <p className="text-lg font-bold text-gray-800">{msg.title}</p>
            <p className="text-sm text-gray-500">{msg.body}</p>
            <Button variant="outline" onClick={() => navigate('/login', { replace: true })}>
              Go to Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // pageState === 'ready'
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-brand-background px-4">
      {/* Logo */}
      <div className="mb-8 text-center">
        <img
          src="/rite-water-logo.png"
          alt="Rite Water Solutions"
          className="h-16 w-auto mx-auto mb-4"
        />
        <h1 className="text-3xl font-extrabold text-brand-navy leading-tight">FieldOps</h1>
        <p className="text-sm text-gray-500 mt-1">MSETCL Substation · by Rite Water Solutions</p>
      </div>

      <Card className="w-full max-w-sm shadow-md">
        <CardContent className="pt-6">
          <p className="text-xs text-gray-500 mb-5 text-center">
            You've been invited as a{' '}
            <span className="font-semibold text-brand-blue capitalize">
              {inviteRole === 'admin' ? 'Admin' : 'Field Expert'}
            </span>
            . Create your account below.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="su-name">Name</Label>
              <Input
                id="su-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                required
                autoComplete="name"
              />
            </div>

            {/* Email — read-only, bound to invite */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="su-email">Email</Label>
              <Input
                id="su-email"
                type="email"
                value={inviteEmail}
                readOnly
                className="bg-gray-50 cursor-not-allowed text-gray-500"
                tabIndex={-1}
              />
              <p className="text-[11px] text-gray-400 -mt-0.5">
                Email is fixed to this invite.
              </p>
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="su-password">Password</Label>
              <Input
                id="su-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                autoComplete="new-password"
              />
            </div>

            {/* Confirm password */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="su-confirm">Confirm Password</Label>
              <Input
                id="su-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat your password"
                required
                autoComplete="new-password"
              />
            </div>

            {error && (
              <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 flex flex-col gap-1.5">
                <p className="text-sm text-brand-red">{error}</p>
                {errorType === 'existing_account' && (
                  <button
                    type="button"
                    onClick={() => navigate('/login')}
                    className="self-start text-sm font-medium text-brand-blue hover:underline"
                  >
                    Go to Sign In →
                  </button>
                )}
              </div>
            )}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Creating account…
                </span>
              ) : (
                'Create Account'
              )}
            </Button>

            <button
              type="button"
              onClick={() => navigate('/login')}
              className="text-center text-sm text-brand-blue hover:underline"
            >
              Already have an account? Sign in
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
