import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '../../src/features/auth/AuthContext';
import { WorkspaceProvider, useWorkspace } from '../../src/features/workspaces/WorkspaceContext';
import { WorkspaceSelector } from '../../src/features/workspaces/WorkspaceSelector';
import { ACCESS_TOKEN_KEY, ACTIVE_WORKSPACE_KEY, apiRequest } from '../../src/lib/api';

const mockUser = {
  id: 'u-1',
  email: 'tester@bizflow.io',
  full_name: 'Tester User',
  is_active: true,
  is_superuser: false,
  created_at: new Date().toISOString(),
};

const mockWorkspaceList = {
  workspaces: [
    {
      business: {
        id: 'ws-a',
        name: 'Workspace Alpha',
        currency: 'USD',
        tax_id: null,
        created_at: new Date().toISOString(),
      },
      membership: {
        id: 'mem-a',
        user_id: 'u-1',
        business_id: 'ws-a',
        role: 'OWNER' as const,
        created_at: new Date().toISOString(),
      },
    },
    {
      business: {
        id: 'ws-b',
        name: 'Workspace Beta',
        currency: 'EUR',
        tax_id: null,
        created_at: new Date().toISOString(),
      },
      membership: {
        id: 'mem-b',
        user_id: 'u-1',
        business_id: 'ws-b',
        role: 'VIEWER' as const,
        created_at: new Date().toISOString(),
      },
    },
  ],
  total: 2,
};

const TestWorkspaceConsumer: React.FC = () => {
  const { activeWorkspace, workspaces, isLoading, error, switchWorkspace } = useWorkspace();
  const { logout } = useAuth();

  return (
    <div>
      <div data-testid="ws-loading">{String(isLoading)}</div>
      <div data-testid="ws-active">{activeWorkspace?.business.name || 'none'}</div>
      <div data-testid="ws-active-id">{activeWorkspace?.business.id || 'none'}</div>
      <div data-testid="ws-role">{activeWorkspace?.membership.role || 'none'}</div>
      <div data-testid="ws-count">{workspaces.length}</div>
      <div data-testid="ws-error">{error || 'none'}</div>
      <button
        data-testid="switch-to-b"
        onClick={() => switchWorkspace('ws-b')}
      >
        Switch to B
      </button>
      <button data-testid="logout-btn" onClick={logout}>
        Logout
      </button>
    </div>
  );
};

describe('Workspace Context & Isolation Architecture', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('saved workspace ID in sessionStorage survives initial authentication loading state', async () => {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, 'token-123');
    sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, 'ws-a');

    // Create a delayed /auth/me response
    let resolveAuth: (res: Response) => void;
    const authPromise = new Promise<Response>((resolve) => {
      resolveAuth = resolve;
    });

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/me')) return authPromise;
      if (url.includes('/workspaces/current')) {
        const requestedWs = mockWorkspaceList.workspaces.find(
          (w) => w.business.id === headers?.['X-Business-ID']
        ) || mockWorkspaceList.workspaces[1];
        return Promise.resolve(
          new Response(JSON.stringify(requestedWs), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(mockWorkspaceList), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <AuthProvider>
        <WorkspaceProvider>
          <TestWorkspaceConsumer />
        </WorkspaceProvider>
      </AuthProvider>
    );

    // During loading: workspace ID MUST NOT be wiped from storage!
    expect(sessionStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBe('ws-a');

    // Now resolve auth
    await act(async () => {
      resolveAuth!(
        new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('ws-active')).toHaveTextContent('Workspace Alpha');
    });
    expect(sessionStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBe('ws-a');
  });

  it('restored session retains saved workspace candidate and probes it', async () => {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, 'token-123');
    sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, 'ws-b');

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify(mockUser), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      if (url.includes('/workspaces/current')) {
        return Promise.resolve(
          new Response(JSON.stringify(mockWorkspaceList.workspaces[1]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(mockWorkspaceList), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <AuthProvider>
        <WorkspaceProvider>
          <TestWorkspaceConsumer />
        </WorkspaceProvider>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('ws-active')).toHaveTextContent('Workspace Beta');
      expect(screen.getByTestId('ws-role')).toHaveTextContent('VIEWER');
    });
    expect(sessionStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBe('ws-b');
  });

  it('failed network connection during session restoration preserves both token and saved workspace candidate', async () => {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, 'token-saved');
    sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, 'ws-saved');

    const mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', mockFetch);

    render(
      <AuthProvider>
        <WorkspaceProvider>
          <TestWorkspaceConsumer />
        </WorkspaceProvider>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(sessionStorage.getItem(ACCESS_TOKEN_KEY)).toBe('token-saved');
      expect(sessionStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBe('ws-saved');
    });
  });

  it('true logout clears saved workspace ID from sessionStorage and state', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem(ACCESS_TOKEN_KEY, 'token-123');
    sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, 'ws-a');

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify(mockUser), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      if (url.includes('/workspaces/current')) {
        const requestedWs = mockWorkspaceList.workspaces.find(
          (w) => w.business.id === headers?.['X-Business-ID']
        ) || mockWorkspaceList.workspaces[1];
        return Promise.resolve(
          new Response(JSON.stringify(requestedWs), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(mockWorkspaceList), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <AuthProvider>
        <WorkspaceProvider>
          <TestWorkspaceConsumer />
        </WorkspaceProvider>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('ws-active')).toHaveTextContent('Workspace Alpha');
    });

    await user.click(screen.getByTestId('logout-btn'));

    expect(screen.getByTestId('ws-active')).toHaveTextContent('none');
    expect(sessionStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBeNull();
    expect(sessionStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
  });

  it('authenticated 401 expiry clears saved workspace ID', async () => {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, 'token-123');
    sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, 'ws-a');

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify(mockUser), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      if (url.includes('/workspaces/current')) {
        const requestedWs = mockWorkspaceList.workspaces.find(
          (w) => w.business.id === headers?.['X-Business-ID']
        ) || mockWorkspaceList.workspaces[1];
        return Promise.resolve(
          new Response(JSON.stringify(requestedWs), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(mockWorkspaceList), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <AuthProvider>
        <WorkspaceProvider>
          <TestWorkspaceConsumer />
        </WorkspaceProvider>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('ws-active')).toHaveTextContent('Workspace Alpha');
    });

    // Simulate authenticated request receiving 401
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Token expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await act(async () => {
      try {
        await apiRequest('/workspaces/current', { scope: 'workspace' });
      } catch {
        // Ignored
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('ws-active')).toHaveTextContent('none');
      expect(sessionStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBeNull();
    });
  });

  it('candidate-probe failure isolation: Workspace A remains active when candidate B returns 404 BUSINESS_NOT_FOUND', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem(ACCESS_TOKEN_KEY, 'token-123');
    sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, 'ws-a');

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify(mockUser), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      if (url.includes('/workspaces/current')) {
        const headers = init?.headers as Record<string, string>;
        if (headers?.['X-Business-ID'] === 'ws-b') {
          // Candidate probe B fails!
          return Promise.resolve(
            new Response(
              JSON.stringify({
                detail: 'Workspace not found or access denied.',
                code: 'BUSINESS_NOT_FOUND',
                status: 404,
              }),
              {
                status: 404,
                headers: { 'Content-Type': 'application/problem+json' },
              }
            )
          );
        }
        const requestedWs = mockWorkspaceList.workspaces.find(
          (w) => w.business.id === headers?.['X-Business-ID']
        ) || mockWorkspaceList.workspaces[1];
        return Promise.resolve(
          new Response(JSON.stringify(requestedWs), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(mockWorkspaceList), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <AuthProvider>
        <WorkspaceProvider>
          <TestWorkspaceConsumer />
        </WorkspaceProvider>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('ws-active')).toHaveTextContent('Workspace Alpha');
    });

    // Attempt to switch to B
    await user.click(screen.getByTestId('switch-to-b'));

    // Critical Invariant: Workspace A remains active, sessionStorage unchanged!
    await waitFor(() => {
      expect(screen.getByTestId('ws-error')).toHaveTextContent('Workspace not found or access denied.');
      expect(screen.getByTestId('ws-active')).toHaveTextContent('Workspace Alpha');
      expect(sessionStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBe('ws-a');
    });
  });

  it('active workspace invalidation: operational request against Workspace A receiving 404 BUSINESS_NOT_FOUND invalidates A', async () => {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, 'token-123');
    sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, 'ws-a');

    let membershipRevoked = false;

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify(mockUser), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      if (url.includes('/workspaces/current')) {
        const headers = init?.headers as Record<string, string>;
        if (headers?.['X-Business-ID'] === 'ws-a' && membershipRevoked) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                detail: 'Workspace not found or access denied.',
                code: 'BUSINESS_NOT_FOUND',
                status: 404,
              }),
              {
                status: 404,
                headers: { 'Content-Type': 'application/problem+json' },
              }
            )
          );
        }
        const requestedWs = mockWorkspaceList.workspaces.find(
          (w) => w.business.id === headers?.['X-Business-ID']
        ) || mockWorkspaceList.workspaces[1];
        return Promise.resolve(
          new Response(JSON.stringify(requestedWs), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      // Return workspace B only after revocation
      return Promise.resolve(
        new Response(
          JSON.stringify({
            workspaces: membershipRevoked ? [mockWorkspaceList.workspaces[1]] : mockWorkspaceList.workspaces,
            total: membershipRevoked ? 1 : 2,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <AuthProvider>
        <WorkspaceProvider>
          <TestWorkspaceConsumer />
        </WorkspaceProvider>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('ws-active')).toHaveTextContent('Workspace Alpha');
    });

    // Revoke membership on Workspace A and execute operational request
    membershipRevoked = true;

    await act(async () => {
      try {
        await apiRequest('/workspaces/current', { scope: 'workspace' });
      } catch {
        // Ignored
      }
    });

    // Active workspace A must be invalidated and purged
    await waitFor(() => {
      expect(sessionStorage.getItem(ACTIVE_WORKSPACE_KEY)).not.toBe('ws-a');
    });
  });

  it('successful candidate switch updates active workspace and sessionStorage', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem(ACCESS_TOKEN_KEY, 'token-123');
    sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, 'ws-a');

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify(mockUser), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      if (url.includes('/workspaces/current')) {
        const headers = init?.headers as Record<string, string>;
        if (headers?.['X-Business-ID'] === 'ws-b') {
          return Promise.resolve(
            new Response(JSON.stringify(mockWorkspaceList.workspaces[1]), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        const requestedWs = mockWorkspaceList.workspaces.find(
          (w) => w.business.id === headers?.['X-Business-ID']
        ) || mockWorkspaceList.workspaces[1];
        return Promise.resolve(
          new Response(JSON.stringify(requestedWs), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(mockWorkspaceList), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <AuthProvider>
        <WorkspaceProvider>
          <TestWorkspaceConsumer />
        </WorkspaceProvider>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('ws-active')).toHaveTextContent('Workspace Alpha');
    });

    await user.click(screen.getByTestId('switch-to-b'));

    await waitFor(() => {
      expect(screen.getByTestId('ws-active')).toHaveTextContent('Workspace Beta');
      expect(screen.getByTestId('ws-role')).toHaveTextContent('VIEWER');
      expect(sessionStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBe('ws-b');
    });
  });

  it('does NOT invalidate workspace on 403 INSUFFICIENT_PERMISSIONS or 400 MISSING_BUSINESS_ID_HEADER', async () => {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, 'token-123');
    sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, 'ws-a');

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify(mockUser), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      if (url.includes('/workspaces/current')) {
        const requestedWs = mockWorkspaceList.workspaces.find(
          (w) => w.business.id === headers?.['X-Business-ID']
        ) || mockWorkspaceList.workspaces[1];
        return Promise.resolve(
          new Response(JSON.stringify(requestedWs), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(mockWorkspaceList), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <AuthProvider>
        <WorkspaceProvider>
          <TestWorkspaceConsumer />
        </WorkspaceProvider>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('ws-active')).toHaveTextContent('Workspace Alpha');
    });

    // Simulate 403 INSUFFICIENT_PERMISSIONS on operational endpoint
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: 'Role VIEWER lacks required permissions.',
          code: 'INSUFFICIENT_PERMISSIONS',
          status: 403,
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/problem+json' },
        }
      )
    );

    await act(async () => {
      try {
        await apiRequest('/workspaces/current', { scope: 'workspace' });
      } catch {
        // Expected
      }
    });

    // Workspace A MUST remain active
    expect(screen.getByTestId('ws-active')).toHaveTextContent('Workspace Alpha');
    expect(sessionStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBe('ws-a');
  });
});
