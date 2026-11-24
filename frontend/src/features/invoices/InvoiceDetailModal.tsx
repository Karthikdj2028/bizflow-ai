import React, { useEffect, useState } from 'react';
import { InvoiceDetailResponse } from '../../types/api';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { InvoiceStatusBadge } from './InvoiceStatusBadge';
import { AlertCircle, Edit2, Send, Ban, Calendar, User, FileText } from 'lucide-react';

export interface InvoiceDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoiceId: string | null;
  getInvoiceDetail: (id: string) => Promise<InvoiceDetailResponse>;
  onEdit?: (invoice: InvoiceDetailResponse) => void;
  onMarkSent?: (invoice: InvoiceDetailResponse) => void;
  onCancel?: (invoice: InvoiceDetailResponse) => void;
  canEdit?: boolean;
  canSend?: boolean;
  canCancel?: boolean;
  currency?: string;
}

export const InvoiceDetailModal: React.FC<InvoiceDetailModalProps> = ({
  isOpen,
  onClose,
  invoiceId,
  getInvoiceDetail,
  onEdit,
  onMarkSent,
  onCancel,
  canEdit = false,
  canSend = false,
  canCancel = false,
  currency = 'USD',
}) => {
  const [invoice, setInvoice] = useState<InvoiceDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !invoiceId) {
      setInvoice(null);
      setError(null);
      return;
    }

    let isSubscribed = true;
    setIsLoading(true);
    setError(null);

    getInvoiceDetail(invoiceId)
      .then((data) => {
        if (isSubscribed) {
          setInvoice(data);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isSubscribed) {
          setError((err as Error).message || 'Failed to load invoice details.');
          setIsLoading(false);
        }
      });

    return () => {
      isSubscribed = false;
    };
  }, [isOpen, invoiceId, getInvoiceDetail]);

  if (!isOpen) return null;

  const isDraft = invoice?.persisted_status === 'DRAFT';
  const isSent = invoice?.persisted_status === 'SENT';
  const isUnpaid = invoice?.paid_amount === '0.00';

  const isEditable = canEdit && isDraft;
  const isSendable = canSend && isDraft && invoice?.total_amount !== '0.00';
  const isCancellable = canCancel && (isDraft || (isSent && isUnpaid));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={invoice ? `Invoice: ${invoice.invoice_number}` : 'Invoice Detail'}
      maxWidth="xl"
    >
      {isLoading && (
        <div className="py-12 text-center text-slate-500 animate-pulse space-y-4">
          <div className="h-6 bg-slate-200 rounded w-1/3 mx-auto" />
          <div className="h-24 bg-slate-100 rounded w-full" />
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center space-x-3 text-rose-700 text-sm"
        >
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {invoice && !isLoading && (
        <div className="space-y-6">
          {/* Header Summary */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <span className="text-lg font-bold text-slate-900 font-mono">
                  {invoice.invoice_number}
                </span>
                <InvoiceStatusBadge
                  status={invoice.status}
                  persistedStatus={invoice.persisted_status}
                />
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <User className="w-3.5 h-3.5 text-slate-400" />
                <span className="font-semibold text-slate-800">{invoice.customer_name}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 text-xs text-slate-600 font-mono">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>Issue: {invoice.issue_date}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>Due: {invoice.due_date}</span>
              </div>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              Line Items ({invoice.items?.length || 0})
            </h4>
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-2.5 px-4">Description</th>
                    <th className="py-2.5 px-4 w-28 text-right">Qty</th>
                    <th className="py-2.5 px-4 w-32 text-right">Unit Price</th>
                    <th className="py-2.5 px-4 w-36 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoice.items?.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/50">
                      <td className="py-2.5 px-4 font-medium text-slate-800">
                        {item.description}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-600 text-right">
                        {item.quantity}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-600 text-right">
                        {currency} {item.unit_price}
                      </td>
                      <td className="py-2.5 px-4 font-mono font-semibold text-slate-900 text-right">
                        {currency} {item.line_total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Financial Breakdown & Notes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            <div className="space-y-3">
              {invoice.notes && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    <FileText className="w-3.5 h-3.5 text-slate-400" />
                    <span>Notes</span>
                  </div>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{invoice.notes}</p>
                </div>
              )}

              <div className="text-xs text-slate-400 space-y-1">
                <p>Created: {new Date(invoice.created_at).toLocaleString()}</p>
                <p>Last updated: {new Date(invoice.updated_at).toLocaleString()}</p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-2.5 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="font-mono font-medium text-slate-900">
                  {currency} {invoice.subtotal}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Tax ({Number(invoice.tax_rate) * 100}%)</span>
                <span className="font-mono font-medium text-slate-900">
                  {currency} {invoice.tax_amount}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Discount</span>
                <span className="font-mono font-medium text-slate-900">
                  -{currency} {invoice.discount_amount}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex justify-between text-base font-bold text-slate-900">
                <span>Total Amount</span>
                <span className="font-mono">{currency} {invoice.total_amount}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500 pt-1">
                <span>Paid to date</span>
                <span className="font-mono">{currency} {invoice.paid_amount}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold text-indigo-700 pt-1 border-t border-slate-200">
                <span>Balance Due</span>
                <span className="font-mono">{currency} {invoice.balance_due}</span>
              </div>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap justify-between items-center gap-3 pt-4 border-t border-slate-200">
            <div className="flex flex-wrap gap-2">
              {isEditable && onEdit && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onClose();
                    onEdit(invoice);
                  }}
                  icon={<Edit2 className="w-4 h-4" />}
                >
                  Edit Invoice
                </Button>
              )}

              {isSendable && onMarkSent && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    onClose();
                    onMarkSent(invoice);
                  }}
                  icon={<Send className="w-4 h-4" />}
                >
                  Mark as Sent
                </Button>
              )}

              {isCancellable && onCancel && (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    onClose();
                    onCancel(invoice);
                  }}
                  icon={<Ban className="w-4 h-4" />}
                >
                  Cancel Invoice
                </Button>
              )}
            </div>

            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};
