import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  InvoiceCreateRequest,
  InvoiceDetailResponse,
  InvoiceListItemResponse,
  InvoicePaginationResponse,
  InvoiceUpdateRequest,
  InvoiceStatusTransitionRequest,
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
  type: 'create' | 'update' | 'status';
}

interface ScopedInvoiceListState {
  businessId: string;
  generation: number;
  invoices: InvoiceListItemResponse[];
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

export interface UseInvoicesResult {
  invoices: InvoiceListItemResponse[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  setPage: (page: number) => void;
  statusFilter: string;
  setStatusFilter: (filter: string) => void;
  customerIdFilter: string;
  setCustomerIdFilter: (id: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  issueDateFrom: string;
  setIssueDateFrom: (date: string) => void;
  issueDateTo: string;
  setIssueDateTo: (date: string) => void;
  dueDateFrom: string;
  setDueDateFrom: (date: string) => void;
  dueDateTo: string;
  setDueDateTo: (date: string) => void;
  isLoading: boolean;
  error: string | null;
  refreshInvoices: () => Promise<void>;
  createInvoice: (data: InvoiceCreateRequest) => Promise<MutationResult<InvoiceDetailResponse>>;
  updateInvoice: (id: string, data: InvoiceUpdateRequest) => Promise<MutationResult<InvoiceDetailResponse>>;
  transitionStatus: (id: string, action: 'MARK_SENT' | 'CANCEL') => Promise<MutationResult<InvoiceDetailResponse>>;
  getInvoiceDetail: (id: string) => Promise<InvoiceDetailResponse>;
  isCreating: boolean;
  isUpdating: boolean;
  isTransitioning: boolean;
  isMutating: boolean;
  mutationError: string | null;
  clearMutationError: () => void;
  canCreate: boolean;
  canEdit: boolean;
  canSend: boolean;
  canCancel: boolean;
  isReadOnly: boolean;
}

export function useInvoices(): UseInvoicesResult {
  const { activeWorkspace, workspaceGeneration, isCurrentWorkspace } = useWorkspace();
  const [listState, setListState] = useState<ScopedInvoiceListState | null>(null);
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(20);

  // Filter States
  const [statusFilter, setStatusFilterState] = useState<string>('ALL');
  const [customerIdFilter, setCustomerIdFilterState] = useState<string>('');
  const [searchQuery, setSearchQueryState] = useState<string>('');
  const [issueDateFrom, setIssueDateFromState] = useState<string>('');
  const [issueDateTo, setIssueDateToState] = useState<string>('');
  const [dueDateFrom, setDueDateFromState] = useState<string>('');
  const [dueDateTo, setDueDateToState] = useState<string>('');

  // Mutation error and locking
  const [mutationErrorState, setMutationErrorState] = useState<ScopedMutationError | null>(null);
  const [activeLock, setActiveLock] = useState<MutationLock | null>(null);

  const mutationLockRef = useRef<MutationLock | null>(null);
  const tokenCounterRef = useRef<number>(0);
  const listSeqRef = useRef<number>(0);

  const currentBusinessId = activeWorkspace?.id;
  const role = activeWorkspace?.role;

  // Role permissions: OWNER, ADMIN, and MEMBER have full write access; VIEWER is read-only
  const canCreate = role === 'OWNER' || role === 'ADMIN' || role === 'MEMBER';
  const canEdit = role === 'OWNER' || role === 'ADMIN' || role === 'MEMBER';
  const canSend = role === 'OWNER' || role === 'ADMIN' || role === 'MEMBER';
  const canCancel = role === 'OWNER' || role === 'ADMIN' || role === 'MEMBER';
  const isReadOnly = role === 'VIEWER';

  // Automatically reset page to 1 whenever any filter changes
  const setStatusFilter = useCallback((filter: string) => {
    setStatusFilterState(filter);
    setPage(1);
  }, []);

  const setCustomerIdFilter = useCallback((id: string) => {
    setCustomerIdFilterState(id);
    setPage(1);
  }, []);

  const setSearchQuery = useCallback((query: string) => {
    setSearchQueryState(query);
    setPage(1);
  }, []);

  const setIssueDateFrom = useCallback((date: string) => {
    setIssueDateFromState(date);
    setPage(1);
  }, []);

  const setIssueDateTo = useCallback((date: string) => {
    setIssueDateToState(date);
    setPage(1);
  }, []);

  const setDueDateFrom = useCallback((date: string) => {
    setDueDateFromState(date);
    setPage(1);
  }, []);

  const setDueDateTo = useCallback((date: string) => {
    setDueDateToState(date);
    setPage(1);
  }, []);

  const isLockActiveForCurrentWorkspace = useMemo(() => {
    return (
      activeLock !== null &&
      isCurrentWorkspace(activeLock.businessId, activeLock.generation)
    );
  }, [activeLock, isCurrentWorkspace]);

  const isCreating = isLockActiveForCurrentWorkspace && activeLock?.type === 'create';
  const isUpdating = isLockActiveForCurrentWorkspace && activeLock?.type === 'update';
  const isTransitioning = isLockActiveForCurrentWorkspace && activeLock?.type === 'status';
  const isMutating = isLockActiveForCurrentWorkspace;

  /**
   * Fetch paginated invoices for active workspace.
   */
  const fetchInvoicesForWorkspace = useCallback(
    async (targetBusinessId: string, targetGen: number): Promise<void> => {
      const seq = ++listSeqRef.current;
      setListState((prev) => {
        if (prev && prev.businessId === targetBusinessId && prev.generation === targetGen) {
          return { ...prev, isLoading: true, error: null };
        }
        return {
          businessId: targetBusinessId,
          generation: targetGen,
          invoices: [],
          totalCount: 0,
          totalPages: 0,
          isLoading: true,
          error: null,
        };
      });

      const params = new URLSearchParams();
      if (statusFilter && statusFilter.toUpperCase() !== 'ALL') {
        params.append('status', statusFilter.toUpperCase());
      }
      if (customerIdFilter) {
        params.append('customer_id', customerIdFilter);
      }
      if (searchQuery.trim()) {
        params.append('search', searchQuery.trim());
      }
      if (issueDateFrom.trim()) {
        params.append('issue_date_from', issueDateFrom.trim());
      }
      if (issueDateTo.trim()) {
        params.append('issue_date_to', issueDateTo.trim());
      }
      if (dueDateFrom.trim()) {
        params.append('due_date_from', dueDateFrom.trim());
      }
      if (dueDateTo.trim()) {
        params.append('due_date_to', dueDateTo.trim());
      }
      params.append('page', String(page));
      params.append('page_size', String(pageSize));

      try {
        const queryStr = params.toString();
        const endpoint = `/invoices${queryStr ? `?${queryStr}` : ''}`;
        const response = await apiRequest<InvoicePaginationResponse>(endpoint, {
          scope: 'workspace',
          targetWorkspaceId: targetBusinessId,
          targetWorkspaceGeneration: targetGen,
        });

        // Verification against race conditions
        if (seq !== listSeqRef.current || !isCurrentWorkspace(targetBusinessId, targetGen)) {
          return;
        }

        setListState({
          businessId: targetBusinessId,
          generation: targetGen,
          invoices: response.items,
          totalCount: response.total,
          totalPages: response.total_pages,
          isLoading: false,
          error: null,
        });
      } catch (err: unknown) {
        if (seq !== listSeqRef.current || !isCurrentWorkspace(targetBusinessId, targetGen)) {
          return;
        }
        const message =
          err instanceof ApiClientError
            ? err.problem?.detail || err.message
            : (err as Error).message || 'Failed to load invoices.';

        setListState((prev) =>
          prev
            ? { ...prev, isLoading: false, error: message }
            : {
                businessId: targetBusinessId,
                generation: targetGen,
                invoices: [],
                totalCount: 0,
                totalPages: 0,
                isLoading: false,
                error: message,
              }
        );
      }
    },
    [
      statusFilter,
      customerIdFilter,
      searchQuery,
      issueDateFrom,
      issueDateTo,
      dueDateFrom,
      dueDateTo,
      page,
      pageSize,
      isCurrentWorkspace,
    ]
  );

  // Trigger fetch whenever active workspace, generation, or filters change
  useEffect(() => {
    if (!currentBusinessId) {
      setListState(null);
      return;
    }
    fetchInvoicesForWorkspace(currentBusinessId, workspaceGeneration);
  }, [currentBusinessId, workspaceGeneration, fetchInvoicesForWorkspace]);

  // Invalidate mutation lock and error when workspace switches
  useEffect(() => {
    mutationLockRef.current = null;
    setActiveLock(null);
    setMutationErrorState(null);
  }, [currentBusinessId, workspaceGeneration]);

  const acquireMutationLock = (type: 'create' | 'update' | 'status'): string | null => {
    if (!currentBusinessId) return null;
    if (
      mutationLockRef.current !== null &&
      isCurrentWorkspace(mutationLockRef.current.businessId, mutationLockRef.current.generation)
    ) {
      return null; // Concurrency conflict
    }
    const token = `mut-${++tokenCounterRef.current}`;
    const lock: MutationLock = {
      ownerToken: token,
      businessId: currentBusinessId,
      generation: workspaceGeneration,
      type,
    };
    mutationLockRef.current = lock;
    setActiveLock(lock);
    return token;
  };

  const releaseMutationLock = (token: string) => {
    if (mutationLockRef.current?.ownerToken === token) {
      mutationLockRef.current = null;
      setActiveLock(null);
    }
  };

  const refreshInvoices = useCallback(async (): Promise<void> => {
    if (!currentBusinessId) return;
    await fetchInvoicesForWorkspace(currentBusinessId, workspaceGeneration);
  }, [currentBusinessId, workspaceGeneration, fetchInvoicesForWorkspace]);

  const clearMutationError = useCallback(() => {
    setMutationErrorState(null);
  }, []);

  const createInvoice = useCallback(
    async (data: InvoiceCreateRequest): Promise<MutationResult<InvoiceDetailResponse>> => {
      if (!currentBusinessId) throw new Error('No active workspace selected.');
      const targetBusinessId = currentBusinessId;
      const targetGen = workspaceGeneration;

      const token = acquireMutationLock('create');
      if (!token) {
        throw new Error('A mutation is already in progress for this workspace.');
      }
      setMutationErrorState(null);

      try {
        const response = await apiRequest<InvoiceDetailResponse>('/invoices', {
          scope: 'workspace',
          method: 'POST',
          body: JSON.stringify(data),
          targetWorkspaceId: targetBusinessId,
          targetWorkspaceGeneration: targetGen,
        });

        if (!isCurrentWorkspace(targetBusinessId, targetGen)) {
          return { status: 'stale' };
        }

        // Reconcile response directly into listState
        setListState((prev) => {
          if (!prev || prev.businessId !== targetBusinessId || prev.generation !== targetGen) {
            return prev;
          }
          return {
            ...prev,
            invoices: [response, ...prev.invoices],
            totalCount: prev.totalCount + 1,
          };
        });

        // Trigger background refresh for pagination and ordering consistency
        void refreshInvoices();
        return { status: 'applied', data: response };
      } catch (err: unknown) {
        if (isCurrentWorkspace(targetBusinessId, targetGen)) {
          const message =
            err instanceof ApiClientError
              ? err.problem?.detail || err.message
              : (err as Error).message || 'Failed to create invoice.';
          setMutationErrorState({
            businessId: targetBusinessId,
            generation: targetGen,
            error: message,
          });
        }
        throw err;
      } finally {
        releaseMutationLock(token);
      }
    },
    [currentBusinessId, workspaceGeneration, isCurrentWorkspace, refreshInvoices]
  );

  const updateInvoice = useCallback(
    async (id: string, data: InvoiceUpdateRequest): Promise<MutationResult<InvoiceDetailResponse>> => {
      if (!currentBusinessId) throw new Error('No active workspace selected.');
      const targetBusinessId = currentBusinessId;
      const targetGen = workspaceGeneration;

      const token = acquireMutationLock('update');
      if (!token) {
        throw new Error('A mutation is already in progress for this workspace.');
      }
      setMutationErrorState(null);

      try {
        const response = await apiRequest<InvoiceDetailResponse>(`/invoices/${id}`, {
          scope: 'workspace',
          method: 'PATCH',
          body: JSON.stringify(data),
          targetWorkspaceId: targetBusinessId,
          targetWorkspaceGeneration: targetGen,
        });

        if (!isCurrentWorkspace(targetBusinessId, targetGen)) {
          return { status: 'stale' };
        }

        // Reconcile response directly into listState
        setListState((prev) => {
          if (!prev || prev.businessId !== targetBusinessId || prev.generation !== targetGen) {
            return prev;
          }
          return {
            ...prev,
            invoices: prev.invoices.map((inv) => (inv.id === id ? response : inv)),
          };
        });

        void refreshInvoices();
        return { status: 'applied', data: response };
      } catch (err: unknown) {
        if (isCurrentWorkspace(targetBusinessId, targetGen)) {
          const message =
            err instanceof ApiClientError
              ? err.problem?.detail || err.message
              : (err as Error).message || 'Failed to update invoice.';
          setMutationErrorState({
            businessId: targetBusinessId,
            generation: targetGen,
            error: message,
          });
        }
        throw err;
      } finally {
        releaseMutationLock(token);
      }
    },
    [currentBusinessId, workspaceGeneration, isCurrentWorkspace, refreshInvoices]
  );

  const transitionStatus = useCallback(
    async (
      id: string,
      action: 'MARK_SENT' | 'CANCEL'
    ): Promise<MutationResult<InvoiceDetailResponse>> => {
      if (!currentBusinessId) throw new Error('No active workspace selected.');
      const targetBusinessId = currentBusinessId;
      const targetGen = workspaceGeneration;

      const token = acquireMutationLock('status');
      if (!token) {
        throw new Error('A mutation is already in progress for this workspace.');
      }
      setMutationErrorState(null);

      try {
        const payload: InvoiceStatusTransitionRequest = { action };
        const response = await apiRequest<InvoiceDetailResponse>(`/invoices/${id}/status`, {
          scope: 'workspace',
          method: 'POST',
          body: JSON.stringify(payload),
          targetWorkspaceId: targetBusinessId,
          targetWorkspaceGeneration: targetGen,
        });

        if (!isCurrentWorkspace(targetBusinessId, targetGen)) {
          return { status: 'stale' };
        }

        // Reconcile response directly into listState
        setListState((prev) => {
          if (!prev || prev.businessId !== targetBusinessId || prev.generation !== targetGen) {
            return prev;
          }
          return {
            ...prev,
            invoices: prev.invoices.map((inv) => (inv.id === id ? response : inv)),
          };
        });

        void refreshInvoices();
        return { status: 'applied', data: response };
      } catch (err: unknown) {
        if (isCurrentWorkspace(targetBusinessId, targetGen)) {
          const message =
            err instanceof ApiClientError
              ? err.problem?.detail || err.message
              : (err as Error).message || `Failed to ${action === 'MARK_SENT' ? 'send' : 'cancel'} invoice.`;
          setMutationErrorState({
            businessId: targetBusinessId,
            generation: targetGen,
            error: message,
          });
        }
        throw err;
      } finally {
        releaseMutationLock(token);
      }
    },
    [currentBusinessId, workspaceGeneration, isCurrentWorkspace, refreshInvoices]
  );

  const getInvoiceDetail = useCallback(
    async (id: string): Promise<InvoiceDetailResponse> => {
      if (!currentBusinessId) throw new Error('No active workspace selected.');
      return await apiRequest<InvoiceDetailResponse>(`/invoices/${id}`, {
        scope: 'workspace',
        method: 'GET',
        targetWorkspaceId: currentBusinessId,
        targetWorkspaceGeneration: workspaceGeneration,
      });
    },
    [currentBusinessId, workspaceGeneration]
  );

  const activeInvoices =
    listState &&
    isCurrentWorkspace(listState.businessId, listState.generation) &&
    listState.businessId === currentBusinessId
      ? listState.invoices
      : [];

  const activeTotalCount =
    listState &&
    isCurrentWorkspace(listState.businessId, listState.generation) &&
    listState.businessId === currentBusinessId
      ? listState.totalCount
      : 0;

  const activeTotalPages =
    listState &&
    isCurrentWorkspace(listState.businessId, listState.generation) &&
    listState.businessId === currentBusinessId
      ? listState.totalPages
      : 0;

  const activeIsLoading =
    !listState ||
    !isCurrentWorkspace(listState.businessId, listState.generation) ||
    listState.isLoading;

  const activeError =
    listState &&
    isCurrentWorkspace(listState.businessId, listState.generation)
      ? listState.error
      : null;

  const activeMutationError =
    mutationErrorState &&
    isCurrentWorkspace(mutationErrorState.businessId, mutationErrorState.generation)
      ? mutationErrorState.error
      : null;

  return {
    invoices: activeInvoices,
    totalCount: activeTotalCount,
    page,
    pageSize,
    totalPages: activeTotalPages,
    setPage,
    statusFilter,
    setStatusFilter,
    customerIdFilter,
    setCustomerIdFilter,
    searchQuery,
    setSearchQuery,
    issueDateFrom,
    setIssueDateFrom,
    issueDateTo,
    setIssueDateTo,
    dueDateFrom,
    setDueDateFrom,
    dueDateTo,
    setDueDateTo,
    isLoading: activeIsLoading,
    error: activeError,
    refreshInvoices,
    createInvoice,
    updateInvoice,
    transitionStatus,
    getInvoiceDetail,
    isCreating,
    isUpdating,
    isTransitioning,
    isMutating,
    mutationError: activeMutationError,
    clearMutationError,
    canCreate,
    canEdit,
    canSend,
    canCancel,
    isReadOnly,
  };
}
