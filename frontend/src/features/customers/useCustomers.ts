import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  CustomerCreateRequest,
  CustomerListResponse,
  CustomerResponse,
  CustomerUpdateRequest,
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

interface ScopedCustomerListState {
  businessId: string;
  generation: number;
  customers: CustomerResponse[];
  totalCount: number;
  totalPages: number;
  isLoading: boolean;
  error: string | null;
}

interface ScopedMutationError {
  businessId: string;
  generation: number;
  error: string;
}

export interface UseCustomersResult {
  customers: CustomerResponse[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  setPage: (page: number) => void;
  statusFilter: 'ALL' | 'ACTIVE' | 'INACTIVE';
  setStatusFilter: (filter: 'ALL' | 'ACTIVE' | 'INACTIVE') => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isLoading: boolean;
  error: string | null;
  refreshCustomers: () => Promise<void>;
  createCustomer: (data: CustomerCreateRequest) => Promise<MutationResult<CustomerResponse>>;
  updateCustomer: (id: string, data: CustomerUpdateRequest) => Promise<MutationResult<CustomerResponse>>;
  deleteCustomer: (id: string) => Promise<MutationResult<void>>;
  deactivateCustomer: (id: string) => Promise<MutationResult<void>>;
  isCreating: boolean;
  isUpdating: boolean;
  isDeleting: boolean;
  isMutating: boolean;
  mutationError: string | null;
  clearMutationError: () => void;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  isReadOnly: boolean;
}

export function useCustomers(): UseCustomersResult {
  const { activeWorkspace, workspaceGeneration, isCurrentWorkspace } = useWorkspace();
  const [listState, setListState] = useState<ScopedCustomerListState | null>(null);
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(20);

  // Filter States
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Scoped mutation error state
  const [mutationErrorState, setMutationErrorState] = useState<ScopedMutationError | null>(null);

  // Active mutation lock state for UI reactivity
  const [activeLock, setActiveLock] = useState<MutationLock | null>(null);

  // Ref locks to avoid stale closures and separate request sequences
  const mutationLockRef = useRef<MutationLock | null>(null);
  const tokenCounterRef = useRef<number>(0);
  const listSeqRef = useRef<number>(0);

  const currentBusinessId = activeWorkspace?.id;
  const role = activeWorkspace?.role;
  const canCreate = role === 'OWNER' || role === 'ADMIN' || role === 'MEMBER';
  const canEdit = role === 'OWNER' || role === 'ADMIN' || role === 'MEMBER';
  const canDelete = role === 'OWNER' || role === 'ADMIN';
  const isReadOnly = role === 'VIEWER';

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
   * Fetch paginated customers list for the active workspace.
   * Uses independent request sequence (listSeqRef) and freshness verification.
   */
  const fetchCustomersForWorkspace = useCallback(
    async (targetBusinessId: string, targetGen: number): Promise<void> => {
      const seq = ++listSeqRef.current;
      setListState((prev) => {
        if (prev && prev.businessId === targetBusinessId && prev.generation === targetGen) {
          return { ...prev, isLoading: true, error: null };
        }
        return {
          businessId: targetBusinessId,
          generation: targetGen,
          customers: [],
          totalCount: 0,
          totalPages: 0,
          isLoading: true,
          error: null,
        };
      });

      const params = new URLSearchParams();
      if (statusFilter === 'ACTIVE') {
        params.append('is_active', 'true');
      } else if (statusFilter === 'INACTIVE') {
        params.append('is_active', 'false');
      }

      if (searchQuery.trim()) {
        params.append('search', searchQuery.trim());
      }
      params.append('page', String(page));
      params.append('page_size', String(pageSize));

      try {
        const queryStr = params.toString();
        const endpoint = `/customers${queryStr ? `?${queryStr}` : ''}`;
        const response = await apiRequest<CustomerListResponse>(endpoint, {
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

        setListState({
          businessId: targetBusinessId,
          generation: targetGen,
          customers: response.items,
          totalCount: response.total,
          totalPages: response.total_pages,
          isLoading: false,
          error: null,
        });
      } catch (err: unknown) {
        if (
          seq !== listSeqRef.current ||
          !isCurrentWorkspace(targetBusinessId, targetGen)
        ) {
          return;
        }

        const message =
          err instanceof ApiClientError
            ? err.problem?.detail || err.message
            : (err as Error).message || 'Failed to load customers.';

        setListState({
          businessId: targetBusinessId,
          generation: targetGen,
          customers: [],
          totalCount: 0,
          totalPages: 0,
          isLoading: false,
          error: message,
        });
      }
    },
    [statusFilter, searchQuery, page, pageSize, isCurrentWorkspace]
  );

  // Auto-fetch customers when active workspace, generation, or filters change
  useEffect(() => {
    if (!currentBusinessId) {
      setListState(null);
      return;
    }
    fetchCustomersForWorkspace(currentBusinessId, workspaceGeneration);
  }, [currentBusinessId, workspaceGeneration, fetchCustomersForWorkspace]);

  // Reset page to 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [statusFilter, searchQuery]);

  const refreshCustomers = useCallback(async (): Promise<void> => {
    if (currentBusinessId) {
      await fetchCustomersForWorkspace(currentBusinessId, workspaceGeneration);
    }
  }, [currentBusinessId, workspaceGeneration, fetchCustomersForWorkspace]);

  /**
   * Mutation: Create Customer with Concurrency & Workspace Isolation Guards
   */
  const createCustomer = useCallback(
    async (data: CustomerCreateRequest): Promise<MutationResult<CustomerResponse>> => {
      if (!currentBusinessId) {
        throw new Error('No active workspace available.');
      }
      if (!canCreate) {
        throw new Error('You do not have permission to create customers.');
      }

      const businessId = currentBusinessId;
      const generation = workspaceGeneration;

      if (mutationLockRef.current) {
        return { status: 'stale' };
      }

      const token = `cust-create-${++tokenCounterRef.current}`;
      const lock: MutationLock = {
        ownerToken: token,
        businessId,
        generation,
        type: 'create',
      };
      mutationLockRef.current = lock;
      setActiveLock(lock);
      setMutationErrorState(null);

      try {
        const response = await apiRequest<CustomerResponse>('/customers', {
          scope: 'workspace',
          targetWorkspaceId: businessId,
          targetWorkspaceGeneration: generation,
          method: 'POST',
          body: JSON.stringify(data),
        });

        // STALENESS CHECK: If workspace switched during async in-flight mutation, discard state update
        if (!isCurrentWorkspace(businessId, generation)) {
          return { status: 'stale' };
        }

        // Refresh list for the authoritative workspace
        await fetchCustomersForWorkspace(businessId, generation);

        // POST-REFRESH STALENESS CHECK: If workspace switched while refresh was pending
        if (!isCurrentWorkspace(businessId, generation)) {
          return { status: 'stale' };
        }

        return { status: 'applied', data: response };
      } catch (err: unknown) {
        if (isCurrentWorkspace(businessId, generation)) {
          const msg =
            err instanceof ApiClientError
              ? err.problem?.detail || err.message
              : (err as Error).message || 'Failed to create customer.';
          setMutationErrorState({
            businessId,
            generation,
            error: msg,
          });
        }
        throw err;
      } finally {
        if (mutationLockRef.current?.ownerToken === token) {
          mutationLockRef.current = null;
          setActiveLock(null);
        }
      }
    },
    [
      currentBusinessId,
      workspaceGeneration,
      canCreate,
      isCurrentWorkspace,
      fetchCustomersForWorkspace,
    ]
  );

  /**
   * Mutation: Update Customer with Concurrency & Workspace Isolation Guards
   */
  const updateCustomer = useCallback(
    async (
      id: string,
      data: CustomerUpdateRequest
    ): Promise<MutationResult<CustomerResponse>> => {
      if (!currentBusinessId) {
        throw new Error('No active workspace available.');
      }
      if (!canEdit) {
        throw new Error('You do not have permission to update customers.');
      }

      const businessId = currentBusinessId;
      const generation = workspaceGeneration;

      if (mutationLockRef.current) {
        return { status: 'stale' };
      }

      const token = `cust-update-${++tokenCounterRef.current}`;
      const lock: MutationLock = {
        ownerToken: token,
        businessId,
        generation,
        type: 'update',
      };
      mutationLockRef.current = lock;
      setActiveLock(lock);
      setMutationErrorState(null);

      try {
        const response = await apiRequest<CustomerResponse>(`/customers/${id}`, {
          scope: 'workspace',
          targetWorkspaceId: businessId,
          targetWorkspaceGeneration: generation,
          method: 'PATCH',
          body: JSON.stringify(data),
        });

        if (!isCurrentWorkspace(businessId, generation)) {
          return { status: 'stale' };
        }

        await fetchCustomersForWorkspace(businessId, generation);

        if (!isCurrentWorkspace(businessId, generation)) {
          return { status: 'stale' };
        }

        return { status: 'applied', data: response };
      } catch (err: unknown) {
        if (isCurrentWorkspace(businessId, generation)) {
          const msg =
            err instanceof ApiClientError
              ? err.problem?.detail || err.message
              : (err as Error).message || 'Failed to update customer.';
          setMutationErrorState({
            businessId,
            generation,
            error: msg,
          });
        }
        throw err;
      } finally {
        if (mutationLockRef.current?.ownerToken === token) {
          mutationLockRef.current = null;
          setActiveLock(null);
        }
      }
    },
    [
      currentBusinessId,
      workspaceGeneration,
      canEdit,
      isCurrentWorkspace,
      fetchCustomersForWorkspace,
    ]
  );

  /**
   * Mutation: Deactivate Customer (Soft Delete) with Concurrency Guards
   */
  const deleteCustomer = useCallback(
    async (id: string): Promise<MutationResult<void>> => {
      if (!currentBusinessId) {
        throw new Error('No active workspace available.');
      }
      if (!canDelete) {
        throw new Error('You do not have permission to deactivate customers.');
      }

      const businessId = currentBusinessId;
      const generation = workspaceGeneration;

      if (mutationLockRef.current) {
        return { status: 'stale' };
      }

      const token = `cust-delete-${++tokenCounterRef.current}`;
      const lock: MutationLock = {
        ownerToken: token,
        businessId,
        generation,
        type: 'delete',
      };
      mutationLockRef.current = lock;
      setActiveLock(lock);
      setMutationErrorState(null);

      try {
        await apiRequest<void>(`/customers/${id}`, {
          scope: 'workspace',
          targetWorkspaceId: businessId,
          targetWorkspaceGeneration: generation,
          method: 'DELETE',
        });

        if (!isCurrentWorkspace(businessId, generation)) {
          return { status: 'stale' };
        }

        await fetchCustomersForWorkspace(businessId, generation);

        if (!isCurrentWorkspace(businessId, generation)) {
          return { status: 'stale' };
        }

        return { status: 'applied' };
      } catch (err: unknown) {
        if (isCurrentWorkspace(businessId, generation)) {
          const msg =
            err instanceof ApiClientError
              ? err.problem?.detail || err.message
              : (err as Error).message || 'Failed to deactivate customer.';
          setMutationErrorState({
            businessId,
            generation,
            error: msg,
          });
        }
        throw err;
      } finally {
        if (mutationLockRef.current?.ownerToken === token) {
          mutationLockRef.current = null;
          setActiveLock(null);
        }
      }
    },
    [
      currentBusinessId,
      workspaceGeneration,
      canDelete,
      isCurrentWorkspace,
      fetchCustomersForWorkspace,
    ]
  );

  const clearMutationError = useCallback(() => {
    setMutationErrorState(null);
  }, []);

  // Authoritative derivation of state exposed to UI
  const isListCurrent = Boolean(
    listState &&
    currentBusinessId &&
    isCurrentWorkspace(listState.businessId, listState.generation)
  );

  const isMutationErrorCurrent = Boolean(
    mutationErrorState &&
    currentBusinessId &&
    isCurrentWorkspace(mutationErrorState.businessId, mutationErrorState.generation)
  );

  const exposedCustomers = isListCurrent ? listState!.customers : [];
  const exposedTotalCount = isListCurrent ? listState!.totalCount : 0;
  const exposedTotalPages = isListCurrent ? listState!.totalPages : 0;
  const exposedPage = isListCurrent ? page : 1;
  const exposedError = isListCurrent ? listState!.error : null;
  const exposedMutationError = isMutationErrorCurrent ? mutationErrorState!.error : null;

  const exposedIsLoading = Boolean(currentBusinessId) && (!isListCurrent || listState!.isLoading);

  return {
    customers: exposedCustomers,
    totalCount: exposedTotalCount,
    page: exposedPage,
    pageSize,
    totalPages: exposedTotalPages,
    setPage,
    statusFilter,
    setStatusFilter,
    searchQuery,
    setSearchQuery,
    isLoading: exposedIsLoading,
    error: exposedError,
    refreshCustomers,
    createCustomer,
    updateCustomer,
    deleteCustomer,
    deactivateCustomer: deleteCustomer,
    isCreating,
    isUpdating,
    isDeleting,
    isMutating,
    mutationError: exposedMutationError,
    clearMutationError,
    canCreate,
    canEdit,
    canDelete,
    isReadOnly,
  };
}
