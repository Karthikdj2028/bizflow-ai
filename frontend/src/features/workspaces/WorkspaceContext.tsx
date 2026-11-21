import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { WorkspaceItem, WorkspaceListResponse, WorkspaceResponse } from '../../types/api';
import { useAuth } from '../auth/AuthContext';
import {
  apiRequest,
  registerWorkspaceErrorHandler,
  ACTIVE_WORKSPACE_KEY,
  ApiClientError,
} from '../../lib/api';

interface WorkspaceContextValue {
  workspaces: WorkspaceItem[];
  activeWorkspace: WorkspaceItem | null;
  isLoading: boolean;
  error: string | null;
  switchWorkspace: (candidateId: string) => Promise<boolean>;
  refreshWorkspaces: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceItem | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Safeguard: Track previous authenticated state to identify true logout/expiry transitions
  const wasAuthenticatedRef = useRef<boolean>(false);

  // Safeguard: Request sequence counter to discard stale async responses
  const requestSeqRef = useRef<number>(0);

  const fetchWorkspacesAndActivate = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiRequest<WorkspaceListResponse>('/workspaces', {
        scope: 'auth',
        method: 'GET',
      });

      // Discard if newer request began or user logged out
      if (seq !== requestSeqRef.current) return;

      const items = response.workspaces || [];
      setWorkspaces(items);

      if (items.length === 0) {
        setActiveWorkspace(null);
        sessionStorage.removeItem(ACTIVE_WORKSPACE_KEY);
        return;
      }

      // Check saved workspace candidate from sessionStorage
      const savedId = sessionStorage.getItem(ACTIVE_WORKSPACE_KEY);
      let candidate = items.find((w) => w.business.id === savedId);

      if (candidate) {
        try {
          // Pre-activation probe
          const currentRes = await apiRequest<WorkspaceResponse>('/workspaces/current', {
            scope: 'workspace',
            targetWorkspaceId: candidate.business.id,
            method: 'GET',
          });

          if (seq !== requestSeqRef.current) return;
          setActiveWorkspace(currentRes);
          sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, currentRes.business.id);
          return;
        } catch (probeErr: unknown) {
          if (seq !== requestSeqRef.current) return;
          if (probeErr instanceof ApiClientError && probeErr.problem?.code === 'BUSINESS_NOT_FOUND') {
            // Stale candidate in storage: clear it and fallback
            sessionStorage.removeItem(ACTIVE_WORKSPACE_KEY);
            candidate = undefined;
          }
        }
      }

      // Fallback: probe and activate first available workspace
      const fallback = items[0];
      try {
        const fallbackRes = await apiRequest<WorkspaceResponse>('/workspaces/current', {
          scope: 'workspace',
          targetWorkspaceId: fallback.business.id,
          method: 'GET',
        });

        if (seq !== requestSeqRef.current) return;
        setActiveWorkspace(fallbackRes);
        sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, fallbackRes.business.id);
      } catch {
        if (seq !== requestSeqRef.current) return;
        // Even if probe fails, set fallback item so UI can present membership
        setActiveWorkspace(fallback);
      }
    } catch (err: unknown) {
      if (seq !== requestSeqRef.current) return;
      setError((err as Error).message || 'Failed to load workspaces.');
    } finally {
      if (seq === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Coordinate with AuthProvider lifecycle
  useEffect(() => {
    // 1. Do nothing while authentication is in initial loading state
    if (authLoading) {
      return;
    }

    // 2. Clear state ONLY after an established authenticated session transitions to unauthenticated
    if (wasAuthenticatedRef.current && !isAuthenticated) {
      ++requestSeqRef.current; // Invalidate any pending in-flight requests
      setActiveWorkspace(null);
      setWorkspaces([]);
      sessionStorage.removeItem(ACTIVE_WORKSPACE_KEY);
      wasAuthenticatedRef.current = false;
      return;
    }

    // 3. Established authentication: load workspaces
    if (isAuthenticated) {
      wasAuthenticatedRef.current = true;
      fetchWorkspacesAndActivate();
    }
  }, [isAuthenticated, authLoading, fetchWorkspacesAndActivate]);

  // Register workspace error listener for active workspace revocation
  useEffect(() => {
    const unregister = registerWorkspaceErrorHandler((err, requestedWorkspaceId) => {
      // Invalidate ONLY if the error occurred on the currently active workspace
      if (
        err.status === 404 &&
        err.problem?.code === 'BUSINESS_NOT_FOUND' &&
        activeWorkspace &&
        requestedWorkspaceId === activeWorkspace.business.id
      ) {
        setActiveWorkspace(null);
        sessionStorage.removeItem(ACTIVE_WORKSPACE_KEY);
        // Re-fetch remaining valid memberships
        fetchWorkspacesAndActivate();
      }
    });

    return unregister;
  }, [activeWorkspace, fetchWorkspacesAndActivate]);

  // Candidate workspace switch mutation
  const switchWorkspace = useCallback(
    async (candidateId: string): Promise<boolean> => {
      const seq = ++requestSeqRef.current;
      setError(null);

      try {
        // Execute probe with targetWorkspaceId
        const verifiedWorkspace = await apiRequest<WorkspaceResponse>('/workspaces/current', {
          scope: 'workspace',
          targetWorkspaceId: candidateId,
          method: 'GET',
        });

        // Discard if newer switch was initiated or user logged out
        if (seq !== requestSeqRef.current) return false;

        setActiveWorkspace(verifiedWorkspace);
        sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, verifiedWorkspace.business.id);
        return true;
      } catch (err: unknown) {
        // Probe failure is handled locally: active workspace remains untouched!
        if (seq !== requestSeqRef.current) return false;
        const msg =
          err instanceof ApiClientError
            ? err.problem?.detail || err.message
            : (err as Error).message || 'Unable to switch workspace.';
        setError(msg);
        return false;
      }
    },
    []
  );

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeWorkspace,
        isLoading,
        error,
        switchWorkspace,
        refreshWorkspaces: fetchWorkspacesAndActivate,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
};

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
