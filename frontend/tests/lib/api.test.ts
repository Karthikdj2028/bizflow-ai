import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  apiRequest,
  ApiClientError,
  NetworkError,
  registerUnauthorizedHandler,
  registerWorkspaceErrorHandler,
  ACCESS_TOKEN_KEY,
  ACTIVE_WORKSPACE_KEY,
} from '../../src/lib/api';

describe('API Client', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  describe('Scope Contract & Option Destructuring', () => {
    it('throws runtime error on missing or invalid scope', async () => {
      // @ts-expect-error Testing missing scope at runtime
      await expect(apiRequest('/test', {})).rejects.toThrow(
        /Invalid or missing request scope/
      );
      // @ts-expect-error Testing invalid scope at runtime
      await expect(apiRequest('/test', { scope: 'invalid' })).rejects.toThrow(
        /Invalid or missing request scope/
      );
    });

    it('destructures application options so scope and targetWorkspaceId never leak to fetch', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      await apiRequest('/test', {
        scope: 'public',
        targetWorkspaceId: 'should-not-leak',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, init] = mockFetch.mock.calls[0];
      expect(init).not.toHaveProperty('scope');
      expect(init).not.toHaveProperty('targetWorkspaceId');
    });

    it('enforces credentials: "omit" even if options pass credentials: "include"', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      // @ts-expect-error Testing credential override attempt
      await apiRequest('/test', { scope: 'public', credentials: 'include' });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.credentials).toBe('omit');
    });
  });

  describe('Header Isolation', () => {
    it('public scope sends neither Authorization nor X-Business-ID', async () => {
      sessionStorage.setItem(ACCESS_TOKEN_KEY, 'test-jwt');
      sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, 'biz-123');

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      await apiRequest('/auth/login', { scope: 'public' });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers).not.toHaveProperty('Authorization');
      expect(init.headers).not.toHaveProperty('X-Business-ID');
    });

    it('auth scope sends Authorization but never X-Business-ID', async () => {
      sessionStorage.setItem(ACCESS_TOKEN_KEY, 'test-jwt');
      sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, 'biz-123');

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 'user-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      await apiRequest('/auth/me', { scope: 'auth' });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers['Authorization']).toBe('Bearer test-jwt');
      expect(init.headers).not.toHaveProperty('X-Business-ID');
    });

    it('workspace scope sends both Authorization and X-Business-ID', async () => {
      sessionStorage.setItem(ACCESS_TOKEN_KEY, 'test-jwt');
      sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, 'biz-123');

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ business: { id: 'biz-123' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      await apiRequest('/workspaces/current', { scope: 'workspace' });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers['Authorization']).toBe('Bearer test-jwt');
      expect(init.headers['X-Business-ID']).toBe('biz-123');
    });

    it('workspace scope uses targetWorkspaceId override for candidate probes', async () => {
      sessionStorage.setItem(ACCESS_TOKEN_KEY, 'test-jwt');
      sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, 'active-biz-1');

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ business: { id: 'candidate-biz-2' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      await apiRequest('/workspaces/current', {
        scope: 'workspace',
        targetWorkspaceId: 'candidate-biz-2',
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers['X-Business-ID']).toBe('candidate-biz-2');
    });

    it('workspace scope throws error before network request if no workspace ID is available', async () => {
      sessionStorage.setItem(ACCESS_TOKEN_KEY, 'test-jwt');
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        apiRequest('/workspaces/current', { scope: 'workspace' })
      ).rejects.toThrow(/Workspace scope requested but no active workspace/);

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Deterministic Response Parsing', () => {
    it('returns undefined for HTTP 204 No Content', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(null, { status: 204 })
      );
      vi.stubGlobal('fetch', mockFetch);

      const result = await apiRequest('/test', { scope: 'public' });
      expect(result).toBeUndefined();
    });

    it('returns undefined for content-length 0', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('', { status: 200, headers: { 'Content-Length': '0' } })
      );
      vi.stubGlobal('fetch', mockFetch);

      const result = await apiRequest('/test', { scope: 'public' });
      expect(result).toBeUndefined();
    });

    it('throws ApiClientError for successful response with malformed JSON', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('{ invalid json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      await expect(apiRequest('/test', { scope: 'public' })).rejects.toThrow(
        ApiClientError
      );
      await expect(apiRequest('/test', { scope: 'public' })).rejects.toThrow(
        /Invalid JSON response/
      );
    });

    it('throws ApiClientError for successful non-JSON response when JSON expected', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('<h1>Success</h1>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      await expect(apiRequest('/test', { scope: 'public' })).rejects.toThrow(
        ApiClientError
      );
      await expect(apiRequest('/test', { scope: 'public' })).rejects.toThrow(
        /Expected JSON response but received text\/html/
      );
    });

    it('parses valid RFC 9457 error response into ApiClientError with problem details', async () => {
      const problem = {
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: 'Workspace not found or access denied.',
        code: 'BUSINESS_NOT_FOUND',
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(problem), {
          status: 404,
          headers: { 'Content-Type': 'application/problem+json' },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      try {
        await apiRequest('/test', { scope: 'public' });
        expect.fail('Should have thrown ApiClientError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.status).toBe(404);
        expect(apiErr.message).toBe('Workspace not found or access denied.');
        expect(apiErr.problem?.code).toBe('BUSINESS_NOT_FOUND');
      }
    });

    it('throws ApiClientError with status for malformed JSON error response', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('{ broken', {
          status: 500,
          statusText: 'Internal Error',
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      try {
        await apiRequest('/test', { scope: 'public' });
        expect.fail('Should have thrown ApiClientError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.status).toBe(500);
      }
    });

    it('throws ApiClientError with status for HTML 502 Bad Gateway response', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('<html><body>502 Bad Gateway</body></html>', {
          status: 502,
          statusText: 'Bad Gateway',
          headers: { 'Content-Type': 'text/html' },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      try {
        await apiRequest('/test', { scope: 'public' });
        expect.fail('Should have thrown ApiClientError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.status).toBe(502);
        expect(apiErr.message).toContain('Bad Gateway');
      }
    });

    it('throws NetworkError strictly for fetch TypeError failures', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
      vi.stubGlobal('fetch', mockFetch);

      await expect(apiRequest('/test', { scope: 'public' })).rejects.toThrow(
        NetworkError
      );
    });
  });

  describe('Handler Registration & Cleanup Safety', () => {
    it('registerUnauthorizedHandler only unregisters its own instance', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const unregister1 = registerUnauthorizedHandler(handler1);
      const unregister2 = registerUnauthorizedHandler(handler2);

      // Calling unregister1 should NOT unregister handler2
      unregister1();

      // Trigger 401 via mock fetch
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      await apiRequest('/auth/me', { scope: 'auth' }).catch(() => {});

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);

      unregister2();
    });

    it('public scope 401 (e.g. login failure) does not invoke unauthorized handler', async () => {
      const handler = vi.fn();
      const unregister = registerUnauthorizedHandler(handler);

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Invalid credentials' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        apiRequest('/auth/login', { scope: 'public' })
      ).rejects.toThrow(ApiClientError);

      expect(handler).not.toHaveBeenCalled();
      unregister();
    });

    it('workspace error handler receives ApiClientError and requestedWorkspaceId', async () => {
      const wsHandler = vi.fn();
      const unregister = registerWorkspaceErrorHandler(wsHandler);

      sessionStorage.setItem(ACCESS_TOKEN_KEY, 'token');
      sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, 'workspace-target-id');

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: 'Not found',
            code: 'BUSINESS_NOT_FOUND',
            status: 404,
          }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/problem+json' },
          }
        )
      );
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        apiRequest('/workspaces/current', { scope: 'workspace' })
      ).rejects.toThrow(ApiClientError);

      expect(wsHandler).toHaveBeenCalledTimes(1);
      const [errorArg, targetIdArg] = wsHandler.mock.calls[0];
      expect(errorArg).toBeInstanceOf(ApiClientError);
      expect(targetIdArg).toBe('workspace-target-id');

      unregister();
    });
  });
});
