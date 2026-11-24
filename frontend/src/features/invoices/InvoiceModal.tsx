import React, { useState, useEffect, useRef } from 'react';
import {
  CustomerResponse,
  InvoiceCreateRequest,
  InvoiceDetailResponse,
  InvoiceListItemResponse,
  InvoiceUpdateRequest,
} from '../../types/api';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';
import { Select, SelectOption } from '../../components/Select';
import { Button } from '../../components/Button';
import { LineItemEditor, LineItemFormRow } from './LineItemEditor';
import { InvoiceTotalsCard } from './InvoiceTotalsCard';
import {
  computeInvoiceTotals,
  fractionalStringToPercentString,
  percentStringToFractionalString,
  addDaysToDateString,
  getTodayDateString,
  DecimalValidationError,
  ComputedInvoiceTotals,
} from './invoiceMath';
import { ApiClientError } from '../../lib/api';
import { AlertCircle } from 'lucide-react';

export interface InvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: InvoiceCreateRequest | InvoiceUpdateRequest) => Promise<any>;
  initialData?: InvoiceDetailResponse | InvoiceListItemResponse | null;
  isLoading?: boolean;
  customers: CustomerResponse[];
  currency?: string;
}

export const InvoiceModal: React.FC<InvoiceModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData = null,
  isLoading = false,
  customers,
  currency = 'USD',
}) => {
  const isEdit = Boolean(initialData);

  const [customerId, setCustomerId] = useState<string>('');
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [issueDate, setIssueDate] = useState<string>(getTodayDateString());
  const [dueDate, setDueDate] = useState<string>(getTodayDateString());
  const [taxPercent, setTaxPercent] = useState<string>('0');
  const [discountAmount, setDiscountAmount] = useState<string>('0.00');
  const [notes, setNotes] = useState<string>('');
  const [items, setItems] = useState<LineItemFormRow[]>([
    { id: 'item-1', description: '', quantity: '1.00', unitPrice: '0.00' },
  ]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Form preservation across parent re-renders
  const prevIsOpenRef = useRef(false);
  const prevInitialDataIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const wasOpen = prevIsOpenRef.current;
    const prevId = prevInitialDataIdRef.current;
    const currentId = initialData?.id;

    prevIsOpenRef.current = isOpen;
    prevInitialDataIdRef.current = currentId;

    if (!isOpen) return;

    const isOpening = !wasOpen;
    const isDifferentInvoice = wasOpen && currentId !== prevId;

    if (!isOpening && !isDifferentInvoice) {
      return; // Preserve existing in-progress form inputs
    }

    if (initialData) {
      setCustomerId(initialData.customer_id);
      setInvoiceNumber(initialData.invoice_number);
      setIssueDate(initialData.issue_date);
      setDueDate(initialData.due_date);
      setTaxPercent(fractionalStringToPercentString(initialData.tax_rate));
      setDiscountAmount(initialData.discount_amount);
      setNotes(initialData.notes || '');

      // Populate items if detail data present
      if ('items' in initialData && Array.isArray((initialData as InvoiceDetailResponse).items)) {
        const detailItems = (initialData as InvoiceDetailResponse).items;
        if (detailItems.length > 0) {
          setItems(
            detailItems.map((it) => ({
              id: it.id,
              description: it.description,
              quantity: it.quantity,
              unitPrice: it.unit_price,
            }))
          );
        } else {
          setItems([{ id: 'item-1', description: '', quantity: '1.00', unitPrice: '0.00' }]);
        }
      } else {
        setItems([{ id: 'item-1', description: '', quantity: '1.00', unitPrice: '0.00' }]);
      }
    } else {
      // Create new draft
      const today = getTodayDateString();
      setCustomerId('');
      setInvoiceNumber('');
      setIssueDate(today);
      setDueDate(today);
      setTaxPercent('0');
      setDiscountAmount('0.00');
      setNotes('');
      setItems([{ id: 'item-1', description: '', quantity: '1.00', unitPrice: '0.00' }]);
    }

    setErrors({});
    setServerError(null);
  }, [isOpen, initialData]);

  // Handle customer change and auto-set due date based on payment terms
  const handleCustomerChange = (newCustId: string) => {
    setCustomerId(newCustId);
    const selectedCust = customers.find((c) => c.id === newCustId);
    if (selectedCust && selectedCust.payment_terms_days >= 0) {
      setDueDate(addDaysToDateString(issueDate, selectedCust.payment_terms_days));
    }
  };

  // Build customer options including inactive current customer if editing
  const customerOptions: SelectOption[] = React.useMemo(() => {
    const safeCustomers = customers || [];
    const activeOpts = safeCustomers
      .filter((c) => c.is_active)
      .map((c) => ({
        value: c.id,
        label: `${c.name} (${c.payment_terms_days} days net)`,
      }));

    // If editing and current customer is inactive or missing from active list, include it
    if (isEdit && initialData) {
      const existsInActive = activeOpts.some((opt) => opt.value === initialData.customer_id);
      if (!existsInActive) {
        return [
          {
            value: initialData.customer_id,
            label: `${initialData.customer_name || 'Customer'} (Current - Inactive)`,
          },
          ...activeOpts,
        ];
      }
    }

    return [{ value: '', label: 'Select customer...' }, ...activeOpts];
  }, [customers, isEdit, initialData]);

  // Compute live totals with strict BigInt arithmetic
  let computedTotals: ComputedInvoiceTotals = {
    subtotal: '0.00',
    taxAmount: '0.00',
    discountAmount: '0.00',
    totalAmount: '0.00',
    isDiscountExceeded: false,
    errorMessage: undefined,
  };

  try {
    computedTotals = computeInvoiceTotals(items, taxPercent, discountAmount);
  } catch (err: unknown) {
    if (err instanceof DecimalValidationError) {
      computedTotals.errorMessage = err.message;
      computedTotals.totalAmount = null;
    }
  }

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};

    // 1. Customer validation
    if (!customerId) {
      nextErrors.customer_id = 'Please select a customer.';
    }

    // 2. Invoice number
    if (!invoiceNumber.trim()) {
      nextErrors.invoice_number = 'Invoice number is required.';
    } else if (invoiceNumber.trim().length > 64) {
      nextErrors.invoice_number = 'Invoice number cannot exceed 64 characters.';
    }

    // 3. Date validation
    if (!issueDate) {
      nextErrors.issue_date = 'Issue date is required.';
    }
    if (!dueDate) {
      nextErrors.due_date = 'Due date is required.';
    }
    if (issueDate && dueDate && dueDate < issueDate) {
      nextErrors.due_date = 'Due date cannot be earlier than issue date.';
    }

    // 4. Line items validation
    if (items.length === 0) {
      nextErrors.items = 'Invoice must have at least one line item.';
    }

    items.forEach((item, idx) => {
      if (!item.description.trim()) {
        nextErrors[`items[${idx}].description`] = 'Description is required.';
      } else if (item.description.trim().length > 255) {
        nextErrors[`items[${idx}].description`] = 'Description cannot exceed 255 characters.';
      }

      if (!item.quantity.trim()) {
        nextErrors[`items[${idx}].quantity`] = 'Quantity is required.';
      } else {
        const decParts = item.quantity.trim().split('.');
        if (decParts.length > 2 || (decParts[1] && decParts[1].length > 2)) {
          nextErrors[`items[${idx}].quantity`] = 'Quantity cannot have more than 2 decimal places.';
        }
      }

      if (!item.unitPrice.trim()) {
        nextErrors[`items[${idx}].unit_price`] = 'Unit price is required.';
      } else {
        const decParts = item.unitPrice.trim().split('.');
        if (decParts.length > 2 || (decParts[1] && decParts[1].length > 2)) {
          nextErrors[`items[${idx}].unit_price`] = 'Unit price cannot have more than 2 decimal places.';
        }
      }
    });

    // 5. Tax rate
    if (taxPercent.trim()) {
      try {
        percentStringToFractionalString(taxPercent);
      } catch (err: any) {
        nextErrors.tax_percent = err.message || 'Invalid tax percentage.';
      }
    }

    // 6. Discount & Totals validation
    if (computedTotals.isDiscountExceeded) {
      nextErrors.discount_amount = 'Discount amount cannot exceed subtotal + tax amount.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || isLoading) return;
    setServerError(null);

    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const taxRateFractional = percentStringToFractionalString(taxPercent);
      const formattedItems = items.map((it) => ({
        description: it.description.trim(),
        quantity: it.quantity.trim(),
        unit_price: it.unitPrice.trim(),
      }));

      if (isEdit) {
        // Safe inactive customer handling: OMIT customer_id if unchanged
        const updatePayload: InvoiceUpdateRequest = {
          invoice_number: invoiceNumber.trim(),
          issue_date: issueDate,
          due_date: dueDate,
          tax_rate: taxRateFractional,
          discount_amount: discountAmount.trim() || '0.00',
          notes: notes.trim() ? notes.trim() : null,
          items: formattedItems,
        };

        if (initialData && customerId !== initialData.customer_id) {
          updatePayload.customer_id = customerId;
        }

        await onSubmit(updatePayload);
      } else {
        const createPayload: InvoiceCreateRequest = {
          customer_id: customerId,
          invoice_number: invoiceNumber.trim(),
          issue_date: issueDate,
          due_date: dueDate,
          tax_rate: taxRateFractional,
          discount_amount: discountAmount.trim() || '0.00',
          notes: notes.trim() ? notes.trim() : null,
          items: formattedItems,
        };
        await onSubmit(createPayload);
      }
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        if (err.problem?.code === 'INVOICE_NUMBER_ALREADY_EXISTS') {
          setErrors((prev) => ({
            ...prev,
            invoice_number: 'Invoice number already exists in this workspace.',
          }));
        } else if (err.problem?.code === 'CUSTOMER_INACTIVE') {
          setErrors((prev) => ({
            ...prev,
            customer_id: 'Cannot assign invoice to an inactive customer.',
          }));
        } else if (err.problem?.code === 'DISCOUNT_EXCEEDS_TOTAL') {
          setErrors((prev) => ({
            ...prev,
            discount_amount: 'Discount amount cannot exceed subtotal + tax amount.',
          }));
        } else {
          setServerError(err.problem?.detail || err.message);
        }
      } else {
        setServerError((err as Error).message || 'Failed to save invoice.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? `Edit Draft Invoice (${initialData?.invoice_number})` : 'Create New Invoice'}
      maxWidth="xl"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        {serverError && (
          <div
            role="alert"
            className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-center space-x-2 text-rose-700 text-sm"
          >
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            <span className="font-medium">{serverError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Customer"
            value={customerId}
            onChange={(e) => handleCustomerChange(e.target.value)}
            options={customerOptions}
            error={errors.customer_id}
            disabled={isLoading || isSubmitting}
          />

          <Input
            label="Invoice Number"
            type="text"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder="INV-001"
            error={errors.invoice_number}
            disabled={isLoading || isSubmitting}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Issue Date"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            error={errors.issue_date}
            disabled={isLoading || isSubmitting}
          />

          <Input
            label="Due Date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            error={errors.due_date}
            disabled={isLoading || isSubmitting}
          />
        </div>

        {/* Dynamic Multi-Line Items */}
        <div className="pt-2">
          <LineItemEditor
            items={items}
            onChange={setItems}
            currency={currency}
            readOnly={isLoading}
            errors={errors}
          />
          {errors.items && (
            <p className="mt-1 text-xs text-rose-600 font-medium">{errors.items}</p>
          )}
        </div>

        {/* Tax, Discount, Notes, and Totals */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-slate-100">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Tax Rate (%)"
                type="text"
                value={taxPercent}
                onChange={(e) => setTaxPercent(e.target.value)}
                placeholder="0"
                helperText="E.g. 8.25 for 8.25%"
                error={errors.tax_percent}
                disabled={isLoading}
              />

              <Input
                label="Discount Amount"
                type="text"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                placeholder="0.00"
                error={errors.discount_amount}
                disabled={isLoading}
              />
            </div>

            <div>
              <label
                htmlFor="invoice-notes"
                className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5"
              >
                Notes / Payment Terms (Optional)
              </label>
              <textarea
                id="invoice-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Payment instructions, bank wire info, or notes..."
                disabled={isLoading}
                className="w-full px-3.5 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg shadow-2xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <InvoiceTotalsCard
              subtotal={computedTotals.subtotal}
              taxAmount={computedTotals.taxAmount}
              taxPercent={taxPercent}
              discountAmount={discountAmount}
              totalAmount={computedTotals.totalAmount}
              isDiscountExceeded={computedTotals.isDiscountExceeded}
              errorMessage={computedTotals.errorMessage}
              currency={currency}
            />
          </div>
        </div>

        <div className="flex justify-end space-x-3 pt-4 border-t border-slate-200">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            isLoading={isLoading || isSubmitting}
            disabled={isLoading || isSubmitting || computedTotals.isDiscountExceeded || computedTotals.totalAmount === null}
          >
            {isEdit ? 'Save Changes' : 'Create Draft'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
