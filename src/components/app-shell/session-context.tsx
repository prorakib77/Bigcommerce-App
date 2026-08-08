'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  apiClient,
  setApiToken,
  hasApiToken,
  ApiClientError,
} from '@/components/shared/api-client';
import type { StoreUserRole } from '@prisma/client';

interface SessionState {
  status: 'loading' | 'ready' | 'unauthenticated' | 'error';
  role: StoreUserRole | null;
  email: string | null;
  errorMessage: string | null;
}

interface SessionContextValue extends SessionState {
  isOwner: boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const REFRESH_MARGIN_MS = 60_000;

export function SessionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, setState] = useState<SessionState>({
    status: 'loading',
    role: null,
    email: null,
    errorMessage: null,
  });
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const applySession = useCallback(
    (token: string, expiresAt: string, role: StoreUserRole, email: string) => {
      setApiToken(token);
      setState({ status: 'ready', role, email, errorMessage: null });

      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      const msUntilExpiry = new Date(expiresAt).getTime() - Date.now() - REFRESH_MARGIN_MS;
      expiryTimer.current = setTimeout(
        () => {
          setApiToken(null);
          setState({
            status: 'unauthenticated',
            role: null,
            email: null,
            errorMessage: 'Your session has expired. Please reload the app from BigCommerce.',
          });
        },
        Math.max(msUntilExpiry, 0),
      );
    },
    [],
  );

  useEffect(() => {
    const bootstrapCode = searchParams.get('bootstrap');

    if (!bootstrapCode) {
      if (!hasApiToken()) {
        setState({
          status: 'unauthenticated',
          role: null,
          email: null,
          errorMessage: 'Please open this app from your BigCommerce control panel.',
        });
      }
      return;
    }

    // Strip the one-time code from the URL immediately so it never lingers
    // in browser history, even if the exchange below fails.
    const params = new URLSearchParams(searchParams.toString());
    params.delete('bootstrap');
    router.replace(params.size > 0 ? `${pathname}?${params.toString()}` : pathname);

    apiClient
      .post<{ token: string; expiresAt: string; role: StoreUserRole; email: string }>(
        '/api/v1/session/bootstrap',
        { code: bootstrapCode },
      )
      .then((session) =>
        applySession(session.token, session.expiresAt, session.role, session.email),
      )
      .catch((error: unknown) => {
        const message =
          error instanceof ApiClientError ? error.message : 'Could not start your session.';
        setState({ status: 'error', role: null, email: null, errorMessage: message });
      });
    // Intentionally only reacting to bootstrap-code changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <SessionContext.Provider value={{ ...state, isOwner: state.role === 'OWNER' }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return ctx;
}
