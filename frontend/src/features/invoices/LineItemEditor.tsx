import React from 'react';
import { computeLineTotalCents, formatScaledBigInt, DecimalValidationError } from './invoiceMath';
import { Button } from '../../components/Button';
import { Plus, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';

export interface LineItemFormRow {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

export interface LineItemEditorProps {
  items: LineItemFormRow[];
  onChange: (items: LineItemFormRow[]) => void;
  currency?: string;
  readOnly?: boolean;
  errors?: Record<string, string>;
}

export const LineItemEditor: React.FC<LineItemEditorProps> = ({
  items,
  onChange,
  currency = 'USD',
  readOnly = false,
  errors = {},
}) => {
  const handleItemChange = (
    index: number,
    field: keyof LineItemFormRow,
    value: string
  ) => {
    const updated = items.map((item, idx) => {
      if (idx === index) {
        return { ...item, [field]: value };
      }
      return item;
    });
    onChange(updated);
  };

  const handleAddItem = () => {
    const newItem: LineItemFormRow = {
      id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      description: '',
      quantity: '1.00',
      unitPrice: '0.00',
    };
    onChange([...items, newItem]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) return;
    onChange(items.filter((_, idx) => idx !== index));
  };

  const getLineTotalDisplay = (quantity: string, unitPrice: string) => {
    if (!quantity.trim() || !unitPrice.trim()) return '0.00';
    try {
      const cents = computeLineTotalCents(quantity, unitPrice);
      return formatScaledBigInt(cents, 2);
    } catch (err: unknown) {
      if (err instanceof DecimalValidationError && err.code === 'NUMERICAL_OVERFLOW_LIMIT') {
        return 'Overflow';
      }
      return 'Invalid';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">
          Line Items ({items.length})
        </h3>
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddItem}
            icon={<Plus className="w-4 h-4" />}
          >
            Add Line Item
          </Button>
        )}
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white shadow-xs">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              <th className="py-3 px-4 w-12 text-center">#</th>
              <th className="py-3 px-4 min-w-[200px]">Description</th>
              <th className="py-3 px-4 w-32">Qty</th>
              <th className="py-3 px-4 w-36">Unit Price</th>
              <th className="py-3 px-4 w-36 text-right">Line Total</th>
              {!readOnly && <th className="py-3 px-4 w-16 text-center">Action</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {items.map((item, index) => {
              const descError = errors[`items[${index}].description`];
              const qtyError = errors[`items[${index}].quantity`];
              const priceError = errors[`items[${index}].unit_price`];
              const lineTotal = getLineTotalDisplay(item.quantity, item.unitPrice);

              return (
                <tr key={item.id} className="hover:bg-slate-50/60 transition">
                  <td className="py-3 px-4 text-center text-xs font-medium text-slate-400">
                    {index + 1}
                  </td>
                  <td className="py-3 px-4">
                    <input
                      type="text"
                      disabled={readOnly}
                      value={item.description}
                      placeholder="Item description or service..."
                      onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                      aria-label={`Item ${index + 1} description`}
                      className={clsx(
                        'w-full px-3 py-1.5 text-sm bg-white border rounded-lg shadow-2xs transition',
                        'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500',
                        descError
                          ? 'border-rose-400 text-rose-900 focus:ring-rose-500'
                          : 'border-slate-300 hover:border-slate-400'
                      )}
                    />
                    {descError && (
                      <p className="mt-1 text-xs text-rose-600 font-medium">{descError}</p>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <input
                      type="text"
                      disabled={readOnly}
                      value={item.quantity}
                      placeholder="1.00"
                      onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                      aria-label={`Item ${index + 1} quantity`}
                      className={clsx(
                        'w-full px-3 py-1.5 text-sm font-mono bg-white border rounded-lg shadow-2xs transition',
                        'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500',
                        qtyError
                          ? 'border-rose-400 text-rose-900 focus:ring-rose-500'
                          : 'border-slate-300 hover:border-slate-400'
                      )}
                    />
                    {qtyError && (
                      <p className="mt-1 text-xs text-rose-600 font-medium">{qtyError}</p>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <input
                      type="text"
                      disabled={readOnly}
                      value={item.unitPrice}
                      placeholder="0.00"
                      onChange={(e) => handleItemChange(index, 'unitPrice', e.target.value)}
                      aria-label={`Item ${index + 1} unit price`}
                      className={clsx(
                        'w-full px-3 py-1.5 text-sm font-mono bg-white border rounded-lg shadow-2xs transition',
                        'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500',
                        priceError
                          ? 'border-rose-400 text-rose-900 focus:ring-rose-500'
                          : 'border-slate-300 hover:border-slate-400'
                      )}
                    />
                    {priceError && (
                      <p className="mt-1 text-xs text-rose-600 font-medium">{priceError}</p>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-medium text-slate-800">
                    {currency} {lineTotal}
                  </td>
                  {!readOnly && (
                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        disabled={items.length <= 1}
                        onClick={() => handleRemoveItem(index)}
                        aria-label={`Remove item ${index + 1}: ${item.description || 'unnamed'}`}
                        className={clsx(
                          'p-1.5 rounded-lg transition',
                          items.length <= 1
                            ? 'text-slate-300 cursor-not-allowed'
                            : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                        )}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
