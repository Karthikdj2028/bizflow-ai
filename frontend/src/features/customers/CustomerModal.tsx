import React, { useState, useEffect, useRef } from 'react';
import {
  CustomerCreateRequest,
  CustomerResponse,
  CustomerUpdateRequest,
} from '../../types/api';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { ApiClientError } from '../../lib/api';
import { AlertCircle } from 'lucide-react';
import { clsx } from 'clsx';

export interface CustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CustomerCreateRequest | CustomerUpdateRequest) => Promise<any>;
  initialData?: CustomerResponse | null;
  isLoading?: boolean;
}

export const CustomerModal: React.FC<CustomerModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData = null,
  isLoading = false,
}) => {
  const isEdit = Boolean(initialData);

  const [name, setName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [billingAddress, setBillingAddress] = useState<string>('');
  const [paymentTerms, setPaymentTerms] = useState<string>('30');
  const [isActive, setIsActive] = useState<boolean>(true);

  // Field validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const prevIsOpenRef = useRef(false);
  const prevInitialDataIdRef = useRef<string | undefined>(undefined);

  // Sync state with initialData when opened or when switching to a different customer
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
    const isDifferentCustomer = wasOpen && currentId !== prevId;

    if (!isOpening && !isDifferentCustomer) {
      return;
    }

    if (initialData) {
      setName(initialData.name);
      setEmail(initialData.email || '');
      setPhone(initialData.phone || '');
      setBillingAddress(initialData.billing_address || '');
      setPaymentTerms(String(initialData.payment_terms_days));
      setIsActive(initialData.is_active);
    } else {
      setName('');
      setEmail('');
      setPhone('');
      setBillingAddress('');
      setPaymentTerms('30');
      setIsActive(true);
    }
    setErrors({});
    setServerError(null);
  }, [isOpen, initialData]);

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};

    // 1. Name validation
    if (!name.trim()) {
      nextErrors.name = 'Customer name is required.';
    } else if (name.trim().length > 255) {
      nextErrors.name = 'Customer name cannot exceed 255 characters.';
    }

    // 2. Email validation (optional, format checked if provided)
    if (email.trim()) {
      if (email.trim().length > 255) {
        nextErrors.email = 'Email address cannot exceed 255 characters.';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        nextErrors.email = 'Enter a valid email address.';
      }
    }

    // 3. Phone validation (optional)
    if (phone.trim().length > 50) {
      nextErrors.phone = 'Phone number cannot exceed 50 characters.';
    }

    // 4. Billing address validation (optional)
    if (billingAddress.trim().length > 1000) {
      nextErrors.billing_address = 'Billing address cannot exceed 1000 characters.';
    }

    // 5. Payment terms validation (required integer 0-365)
    const termsNum = parseInt(paymentTerms.trim(), 10);
    if (
      paymentTerms.trim() === '' ||
      isNaN(termsNum) ||
      !/^\d+$/.test(paymentTerms.trim())
    ) {
      nextErrors.payment_terms_days =
        'Payment terms must be a non-negative whole number (days).';
    } else if (termsNum < 0 || termsNum > 365) {
      nextErrors.payment_terms_days = 'Payment terms must be between 0 and 365 days.';
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
        const updatePayload: CustomerUpdateRequest = {
          name: name.trim(),
          email: email.trim() ? email.trim() : null,
          phone: phone.trim() ? phone.trim() : null,
          billing_address: billingAddress.trim() ? billingAddress.trim() : null,
          payment_terms_days: parseInt(paymentTerms.trim(), 10),
          is_active: isActive,
        };
        await onSubmit(updatePayload);
      } else {
        const createPayload: CustomerCreateRequest = {
          name: name.trim(),
          email: email.trim() ? email.trim() : null,
          phone: phone.trim() ? phone.trim() : null,
          billing_address: billingAddress.trim() ? billingAddress.trim() : null,
          payment_terms_days: parseInt(paymentTerms.trim(), 10),
        };
        await onSubmit(createPayload);
      }
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setServerError(err.problem?.detail || err.message);
      } else if (err instanceof Error) {
        setServerError(err.message);
      } else {
        setServerError('An unexpected error occurred.');
      }
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Customer' : 'Add New Customer'}
      maxWidth="md"
      isLoading={isLoading}
      preventClose={isLoading}
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {serverError && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start space-x-2 text-rose-700 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <span className="leading-relaxed">{serverError}</span>
          </div>
        )}

        {/* Customer Name */}
        <Input
          label="Customer / Client Name *"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Acme Corp or Jane Doe"
          error={errors.name}
          disabled={isLoading}
          autoFocus
        />

        {/* Contact Info: Email & Phone */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Email Address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="billing@acme.com"
            error={errors.email}
            disabled={isLoading}
          />

          <Input
            label="Phone Number"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555-0199"
            error={errors.phone}
            disabled={isLoading}
          />
        </div>

        {/* Payment Terms */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Payment Terms (Days) *"
            type="number"
            min="0"
            max="365"
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value)}
            placeholder="30"
            error={errors.payment_terms_days}
            helperText="0 = Due on Receipt, 30 = Net 30 days."
            disabled={isLoading}
          />

          {isEdit && (
            <div className="flex flex-col justify-center pt-2">
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                Status
              </label>
              <label className="inline-flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  disabled={isLoading}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                />
                <span className="text-sm font-medium text-slate-700">
                  {isActive ? 'Active Customer' : 'Inactive Customer'}
                </span>
              </label>
              <p className="text-xs text-slate-400 mt-1">
                Inactive customers cannot receive new invoices.
              </p>
            </div>
          )}
        </div>

        {/* Billing Address */}
        <div>
          <label
            htmlFor="billing-address"
            className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5"
          >
            Billing Address
          </label>
          <textarea
            id="billing-address"
            rows={3}
            value={billingAddress}
            onChange={(e) => setBillingAddress(e.target.value)}
            placeholder="123 Business Way, Suite 400&#10;City, State 12345"
            disabled={isLoading}
            className={clsx(
              'w-full px-3.5 py-2 text-sm text-slate-900 bg-white border rounded-lg shadow-sm placeholder:text-slate-400 transition',
              'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500',
              errors.billing_address
                ? 'border-rose-400 text-rose-900 focus:ring-rose-500'
                : 'border-slate-300 hover:border-slate-400',
              isLoading && 'bg-slate-50 text-slate-400 cursor-not-allowed'
            )}
          />
          {errors.billing_address ? (
            <p className="mt-1 text-xs text-rose-600 font-medium">
              {errors.billing_address}
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-400">
              Appears on generated invoices and receipts.
            </p>
          )}
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-100">
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
            disabled={isLoading}
          >
            {isLoading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Customer'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
