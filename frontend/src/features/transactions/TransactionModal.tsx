import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  CategoryResponse,
  PaymentMethod,
  SUPPORTED_PAYMENT_METHODS,
  TransactionCreateRequest,
  TransactionResponse,
  TransactionUpdateRequest,
} from '../../types/api';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { Button } from '../../components/Button';
import {
  formatPaymentMethod,
  getUtcTodayDateString,
  isDateInFutureUtc,
  isValidCalendarDate,
  isValidMonetaryAmount,
} from '../../lib/formatters';
import { AlertCircle } from 'lucide-react';
import { clsx } from 'clsx';

export interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: TransactionCreateRequest | TransactionUpdateRequest) => Promise<any>;
  initialData?: TransactionResponse | null;
  categories: CategoryResponse[];
  currency?: string;
  isLoading?: boolean;
}

export const TransactionModal: React.FC<TransactionModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData = null,
  categories,
  currency = 'INR',
  isLoading = false,
}) => {
  const isEdit = Boolean(initialData);

  const [type, setType] = useState<'INCOME' | 'EXPENSE'>('EXPENSE');
  const [amount, setAmount] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [transactionDate, setTransactionDate] = useState<string>(getUtcTodayDateString());
  const [description, setDescription] = useState<string>('');
  const [counterparty, setCounterparty] = useState<string>('');
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('BANK_TRANSFER');

  // Field validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const prevIsOpenRef = useRef(false);
  const prevInitialDataIdRef = useRef<string | undefined>(undefined);

  // Sync state with initialData when opened or when switching to a different transaction
  useEffect(() => {
    const wasOpen = prevIsOpenRef.current;
    const prevId = prevInitialDataIdRef.current;
    const currentId = initialData?.id;

    prevIsOpenRef.current = isOpen;
    prevInitialDataIdRef.current = currentId;

    if (!isOpen) {
      return;
    }

    const isOpening = !wasOpen;
    const isDifferentTransaction = wasOpen && currentId !== prevId;

    if (!isOpening && !isDifferentTransaction) {
      return;
    }

    if (initialData) {
      setType(initialData.type);
      setAmount(initialData.amount);
      setCategoryId(initialData.category_id);
      setTransactionDate(initialData.transaction_date);
      setDescription(initialData.description);
      setCounterparty(initialData.counterparty || '');
      setReferenceNumber(initialData.reference_number || '');
      setPaymentMethod(initialData.payment_method || 'BANK_TRANSFER');
    } else {
      setType('EXPENSE');
      setAmount('');
      setCategoryId('');
      setTransactionDate(getUtcTodayDateString());
      setDescription('');
      setCounterparty('');
      setReferenceNumber('');
      setPaymentMethod('BANK_TRANSFER');
    }
    setErrors({});
    setServerError(null);
  }, [isOpen, initialData]);

  // Filter categories matching current transaction type
  const matchingCategories = useMemo(
    () => categories.filter((cat) => cat.type === type),
    [categories, type]
  );

  // Keep category selection synchronized with selected transaction type and available categories
  useEffect(() => {
    if (!isOpen) return;

    if (matchingCategories.length > 0 && !matchingCategories.some((c) => c.id === categoryId)) {
      setCategoryId(matchingCategories[0].id);
    } else if (matchingCategories.length === 0 && categories.length > 0 && categoryId !== '') {
      setCategoryId('');
    }
  }, [isOpen, matchingCategories, categories.length, categoryId]);

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};

    // 1. Amount validation
    if (!amount.trim()) {
      nextErrors.amount = 'Amount is required.';
    } else if (!isValidMonetaryAmount(amount.trim())) {
      nextErrors.amount =
        'Enter a valid positive amount (up to 2 decimal places, e.g. "1250.50").';
    }

    // 2. Category validation
    if (!categoryId) {
      nextErrors.category_id = `Please select an ${type.toLowerCase()} category.`;
    }

    // 3. Date validation
    if (!transactionDate) {
      nextErrors.transaction_date = 'Transaction date is required.';
    } else if (!isValidCalendarDate(transactionDate)) {
      nextErrors.transaction_date = 'Enter a valid calendar date (YYYY-MM-DD).';
    } else if (isDateInFutureUtc(transactionDate)) {
      nextErrors.transaction_date = 'Transaction date cannot be in the future (UTC).';
    }

    // 4. Description validation
    if (!description.trim()) {
      nextErrors.description = 'Description is required.';
    } else if (description.trim().length > 255) {
      nextErrors.description = 'Description cannot exceed 255 characters.';
    }

    // 5. Optional fields bounds
    if (counterparty.trim().length > 255) {
      nextErrors.counterparty = 'Counterparty cannot exceed 255 characters.';
    }
    if (referenceNumber.trim().length > 100) {
      nextErrors.reference_number = 'Reference number cannot exceed 100 characters.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    if (!validate()) return;

    try {
      if (isEdit) {
        const updatePayload: TransactionUpdateRequest = {
          amount: amount.trim(),
          category_id: categoryId,
          transaction_date: transactionDate,
          description: description.trim(),
          counterparty: counterparty.trim() || null,
          reference_number: referenceNumber.trim() || null,
          payment_method: paymentMethod,
        };
        await onSubmit(updatePayload);
      } else {
        const createPayload: TransactionCreateRequest = {
          type,
          amount: amount.trim(),
          category_id: categoryId,
          transaction_date: transactionDate,
          description: description.trim(),
          counterparty: counterparty.trim() || null,
          reference_number: referenceNumber.trim() || null,
          payment_method: paymentMethod,
        };
        await onSubmit(createPayload);
      }
    } catch (err: any) {
      const msg = err?.problem?.detail || err?.message || 'Failed to save transaction.';
      setServerError(msg);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Transaction' : 'Record New Transaction'}
      description={
        isEdit
          ? 'Modify details of this existing ledger entry. Transaction cash flow type is immutable.'
          : `Record an income or expense transaction in ${currency}.`
      }
      maxWidth="md"
      isLoading={isLoading}
      preventClose={isLoading}
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {serverError && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start space-x-2 text-rose-700 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{serverError}</span>
          </div>
        )}

        {/* Cash Flow Classification (Type) */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            Transaction Type
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={isEdit || isLoading}
              onClick={() => setType('EXPENSE')}
              className={clsx(
                'py-2 px-4 rounded-lg text-sm font-semibold border transition text-center',
                type === 'EXPENSE'
                  ? 'bg-rose-50 border-rose-400 text-rose-700 ring-2 ring-rose-200 shadow-sm'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50',
                (isEdit || isLoading) && 'opacity-60 cursor-not-allowed'
              )}
            >
              Expense (-)
            </button>
            <button
              type="button"
              disabled={isEdit || isLoading}
              onClick={() => setType('INCOME')}
              className={clsx(
                'py-2 px-4 rounded-lg text-sm font-semibold border transition text-center',
                type === 'INCOME'
                  ? 'bg-emerald-50 border-emerald-400 text-emerald-700 ring-2 ring-emerald-200 shadow-sm'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50',
                (isEdit || isLoading) && 'opacity-60 cursor-not-allowed'
              )}
            >
              Income (+)
            </button>
          </div>
          {isEdit && (
            <p className="text-[11px] text-slate-400 mt-1">
              Transaction type cannot be changed after creation.
            </p>
          )}
        </div>

        {/* Amount & Date Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label={`Amount (${currency})`}
            id="tx-amount"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              if (errors.amount) setErrors((prev) => ({ ...prev, amount: '' }));
            }}
            error={errors.amount}
            disabled={isLoading}
            required
          />

          <div>
            <label
              htmlFor="tx-date"
              className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5"
            >
              Date (UTC)
            </label>
            <input
              id="tx-date"
              type="date"
              max={getUtcTodayDateString()}
              value={transactionDate}
              onChange={(e) => {
                setTransactionDate(e.target.value);
                if (errors.transaction_date) setErrors((prev) => ({ ...prev, transaction_date: '' }));
              }}
              disabled={isLoading}
              className={clsx(
                'w-full px-3.5 py-2 text-sm text-slate-900 bg-white border rounded-lg shadow-sm transition',
                'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500',
                errors.transaction_date
                  ? 'border-rose-400 text-rose-900 focus:ring-rose-500'
                  : 'border-slate-300 hover:border-slate-400',
                isLoading && 'bg-slate-50 text-slate-400 cursor-not-allowed'
              )}
              required
            />
            {errors.transaction_date && (
              <p className="mt-1 text-xs text-rose-600 font-medium">{errors.transaction_date}</p>
            )}
          </div>
        </div>

        {/* Category & Payment Method Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Category"
            id="tx-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            error={errors.category_id}
            disabled={isLoading || matchingCategories.length === 0}
            options={matchingCategories.map((c) => ({
              value: c.id,
              label: c.name,
            }))}
            helperText={
              matchingCategories.length === 0
                ? `No ${type.toLowerCase()} categories found. Create one in Categories first.`
                : undefined
            }
          />

          <Select
            label="Payment Method"
            id="tx-payment-method"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            disabled={isLoading}
            options={SUPPORTED_PAYMENT_METHODS.map((method) => ({
              value: method,
              label: formatPaymentMethod(method),
            }))}
          />
        </div>

        {/* Description */}
        <Input
          label="Description / Memorandum"
          id="tx-description"
          type="text"
          placeholder="e.g. Office Supplies & Printer Ink"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          error={errors.description}
          disabled={isLoading}
          required
        />

        {/* Counterparty & Reference Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Counterparty (Optional)"
            id="tx-counterparty"
            type="text"
            placeholder="e.g. Acme Corp, Vendor, Client"
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            error={errors.counterparty}
            disabled={isLoading}
          />

          <Input
            label="Reference Number (Optional)"
            id="tx-reference"
            type="text"
            placeholder="e.g. INV-9912, Check #, Receipt #"
            value={referenceNumber}
            onChange={(e) => setReferenceNumber(e.target.value)}
            error={errors.reference_number}
            disabled={isLoading}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-100">
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>

          <Button
            type="submit"
            variant="primary"
            size="md"
            isLoading={isLoading}
          >
            {isEdit ? 'Save Changes' : 'Record Transaction'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
