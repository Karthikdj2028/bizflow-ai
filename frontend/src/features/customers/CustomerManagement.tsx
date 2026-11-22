import React, { useState, useEffect } from 'react';
import { useCustomers } from './useCustomers';
import { useWorkspace } from '../workspaces/WorkspaceContext';
import { CustomerRow } from './CustomerRow';
import { CustomerModal } from './CustomerModal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Pagination } from '../../components/Pagination';
import { Button } from '../../components/Button';
import {
  CustomerCreateRequest,
  CustomerResponse,
  CustomerUpdateRequest,
} from '../../types/api';
import { ApiClientError } from '../../lib/api';
import {
  Plus,
  Search,
  RefreshCw,
  AlertTriangle,
  Users,
  X,
} from 'lucide-react';
import { clsx } from 'clsx';

export const CustomerManagement: React.FC = () => {
  const {
    customers,
    totalCount,
    page,
    pageSize,
    totalPages,
    setPage,
    statusFilter,
    setStatusFilter,
    searchQuery,
    setSearchQuery,
    isLoading,
    error,
    refreshCustomers,
    createCustomer,
    updateCustomer,
    deactivateCustomer,
    isMutating,
    mutationError,
    clearMutationError,
    canCreate,
    canEdit,
    canDelete,
  } = useCustomers();

  const { activeWorkspace, workspaceGeneration } = useWorkspace();

  // Dialog & Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [customerToEdit, setCustomerToEdit] = useState<CustomerResponse | null>(null);
  const [customerToDeactivate, setCustomerToDeactivate] = useState<CustomerResponse | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  // Deterministically auto-dismiss all open modals upon workspace transition
  useEffect(() => {
    setIsCreateOpen(false);
    setCustomerToEdit(null);
    setCustomerToDeactivate(null);
    setDeactivateError(null);
  }, [activeWorkspace?.id, workspaceGeneration]);

  const handleCreateSubmit = async (data: CustomerCreateRequest | CustomerUpdateRequest) => {
    const result = await createCustomer(data as CustomerCreateRequest);
    if (result.status === 'applied') {
      setIsCreateOpen(false);
    }
    return result;
  };

  const handleEditSubmit = async (data: CustomerCreateRequest | CustomerUpdateRequest) => {
    if (!customerToEdit) {
      throw new Error('No customer selected for editing.');
    }
    const result = await updateCustomer(customerToEdit.id, data as CustomerUpdateRequest);
    if (result.status === 'applied') {
      setCustomerToEdit(null);
    }
    return result;
  };

  const handleDeactivateConfirm = async () => {
    if (!customerToDeactivate) return;
    setDeactivateError(null);

    try {
      const result = await deactivateCustomer(customerToDeactivate.id);
      if (result.status === 'applied') {
        setCustomerToDeactivate(null);
      }
    } catch (err: unknown) {
      const message =
        err instanceof ApiClientError
          ? err.problem?.detail || err.message
          : (err as Error).message || 'Failed to deactivate customer.';
      setDeactivateError(message);
    }
  };

  const hasActiveFilters = statusFilter !== 'ALL' || Boolean(searchQuery);

  const handleClearFilters = () => {
    setStatusFilter('ALL');
    setSearchQuery('');
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Customer Directory</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage clients, contact information, and billing terms for{' '}
            <span className="font-medium text-slate-700">{activeWorkspace?.name || 'Workspace'}</span>.
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
            New Customer
          </Button>
        )}
      </div>

      {/* Global Error Banner */}
      {(error || deactivateError || mutationError) && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start justify-between text-rose-800 text-sm">
          <div className="flex items-start space-x-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Unable to complete customer operation</p>
              <p className="text-xs text-rose-600 mt-0.5">
                {error || deactivateError || mutationError}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDeactivateError(null);
              clearMutationError();
              refreshCustomers();
            }}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Filter and Search Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Substring Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by name, email, or phone..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-4 py-2 text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-lg placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition"
            />
          </div>

          <div className="flex items-center gap-3">
            {/* Status Toggle Pills */}
            <div className="flex items-center space-x-1.5 bg-slate-100 p-1 rounded-lg">
              {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => {
                    setStatusFilter(status);
                    setPage(1);
                  }}
                  className={clsx(
                    'px-3 py-1.5 rounded-md text-xs font-semibold transition',
                    statusFilter === status
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  {status === 'ALL'
                    ? 'All'
                    : status === 'ACTIVE'
                    ? 'Active'
                    : 'Inactive'}
                </button>
              ))}
            </div>

            {/* Clear Filter Button */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="inline-flex items-center text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition"
              >
                <X className="w-3.5 h-3.5 mr-0.5" />
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Customer Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4">Billing Address</th>
                <th className="py-3 px-4">Terms</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                // Skeletons
                [1, 2, 3, 4, 5].map((i) => (
                  <tr key={i} className="border-b border-slate-100 animate-pulse">
                    <td className="py-4 px-4"><div className="h-4 w-32 bg-slate-200 rounded" /></td>
                    <td className="py-4 px-4"><div className="h-4 w-28 bg-slate-200 rounded" /></td>
                    <td className="py-4 px-4"><div className="h-4 w-40 bg-slate-200 rounded" /></td>
                    <td className="py-4 px-4"><div className="h-4 w-16 bg-slate-200 rounded" /></td>
                    <td className="py-4 px-4 text-right"><div className="h-4 w-12 bg-slate-200 rounded ml-auto" /></td>
                  </tr>
                ))
              ) : customers.length === 0 ? (
                // Empty State
                <tr>
                  <td colSpan={5} className="py-12 text-center">
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
                      <Users className="w-6 h-6" />
                    </div>
                    <h3 className="text-base font-semibold text-slate-800">No Customers Found</h3>
                    <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                      {hasActiveFilters
                        ? 'No customers match your current search or filter criteria.'
                        : 'No customers registered in this workspace yet.'}
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
                        Add First Customer
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
                customers.map((c) => (
                  <CustomerRow
                    key={c.id}
                    customer={c}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    onEdit={(cust) => setCustomerToEdit(cust)}
                    onDelete={(cust) => setCustomerToDeactivate(cust)}
                    disabled={isMutating}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          totalItems={totalCount}
          pageSize={pageSize}
          onPageChange={setPage}
        />
      </div>

      {/* Customer Modals */}
      <CustomerModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={handleCreateSubmit}
        isLoading={isMutating}
      />

      <CustomerModal
        isOpen={Boolean(customerToEdit)}
        onClose={() => setCustomerToEdit(null)}
        onSubmit={handleEditSubmit}
        initialData={customerToEdit}
        isLoading={isMutating}
      />

      {/* Deactivate Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(customerToDeactivate)}
        onClose={() => setCustomerToDeactivate(null)}
        onConfirm={handleDeactivateConfirm}
        title="Deactivate Customer"
        message={`Are you sure you want to deactivate "${customerToDeactivate?.name}"? Inactive customers cannot receive new invoices, but their historical records are preserved.`}
        confirmText="Deactivate Customer"
        variant="danger"
        isLoading={isMutating}
      />
    </div>
  );
};
