import React from 'react';
import { InvoiceListItemResponse } from '../../types/api';
import { InvoiceStatusBadge } from './InvoiceStatusBadge';
import { Eye, Edit2, Send, Ban } from 'lucide-react';

export interface InvoiceRowProps {
  invoice: InvoiceListItemResponse;
  currency?: string;
  canEdit: boolean;
  canSend: boolean;
  canCancel: boolean;
  onView: (invoice: InvoiceListItemResponse) => void;
  onEdit: (invoice: InvoiceListItemResponse) => void;
  onMarkSent: (invoice: InvoiceListItemResponse) => void;
  onCancel: (invoice: InvoiceListItemResponse) => void;
}

export const InvoiceRow: React.FC<InvoiceRowProps> = ({
  invoice,
  currency = 'USD',
  canEdit,
  canSend,
  canCancel,
  onView,
  onEdit,
  onMarkSent,
  onCancel,
}) => {
  // Eligibility strictly derived from persisted_status
  const isDraft = invoice.persisted_status === 'DRAFT';
  const isSent = invoice.persisted_status === 'SENT';
  const isUnpaid = invoice.paid_amount === '0.00';

  // Edit eligibility: DRAFT only
  const isEditable = canEdit && isDraft;

  // Send eligibility: DRAFT only and total > 0
  const isSendable = canSend && isDraft && invoice.total_amount !== '0.00';

  // Cancel eligibility: DRAFT or SENT (with paid_amount = 0.00). Overdue with persisted SENT is cancellable!
  const isCancellable = canCancel && (isDraft || (isSent && isUnpaid));

  return (
    <tr className="hover:bg-slate-50/75 transition border-b border-slate-100 last:border-0">
      <td className="py-3.5 px-4">
        <button
          type="button"
          onClick={() => onView(invoice)}
          className="font-semibold text-indigo-600 hover:text-indigo-800 hover:underline text-sm font-mono text-left focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
        >
          {invoice.invoice_number}
        </button>
      </td>
      <td className="py-3.5 px-4 text-sm font-medium text-slate-800">
        {invoice.customer_name || '—'}
      </td>
      <td className="py-3.5 px-4 text-xs text-slate-600 whitespace-nowrap font-mono">
        {invoice.issue_date}
      </td>
      <td className="py-3.5 px-4 text-xs text-slate-600 whitespace-nowrap font-mono">
        {invoice.due_date}
      </td>
      <td className="py-3.5 px-4 text-sm font-mono font-semibold text-slate-900 text-right">
        {currency} {invoice.total_amount}
      </td>
      <td className="py-3.5 px-4 text-sm font-mono text-slate-700 text-right">
        {currency} {invoice.balance_due}
      </td>
      <td className="py-3.5 px-4 whitespace-nowrap">
        <InvoiceStatusBadge
          status={invoice.status}
          persistedStatus={invoice.persisted_status}
        />
      </td>
      <td className="py-3.5 px-4 whitespace-nowrap text-right text-xs">
        <div className="flex items-center justify-end space-x-1">
          <button
            type="button"
            title="View Details"
            onClick={() => onView(invoice)}
            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
            aria-label={`View details for invoice ${invoice.invoice_number}`}
          >
            <Eye className="w-4 h-4" />
          </button>

          {isEditable && (
            <button
              type="button"
              title="Edit Draft"
              onClick={() => onEdit(invoice)}
              className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition"
              aria-label={`Edit invoice ${invoice.invoice_number}`}
            >
              <Edit2 className="w-4 h-4" />
            </button>
          )}

          {isSendable && (
            <button
              type="button"
              title="Mark as Sent"
              onClick={() => onMarkSent(invoice)}
              className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
              aria-label={`Mark invoice ${invoice.invoice_number} as sent`}
            >
              <Send className="w-4 h-4" />
            </button>
          )}

          {isCancellable && (
            <button
              type="button"
              title="Cancel Invoice"
              onClick={() => onCancel(invoice)}
              className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
              aria-label={`Cancel invoice ${invoice.invoice_number}`}
            >
              <Ban className="w-4 h-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
};
