import React from 'react';
import { InvoiceStatus, InvoicePersistedStatus } from '../../types/api';
import { clsx } from 'clsx';
import { AlertCircle } from 'lucide-react';

export interface InvoiceStatusBadgeProps {
  status: InvoiceStatus;
  persistedStatus?: InvoicePersistedStatus;
  className?: string;
}

export const InvoiceStatusBadge: React.FC<InvoiceStatusBadgeProps> = ({
  status,
  persistedStatus,
  className,
}) => {
  const getBadgeConfig = (st: InvoiceStatus) => {
    switch (st) {
      case 'DRAFT':
        return {
          label: 'Draft',
          classes: 'bg-slate-100 text-slate-700 border-slate-300',
        };
      case 'SENT':
        return {
          label: 'Sent',
          classes: 'bg-blue-50 text-blue-700 border-blue-200',
        };
      case 'OVERDUE':
        return {
          label: 'Overdue',
          classes: 'bg-rose-50 text-rose-700 border-rose-200 font-semibold',
          hasIcon: true,
        };
      case 'PARTIALLY_PAID':
        return {
          label: 'Partially Paid',
          classes: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        };
      case 'PAID':
        return {
          label: 'Paid',
          classes: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        };
      case 'CANCELED':
        return {
          label: 'Canceled',
          classes: 'bg-zinc-100 text-zinc-500 border-zinc-200 line-through',
        };
      default:
        return {
          label: st,
          classes: 'bg-slate-100 text-slate-700 border-slate-300',
        };
    }
  };

  const config = getBadgeConfig(status);
  const tooltip =
    status === 'OVERDUE' && persistedStatus
      ? `Overdue (Persisted: ${persistedStatus})`
      : undefined;

  return (
    <span
      title={tooltip}
      className={clsx(
        'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border shadow-xs transition',
        config.classes,
        className
      )}
    >
      {config.hasIcon && <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />}
      <span>{config.label}</span>
    </span>
  );
};
