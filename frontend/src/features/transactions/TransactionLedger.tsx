import React, { useState, useEffect } from 'react';
import { useTransactions } from './useTransactions';
import { useCategories } from '../categories/useCategories';
import { useWorkspace } from '../workspaces/WorkspaceContext';
import { TransactionSummaryCard } from './TransactionSummaryCard';
import { TransactionRow } from './TransactionRow';
import { TransactionModal } from './TransactionModal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Pagination } from '../../components/Pagination';
import { Button } from '../../components/Button';
import {
  TransactionCreateRequest,
  TransactionResponse,
  TransactionUpdateRequest,
} from '../../types/api';
import { ApiClientError } from '../../lib/api';
import {
  Plus,
  Search,
  RefreshCw,
  AlertTriangle,
  Receipt,
  X,
  ArrowUpDown,
} from 'lucide-react';
import { clsx } from 'clsx';

export const TransactionLedger: React.FC = () => {
  const {
    transactions,
    totalCount,
    page,
    pageSize,
    totalPages,
    setPage,
    summary,
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
    isLoading,
    isSummaryLoading,
    error,
    refreshTransactions,
    refreshSummary,
    createTransaction,
    updateTransaction,
    deleteTransaction,
    isMutating,
    mutationError,
    clearMutationError,
    canCreate,
    canEdit,
    canDelete,
  } = useTransactions();

  const { categories } = useCategories();
  const { activeWorkspace, workspaceGeneration } = useWorkspace();

  // Dialog & Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [transactionToEdit, setTransactionToEdit] = useState<TransactionResponse | null>(null);
  const [transactionToDelete, setTransactionToDelete] = useState<TransactionResponse | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Deterministically auto-dismiss all open modals upon workspace transition
  useEffect(() => {
    setIsCreateOpen(false);
    setTransactionToEdit(null);
    setTransactionToDelete(null);
    setDeleteError(null);
  }, [activeWorkspace?.id, workspaceGeneration]);

  const handleCreateSubmit = async (data: TransactionCreateRequest | TransactionUpdateRequest) => {
    const result = await createTransaction(data as TransactionCreateRequest);
    if (result.status === 'applied') {
      setIsCreateOpen(false);
    }
    return result;
  };

  const handleEditSubmit = async (data: TransactionCreateRequest | TransactionUpdateRequest) => {
    if (!transactionToEdit) {
      throw new Error('No transaction selected for editing.');
    }
    const result = await updateTransaction(transactionToEdit.id, data as TransactionUpdateRequest);
    if (result.status === 'applied') {
      setTransactionToEdit(null);
    }
    return result;
  };

  const handleDeleteConfirm = async () => {
    if (!transactionToDelete) return;
    setDeleteError(null);

    try {
      const result = await deleteTransaction(transactionToDelete.id);
      if (result.status === 'applied') {
        setTransactionToDelete(null);
      }
    } catch (err: unknown) {
      const message =
        err instanceof ApiClientError
          ? err.problem?.detail || err.message
          : (err as Error).message || 'Failed to delete transaction.';
      setDeleteError(message);
    }
  };

  const hasActiveFilters =
    typeFilter !== 'ALL' ||
    Boolean(categoryIdFilter) ||
    Boolean(searchQuery) ||
    Boolean(startDate) ||
    Boolean(endDate);

  const handleClearFilters = () => {
    setTypeFilter('ALL');
    setCategoryIdFilter('');
    setSearchQuery('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const currency = activeWorkspace?.base_currency || 'INR';

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Transaction Ledger</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Operational cash flow records, categorized income and expenses for {activeWorkspace?.name || 'Workspace'}.
          </p>
        </div>

        {canCreate && (
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => setIsCreateOpen(true)}
            disabled={isMutating}
            icon={<Plus className="w-4 h-4" />}
          >
            New Transaction
          </Button>
        )}
      </div>

      {/* Financial Summary Ribbon */}
      <TransactionSummaryCard
        summary={summary}
        currency={currency}
        isLoading={isSummaryLoading}
      />

      {/* Global Error Banner */}
      {(error || deleteError || mutationError) && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start justify-between text-rose-800 text-sm">
          <div className="flex items-start space-x-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Unable to complete transaction operation</p>
              <p className="text-xs text-rose-600 mt-0.5">{error || deleteError || mutationError}</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDeleteError(null);
              clearMutationError();
              refreshTransactions();
              refreshSummary();
            }}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Filter and Search Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Substring Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search description or counterparty..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-4 py-2 text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-lg placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition"
            />
          </div>

          {/* Type Toggle Pills */}
          <div className="flex items-center space-x-1.5 bg-slate-100 p-1 rounded-lg">
            {(['ALL', 'INCOME', 'EXPENSE'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTypeFilter(t);
                  setPage(1);
                }}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-xs font-semibold transition',
                  typeFilter === t
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                {t === 'ALL' ? 'All Types' : t === 'INCOME' ? 'Income' : 'Expense'}
              </button>
            ))}
          </div>
        </div>

        {/* Secondary Filter Row: Category & Dates */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 text-xs">
          {/* Category Dropdown */}
          <div className="flex items-center space-x-1.5">
            <span className="text-slate-500 font-medium">Category:</span>
            <select
              aria-label="Filter by category"
              value={categoryIdFilter}
              onChange={(e) => {
                setCategoryIdFilter(e.target.value);
                setPage(1);
              }}
              className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-700 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.type})
                </option>
              ))}
            </select>
          </div>

          {/* Date Boundaries */}
          <div className="flex items-center space-x-1.5">
            <span className="text-slate-500 font-medium">From:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
              className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-700 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center space-x-1.5">
            <span className="text-slate-500 font-medium">To:</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
              className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-700 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Sorting Control */}
          <div className="flex items-center space-x-1.5 ml-auto">
            <span className="text-slate-500 font-medium">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-700 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="transaction_date">Date</option>
              <option value="amount">Amount</option>
              <option value="created_at">Created Time</option>
            </select>

            <button
              type="button"
              onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
              className="p-1.5 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition"
              title={`Sort ${sortOrder === 'desc' ? 'Ascending' : 'Descending'}`}
              aria-label={`Sort ${sortOrder === 'desc' ? 'Ascending' : 'Descending'}`}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Clear Filter Button */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="inline-flex items-center text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition"
            >
              <X className="w-3.5 h-3.5 mr-0.5" />
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Transaction Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Description</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Method</th>
                <th className="py-3 px-4 text-right">Amount</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                // Skeletons
                [1, 2, 3, 4, 5].map((i) => (
                  <tr key={i} className="border-b border-slate-100 animate-pulse">
                    <td className="py-4 px-4"><div className="h-4 w-20 bg-slate-200 rounded" /></td>
                    <td className="py-4 px-4"><div className="h-4 w-16 bg-slate-200 rounded-full" /></td>
                    <td className="py-4 px-4"><div className="h-4 w-48 bg-slate-200 rounded" /></td>
                    <td className="py-4 px-4"><div className="h-4 w-24 bg-slate-200 rounded" /></td>
                    <td className="py-4 px-4"><div className="h-4 w-20 bg-slate-200 rounded" /></td>
                    <td className="py-4 px-4 text-right"><div className="h-4 w-20 bg-slate-200 rounded ml-auto" /></td>
                    <td className="py-4 px-4 text-right"><div className="h-4 w-12 bg-slate-200 rounded ml-auto" /></td>
                  </tr>
                ))
              ) : transactions.length === 0 ? (
                // Empty State
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
                      <Receipt className="w-6 h-6" />
                    </div>
                    <h3 className="text-base font-semibold text-slate-800">No Transactions Found</h3>
                    <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                      {hasActiveFilters
                        ? 'No transactions match your current filters. Try resetting the search or date boundaries.'
                        : 'No financial transactions recorded in this workspace yet.'}
                    </p>
                    {canCreate && !hasActiveFilters && (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => setIsCreateOpen(true)}
                        className="mt-4"
                        icon={<Plus className="w-4 h-4" />}
                      >
                        Record First Transaction
                      </Button>
                    )}
                    {hasActiveFilters && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleClearFilters}
                        className="mt-4"
                      >
                        Clear Filters
                      </Button>
                    )}
                  </td>
                </tr>
              ) : (
                // Rows
                transactions.map((tx) => (
                  <TransactionRow
                    key={tx.id}
                    transaction={tx}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    onEdit={(txToEdit) => setTransactionToEdit(txToEdit)}
                    onDelete={(txToDelete) => setTransactionToDelete(txToDelete)}
                    disabled={isMutating}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          totalItems={totalCount}
          pageSize={pageSize}
          onPageChange={(nextPage) => setPage(nextPage)}
          isLoading={isLoading}
        />
      </div>

      {/* Create Modal */}
      <TransactionModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={handleCreateSubmit}
        categories={categories}
        currency={currency}
        isLoading={isMutating}
      />

      {/* Edit Modal */}
      <TransactionModal
        isOpen={Boolean(transactionToEdit)}
        onClose={() => setTransactionToEdit(null)}
        onSubmit={handleEditSubmit}
        initialData={transactionToEdit}
        categories={categories}
        currency={currency}
        isLoading={isMutating}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(transactionToDelete)}
        onClose={() => setTransactionToDelete(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Transaction"
        message={`Are you sure you want to delete the transaction "${transactionToDelete?.description}"? This operation soft-deletes the record from active ledger calculations.`}
        confirmText="Delete Transaction"
        variant="danger"
        isLoading={isMutating}
      />
    </div>
  );
};
