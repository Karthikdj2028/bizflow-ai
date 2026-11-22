import React from 'react';
import { CustomerResponse } from '../../types/api';
import { Edit2, Mail, Phone, MapPin, Clock, UserX } from 'lucide-react';
import { clsx } from 'clsx';

export interface CustomerRowProps {
  customer: CustomerResponse;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (customer: CustomerResponse) => void;
  onDelete: (customer: CustomerResponse) => void;
  disabled?: boolean;
}

export const CustomerRow: React.FC<CustomerRowProps> = ({
  customer,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  disabled = false,
}) => {
  const termsText =
    customer.payment_terms_days === 0
      ? 'Due on Receipt'
      : `Net ${customer.payment_terms_days}`;

  return (
    <tr
      data-testid={`customer-row-${customer.id}`}
      className="border-b border-slate-100 hover:bg-slate-50/70 transition-colors"
    >
      {/* Customer Name & Active Status */}
      <td className="py-3.5 px-4">
        <div className="flex items-center space-x-2">
          <span className="font-semibold text-sm text-slate-900 truncate max-w-xs">
            {customer.name}
          </span>
          <span
            className={clsx(
              'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border',
              customer.is_active
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-slate-100 text-slate-600 border-slate-200'
            )}
          >
            {customer.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </td>

      {/* Contact Info (Email & Phone) */}
      <td className="py-3.5 px-4 text-xs text-slate-600">
        <div className="space-y-1">
          {customer.email ? (
            <div className="flex items-center space-x-1.5 truncate">
              <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{customer.email}</span>
            </div>
          ) : null}
          {customer.phone ? (
            <div className="flex items-center space-x-1.5 truncate">
              <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{customer.phone}</span>
            </div>
          ) : null}
          {!customer.email && !customer.phone && (
            <span className="text-slate-400">—</span>
          )}
        </div>
      </td>

      {/* Billing Address */}
      <td className="py-3.5 px-4 text-xs text-slate-600 max-w-xs truncate">
        {customer.billing_address ? (
          <div className="flex items-center space-x-1.5 truncate">
            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">{customer.billing_address}</span>
          </div>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>

      {/* Payment Terms */}
      <td className="py-3.5 px-4 whitespace-nowrap">
        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
          <Clock className="w-3 h-3 mr-1 text-indigo-500" />
          {termsText}
        </span>
      </td>

      {/* Actions */}
      <td className="py-3.5 px-4 text-right whitespace-nowrap text-xs">
        <div className="flex items-center justify-end space-x-1">
          {canEdit && (
            <button
              type="button"
              onClick={() => onEdit(customer)}
              disabled={disabled}
              aria-label={`Edit ${customer.name}`}
              className={clsx(
                'p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition',
                disabled && 'opacity-50 cursor-not-allowed'
              )}
            >
              <Edit2 className="w-4 h-4" />
            </button>
          )}

          {canDelete && (
            <button
              type="button"
              onClick={() => onDelete(customer)}
              disabled={disabled || !customer.is_active}
              aria-label={`Deactivate ${customer.name}`}
              className={clsx(
                'p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition',
                (disabled || !customer.is_active) && 'opacity-40 cursor-not-allowed'
              )}
            >
              <UserX className="w-4 h-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
};
