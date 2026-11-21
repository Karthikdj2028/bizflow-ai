/**
 * Centralized, typed API client enforcing request scopes, non-overridable credentials: 'omit',
 * deterministic response parsing, and identity-checked error hooks.
 */

import { ProblemDetails, RequestOptions } from '../types/api';

export class ApiClientError extends Error {
  public status: number;
  public problem?: ProblemDetails;

  constructor(message: string, status: number, problem?: ProblemDetails) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.problem = problem;
  }
}

export class NetworkError extends Error {
  constructor(message: string = 'Unable to connect to server. Please check your connection.') {
    super(message);
    this.name = 'NetworkError';
  }
}

const API_BASE_URL = '/api/v1';

// Token storage key
export const ACCESS_TOKEN_KEY = 'bizflow_access_token';
export const ACTIVE_WORKSPACE_KEY = 'bizflow_active_workspace_id';

// Listener definitions
type UnauthorizedHandler = () => void;
type WorkspaceErrorHandler = (error: ApiClientError, requestedWorkspaceId: string) => void;

let onUnauthorizedCallback: UnauthorizedHandler | null = null;
let onWorkspaceErrorCallback: WorkspaceErrorHandler | null = null;

/**
 * Register unauthorized (401) listener with identity-checked cleanup.
 */
export function registerUnauthorizedHandler(handler: UnauthorizedHandler): () => void {
  onUnauthorizedCallback = handler;
  return () => {
    if (onUnauthorizedCallback === handler) {
      onUnauthorizedCallback = null;
    }
  };
}

/**
 * Register workspace error listener with identity-checked cleanup.
 */
export function registerWorkspaceErrorHandler(handler: WorkspaceErrorHandler): () => void {
  onWorkspaceErrorCallback = handler;
  return () => {
    if (onWorkspaceErrorCallback === handler) {
      onWorkspaceErrorCallback = null;
    }
  };
}

/**
 * Core API request function enforcing scope isolation, option destructuring, and deterministic parsing.
 */
export async function apiRequest<T>(
  endpoint: string,
  options: RequestOptions
): Promise<T> {
  // 1. Runtime scope validation
  if (!options || !options.scope || !['public', 'auth', 'workspace'].includes(options.scope)) {
    throw new Error(
      `Invalid or missing request scope: "${options?.scope}". Must be 'public', 'auth', or 'workspace'.`
    );
  }

  // 2. Destructure application options to prevent leakage into RequestInit
  const { scope, targetWorkspaceId, headers: callerHeaders = {}, ...nativeOptions } = options;

  // 3. Prepare headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...callerHeaders,
  };

  const token = sessionStorage.getItem(ACCESS_TOKEN_KEY);
  let resolvedWorkspaceId: string | null = null;

  if (scope === 'auth' || scope === 'workspace') {
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  if (scope === 'workspace') {
    resolvedWorkspaceId = targetWorkspaceId || sessionStorage.getItem(ACTIVE_WORKSPACE_KEY);
    if (!resolvedWorkspaceId) {
      throw new Error(
        'Workspace scope requested but no active workspace or targetWorkspaceId was provided.'
      );
    }
    headers['X-Business-ID'] = resolvedWorkspaceId;
  }

  // 4. Force credentials: 'omit'
  const fetchInit: RequestInit = {
    ...nativeOptions,
    headers,
    credentials: 'omit',
  };

  const url = endpoint.startsWith('http')
    ? endpoint
    : `${API_BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  let response: Response;
  try {
    response = await fetch(url, fetchInit);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new NetworkError();
    }
    throw error;
  }

  // 5. Check 401 Unauthorized handling (strictly for non-public requests)
  if (response.status === 401 && scope !== 'public') {
    if (onUnauthorizedCallback) {
      onUnauthorizedCallback();
    }
  }

  // 6. Deterministic Response Parsing Contract
  // 6a. HTTP 204 or explicitly empty response
  const contentLength = response.headers.get('content-length');
  if (response.status === 204 || contentLength === '0') {
    if (!response.ok) {
      const err = new ApiClientError(response.statusText || `HTTP ${response.status}`, response.status);
      if (scope === 'workspace' && resolvedWorkspaceId && onWorkspaceErrorCallback) {
        onWorkspaceErrorCallback(err, resolvedWorkspaceId);
      }
      throw err;
    }
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json') || contentType.includes('application/problem+json');

  // 6b. Successful response
  if (response.ok) {
    if (!isJson) {
      throw new ApiClientError(`Expected JSON response but received ${contentType}`, response.status);
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiClientError('Invalid JSON response received from server', response.status);
    }
  }

  // 6c. Error response (!response.ok)
  if (isJson) {
    let parsedBody: unknown;
    try {
      parsedBody = await response.json();
    } catch {
      const err = new ApiClientError(response.statusText || 'Server Error', response.status);
      if (scope === 'workspace' && resolvedWorkspaceId && onWorkspaceErrorCallback) {
        onWorkspaceErrorCallback(err, resolvedWorkspaceId);
      }
      throw err;
    }

    const problem = parsedBody as ProblemDetails;
    const detail = problem?.detail || response.statusText || `Request failed with status ${response.status}`;
    const err = new ApiClientError(detail, response.status, problem);
    if (scope === 'workspace' && resolvedWorkspaceId && onWorkspaceErrorCallback) {
      onWorkspaceErrorCallback(err, resolvedWorkspaceId);
    }
    throw err;
  }

  // Non-JSON error (e.g. HTML 502/504 from reverse proxy)
  try {
    await response.text();
  } catch {
    // Ignore text reading failure
  }
  const err = new ApiClientError(response.statusText || `HTTP Error ${response.status}`, response.status);
  if (scope === 'workspace' && resolvedWorkspaceId && onWorkspaceErrorCallback) {
    onWorkspaceErrorCallback(err, resolvedWorkspaceId);
  }
  throw err;
}
