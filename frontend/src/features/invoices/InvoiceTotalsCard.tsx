import React from 'react';
import { clsx } from 'clsx';
import { AlertTriangle } from 'lucide-react';

export interface InvoiceTotalsCardProps {
  subtotal: string;
  taxAmount: string;
  taxPercent: string;
  discountAmount: string;
  totalAmount: string | null;
  isDiscountExceeded?: boolean;
  errorMessage?: string;
  currency?: string;
  className?: string;
}

export const InvoiceTotalsCard: React.FC<InvoiceTotalsCardProps> = ({
  subtotal,
  taxAmount,
  taxPercent,
  discountAmount,
  totalAmount,
  isDiscountExceeded = false,
  errorMessage,
  currency = 'USD',
  className,
}) => {
  return (
    <div
      className={clsx(
        'bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3',
        className
      )}
    >
      <div className="flex justify-between items-center text-sm text-slate-600">
        <span>Subtotal</span>
        <span className="font-medium text-slate-900 font-mono">
          {currency} {subtotal || '0.00'}
        </span>
      </div>

      <div className="flex justify-between items-center text-sm text-slate-600">
        <span>
          Tax {taxPercent ? `(${taxPercent}%)` : '(0%)'}
        </span>
        <span className="font-medium text-slate-900 font-mono">
          {currency} {taxAmount || '0.00'}
        </span>
      </div>

      <div className="flex justify-between items-center text-sm text-slate-600">
        <span>Discount</span>
        <span
          className={clsx(
            'font-medium font-mono',
            isDiscountExceeded ? 'text-rose-600 font-bold' : 'text-slate-900'
          )}
        >
          -{currency} {discountAmount || '0.00'}
        </span>
      </div>

      {isDiscountExceeded && (
        <div
          role="alert"
          className="flex items-center gap-2 p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 font-medium"
        >
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorMessage || 'Discount amount cannot exceed subtotal + tax amount.'}</span>
        </div>
      )}

      <div className="pt-3 border-t border-slate-200 flex justify-between items-center text-base">
        <span className="font-semibold text-slate-900">Total Amount</span>
        {totalAmount !== null ? (
          <span className="font-bold text-slate-900 font-mono text-lg">
            {currency} {totalAmount}
          </span>
        ) : (
          <span className="font-bold text-rose-600 text-sm italic">
            Unavailable (Invalid discount)
          </span>
        )}
      </div>
    </div>
  );
};
