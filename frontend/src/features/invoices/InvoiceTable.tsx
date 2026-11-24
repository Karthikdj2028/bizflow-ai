import React from 'react';
import { InvoiceListItemResponse } from '../../types/api';
import { InvoiceRow } from './InvoiceRow';
import { FileText } from 'lucide-react';

export interface InvoiceTableProps {
  invoices: InvoiceListItemResponse[];
  currency?: string;
  canEdit: boolean;
  canSend: boolean;
  canCancel: boolean;
  isLoading?: boolean;
  onView: (invoice: InvoiceListItemResponse) => void;
  onEdit: (invoice: InvoiceListItemResponse) => void;
  onMarkSent: (invoice: InvoiceListItemResponse) => void;
  onCancel: (invoice: InvoiceListItemResponse) => void;
}

export const InvoiceTable: React.FC<InvoiceTableProps> = ({
  invoices,
  currency = 'USD',
  canEdit,
  canSend,
  canCancel,
  isLoading = false,
  onView,
  onEdit,
  onMarkSent,
  onCancel,
}) => {
  if (isLoading && invoices.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center animate-pulse">
        <div className="h-4 bg-slate-200 rounded w-1/4 mx-auto mb-4" />
        <div className="space-y-3">
          <div className="h-8 bg-slate-100 rounded" />
          <div className="h-8 bg-slate-100 rounded" />
          <div className="h-8 bg-slate-100 rounded" />
        </div>
      </div>
    );
  }

  if (invoices.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
          <FileText className="w-6 h-6" />
        </div>
        <h3 className="text-base font-semibold text-slate-800">No invoices found</h3>
        <p className="text-sm text-slate-500 max-w-sm mx-auto">
          No invoices match your current filter criteria or none have been created yet.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl shadow-xs">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <th className="py-3.5 px-4">Invoice #</th>
            <th className="py-3.5 px-4">Customer</th>
            <th className="py-3.5 px-4">Issue Date</th>
            <th className="py-3.5 px-4">Due Date</th>
            <th className="py-3.5 px-4 text-right">Total</th>
            <th className="py-3.5 px-4 text-right">Balance Due</th>
            <th className="py-3.5 px-4">Status</th>
            <th className="py-3.5 px-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <InvoiceRow
              key={inv.id}
              invoice={inv}
              currency={currency}
              canEdit={canEdit}
              canSend={canSend}
              canCancel={canCancel}
              onView={onView}
              onEdit={onEdit}
              onMarkSent={onMarkSent}
              onCancel={onCancel}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};
