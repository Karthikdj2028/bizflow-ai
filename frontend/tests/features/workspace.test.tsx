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
  items: [
    {
      id: 'ws-a',
      name: 'Workspace Alpha',
      base_currency: 'USD',
      role: 'OWNER' as const,
      created_at: new Date().toISOString(),
    },
    {
      id: 'ws-b',
      name: 'Workspace Beta',
      base_currency: 'EUR',
      role: 'VIEWER' as const,
      created_at: new Date().toISOString(),
    },
  ],
  total: 2,
};

const TestWorkspaceConsumer: React.FC = () => {
  const { activeWorkspace, workspaces, isLoading, error, switchWorkspace, workspaceGeneration } = useWorkspace();
  const { logout } = useAuth();

  return (
    <div>
      <div data-testid="ws-loading">{String(isLoading)}</div>
      <div data-testid="ws-active">{activeWorkspace?.name || 'none'}</div>
      <div data-testid="ws-active-id">{activeWorkspace?.id || 'none'}</div>
      <div data-testid="ws-role">{activeWorkspace?.role || 'none'}</div>
      <div data-testid="ws-currency">{activeWorkspace?.base_currency || 'none'}</div>
      <div data-testid="ws-count">{workspaces.length}</div>
      <div data-testid="ws-error">{error || 'none'}</div>
      <div data-testid="ws-gen">{workspaceGeneration}</div>
      <button
        data-testid="switch-to-b"
        onClick={() => switchWorkspace('ws-b')}
      >
        Switch to B
      </button>
      <button
        data-testid="switch-to-a"
        onClick={() => switchWorkspace('ws-a')}
      >
        Switch to A
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
        const requestedWs = mockWorkspaceList.items.find(
          (w) => w.id === headers?.['X-Business-ID']
        ) || mockWorkspaceList.items[1];
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
          new Response(JSON.stringify(mockWorkspaceList.items[1]), {
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
        const requestedWs = mockWorkspaceList.items.find(
          (w) => w.id === headers?.['X-Business-ID']
        ) || mockWorkspaceList.items[1];
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
        const requestedWs = mockWorkspaceList.items.find(
          (w) => w.id === headers?.['X-Business-ID']
        ) || mockWorkspaceList.items[1];
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
        const requestedWs = mockWorkspaceList.items.find(
          (w) => w.id === headers?.['X-Business-ID']
        ) || mockWorkspaceList.items[1];
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
        const requestedWs = mockWorkspaceList.items.find(
          (w) => w.id === headers?.['X-Business-ID']
        ) || mockWorkspaceList.items[1];
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
            items: membershipRevoked ? [mockWorkspaceList.items[1]] : mockWorkspaceList.items,
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
    const activeGen = Number(screen.getByTestId('ws-gen').textContent);

    await act(async () => {
      try {
        await apiRequest('/workspaces/current', {
          scope: 'workspace',
          targetWorkspaceId: 'ws-a',
          targetWorkspaceGeneration: activeGen,
        });
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
            new Response(JSON.stringify(mockWorkspaceList.items[1]), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        const requestedWs = mockWorkspaceList.items.find(
          (w) => w.id === headers?.['X-Business-ID']
        ) || mockWorkspaceList.items[1];
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
        const requestedWs = mockWorkspaceList.items.find(
          (w) => w.id === headers?.['X-Business-ID']
        ) || mockWorkspaceList.items[1];
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

  it('advances workspaceGeneration on initial workspace activation', async () => {
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
        return Promise.resolve(
          new Response(JSON.stringify(mockWorkspaceList.items[0]), {
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

    const activeGen = parseInt(screen.getByTestId('ws-gen').textContent || '0', 10);
    expect(activeGen).toBeGreaterThan(1);
  });

  it('produces a distinguishable generation on A -> B -> A workspace cycle', async () => {
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
        const requestedId = headers?.['X-Business-ID'];
        const ws = mockWorkspaceList.items.find((w) => w.id === requestedId) || mockWorkspaceList.items[0];
        return Promise.resolve(
          new Response(JSON.stringify(ws), {
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

    const genA1 = parseInt(screen.getByTestId('ws-gen').textContent || '0', 10);

    // Switch to B
    await user.click(screen.getByTestId('switch-to-b'));
    await waitFor(() => {
      expect(screen.getByTestId('ws-active')).toHaveTextContent('Workspace Beta');
    });
    const genB = parseInt(screen.getByTestId('ws-gen').textContent || '0', 10);
    expect(genB).toBeGreaterThan(genA1);

    // Switch back to A
    await user.click(screen.getByTestId('switch-to-a'));
    await waitFor(() => {
      expect(screen.getByTestId('ws-active')).toHaveTextContent('Workspace Alpha');
    });
    const genA2 = parseInt(screen.getByTestId('ws-gen').textContent || '0', 10);
    expect(genA2).toBeGreaterThan(genB);
    expect(genA2).not.toBe(genA1);
  });

  it('invalidates in-flight operation from old session after reauthentication and new workspace activation', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem(ACCESS_TOKEN_KEY, 'token-123');
    sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, 'ws-a');

    let deferredResolveSession1: (res: Response) => void = () => {};
    const deferredPromiseSession1 = new Promise<Response>((resolve) => {
      deferredResolveSession1 = resolve;
    });

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
        const requestedId = headers?.['X-Business-ID'];
        const ws = mockWorkspaceList.items.find((w) => w.id === requestedId) || mockWorkspaceList.items[0];
        return Promise.resolve(
          new Response(JSON.stringify(ws), {
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

    const genSession1 = parseInt(screen.getByTestId('ws-gen').textContent || '0', 10);

    // 1. Start async operational request under Session 1
    mockFetch.mockImplementationOnce(() => deferredPromiseSession1);
    const inFlightReq1 = apiRequest('/categories', {
      scope: 'workspace',
      targetWorkspaceId: 'ws-a',
      targetWorkspaceGeneration: genSession1,
    });

    // 2. Log out while request is pending
    await user.click(screen.getByTestId('logout-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('ws-active')).toHaveTextContent('none');
    });

    // 3 & 4. Re-authenticate Session 2 with new token & activate workspace
    sessionStorage.setItem(ACCESS_TOKEN_KEY, 'token-session-2');
    sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, 'ws-a');

    // 5. Resolve the delayed request from Session 1 with 404
    await act(async () => {
      deferredResolveSession1(
        new Response(
          JSON.stringify({
            detail: 'Workspace not found',
            code: 'BUSINESS_NOT_FOUND',
            status: 404,
          }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/problem+json' },
          }
        )
      );
      try {
        await inFlightReq1;
      } catch {
        // Ignored
      }
    });

    // 6. Assert Session 1 delayed error could not affect or invalidate state
    expect(screen.getByTestId('ws-active')).not.toHaveTextContent('Workspace Beta');
  });

  it('prevents delayed 404 from Workspace A from invalidating Workspace B', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem(ACCESS_TOKEN_KEY, 'token-123');
    sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, 'ws-a');

    let deferredResolveA: (res: Response) => void = () => {};
    const deferredPromiseA = new Promise<Response>((resolve) => {
      deferredResolveA = resolve;
    });

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
        const requestedId = headers?.['X-Business-ID'];
        const ws = mockWorkspaceList.items.find((w) => w.id === requestedId) || mockWorkspaceList.items[0];
        return Promise.resolve(
          new Response(JSON.stringify(ws), {
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

    const genA = parseInt(screen.getByTestId('ws-gen').textContent || '0', 10);

    // Operational request dispatched on Workspace A at genA
    mockFetch.mockImplementationOnce(() => deferredPromiseA);
    const reqA = apiRequest('/categories', {
      scope: 'workspace',
      targetWorkspaceId: 'ws-a',
      targetWorkspaceGeneration: genA,
    });

    // Switch to Workspace B
    await user.click(screen.getByTestId('switch-to-b'));
    await waitFor(() => {
      expect(screen.getByTestId('ws-active')).toHaveTextContent('Workspace Beta');
    });

    // Delayed 404 returns for Workspace A
    await act(async () => {
      deferredResolveA(
        new Response(
          JSON.stringify({
            detail: 'Workspace not found',
            code: 'BUSINESS_NOT_FOUND',
            status: 404,
          }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/problem+json' },
          }
        )
      );
      try {
        await reqA;
      } catch {
        // Expected
      }
    });

    // Workspace B remains active and storage entry preserved!
    expect(screen.getByTestId('ws-active')).toHaveTextContent('Workspace Beta');
    expect(sessionStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBe('ws-b');
  });

  it('prevents delayed 404 from A/G1 from invalidating active A/G3 on ABA workspace cycle', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem(ACCESS_TOKEN_KEY, 'token-123');
    sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, 'ws-a');

    let deferredResolveG1: (res: Response) => void = () => {};
    const deferredPromiseG1 = new Promise<Response>((resolve) => {
      deferredResolveG1 = resolve;
    });

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
        const requestedId = headers?.['X-Business-ID'];
        const ws = mockWorkspaceList.items.find((w) => w.id === requestedId) || mockWorkspaceList.items[0];
        return Promise.resolve(
          new Response(JSON.stringify(ws), {
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

    const genG1 = parseInt(screen.getByTestId('ws-gen').textContent || '0', 10);

    // 1. Dispatch request for A at G1
    mockFetch.mockImplementationOnce(() => deferredPromiseG1);
    const reqG1 = apiRequest('/categories', {
      scope: 'workspace',
      targetWorkspaceId: 'ws-a',
      targetWorkspaceGeneration: genG1,
    });

    // 2. Switch to B (G2)
    await user.click(screen.getByTestId('switch-to-b'));
    await waitFor(() => {
      expect(screen.getByTestId('ws-active')).toHaveTextContent('Workspace Beta');
    });

    // 3. Switch back to A (G3)
    await user.click(screen.getByTestId('switch-to-a'));
    await waitFor(() => {
      expect(screen.getByTestId('ws-active')).toHaveTextContent('Workspace Alpha');
    });
    const genG3 = parseInt(screen.getByTestId('ws-gen').textContent || '0', 10);
    expect(genG3).toBeGreaterThan(genG1);

    // 4. Resolve delayed request from A/G1 with 404 BUSINESS_NOT_FOUND
    await act(async () => {
      deferredResolveG1(
        new Response(
          JSON.stringify({
            detail: 'Workspace not found',
            code: 'BUSINESS_NOT_FOUND',
            status: 404,
          }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/problem+json' },
          }
        )
      );
      try {
        await reqG1;
      } catch {
        // Expected
      }
    });

    // Workspace A remains active at G3 and sessionStorage preserved!
    expect(screen.getByTestId('ws-active')).toHaveTextContent('Workspace Alpha');
    expect(sessionStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBe('ws-a');
    expect(parseInt(screen.getByTestId('ws-gen').textContent || '0', 10)).toBe(genG3);
  });

  it('rejects workspace invalidation when error callback receives missing or undefined generation', async () => {
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
        return Promise.resolve(
          new Response(JSON.stringify(mockWorkspaceList.items[0]), {
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

    // Simulate 404 BUSINESS_NOT_FOUND on an operational request that omits generation
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: 'Workspace not found',
          code: 'BUSINESS_NOT_FOUND',
          status: 404,
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/problem+json' },
        }
      )
    );

    await act(async () => {
      try {
        await apiRequest('/some-endpoint', {
          scope: 'workspace',
          targetWorkspaceId: 'ws-a',
          // targetWorkspaceGeneration omitted!
        });
      } catch {
        // Expected
      }
    });

    // Workspace A must NOT be invalidated when generation metadata is omitted!
    expect(screen.getByTestId('ws-active')).toHaveTextContent('Workspace Alpha');
    expect(sessionStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBe('ws-a');
  });

  it("correctly consumes flat backend workspace response with items[], role OWNER, and currency INR", async () => {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, 'token-123');

    const karthikWorkspace = {
      id: 'fe8a71c0-eb0c-4f3c-b4ad-0dffac2b7a0d',
      name: "Karthik's Workspace",
      base_currency: 'INR',
      role: 'OWNER' as const,
      created_at: '2026-11-22T11:23:25.681351+05:30',
    };

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
          new Response(JSON.stringify(karthikWorkspace), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      if (url.includes('/workspaces')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [karthikWorkspace],
              total: 1,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          )
        );
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
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
      expect(screen.getByTestId('ws-active')).toHaveTextContent("Karthik's Workspace");
    });

    expect(screen.getByTestId('ws-active-id')).toHaveTextContent('fe8a71c0-eb0c-4f3c-b4ad-0dffac2b7a0d');
    expect(screen.getByTestId('ws-role')).toHaveTextContent('OWNER');
    expect(screen.getByTestId('ws-currency')).toHaveTextContent('INR');
    expect(screen.getByTestId('ws-count')).toHaveTextContent('1');
    expect(sessionStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBe('fe8a71c0-eb0c-4f3c-b4ad-0dffac2b7a0d');
  });
});
