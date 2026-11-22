import React from 'react';
import { TransactionResponse } from '../../types/api';
import { formatCurrencyAmount, formatDisplayDate, formatPaymentMethod } from '../../lib/formatters';
import { Edit2, Trash2, User, FileText } from 'lucide-react';
import { clsx } from 'clsx';

export interface TransactionRowProps {
  transaction: TransactionResponse;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (tx: TransactionResponse) => void;
  onDelete: (tx: TransactionResponse) => void;
  disabled?: boolean;
}

export const TransactionRow: React.FC<TransactionRowProps> = ({
  transaction,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  disabled = false,
}) => {
  const isIncome = transaction.type === 'INCOME';

  return (
    <tr
      data-testid={`transaction-row-${transaction.id}`}
      className="border-b border-slate-100 hover:bg-slate-50/70 transition-colors"
    >
      {/* Date */}
      <td className="py-3.5 px-4 text-xs font-medium text-slate-700 whitespace-nowrap">
        {formatDisplayDate(transaction.transaction_date)}
      </td>

      {/* Type Pill */}
      <td className="py-3.5 px-4 whitespace-nowrap">
        <span
          className={clsx(
            'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold',
            isIncome
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
              : 'bg-rose-50 text-rose-700 border border-rose-200/60'
          )}
        >
          {transaction.type}
        </span>
      </td>

      {/* Description & Counterparty / Reference */}
      <td className="py-3.5 px-4 max-w-xs sm:max-w-sm truncate">
        <div className="text-sm font-semibold text-slate-900 truncate">
          {transaction.description}
        </div>
        {(transaction.counterparty || transaction.reference_number) && (
          <div className="flex items-center space-x-2 text-xs text-slate-500 mt-0.5 truncate">
            {transaction.counterparty && (
              <span className="flex items-center truncate">
                <User className="w-3 h-3 mr-1 shrink-0 text-slate-400" />
                <span className="truncate">{transaction.counterparty}</span>
              </span>
            )}
            {transaction.reference_number && (
              <span className="flex items-center truncate">
                <FileText className="w-3 h-3 mr-1 shrink-0 text-slate-400" />
                <span className="truncate">Ref: {transaction.reference_number}</span>
              </span>
            )}
          </div>
        )}
      </td>

      {/* Category */}
      <td className="py-3.5 px-4 whitespace-nowrap">
        {transaction.category_name ? (
          <span className="inline-flex items-center text-xs font-medium text-slate-700 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200/70">
            <span
              className="w-2 h-2 rounded-full mr-1.5 shrink-0"
              style={{ backgroundColor: transaction.category_color || '#6366F1' }}
            />
            <span className="truncate max-w-[120px]">{transaction.category_name}</span>
          </span>
        ) : (
          <span className="text-xs text-slate-400 italic">Uncategorized</span>
        )}
      </td>

      {/* Payment Method */}
      <td className="py-3.5 px-4 text-xs text-slate-600 whitespace-nowrap">
        {formatPaymentMethod(transaction.payment_method)}
      </td>

      {/* Amount */}
      <td className="py-3.5 px-4 text-right whitespace-nowrap">
        <span
          className={clsx(
            'text-sm font-bold tracking-tight',
            isIncome ? 'text-emerald-600' : 'text-slate-900'
          )}
        >
          {isIncome ? '+' : '-'}
          {formatCurrencyAmount(transaction.amount, transaction.currency)}
        </span>
      </td>

      {/* Actions */}
      <td className="py-3.5 px-4 text-right whitespace-nowrap">
        <div className="flex items-center justify-end space-x-1">
          {canEdit && (
            <button
              type="button"
              onClick={() => onEdit(transaction)}
              disabled={disabled}
              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
              title="Edit Transaction"
              aria-label={`Edit ${transaction.description}`}
            >
              <Edit2 className="w-4 h-4" />
            </button>
          )}

          {canDelete && (
            <button
              type="button"
              onClick={() => onDelete(transaction)}
              disabled={disabled}
              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
              title="Delete Transaction"
              aria-label={`Delete ${transaction.description}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          {!canEdit && !canDelete && (
            <span className="text-xs text-slate-400 italic">—</span>
          )}
        </div>
      </td>
    </tr>
  );
};
