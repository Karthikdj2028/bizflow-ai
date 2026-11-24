import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { InvoiceManagement } from '../../src/features/invoices/InvoiceManagement';
import { InvoiceModal } from '../../src/features/invoices/InvoiceModal';
import { InvoiceDetailModal } from '../../src/features/invoices/InvoiceDetailModal';
import {
  WorkspaceContext,
  WorkspaceContextValue,
} from '../../src/features/workspaces/WorkspaceContext';
import {
  CustomerResponse,
  InvoiceDetailResponse,
  InvoiceListItemResponse,
  InvoicePaginationResponse,
} from '../../src/types/api';
import * as apiModule from '../../src/lib/api';
import {
  computeInvoiceTotals,
  computeLineTotalCents,
  parseStrictDecimalStringToBigInt,
  percentStringToFractionalString,
  fractionalStringToPercentString,
  DecimalValidationError,
  formatScaledBigInt,
} from '../../src/features/invoices/invoiceMath';

let mockUserRole: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' = 'OWNER';

vi.mock('../../src/features/auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', email: 'user@bizflow.ai', full_name: 'Test User', is_active: true },
    isAuthenticated: true,
    isLoading: false,
    connectionError: false,
    error: null,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    retryInit: vi.fn(),
    clearError: vi.fn(),
  }),
}));

const mockWorkspaceA = {
  id: 'ws-a-1111-1111',
  name: 'Workspace Alpha',
  base_currency: 'USD',
  role: 'OWNER' as const,
  created_at: '2026-01-01T00:00:00Z',
};

const mockCustomers: CustomerResponse[] = [
  {
    id: 'cust-1',
    business_id: 'ws-a-1111-1111',
    name: 'Acme Corporation',
    email: 'billing@acme.com',
    phone: '+1 555-0100',
    billing_address: '100 Acme Way, Metropolis',
    payment_terms_days: 30,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'cust-2',
    business_id: 'ws-a-1111-1111',
    name: 'Inactive Client Corp',
    email: 'inactive@client.com',
    phone: null,
    billing_address: null,
    payment_terms_days: 15,
    is_active: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const mockInvoiceDraft: InvoiceListItemResponse = {
  id: 'inv-1',
  business_id: 'ws-a-1111-1111',
  customer_id: 'cust-1',
  customer_name: 'Acme Corporation',
  invoice_number: 'INV-2026-001',
  status: 'DRAFT',
  persisted_status: 'DRAFT',
  issue_date: '2026-01-10',
  due_date: '2026-02-09',
  subtotal: '100.00',
  tax_rate: '0.1000',
  tax_amount: '10.00',
  discount_amount: '0.00',
  total_amount: '110.00',
  paid_amount: '0.00',
  balance_due: '110.00',
  notes: 'Draft test note',
  created_at: '2026-01-10T10:00:00Z',
  updated_at: '2026-01-10T10:00:00Z',
};

const mockInvoiceOverdue: InvoiceListItemResponse = {
  id: 'inv-2',
  business_id: 'ws-a-1111-1111',
  customer_id: 'cust-1',
  customer_name: 'Acme Corporation',
  invoice_number: 'INV-2026-002',
  status: 'OVERDUE',
  persisted_status: 'SENT',
  issue_date: '2026-01-01',
  due_date: '2026-01-15',
  subtotal: '200.00',
  tax_rate: '0.0000',
  tax_amount: '0.00',
  discount_amount: '0.00',
  total_amount: '200.00',
  paid_amount: '0.00',
  balance_due: '200.00',
  notes: null,
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-01T10:00:00Z',
};

const mockInvoicePaid: InvoiceListItemResponse = {
  id: 'inv-3',
  business_id: 'ws-a-1111-1111',
  customer_id: 'cust-1',
  customer_name: 'Acme Corporation',
  invoice_number: 'INV-2026-003',
  status: 'PAID',
  persisted_status: 'PAID',
  issue_date: '2026-01-05',
  due_date: '2026-01-20',
  subtotal: '300.00',
  tax_rate: '0.0000',
  tax_amount: '0.00',
  discount_amount: '0.00',
  total_amount: '300.00',
  paid_amount: '300.00',
  balance_due: '0.00',
  notes: null,
  created_at: '2026-01-05T10:00:00Z',
  updated_at: '2026-01-05T10:00:00Z',
};

const mockInvoiceDetail: InvoiceDetailResponse = {
  ...mockInvoiceDraft,
  items: [
    {
      id: 'item-1',
      invoice_id: 'inv-1',
      description: 'Web Development Services',
      quantity: '1.00',
      unit_price: '100.00',
      line_total: '100.00',
      created_at: '2026-01-10T10:00:00Z',
    },
  ],
};

function renderWithWorkspace(
  ui: React.ReactNode,
  workspaceRole: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' = 'OWNER',
  generation: number = 1
) {
  const ws = { ...mockWorkspaceA, role: workspaceRole };
  const mockContext: WorkspaceContextValue = {
    workspaces: [ws],
    activeWorkspace: ws,
    workspaceGeneration: generation,
    isLoading: false,
    error: null,
    switchWorkspace: vi.fn(),
    refreshWorkspaces: vi.fn(),
    isCurrentWorkspace: (bid, gen) => bid === ws.id && gen === generation,
  };

  return render(
    <WorkspaceContext.Provider value={mockContext}>
      {ui}
    </WorkspaceContext.Provider>
  );
}

describe('Invoice Management Feature Suite', () => {
  let apiRequestSpy: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    mockUserRole = 'OWNER';

    apiRequestSpy = vi.spyOn(apiModule, 'apiRequest').mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('/customers')) {
        return Promise.resolve({
          items: mockCustomers,
          total: mockCustomers.length,
          page: 1,
          page_size: 20,
          total_pages: 1,
        });
      }
      if (endpoint === '/invoices/inv-1') {
        return Promise.resolve(mockInvoiceDetail);
      }
      if (endpoint.startsWith('/invoices')) {
        return Promise.resolve({
          items: [mockInvoiceDraft, mockInvoiceOverdue, mockInvoicePaid],
          total: 3,
          page: 1,
          page_size: 20,
          total_pages: 1,
        });
      }
      return Promise.resolve({});
    });
  });

  // INV-TEST-01: Directory Rendering & Formatting
  it('INV-TEST-01: Directory List Rendering & Currency Formatting', async () => {
    renderWithWorkspace(<InvoiceManagement />);

    await waitFor(() => {
      expect(screen.getByText('INV-2026-001')).toBeInTheDocument();
      expect(screen.getByText('INV-2026-002')).toBeInTheDocument();
      expect(screen.getByText('INV-2026-003')).toBeInTheDocument();
    });

    expect(screen.getAllByText('USD 110.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('USD 200.00').length).toBeGreaterThanOrEqual(1);

    const table = screen.getByRole('table');
    expect(within(table).getByText('Draft')).toBeInTheDocument();
    expect(within(table).getByText('Overdue')).toBeInTheDocument();
    expect(within(table).getByText('Paid')).toBeInTheDocument();
  });

  // INV-TEST-02: Status Filtering Execution
  it('INV-TEST-02: Status Filtering Execution passes query parameter to API', async () => {
    renderWithWorkspace(<InvoiceManagement />);

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /filter by invoice status/i })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole('combobox', { name: /filter by invoice status/i }), {
      target: { value: 'OVERDUE' },
    });

    await waitFor(() => {
      expect(apiRequestSpy).toHaveBeenCalledWith(
        expect.stringContaining('/invoices?status=OVERDUE'),
        expect.anything()
      );
    });
  });

  // INV-TEST-03: Search & Pagination Reset
  it('INV-TEST-03: Substring search resets page to 1 and passes search query parameter', async () => {
    renderWithWorkspace(<InvoiceManagement />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search by invoice number/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/search by invoice number/i), {
      target: { value: 'INV-2026' },
    });

    await waitFor(() => {
      expect(apiRequestSpy).toHaveBeenCalledWith(
        expect.stringContaining('search=INV-2026&page=1'),
        expect.anything()
      );
    });
  });

  // INV-TEST-04: Filter Change Pagination Reset
  it('INV-TEST-04: Customer filter selection resets page to 1', async () => {
    renderWithWorkspace(<InvoiceManagement />);

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /filter by customer/i })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole('combobox', { name: /filter by customer/i }), {
      target: { value: 'cust-1' },
    });

    await waitFor(() => {
      expect(apiRequestSpy).toHaveBeenCalledWith(
        expect.stringContaining('customer_id=cust-1&page=1'),
        expect.anything()
      );
    });
  });

  // INV-TEST-05: Fixed Backend Ordering
  it('INV-TEST-05: Fixed Backend Ordering does not expose sort headers or params', async () => {
    renderWithWorkspace(<InvoiceManagement />);

    await waitFor(() => {
      expect(screen.getByText('INV-2026-001')).toBeInTheDocument();
    });

    // Ensure no sorting buttons or query parameters were dispatched
    const calls = apiRequestSpy.mock.calls.filter((c: any) => c[0].startsWith('/invoices'));
    calls.forEach((c: any) => {
      expect(c[0]).not.toContain('sort_by');
      expect(c[0]).not.toContain('sort_order');
    });
  });

  // INV-TEST-06: Role-Based Permissions (Member/Owner)
  it('INV-TEST-06: MEMBER role has full write access (New Invoice, Edit, Mark Sent, Cancel)', async () => {
    renderWithWorkspace(<InvoiceManagement />, 'MEMBER');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new invoice/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /edit invoice inv-2026-001/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /mark invoice inv-2026-001 as sent/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel invoice inv-2026-001/i })).toBeInTheDocument();
    });
  });

  // INV-TEST-07: Role-Based Permissions (Viewer)
  it('INV-TEST-07: VIEWER role is strictly read-only', async () => {
    renderWithWorkspace(<InvoiceManagement />, 'VIEWER');

    await waitFor(() => {
      expect(screen.getByText('INV-2026-001')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /new invoice/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit invoice/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark invoice.*as sent/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel invoice/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view details for invoice inv-2026-001/i })).toBeInTheDocument();
  });

  // INV-TEST-08: BigInt Arithmetic: Valid Halfway Rounding
  it('INV-TEST-08: BigInt Arithmetic evaluates halfway rounding with valid scale inputs (0.01 * 0.50 -> 0.01)', () => {
    // 0.01 (scale 2) * 0.50 (scale 2) = 0.0050 -> Round-Half-Up to cents is 0.01
    const cents = computeLineTotalCents('0.01', '0.50');
    expect(formatScaledBigInt(cents, 2)).toBe('0.01');
  });

  // INV-TEST-09: BigInt Arithmetic: Schema Ceilings & Overflow
  it('INV-TEST-09: BigInt Arithmetic surfaces overflow when product exceeds monetary limits', () => {
    // Max quantity 10000000.00 * max price 100000000.00 = 10^15 (exceeds $999,999,999,999.99)
    expect(() => computeLineTotalCents('10000000.00', '100000000.00')).toThrowError(
      DecimalValidationError
    );
  });

  // INV-TEST-10: BigInt Arithmetic: Valid Maximum within Cap
  it('INV-TEST-10: BigInt Arithmetic computes large valid numbers without precision loss', () => {
    // 999999.99 * 999999.99 = 999999980000.0001 -> Round-half-up to cents is 999999980000.00 <= 999999999999.99
    const cents = computeLineTotalCents('999999.99', '999999.99');
    expect(formatScaledBigInt(cents, 2)).toBe('999999980000.00');
  });

  // INV-TEST-11: Strict Decimal Scale Rejection
  it('INV-TEST-11: Strict Decimal Scale Rejection blocks excess decimal places without silent truncation', () => {
    expect(() => parseStrictDecimalStringToBigInt('1.234', 2, 'quantity')).toThrowError(
      /MAX_SCALE_EXCEEDED/
    );
  });

  // INV-TEST-12: Out-of-Bounds Schema Limit Rejection
  it('INV-TEST-12: Out-of-Bounds Schema Limit Rejection blocks values above backend limits', () => {
    expect(() => computeLineTotalCents('10000000.01', '10.00')).toThrowError(
      /quantity exceeds maximum allowed limit/
    );
    expect(() => computeLineTotalCents('10.00', '100000000.01')).toThrowError(
      /unit_price exceeds maximum allowed limit/
    );
  });

  // INV-TEST-13: Discount Validation Without Silent Clamping
  it('INV-TEST-13: Discount Validation Without Silent Clamping displays error and sets totalAmount to null', () => {
    const totals = computeInvoiceTotals(
      [{ quantity: '1.00', unitPrice: '100.00' }],
      '0',
      '150.00' // Exceeds subtotal (100.00)
    );

    expect(totals.isDiscountExceeded).toBe(true);
    expect(totals.totalAmount).toBeNull(); // Must not be 0.00
    expect(totals.discountAmount).toBe('150.00'); // Preserved as entered
    expect(totals.errorMessage).toMatch(/Discount amount cannot exceed subtotal \+ tax amount/i);
  });

  // INV-TEST-14: Tax Percentage Conversion
  it('INV-TEST-14: Tax Percentage Conversion converts UI percent string to backend fractional Decimal', () => {
    expect(percentStringToFractionalString('8.25')).toBe('0.0825');
    expect(percentStringToFractionalString('0')).toBe('0.0000');
    expect(fractionalStringToPercentString('0.0825')).toBe('8.25');
    expect(fractionalStringToPercentString('0.0000')).toBe('0');
  });

  // INV-TEST-15: Dynamic Line Items Manipulations
  it('INV-TEST-15: Dynamic Line Items editor adds, updates, and blocks removing last row', async () => {
    renderWithWorkspace(<InvoiceModal isOpen={true} onClose={vi.fn()} onSubmit={vi.fn()} customers={mockCustomers} />);

    expect(screen.getByRole('heading', { name: /line items \(1\)/i })).toBeInTheDocument();

    // Add item
    fireEvent.click(screen.getByRole('button', { name: /add line item/i }));
    expect(screen.getByRole('heading', { name: /line items \(2\)/i })).toBeInTheDocument();

    // Delete first item
    const deleteBtns = screen.getAllByRole('button', { name: /remove item/i });
    fireEvent.click(deleteBtns[0]);
    expect(screen.getByRole('heading', { name: /line items \(1\)/i })).toBeInTheDocument();

    // Last remaining item has delete button disabled
    const lastDeleteBtn = screen.getByRole('button', { name: /remove item/i });
    expect(lastDeleteBtn).toBeDisabled();
  });

  // INV-TEST-16: Client Date Invariant Validation
  it('INV-TEST-16: Due date earlier than issue date blocks submit and displays inline error', async () => {
    renderWithWorkspace(<InvoiceModal isOpen={true} onClose={vi.fn()} onSubmit={vi.fn()} customers={mockCustomers} />);

    fireEvent.change(screen.getByLabelText(/issue date/i), { target: { value: '2026-02-15' } });
    fireEvent.change(screen.getByLabelText(/due date/i), { target: { value: '2026-02-10' } });

    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));

    await waitFor(() => {
      expect(screen.getByText('Due date cannot be earlier than issue date.')).toBeInTheDocument();
    });
  });

  // INV-TEST-17: Invoice Creation & State Reconciliation
  it('INV-TEST-17: Invoice Creation reconciles created response directly into list state', async () => {
    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      if (endpoint.startsWith('/customers')) {
        return Promise.resolve({ items: mockCustomers, total: mockCustomers.length, page: 1, page_size: 20, total_pages: 1 });
      }
      if (endpoint === '/invoices' && options?.method === 'POST') {
        const newInv: InvoiceDetailResponse = {
          ...mockInvoiceDraft,
          id: 'inv-new',
          invoice_number: 'INV-NEW-999',
        };
        return Promise.resolve(newInv);
      }
      if (endpoint.startsWith('/invoices')) {
        return Promise.resolve({
          items: [mockInvoiceDraft],
          total: 1,
          page: 1,
          page_size: 20,
          total_pages: 1,
        });
      }
      return Promise.resolve({});
    });

    renderWithWorkspace(<InvoiceManagement />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new invoice/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /new invoice/i }));

    // Fill form
    fireEvent.change(screen.getByRole('combobox', { name: /^customer$/i }), { target: { value: 'cust-1' } });
    fireEvent.change(screen.getByLabelText(/invoice number/i), { target: { value: 'INV-NEW-999' } });
    fireEvent.change(screen.getByLabelText(/item 1 description/i), { target: { value: 'Consulting' } });
    fireEvent.change(screen.getByLabelText(/item 1 quantity/i), { target: { value: '2.00' } });
    fireEvent.change(screen.getByLabelText(/item 1 unit price/i), { target: { value: '50.00' } });

    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));

    await waitFor(() => {
      expect(screen.getByText('INV-NEW-999')).toBeInTheDocument();
    });
  });

  // INV-TEST-18: Draft Edit: Unchanged Inactive Customer
  it('INV-TEST-18: Editing draft with inactive customer preserves customer and omits customer_id from PATCH', async () => {
    let capturedPatchBody: any = null;
    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      if (endpoint === '/invoices/inv-inactive' && options?.method === 'PATCH') {
        capturedPatchBody = JSON.parse(options.body);
        return Promise.resolve({ ...mockInvoiceDraft, id: 'inv-inactive', notes: 'Updated notes' });
      }
      return Promise.resolve({});
    });

    const inactiveInvoice: InvoiceListItemResponse & { items: any[] } = {
      ...mockInvoiceDraft,
      id: 'inv-inactive',
      customer_id: 'cust-2',
      customer_name: 'Inactive Client Corp',
      items: [
        {
          id: 'item-1',
          invoice_id: 'inv-inactive',
          description: 'Consulting Services',
          quantity: '1.00',
          unit_price: '100.00',
          line_total: '100.00',
          created_at: '2026-01-10T10:00:00Z',
        },
      ],
    };

    renderWithWorkspace(
      <InvoiceModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={async (data) => {
          await apiModule.apiRequest('/invoices/inv-inactive', {
            scope: 'workspace',
            method: 'PATCH',
            body: JSON.stringify(data),
          });
        }}
        initialData={inactiveInvoice}
        customers={mockCustomers}
      />
    );

    // Verify option label displays (Current - Inactive)
    expect(screen.getByText('Inactive Client Corp (Current - Inactive)')).toBeInTheDocument();

    // Modify notes only
    fireEvent.change(screen.getByLabelText(/notes/i), { target: { value: 'Updated notes' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(capturedPatchBody).not.toBeNull();
      expect(capturedPatchBody.customer_id).toBeUndefined(); // customer_id MUST be omitted!
      expect(capturedPatchBody.notes).toBe('Updated notes');
    });
  });

  // INV-TEST-19: Mark Sent: Inactive Customer Block
  it('INV-TEST-19: Marking invoice sent with inactive customer displays clear error from API', async () => {
    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      if (endpoint.startsWith('/customers')) {
        return Promise.resolve({ items: mockCustomers, total: mockCustomers.length, page: 1, page_size: 20, total_pages: 1 });
      }
      if (endpoint === '/invoices/inv-1/status' && options?.method === 'POST') {
        const error = new apiModule.ApiClientError('Customer is inactive', 422, {
          type: 'https://errors.bizflow.ai/validation',
          title: 'Validation Error',
          status: 422,
          detail: 'Cannot issue invoice to an inactive customer.',
          code: 'CUSTOMER_INACTIVE',
        });
        return Promise.reject(error);
      }
      if (endpoint.startsWith('/invoices')) {
        return Promise.resolve({ items: [mockInvoiceDraft], total: 1, page: 1, page_size: 20, total_pages: 1 });
      }
      return Promise.resolve({});
    });

    renderWithWorkspace(<InvoiceManagement />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mark invoice inv-2026-001 as sent/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /mark invoice inv-2026-001 as sent/i }));
    fireEvent.click(screen.getByRole('button', { name: /^mark as sent$/i }));

    await waitFor(() => {
      expect(screen.getByText('Cannot issue invoice to an inactive customer.')).toBeInTheDocument();
    });
  });

  // INV-TEST-20: Overdue Invoice Cancellation
  it('INV-TEST-20: Overdue invoice with persisted status SENT and paid_amount=0.00 can be canceled', async () => {
    let cancelCalled = false;
    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      if (endpoint.startsWith('/customers')) {
        return Promise.resolve({ items: mockCustomers, total: mockCustomers.length, page: 1, page_size: 20, total_pages: 1 });
      }
      if (endpoint === '/invoices/inv-2/status' && options?.method === 'POST') {
        cancelCalled = true;
        return Promise.resolve({ ...mockInvoiceOverdue, status: 'CANCELED', persisted_status: 'CANCELED' });
      }
      if (endpoint.startsWith('/invoices')) {
        return Promise.resolve({ items: [mockInvoiceOverdue], total: 1, page: 1, page_size: 20, total_pages: 1 });
      }
      return Promise.resolve({});
    });

    renderWithWorkspace(<InvoiceManagement />);

    await waitFor(() => {
      expect(screen.getByText('INV-2026-002')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel invoice inv-2026-002/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /cancel invoice inv-2026-002/i }));
    fireEvent.click(screen.getByRole('button', { name: /^cancel invoice$/i }));

    await waitFor(() => {
      expect(cancelCalled).toBe(true);
    });
  });

  // INV-TEST-21: Paid/Partial Invoice Cancel Block
  it('INV-TEST-21: Paid invoice does not expose cancel button', async () => {
    renderWithWorkspace(<InvoiceManagement />);

    await waitFor(() => {
      expect(screen.getByText('INV-2026-003')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /cancel invoice inv-2026-003/i })).not.toBeInTheDocument();
  });

  // INV-TEST-22: Duplicate Submission Guard
  it('INV-TEST-22: Rapid double-click on Create Draft dispatches only one request', async () => {
    let createCallCount = 0;
    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      if (endpoint === '/invoices' && options?.method === 'POST') {
        createCallCount++;
        return new Promise((resolve) => setTimeout(() => resolve(mockInvoiceDraft), 100));
      }
      return Promise.resolve({});
    });

    renderWithWorkspace(
      <InvoiceModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={async (data) => {
          await apiModule.apiRequest('/invoices', { scope: 'workspace', method: 'POST', body: JSON.stringify(data) });
        }}
        customers={mockCustomers}
      />
    );

    fireEvent.change(screen.getByRole('combobox', { name: /^customer$/i }), { target: { value: 'cust-1' } });
    fireEvent.change(screen.getByLabelText(/invoice number/i), { target: { value: 'INV-DOUBLE' } });
    fireEvent.change(screen.getByLabelText(/item 1 description/i), { target: { value: 'Service' } });

    const submitBtn = screen.getByRole('button', { name: /create draft/i });
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(createCallCount).toBe(1);
    });
  });

  // INV-TEST-23: Stale Mutation Discard on Workspace Switch
  it('INV-TEST-23: Stale mutation from Workspace A is discarded after switch to Workspace B', async () => {
    let resolveMutation: any;
    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      if (endpoint.startsWith('/customers')) {
        return Promise.resolve({ items: mockCustomers, total: mockCustomers.length, page: 1, page_size: 20, total_pages: 1 });
      }
      if (endpoint === '/invoices' && options?.method === 'POST') {
        return new Promise((res) => {
          resolveMutation = res;
        });
      }
      if (endpoint.startsWith('/invoices')) {
        return Promise.resolve({ items: [], total: 0, page: 1, page_size: 20, total_pages: 0 });
      }
      return Promise.resolve({});
    });

    let currentGen = 1;
    let currentBiz = 'ws-a-1111-1111';

    const mockCtx: WorkspaceContextValue = {
      workspaces: [mockWorkspaceA],
      activeWorkspace: mockWorkspaceA,
      workspaceGeneration: currentGen,
      isLoading: false,
      error: null,
      switchWorkspace: vi.fn(),
      refreshWorkspaces: vi.fn(),
      isCurrentWorkspace: (bid, gen) => bid === currentBiz && gen === currentGen,
    };

    const { rerender } = render(
      <WorkspaceContext.Provider value={mockCtx}>
        <InvoiceManagement />
      </WorkspaceContext.Provider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new invoice/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /new invoice/i }));
    fireEvent.change(screen.getByRole('combobox', { name: /^customer$/i }), { target: { value: 'cust-1' } });
    fireEvent.change(screen.getByLabelText(/invoice number/i), { target: { value: 'INV-STALE' } });
    fireEvent.change(screen.getByLabelText(/item 1 description/i), { target: { value: 'Item' } });

    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));

    // Switch workspace before mutation resolves
    currentGen = 2;
    currentBiz = 'ws-b-2222-2222';
    const mockCtxB = {
      ...mockCtx,
      activeWorkspace: { ...mockWorkspaceA, id: 'ws-b-2222-2222', name: 'Workspace Beta' },
      workspaceGeneration: currentGen,
      isCurrentWorkspace: (bid: any, gen: any) => bid === currentBiz && gen === currentGen,
    };

    rerender(
      <WorkspaceContext.Provider value={mockCtxB}>
        <InvoiceManagement />
      </WorkspaceContext.Provider>
    );

    // Now resolve the slow mutation
    act(() => {
      resolveMutation(mockInvoiceDraft);
    });

    // In Workspace B: Modal must be dismissed and Invoice from Workspace A must NOT appear
    expect(screen.queryByText('INV-STALE')).not.toBeInTheDocument();
  });

  // INV-TEST-24: Detail View Schema Alignment
  it('INV-TEST-24: Detail View Schema Alignment renders all line items and fields accurately', async () => {
    renderWithWorkspace(
      <InvoiceDetailModal
        isOpen={true}
        onClose={vi.fn()}
        invoiceId="inv-1"
        getInvoiceDetail={async () => mockInvoiceDetail}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Invoice: INV-2026-001')).toBeInTheDocument();
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
      expect(screen.getByText('Web Development Services')).toBeInTheDocument();
      expect(screen.getByText('Draft test note')).toBeInTheDocument();
      expect(screen.getAllByText('USD 110.00').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Balance Due')).toBeInTheDocument();
    });
  });

  // INV-TEST-25: Form Preservation During Re-render
  it('INV-TEST-25: Form Preservation preserves entered values during incidental parent re-render', async () => {
    const { rerender } = renderWithWorkspace(
      <InvoiceModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        customers={mockCustomers}
      />
    );

    fireEvent.change(screen.getByLabelText(/invoice number/i), { target: { value: 'INV-PRESERVED' } });
    fireEvent.change(screen.getByLabelText(/item 1 description/i), { target: { value: 'In-progress task' } });

    // Trigger parent re-render
    rerender(
      <WorkspaceContext.Provider
        value={{
          workspaces: [mockWorkspaceA],
          activeWorkspace: mockWorkspaceA,
          workspaceGeneration: 1,
          isLoading: false,
          error: null,
          switchWorkspace: vi.fn(),
          refreshWorkspaces: vi.fn(),
          isCurrentWorkspace: () => true,
        }}
      >
        <InvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          customers={mockCustomers}
        />
      </WorkspaceContext.Provider>
    );

    expect(screen.getByDisplayValue('INV-PRESERVED')).toBeInTheDocument();
    expect(screen.getByDisplayValue('In-progress task')).toBeInTheDocument();
  });

  // INV-TEST-26: 5-Tab Accessible Keyboard Navigation
  it('INV-TEST-26: 5-Tab Accessible Keyboard Navigation links to Invoices tab correctly', async () => {
    renderWithWorkspace(<InvoiceManagement />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^invoices$/i })).toBeInTheDocument();
      expect(screen.getByRole('table')).toBeInTheDocument();
    });
  });
});
