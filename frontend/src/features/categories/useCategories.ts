import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  CategoryCreateRequest,
  CategoryListResponse,
  CategoryResponse,
  CategoryUpdateRequest,
} from '../../types/api';
import { useWorkspace } from '../workspaces/WorkspaceContext';
import { apiRequest, ApiClientError } from '../../lib/api';

export type MutationResult<T = void> =
  | { status: 'applied'; data?: T }
  | { status: 'stale'; data?: undefined };

interface MutationLock {
  ownerToken: string;
  businessId: string;
  generation: number;
  type: 'create' | 'update' | 'delete';
}

export interface UseCategoriesResult {
  categories: CategoryResponse[];
  filteredCategories: CategoryResponse[];
  typeFilter: 'ALL' | 'INCOME' | 'EXPENSE';
  setTypeFilter: (filter: 'ALL' | 'INCOME' | 'EXPENSE') => void;
  isLoading: boolean;
  error: string | null;
  refreshCategories: () => Promise<void>;
  createCategory: (data: CategoryCreateRequest) => Promise<MutationResult<CategoryResponse>>;
  updateCategory: (id: string, data: CategoryUpdateRequest) => Promise<MutationResult<CategoryResponse>>;
  deleteCategory: (id: string) => Promise<MutationResult<void>>;
  isCreating: boolean;
  isUpdating: boolean;
  isDeleting: boolean;
  isMutating: boolean;
  mutationError: string | null;
  clearMutationError: () => void;
  canManage: boolean;
}

export function useCategories(): UseCategoriesResult {
  const { activeWorkspace, workspaceGeneration, isCurrentWorkspace } = useWorkspace();
  const [categories, setCategories] = useState<CategoryResponse[]>([]);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'INCOME' | 'EXPENSE'>('ALL');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Active mutation lock state for UI reactivity
  const [activeLock, setActiveLock] = useState<MutationLock | null>(null);

  // Synchronous lock ref to prevent race conditions during synchronous event dispatch
  const mutationLockRef = useRef<MutationLock | null>(null);
  const tokenCounterRef = useRef<number>(0);
  const listSeqRef = useRef<number>(0);

  const currentBusinessId = activeWorkspace?.id;
  const role = activeWorkspace?.role;
  const canManage = role === 'OWNER' || role === 'ADMIN';

  // Derived loading states bound strictly to current authoritative workspace and generation
  const isLockActiveForCurrentWorkspace = useMemo(() => {
    return (
      activeLock !== null &&
      isCurrentWorkspace(activeLock.businessId, activeLock.generation)
    );
  }, [activeLock, isCurrentWorkspace]);

  const isCreating = isLockActiveForCurrentWorkspace && activeLock?.type === 'create';
  const isUpdating = isLockActiveForCurrentWorkspace && activeLock?.type === 'update';
  const isDeleting = isLockActiveForCurrentWorkspace && activeLock?.type === 'delete';
  const isMutating = isLockActiveForCurrentWorkspace;

  /**
   * Fetch categories explicitly scoped to a target workspace ID and generation.
   * Guarantees that stale list responses from prior workspaces never update state.
   */
  const fetchCategoriesForWorkspace = useCallback(
    async (targetBusinessId: string, targetGen: number): Promise<void> => {
      const seq = ++listSeqRef.current;
      setIsLoading(true);
      setError(null);

      try {
        const response = await apiRequest<CategoryListResponse>('/categories', {
          scope: 'workspace',
          targetWorkspaceId: targetBusinessId,
          targetWorkspaceGeneration: targetGen,
          method: 'GET',
        });

        // FRESHNESS CHECK: Discard if newer list request was issued or workspace generation advanced
        if (
          seq !== listSeqRef.current ||
          !isCurrentWorkspace(targetBusinessId, targetGen)
        ) {
          return;
        }

        setCategories(response.items || []);
      } catch (err: unknown) {
        if (
          seq !== listSeqRef.current ||
          !isCurrentWorkspace(targetBusinessId, targetGen)
        ) {
          return;
        }

        const msg =
          err instanceof ApiClientError
            ? err.problem?.detail || err.message
            : (err as Error).message || 'Failed to load categories.';
        setError(msg);
      } finally {
        if (
          seq === listSeqRef.current &&
          isCurrentWorkspace(targetBusinessId, targetGen)
        ) {
          setIsLoading(false);
        }
      }
    },
    [isCurrentWorkspace]
  );

  // Trigger category load whenever active workspace changes
  useEffect(() => {
    if (!currentBusinessId) {
      setCategories([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    fetchCategoriesForWorkspace(currentBusinessId, workspaceGeneration);
  }, [currentBusinessId, workspaceGeneration, fetchCategoriesForWorkspace]);

  /**
   * Helper to release a mutation lock safely without allowing stale cleanup
   * to release a newer lock acquired by a different workspace or operation.
   */
  const releaseLock = useCallback((tokenToRelease: string) => {
    if (mutationLockRef.current?.ownerToken === tokenToRelease) {
      mutationLockRef.current = null;
      setActiveLock(null);
    }
  }, []);

  /**
   * Extract human-readable error detail from RFC 9457 Problem Details.
   */
  const extractErrorMessage = (err: unknown): string => {
    if (err instanceof ApiClientError) {
      return err.problem?.detail || err.message;
    }
    return (err as Error).message || 'An unexpected error occurred.';
  };

  /**
   * Create category mutation with full lifecycle guards.
   */
  const createCategory = useCallback(
    async (data: CategoryCreateRequest): Promise<MutationResult<CategoryResponse>> => {
      const targetBusinessId = activeWorkspace?.id;
      const targetGen = workspaceGeneration;

      if (!targetBusinessId) {
        throw new Error('Cannot create category: No active workspace.');
      }

      // Check for active lock on CURRENT workspace and generation
      if (
        mutationLockRef.current &&
        isCurrentWorkspace(mutationLockRef.current.businessId, mutationLockRef.current.generation)
      ) {
        throw new Error('A category operation is already in progress. Please wait.');
      }

      // Acquire generation-safe lock
      const ownerToken = `lock_${targetGen}_${++tokenCounterRef.current}`;
      const lock: MutationLock = {
        ownerToken,
        businessId: targetBusinessId,
        generation: targetGen,
        type: 'create',
      };
      mutationLockRef.current = lock;
      setActiveLock(lock);
      setMutationError(null);

      // Verify freshness before dispatch
      if (!isCurrentWorkspace(targetBusinessId, targetGen)) {
        releaseLock(ownerToken);
        return { status: 'stale' };
      }

      try {
        const response = await apiRequest<CategoryResponse>('/categories', {
          scope: 'workspace',
          targetWorkspaceId: targetBusinessId,
          targetWorkspaceGeneration: targetGen,
          method: 'POST',
          body: JSON.stringify(data),
        });

        // FRESHNESS CHECK 1: After primary mutation
        if (!isCurrentWorkspace(targetBusinessId, targetGen)) {
          releaseLock(ownerToken);
          return { status: 'stale' };
        }

        // Refresh category list explicitly scoped to target workspace
        await fetchCategoriesForWorkspace(targetBusinessId, targetGen);

        // FRESHNESS CHECK 2: Immediately before UI delivery
        if (!isCurrentWorkspace(targetBusinessId, targetGen)) {
          releaseLock(ownerToken);
          return { status: 'stale' };
        }

        releaseLock(ownerToken);
        return { status: 'applied', data: response };
      } catch (err: unknown) {
        if (!isCurrentWorkspace(targetBusinessId, targetGen)) {
          releaseLock(ownerToken);
          return { status: 'stale' };
        }

        releaseLock(ownerToken);
        setMutationError(extractErrorMessage(err));
        throw err;
      }
    },
    [activeWorkspace?.id, workspaceGeneration, isCurrentWorkspace, fetchCategoriesForWorkspace, releaseLock]
  );

  /**
   * Update category mutation with full lifecycle guards.
   */
  const updateCategory = useCallback(
    async (
      id: string,
      data: CategoryUpdateRequest
    ): Promise<MutationResult<CategoryResponse>> => {
      const targetBusinessId = activeWorkspace?.id;
      const targetGen = workspaceGeneration;

      if (!targetBusinessId) {
        throw new Error('Cannot update category: No active workspace.');
      }

      if (
        mutationLockRef.current &&
        isCurrentWorkspace(mutationLockRef.current.businessId, mutationLockRef.current.generation)
      ) {
        throw new Error('A category operation is already in progress. Please wait.');
      }

      const ownerToken = `lock_${targetGen}_${++tokenCounterRef.current}`;
      const lock: MutationLock = {
        ownerToken,
        businessId: targetBusinessId,
        generation: targetGen,
        type: 'update',
      };
      mutationLockRef.current = lock;
      setActiveLock(lock);
      setMutationError(null);

      if (!isCurrentWorkspace(targetBusinessId, targetGen)) {
        releaseLock(ownerToken);
        return { status: 'stale' };
      }

      try {
        const response = await apiRequest<CategoryResponse>(`/categories/${id}`, {
          scope: 'workspace',
          targetWorkspaceId: targetBusinessId,
          targetWorkspaceGeneration: targetGen,
          method: 'PATCH',
          body: JSON.stringify(data),
        });

        // FRESHNESS CHECK 1
        if (!isCurrentWorkspace(targetBusinessId, targetGen)) {
          releaseLock(ownerToken);
          return { status: 'stale' };
        }

        await fetchCategoriesForWorkspace(targetBusinessId, targetGen);

        // FRESHNESS CHECK 2
        if (!isCurrentWorkspace(targetBusinessId, targetGen)) {
          releaseLock(ownerToken);
          return { status: 'stale' };
        }

        releaseLock(ownerToken);
        return { status: 'applied', data: response };
      } catch (err: unknown) {
        if (!isCurrentWorkspace(targetBusinessId, targetGen)) {
          releaseLock(ownerToken);
          return { status: 'stale' };
        }

        releaseLock(ownerToken);
        setMutationError(extractErrorMessage(err));
        throw err;
      }
    },
    [activeWorkspace?.id, workspaceGeneration, isCurrentWorkspace, fetchCategoriesForWorkspace, releaseLock]
  );

  /**
   * Delete category mutation with full lifecycle guards and 204 handling.
   */
  const deleteCategory = useCallback(
    async (id: string): Promise<MutationResult<void>> => {
      const targetBusinessId = activeWorkspace?.id;
      const targetGen = workspaceGeneration;

      if (!targetBusinessId) {
        throw new Error('Cannot delete category: No active workspace.');
      }

      if (
        mutationLockRef.current &&
        isCurrentWorkspace(mutationLockRef.current.businessId, mutationLockRef.current.generation)
      ) {
        throw new Error('A category operation is already in progress. Please wait.');
      }

      const ownerToken = `lock_${targetGen}_${++tokenCounterRef.current}`;
      const lock: MutationLock = {
        ownerToken,
        businessId: targetBusinessId,
        generation: targetGen,
        type: 'delete',
      };
      mutationLockRef.current = lock;
      setActiveLock(lock);
      setMutationError(null);

      if (!isCurrentWorkspace(targetBusinessId, targetGen)) {
        releaseLock(ownerToken);
        return { status: 'stale' };
      }

      try {
        await apiRequest<void>(`/categories/${id}`, {
          scope: 'workspace',
          targetWorkspaceId: targetBusinessId,
          targetWorkspaceGeneration: targetGen,
          method: 'DELETE',
        });

        // FRESHNESS CHECK 1
        if (!isCurrentWorkspace(targetBusinessId, targetGen)) {
          releaseLock(ownerToken);
          return { status: 'stale' };
        }

        await fetchCategoriesForWorkspace(targetBusinessId, targetGen);

        // FRESHNESS CHECK 2
        if (!isCurrentWorkspace(targetBusinessId, targetGen)) {
          releaseLock(ownerToken);
          return { status: 'stale' };
        }

        releaseLock(ownerToken);
        return { status: 'applied' };
      } catch (err: unknown) {
        if (!isCurrentWorkspace(targetBusinessId, targetGen)) {
          releaseLock(ownerToken);
          return { status: 'stale' };
        }

        releaseLock(ownerToken);
        setMutationError(extractErrorMessage(err));
        throw err;
      }
    },
    [activeWorkspace?.id, workspaceGeneration, isCurrentWorkspace, fetchCategoriesForWorkspace, releaseLock]
  );

  const clearMutationError = useCallback(() => {
    setMutationError(null);
  }, []);

  const refreshCategories = useCallback(async () => {
    if (currentBusinessId) {
      await fetchCategoriesForWorkspace(currentBusinessId, workspaceGeneration);
    }
  }, [currentBusinessId, workspaceGeneration, fetchCategoriesForWorkspace]);

  const filteredCategories = useMemo(() => {
    if (typeFilter === 'ALL') return categories;
    return categories.filter((c) => c.type === typeFilter);
  }, [categories, typeFilter]);

  return {
    categories,
    filteredCategories,
    typeFilter,
    setTypeFilter,
    isLoading,
    error,
    refreshCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    isCreating,
    isUpdating,
    isDeleting,
    isMutating,
    mutationError,
    clearMutationError,
    canManage,
  };
}
