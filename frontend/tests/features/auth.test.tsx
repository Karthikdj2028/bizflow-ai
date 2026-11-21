import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '../../src/features/auth/AuthContext';
import { LoginForm } from '../../src/features/auth/LoginForm';
import { ACCESS_TOKEN_KEY, ACTIVE_WORKSPACE_KEY, apiRequest } from '../../src/lib/api';

const TestAuthConsumer: React.FC = () => {
  const { user, isAuthenticated, isLoading, connectionError, error, logout } = useAuth();
  return (
    <div>
      <div data-testid="auth-loading">{String(isLoading)}</div>
      <div data-testid="auth-authenticated">{String(isAuthenticated)}</div>
      <div data-testid="auth-connection-error">{String(connectionError)}</div>
      <div data-testid="auth-error">{error || 'none'}</div>
      <div data-testid="auth-user">{user?.email || 'none'}</div>
      <button data-testid="auth-logout-btn" onClick={logout}>
        Logout
      </button>
    </div>
  );
};

describe('Auth Feature & Context Integration', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('fresh launch without saved token initializes unauthenticated and registers unauthorized handler', async () => {
    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('auth-authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('auth-user')).toHaveTextContent('none');
  });

  it('session restoration: restores authenticated state when saved token exists and /auth/me returns 200', async () => {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, 'valid-token');

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'user-uuid-1',
          email: 'admin@bizflow.io',
          full_name: 'Bizflow Admin',
          is_active: true,
          is_superuser: false,
          created_at: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    vi.stubGlobal('fetch', mockFetch);

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('auth-authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('auth-user')).toHaveTextContent('admin@bizflow.io');
    expect(sessionStorage.getItem(ACCESS_TOKEN_KEY)).toBe('valid-token');
  });

  it('clears token and becomes unauthenticated when /auth/me returns 401', async () => {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, 'expired-token');

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Token expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('auth-authenticated')).toHaveTextContent('false');
    expect(sessionStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
  });

  it('network failure during initialization preserves token and sets connectionError', async () => {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, 'saved-token');

    const mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', mockFetch);

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('auth-authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('auth-connection-error')).toHaveTextContent('true');
    // Critical Invariant: Token preserved in storage!
    expect(sessionStorage.getItem(ACCESS_TOKEN_KEY)).toBe('saved-token');
  });

  it('successful login populates session state and subsequent authenticated 401 triggers expiry', async () => {
    const user = userEvent.setup();

    // 1. Initial launch without token
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    render(
      <AuthProvider>
        <TestAuthConsumer />
        <LoginForm />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-loading')).toHaveTextContent('false');
    });

    // 2. Perform login
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'new-jwt-token', token_type: 'bearer' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'u-1',
            email: 'newuser@bizflow.io',
            full_name: 'New User',
            is_active: true,
            is_superuser: false,
            created_at: new Date().toISOString(),
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

    await user.type(screen.getByLabelText(/Email Address/i), 'newuser@bizflow.io');
    await user.type(screen.getByLabelText(/Password/i), 'ValidPass123!');
    await user.click(screen.getByRole('button', { name: /Sign In/i }));

    await waitFor(() => {
      expect(screen.getByTestId('auth-authenticated')).toHaveTextContent('true');
      expect(screen.getByTestId('auth-user')).toHaveTextContent('newuser@bizflow.io');
    });
    expect(sessionStorage.getItem(ACCESS_TOKEN_KEY)).toBe('new-jwt-token');

    // 3. Now trigger an authenticated 401 request
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Token revoked' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await act(async () => {
      try {
        await apiRequest('/auth/me', { scope: 'auth' });
      } catch {
        // Ignored
      }
    });

    // Verify session expired
    await waitFor(() => {
      expect(screen.getByTestId('auth-authenticated')).toHaveTextContent('false');
      expect(screen.getByTestId('auth-user')).toHaveTextContent('none');
    });
    expect(sessionStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
  });

  it('failed public login displays error without evicting session or invoking unauthorized handler', async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: 'Invalid email or password.',
          status: 401,
          code: 'INVALID_CREDENTIALS',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/problem+json' },
        }
      )
    );
    vi.stubGlobal('fetch', mockFetch);

    render(
      <AuthProvider>
        <LoginForm />
      </AuthProvider>
    );

    await user.type(screen.getByLabelText(/Email Address/i), 'wrong@bizflow.io');
    await user.type(screen.getByLabelText(/Password/i), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /Sign In/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password.');
    });
  });

  it('logout clears sessionStorage and resets state to unauthenticated', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem(ACCESS_TOKEN_KEY, 'token-to-clear');
    sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, 'ws-to-clear');

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'u-1',
          email: 'logged@bizflow.io',
          full_name: 'Logged In',
          is_active: true,
          is_superuser: false,
          created_at: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    vi.stubGlobal('fetch', mockFetch);

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-authenticated')).toHaveTextContent('true');
    });

    await user.click(screen.getByTestId('auth-logout-btn'));

    expect(screen.getByTestId('auth-authenticated')).toHaveTextContent('false');
    expect(sessionStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBeNull();
  });
});
