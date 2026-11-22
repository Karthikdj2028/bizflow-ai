import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { WorkspaceItem, WorkspaceListResponse, WorkspaceResponse } from '../../types/api';
import { useAuth } from '../auth/AuthContext';
import {
  apiRequest,
  registerWorkspaceErrorHandler,
  ACTIVE_WORKSPACE_KEY,
  ApiClientError,
} from '../../lib/api';

export interface WorkspaceContextValue {
  workspaces: WorkspaceItem[];
  activeWorkspace: WorkspaceItem | null;
  workspaceGeneration: number;
  isLoading: boolean;
  error: string | null;
  switchWorkspace: (candidateId: string) => Promise<boolean>;
  refreshWorkspaces: () => Promise<void>;
  isCurrentWorkspace: (businessId: string | null | undefined, generation: number) => boolean;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceItem | null>(null);
  const [workspaceGeneration, setWorkspaceGeneration] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Authoritative snapshot ref updated strictly within transition actions (outside render)
  const authoritativeSnapshotRef = useRef<{
    businessId: string | null;
    generation: number;
  }>({
    businessId: null,
    generation: 1,
  });

  // Centralized transition helper keeping snapshot ref and React state strictly synchronized
  const applyWorkspaceTransition = useCallback((nextWorkspace: WorkspaceItem | null) => {
    const nextGen = authoritativeSnapshotRef.current.generation + 1;
    const nextBusinessId = nextWorkspace?.id ?? null;

    // 1. Update authoritative snapshot synchronously in the action
    authoritativeSnapshotRef.current = {
      businessId: nextBusinessId,
      generation: nextGen,
    };

    // 2. Schedule React state updates atomically
    setActiveWorkspace(nextWorkspace);
    setWorkspaceGeneration(nextGen);
  }, []);

  // Stable, concurrency-safe snapshot verifier (safe across async closures)
  const isCurrentWorkspace = useCallback(
    (businessId: string | null | undefined, generation: number): boolean => {
      const snapshot = authoritativeSnapshotRef.current;
      return (
        Boolean(businessId) &&
        snapshot.businessId === businessId &&
        snapshot.generation === generation
      );
    },
    []
  );

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

      const items = response.items || (response as any).workspaces || [];
      setWorkspaces(items);

      if (items.length === 0) {
        sessionStorage.removeItem(ACTIVE_WORKSPACE_KEY);
        applyWorkspaceTransition(null);
        return;
      }

      // Check saved workspace candidate from sessionStorage
      const savedId = sessionStorage.getItem(ACTIVE_WORKSPACE_KEY);
      let candidate = items.find((w) => w.id === savedId);

      if (candidate) {
        try {
          // Pre-activation probe
          const currentRes = await apiRequest<WorkspaceResponse>('/workspaces/current', {
            scope: 'workspace',
            targetWorkspaceId: candidate.id,
            targetWorkspaceGeneration: authoritativeSnapshotRef.current.generation,
            method: 'GET',
          });

          if (seq !== requestSeqRef.current) return;
          applyWorkspaceTransition(currentRes);
          sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, currentRes.id);
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
          targetWorkspaceId: fallback.id,
          targetWorkspaceGeneration: authoritativeSnapshotRef.current.generation,
          method: 'GET',
        });

        if (seq !== requestSeqRef.current) return;
        applyWorkspaceTransition(fallbackRes);
        sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, fallbackRes.id);
      } catch {
        if (seq !== requestSeqRef.current) return;
        // Even if probe fails, set fallback item so UI can present membership
        applyWorkspaceTransition(fallback);
      }
    } catch (err: unknown) {
      if (seq !== requestSeqRef.current) return;
      setError((err as Error).message || 'Failed to load workspaces.');
    } finally {
      if (seq === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [applyWorkspaceTransition]);

  // Coordinate with AuthProvider lifecycle
  useEffect(() => {
    // 1. Do nothing while authentication is in initial loading state
    if (authLoading) {
      return;
    }

    // 2. Clear state ONLY after an established authenticated session transitions to unauthenticated
    if (wasAuthenticatedRef.current && !isAuthenticated) {
      ++requestSeqRef.current; // Invalidate any pending in-flight requests
      sessionStorage.removeItem(ACTIVE_WORKSPACE_KEY);
      setWorkspaces([]);
      applyWorkspaceTransition(null);
      wasAuthenticatedRef.current = false;
      return;
    }

    // 3. Established authentication: load workspaces
    if (isAuthenticated) {
      wasAuthenticatedRef.current = true;
      fetchWorkspacesAndActivate();
    }
  }, [isAuthenticated, authLoading, fetchWorkspacesAndActivate, applyWorkspaceTransition]);

  // Register workspace error listener for active workspace revocation
  useEffect(() => {
    const unregister = registerWorkspaceErrorHandler((err, requestedWorkspaceId, requestedGen) => {
      // Invalidate ONLY if the error occurred on the currently active workspace in the authoritative snapshot
      // AND the originating generation strictly matches the current authoritative generation!
      const snapshot = authoritativeSnapshotRef.current;
      const isStrictGenerationMatch =
        typeof requestedGen === 'number' && requestedGen === snapshot.generation;

      if (
        err.status === 404 &&
        err.problem?.code === 'BUSINESS_NOT_FOUND' &&
        snapshot.businessId !== null &&
        requestedWorkspaceId === snapshot.businessId &&
        isStrictGenerationMatch
      ) {
        sessionStorage.removeItem(ACTIVE_WORKSPACE_KEY);
        applyWorkspaceTransition(null);
        // Re-fetch remaining valid memberships
        fetchWorkspacesAndActivate();
      }
    });

    return unregister;
  }, [fetchWorkspacesAndActivate, applyWorkspaceTransition]);

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
          targetWorkspaceGeneration: authoritativeSnapshotRef.current.generation,
          method: 'GET',
        });

        // Discard if newer switch was initiated or user logged out
        if (seq !== requestSeqRef.current) return false;

        applyWorkspaceTransition(verifiedWorkspace);
        sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, verifiedWorkspace.id);
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
    [applyWorkspaceTransition]
  );

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeWorkspace,
        workspaceGeneration,
        isLoading,
        error,
        switchWorkspace,
        refreshWorkspaces: fetchWorkspacesAndActivate,
        isCurrentWorkspace,
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
