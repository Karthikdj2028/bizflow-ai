import React, { useState, useEffect } from 'react';
import { useInvoices } from './useInvoices';
import { useCustomers } from '../customers/useCustomers';
import { useWorkspace } from '../workspaces/WorkspaceContext';
import { InvoiceTable } from './InvoiceTable';
import { InvoiceModal } from './InvoiceModal';
import { InvoiceDetailModal } from './InvoiceDetailModal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Pagination } from '../../components/Pagination';
import { Button } from '../../components/Button';
import {
  InvoiceCreateRequest,
  InvoiceListItemResponse,
  InvoiceUpdateRequest,
} from '../../types/api';
import { ApiClientError } from '../../lib/api';
import {
  Plus,
  Search,
  RefreshCw,
  AlertTriangle,
  Receipt,
  X,
  Filter,
} from 'lucide-react';
import { clsx } from 'clsx';

export const InvoiceManagement: React.FC = () => {
  const {
    invoices,
    totalCount,
    page,
    pageSize,
    totalPages,
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
    isLoading,
    error,
    refreshInvoices,
    createInvoice,
    updateInvoice,
    transitionStatus,
    getInvoiceDetail,
    isMutating,
    mutationError,
    clearMutationError,
    canCreate,
    canEdit,
    canSend,
    canCancel,
  } = useInvoices();

  const { customers } = useCustomers();
  const { activeWorkspace, workspaceGeneration } = useWorkspace();

  // Dialog & Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [invoiceToEdit, setInvoiceToEdit] = useState<InvoiceListItemResponse | null>(null);
  const [invoiceToViewId, setInvoiceToViewId] = useState<string | null>(null);
  const [invoiceToCancel, setInvoiceToCancel] = useState<InvoiceListItemResponse | null>(null);
  const [invoiceToSend, setInvoiceToSend] = useState<InvoiceListItemResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState<boolean>(false);

  // Auto-dismiss open modals on workspace change
  useEffect(() => {
    setIsCreateOpen(false);
    setInvoiceToEdit(null);
    setInvoiceToViewId(null);
    setInvoiceToCancel(null);
    setInvoiceToSend(null);
    setActionError(null);
  }, [activeWorkspace?.id, workspaceGeneration]);

  const handleCreateSubmit = async (data: InvoiceCreateRequest | InvoiceUpdateRequest) => {
    const result = await createInvoice(data as InvoiceCreateRequest);
    if (result.status === 'applied') {
      setIsCreateOpen(false);
    }
    return result;
  };

  const handleEditSubmit = async (data: InvoiceCreateRequest | InvoiceUpdateRequest) => {
    if (!invoiceToEdit) {
      throw new Error('No invoice selected for editing.');
    }
    const result = await updateInvoice(invoiceToEdit.id, data as InvoiceUpdateRequest);
    if (result.status === 'applied') {
      setInvoiceToEdit(null);
    }
    return result;
  };

  const handleSendConfirm = async () => {
    if (!invoiceToSend) return;
    setActionError(null);

    try {
      const result = await transitionStatus(invoiceToSend.id, 'MARK_SENT');
      if (result.status === 'applied') {
        setInvoiceToSend(null);
      }
    } catch (err: unknown) {
      const message =
        err instanceof ApiClientError
          ? err.problem?.detail || err.message
          : (err as Error).message || 'Failed to mark invoice as sent.';
      setActionError(message);
    }
  };

  const handleCancelConfirm = async () => {
    if (!invoiceToCancel) return;
    setActionError(null);

    try {
      const result = await transitionStatus(invoiceToCancel.id, 'CANCEL');
      if (result.status === 'applied') {
        setInvoiceToCancel(null);
      }
    } catch (err: unknown) {
      const message =
        err instanceof ApiClientError
          ? err.problem?.detail || err.message
          : (err as Error).message || 'Failed to cancel invoice.';
      setActionError(message);
    }
  };

  const hasActiveFilters = Boolean(
    (statusFilter && statusFilter !== 'ALL') ||
    customerIdFilter ||
    searchQuery.trim() ||
    issueDateFrom ||
    issueDateTo ||
    dueDateFrom ||
    dueDateTo
  );

  const handleClearFilters = () => {
    setStatusFilter('ALL');
    setCustomerIdFilter('');
    setSearchQuery('');
    setIssueDateFrom('');
    setIssueDateTo('');
    setDueDateFrom('');
    setDueDateTo('');
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <Receipt className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Invoices</h1>
            <p className="text-xs text-slate-500">
              Manage client billing, multi-line items, and invoice lifecycles.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshInvoices()}
            isLoading={isLoading && !isMutating}
            icon={<RefreshCw className="w-4 h-4" />}
          >
            Refresh
          </Button>

          {canCreate && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsCreateOpen(true)}
              icon={<Plus className="w-4 h-4" />}
            >
              New Invoice
            </Button>
          )}
        </div>
      </div>

      {/* Global Error Banner */}
      {(error || mutationError || actionError) && (
        <div
          role="alert"
          className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between text-rose-700 text-sm shadow-xs"
        >
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <span className="font-medium">{actionError || mutationError || error}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setActionError(null);
              clearMutationError();
            }}
            className="text-rose-500 hover:text-rose-700 p-1 rounded-lg transition"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          {/* Substring Search */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by invoice number (e.g. INV-001)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg shadow-2xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:bg-white transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status Filter */}
          <div className="w-full md:w-48">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by invoice status"
              className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg shadow-2xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:bg-white transition"
            >
              <option value="ALL">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="SENT">Sent</option>
              <option value="OVERDUE">Overdue</option>
              <option value="PARTIALLY_PAID">Partially Paid</option>
              <option value="PAID">Paid</option>
              <option value="CANCELED">Canceled</option>
            </select>
          </div>

          {/* Customer Filter */}
          <div className="w-full md:w-56">
            <select
              value={customerIdFilter}
              onChange={(e) => setCustomerIdFilter(e.target.value)}
              aria-label="Filter by customer"
              className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg shadow-2xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:bg-white transition"
            >
              <option value="">All Customers</option>
              {(customers || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {!c.is_active ? '(Inactive)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Advanced Dates Toggle */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className={clsx(
              showAdvancedFilters && 'bg-slate-100 text-indigo-600 border-indigo-200'
            )}
            icon={<Filter className="w-4 h-4" />}
          >
            Dates
          </Button>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearFilters}
              className="text-slate-500 hover:text-slate-700"
            >
              Clear
            </Button>
          )}
        </div>

        {/* Collapsible Date Range Filters */}
        {showAdvancedFilters && (
          <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="block text-slate-500 mb-1 font-medium">Issue Date From</label>
              <input
                type="date"
                value={issueDateFrom}
                onChange={(e) => setIssueDateFrom(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1 font-medium">Issue Date To</label>
              <input
                type="date"
                value={issueDateTo}
                onChange={(e) => setIssueDateTo(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1 font-medium">Due Date From</label>
              <input
                type="date"
                value={dueDateFrom}
                onChange={(e) => setDueDateFrom(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1 font-medium">Due Date To</label>
              <input
                type="date"
                value={dueDateTo}
                onChange={(e) => setDueDateTo(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs"
              />
            </div>
          </div>
        )}
      </div>

      {/* Invoices Directory Table */}
      <InvoiceTable
        invoices={invoices}
        currency={activeWorkspace?.base_currency || 'USD'}
        canEdit={canEdit}
        canSend={canSend}
        canCancel={canCancel}
        isLoading={isLoading}
        onView={(inv) => setInvoiceToViewId(inv.id)}
        onEdit={(inv) => setInvoiceToEdit(inv)}
        onMarkSent={(inv) => setInvoiceToSend(inv)}
        onCancel={(inv) => setInvoiceToCancel(inv)}
      />

      {/* Pagination */}
      <Pagination
        currentPage={page}
        totalPages={totalPages}
        totalItems={totalCount}
        pageSize={pageSize}
        onPageChange={setPage}
        isLoading={isLoading}
      />

      {/* Create New Invoice Modal */}
      {isCreateOpen && (
        <InvoiceModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onSubmit={handleCreateSubmit}
          customers={customers}
          currency={activeWorkspace?.base_currency || 'USD'}
          isLoading={isMutating}
        />
      )}

      {/* Edit Draft Invoice Modal */}
      {invoiceToEdit && (
        <InvoiceModal
          isOpen={Boolean(invoiceToEdit)}
          onClose={() => setInvoiceToEdit(null)}
          onSubmit={handleEditSubmit}
          initialData={invoiceToEdit}
          customers={customers}
          currency={activeWorkspace?.base_currency || 'USD'}
          isLoading={isMutating}
        />
      )}

      {/* Invoice Detail Modal */}
      {invoiceToViewId && (
        <InvoiceDetailModal
          isOpen={Boolean(invoiceToViewId)}
          onClose={() => setInvoiceToViewId(null)}
          invoiceId={invoiceToViewId}
          getInvoiceDetail={getInvoiceDetail}
          currency={activeWorkspace?.base_currency || 'USD'}
          canEdit={canEdit}
          canSend={canSend}
          canCancel={canCancel}
          onEdit={(inv) => setInvoiceToEdit(inv)}
          onMarkSent={(inv) => setInvoiceToSend(inv)}
          onCancel={(inv) => setInvoiceToCancel(inv)}
        />
      )}

      {/* Mark as Sent Confirmation Dialog */}
      {invoiceToSend && (
        <ConfirmDialog
          isOpen={Boolean(invoiceToSend)}
          onClose={() => setInvoiceToSend(null)}
          onConfirm={handleSendConfirm}
          title="Mark Invoice as Sent"
          message={`Are you sure you want to transition invoice ${invoiceToSend.invoice_number} to SENT? Once marked as sent, line items, amounts, and customer can no longer be edited.`}
          confirmText="Mark as Sent"
          variant="warning"
          isLoading={isMutating}
        />
      )}

      {/* Cancel Invoice Confirmation Dialog */}
      {invoiceToCancel && (
        <ConfirmDialog
          isOpen={Boolean(invoiceToCancel)}
          onClose={() => setInvoiceToCancel(null)}
          onConfirm={handleCancelConfirm}
          title="Cancel Invoice"
          message={`Are you sure you want to cancel invoice ${invoiceToCancel.invoice_number}? Cancellation is permanent and creates an immutable audit record.`}
          confirmText="Cancel Invoice"
          variant="danger"
          isLoading={isMutating}
        />
      )}
    </div>
  );
};
