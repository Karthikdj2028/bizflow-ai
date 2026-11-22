import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  FinancialSummaryResponse,
  TransactionCreateRequest,
  TransactionListResponse,
  TransactionResponse,
  TransactionUpdateRequest,
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

interface ScopedListState {
  businessId: string;
  generation: number;
  transactions: TransactionResponse[];
  totalCount: number;
  totalPages: number;
  isLoading: boolean;
  error: string | null;
}

interface ScopedSummaryState {
  businessId: string;
  generation: number;
  summary: FinancialSummaryResponse | null;
  isLoading: boolean;
  error: string | null;
}

interface ScopedMutationError {
  businessId: string;
  generation: number;
  error: string | null;
}

export interface UseTransactionsResult {
  transactions: TransactionResponse[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  setPage: (page: number) => void;
  summary: FinancialSummaryResponse | null;
  typeFilter: 'ALL' | 'INCOME' | 'EXPENSE';
  setTypeFilter: (filter: 'ALL' | 'INCOME' | 'EXPENSE') => void;
  categoryIdFilter: string;
  setCategoryIdFilter: (categoryId: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  startDate: string;
  setStartDate: (date: string) => void;
  endDate: string;
  setEndDate: (date: string) => void;
  sortBy: 'transaction_date' | 'amount' | 'created_at';
  setSortBy: (sort: 'transaction_date' | 'amount' | 'created_at') => void;
  sortOrder: 'asc' | 'desc';
  setSortOrder: (order: 'asc' | 'desc') => void;
  isLoading: boolean;
  isSummaryLoading: boolean;
  error: string | null;
  summaryError: string | null;
  refreshTransactions: () => Promise<void>;
  refreshSummary: () => Promise<void>;
  createTransaction: (data: TransactionCreateRequest) => Promise<MutationResult<TransactionResponse>>;
  updateTransaction: (id: string, data: TransactionUpdateRequest) => Promise<MutationResult<TransactionResponse>>;
  deleteTransaction: (id: string) => Promise<MutationResult<void>>;
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

export function useTransactions(): UseTransactionsResult {
  const { activeWorkspace, workspaceGeneration, isCurrentWorkspace } = useWorkspace();
  const [listState, setListState] = useState<ScopedListState | null>(null);
  const [summaryState, setSummaryState] = useState<ScopedSummaryState | null>(null);
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(20);

  // Filter States
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'INCOME' | 'EXPENSE'>('ALL');
  const [categoryIdFilter, setCategoryIdFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [sortBy, setSortBy] = useState<'transaction_date' | 'amount' | 'created_at'>('transaction_date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Loading and Error States
  const [mutationErrorState, setMutationErrorState] = useState<ScopedMutationError | null>(null);

  // Active mutation lock state for UI reactivity
  const [activeLock, setActiveLock] = useState<MutationLock | null>(null);

  // Ref locks to avoid stale closures and separate request sequences
  const mutationLockRef = useRef<MutationLock | null>(null);
  const tokenCounterRef = useRef<number>(0);
  const listSeqRef = useRef<number>(0);
  const summarySeqRef = useRef<number>(0);

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
   * Fetch paginated transactions list for the active workspace.
   * Uses independent request sequence (listSeqRef) and freshness verification.
   */
  const fetchTransactionsForWorkspace = useCallback(
    async (targetBusinessId: string, targetGen: number): Promise<void> => {
      const seq = ++listSeqRef.current;
      setListState((prev) => {
        if (prev && prev.businessId === targetBusinessId && prev.generation === targetGen) {
          return { ...prev, isLoading: true, error: null };
        }
        return {
          businessId: targetBusinessId,
          generation: targetGen,
          transactions: [],
          totalCount: 0,
          totalPages: 0,
          isLoading: true,
          error: null,
        };
      });

      const params = new URLSearchParams();
      if (typeFilter !== 'ALL') {
        params.append('type', typeFilter);
      }
      if (categoryIdFilter) {
        params.append('category_id', categoryIdFilter);
      }
      if (startDate) {
        params.append('start_date', startDate);
      }
      if (endDate) {
        params.append('end_date', endDate);
      }
      if (searchQuery.trim()) {
        params.append('search', searchQuery.trim());
      }
      params.append('sort_by', sortBy);
      params.append('sort_order', sortOrder);
      params.append('page', String(page));
      params.append('page_size', String(pageSize));

      try {
        const queryStr = params.toString();
        const endpoint = `/transactions${queryStr ? `?${queryStr}` : ''}`;
        const response = await apiRequest<TransactionListResponse>(endpoint, {
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
          transactions: response.items || [],
          totalCount: response.total || 0,
          totalPages: response.total_pages || 0,
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

        const msg =
          err instanceof ApiClientError
            ? err.problem?.detail || err.message
            : (err as Error).message || 'Failed to load transactions.';
        setListState({
          businessId: targetBusinessId,
          generation: targetGen,
          transactions: [],
          totalCount: 0,
          totalPages: 0,
          isLoading: false,
          error: msg,
        });
      } finally {
        if (
          seq === listSeqRef.current &&
          isCurrentWorkspace(targetBusinessId, targetGen)
        ) {
          setListState((prev) => {
            if (prev && prev.businessId === targetBusinessId && prev.generation === targetGen) {
              return { ...prev, isLoading: false };
            }
            return prev;
          });
        }
      }
    },
    [
      typeFilter,
      categoryIdFilter,
      startDate,
      endDate,
      searchQuery,
      sortBy,
      sortOrder,
      page,
      pageSize,
      isCurrentWorkspace,
    ]
  );

  /**
   * Fetch financial calculation summary for the active workspace.
   * Uses independent request sequence (summarySeqRef) and freshness verification.
   */
  const fetchSummaryForWorkspace = useCallback(
    async (targetBusinessId: string, targetGen: number): Promise<void> => {
      const seq = ++summarySeqRef.current;
      setSummaryState((prev) => {
        if (prev && prev.businessId === targetBusinessId && prev.generation === targetGen) {
          return { ...prev, isLoading: true, error: null };
        }
        return {
          businessId: targetBusinessId,
          generation: targetGen,
          summary: null,
          isLoading: true,
          error: null,
        };
      });

      const params = new URLSearchParams();
      if (startDate) {
        params.append('start_date', startDate);
      }
      if (endDate) {
        params.append('end_date', endDate);
      }
      if (categoryIdFilter) {
        params.append('category_id', categoryIdFilter);
      }

      try {
        const queryStr = params.toString();
        const endpoint = `/transactions/summary${queryStr ? `?${queryStr}` : ''}`;
        const response = await apiRequest<FinancialSummaryResponse>(endpoint, {
          scope: 'workspace',
          targetWorkspaceId: targetBusinessId,
          targetWorkspaceGeneration: targetGen,
          method: 'GET',
        });

        // FRESHNESS CHECK: Discard if newer summary request was issued or workspace generation advanced
        if (
          seq !== summarySeqRef.current ||
          !isCurrentWorkspace(targetBusinessId, targetGen)
        ) {
          return;
        }

        setSummaryState({
          businessId: targetBusinessId,
          generation: targetGen,
          summary: response,
          isLoading: false,
          error: null,
        });
      } catch (err: unknown) {
        if (
          seq !== summarySeqRef.current ||
          !isCurrentWorkspace(targetBusinessId, targetGen)
        ) {
          return;
        }

        const msg =
          err instanceof ApiClientError
            ? err.problem?.detail || err.message
            : (err as Error).message || 'Failed to load financial summary.';
        setSummaryState({
          businessId: targetBusinessId,
          generation: targetGen,
          summary: null,
          isLoading: false,
          error: msg,
        });
      } finally {
        if (
          seq === summarySeqRef.current &&
          isCurrentWorkspace(targetBusinessId, targetGen)
        ) {
          setSummaryState((prev) => {
            if (prev && prev.businessId === targetBusinessId && prev.generation === targetGen) {
              return { ...prev, isLoading: false };
            }
            return prev;
          });
        }
      }
    },
    [startDate, endDate, categoryIdFilter, isCurrentWorkspace]
  );

  // Trigger data fetching on workspace mount / transition
  useEffect(() => {
    if (!currentBusinessId) {
      setListState(null);
      setSummaryState(null);
      return;
    }

    // Reset pagination to page 1 on workspace transition
    setPage(1);
    fetchTransactionsForWorkspace(currentBusinessId, workspaceGeneration);
    fetchSummaryForWorkspace(currentBusinessId, workspaceGeneration);
  }, [currentBusinessId, workspaceGeneration, fetchTransactionsForWorkspace, fetchSummaryForWorkspace]);

  const refreshTransactions = useCallback(async () => {
    if (currentBusinessId) {
      await fetchTransactionsForWorkspace(currentBusinessId, workspaceGeneration);
    }
  }, [currentBusinessId, workspaceGeneration, fetchTransactionsForWorkspace]);

  const refreshSummary = useCallback(async () => {
    if (currentBusinessId) {
      await fetchSummaryForWorkspace(currentBusinessId, workspaceGeneration);
    }
  }, [currentBusinessId, workspaceGeneration, fetchSummaryForWorkspace]);

  /**
   * Mutation: Create Transaction with Concurrency & Workspace Isolation Guards
   */
  const createTransaction = useCallback(
    async (data: TransactionCreateRequest): Promise<MutationResult<TransactionResponse>> => {
      if (!currentBusinessId) {
        throw new Error('No active workspace available.');
      }
      if (!canCreate) {
        throw new Error('You do not have permission to record transactions.');
      }

      const businessId = currentBusinessId;
      const generation = workspaceGeneration;

      if (mutationLockRef.current) {
        return { status: 'stale' };
      }

      const token = `tx-create-${++tokenCounterRef.current}`;
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
        const response = await apiRequest<TransactionResponse>('/transactions', {
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

        // Refresh both list and summary for the authoritative workspace
        await Promise.all([
          fetchTransactionsForWorkspace(businessId, generation),
          fetchSummaryForWorkspace(businessId, generation),
        ]);

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
              : (err as Error).message || 'Failed to create transaction.';
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
      fetchTransactionsForWorkspace,
      fetchSummaryForWorkspace,
    ]
  );

  /**
   * Mutation: Update Transaction with Concurrency & Workspace Isolation Guards
   */
  const updateTransaction = useCallback(
    async (
      id: string,
      data: TransactionUpdateRequest
    ): Promise<MutationResult<TransactionResponse>> => {
      if (!currentBusinessId) {
        throw new Error('No active workspace available.');
      }
      if (!canEdit) {
        throw new Error('You do not have permission to update transactions.');
      }

      const businessId = currentBusinessId;
      const generation = workspaceGeneration;

      if (mutationLockRef.current) {
        return { status: 'stale' };
      }

      const token = `tx-update-${++tokenCounterRef.current}`;
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
        const response = await apiRequest<TransactionResponse>(`/transactions/${id}`, {
          scope: 'workspace',
          targetWorkspaceId: businessId,
          targetWorkspaceGeneration: generation,
          method: 'PATCH',
          body: JSON.stringify(data),
        });

        if (!isCurrentWorkspace(businessId, generation)) {
          return { status: 'stale' };
        }

        await Promise.all([
          fetchTransactionsForWorkspace(businessId, generation),
          fetchSummaryForWorkspace(businessId, generation),
        ]);

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
              : (err as Error).message || 'Failed to update transaction.';
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
      fetchTransactionsForWorkspace,
      fetchSummaryForWorkspace,
    ]
  );

  /**
   * Mutation: Soft Delete Transaction with Concurrency & Workspace Isolation Guards
   */
  const deleteTransaction = useCallback(
    async (id: string): Promise<MutationResult<void>> => {
      if (!currentBusinessId) {
        throw new Error('No active workspace available.');
      }
      if (!canDelete) {
        throw new Error('You do not have permission to delete transactions.');
      }

      const businessId = currentBusinessId;
      const generation = workspaceGeneration;

      if (mutationLockRef.current) {
        return { status: 'stale' };
      }

      const token = `tx-delete-${++tokenCounterRef.current}`;
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
        await apiRequest<{ message: string; id: string }>(`/transactions/${id}`, {
          scope: 'workspace',
          targetWorkspaceId: businessId,
          targetWorkspaceGeneration: generation,
          method: 'DELETE',
        });

        if (!isCurrentWorkspace(businessId, generation)) {
          return { status: 'stale' };
        }

        await Promise.all([
          fetchTransactionsForWorkspace(businessId, generation),
          fetchSummaryForWorkspace(businessId, generation),
        ]);

        // POST-REFRESH STALENESS CHECK: If workspace switched while refresh was pending
        if (!isCurrentWorkspace(businessId, generation)) {
          return { status: 'stale' };
        }

        return { status: 'applied' };
      } catch (err: unknown) {
        if (isCurrentWorkspace(businessId, generation)) {
          const msg =
            err instanceof ApiClientError
              ? err.problem?.detail || err.message
              : (err as Error).message || 'Failed to delete transaction.';
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
      fetchTransactionsForWorkspace,
      fetchSummaryForWorkspace,
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

  const isSummaryCurrent = Boolean(
    summaryState &&
    currentBusinessId &&
    isCurrentWorkspace(summaryState.businessId, summaryState.generation)
  );

  const isMutationErrorCurrent = Boolean(
    mutationErrorState &&
    currentBusinessId &&
    isCurrentWorkspace(mutationErrorState.businessId, mutationErrorState.generation)
  );

  const exposedTransactions = isListCurrent ? listState!.transactions : [];
  const exposedTotalCount = isListCurrent ? listState!.totalCount : 0;
  const exposedTotalPages = isListCurrent ? listState!.totalPages : 0;
  const exposedPage = isListCurrent ? page : 1;
  const exposedError = isListCurrent ? listState!.error : null;
  const exposedSummary = isSummaryCurrent ? summaryState!.summary : null;
  const exposedSummaryError = isSummaryCurrent ? summaryState!.error : null;
  const exposedMutationError = isMutationErrorCurrent ? mutationErrorState!.error : null;

  const exposedIsLoading = Boolean(currentBusinessId) && (!isListCurrent || listState!.isLoading);
  const exposedIsSummaryLoading = Boolean(currentBusinessId) && (!isSummaryCurrent || summaryState!.isLoading);

  return {
    transactions: exposedTransactions,
    totalCount: exposedTotalCount,
    page: exposedPage,
    pageSize,
    totalPages: exposedTotalPages,
    setPage,
    summary: exposedSummary,
    typeFilter,
    setTypeFilter,
    categoryIdFilter,
    setCategoryIdFilter,
    searchQuery,
    setSearchQuery,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    isLoading: exposedIsLoading,
    isSummaryLoading: exposedIsSummaryLoading,
    error: exposedError,
    summaryError: exposedSummaryError,
    refreshTransactions,
    refreshSummary,
    createTransaction,
    updateTransaction,
    deleteTransaction,
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
