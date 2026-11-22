import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransactionLedger } from '../../src/features/transactions/TransactionLedger';
import { TransactionModal } from '../../src/features/transactions/TransactionModal';
import {
  WorkspaceContext,
  WorkspaceContextValue,
} from '../../src/features/workspaces/WorkspaceContext';
import {
  CategoryResponse,
  FinancialSummaryResponse,
  TransactionListResponse,
  TransactionResponse,
} from '../../src/types/api';
import * as apiModule from '../../src/lib/api';

vi.mock('../../src/features/auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', email: 'owner@bizflow.ai', full_name: 'Alpha Owner', is_active: true },
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

const mockCategories: CategoryResponse[] = [
  {
    id: 'cat-inc-1',
    business_id: 'ws-a-1111-1111',
    name: 'Consulting Income',
    type: 'INCOME',
    description: 'Advisory and consulting revenue',
    color_hex: '#10B981',
    is_system_default: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'cat-exp-1',
    business_id: 'ws-a-1111-1111',
    name: 'Cloud Hosting',
    type: 'EXPENSE',
    description: 'Servers and cloud storage',
    color_hex: '#6366F1',
    is_system_default: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const mockTransactions: TransactionResponse[] = [
  {
    id: 'tx-1',
    business_id: 'ws-a-1111-1111',
    category_id: 'cat-inc-1',
    category_name: 'Consulting Income',
    category_color: '#10B981',
    type: 'INCOME',
    amount: '1250.50',
    currency: 'USD',
    transaction_date: '2026-11-20',
    description: 'Client Advisory Retainer',
    counterparty: 'Apex Manufacturing',
    reference_number: 'INV-001',
    payment_method: 'BANK_TRANSFER',
    created_at: '2026-11-20T10:00:00Z',
    updated_at: '2026-11-20T10:00:00Z',
  },
  {
    id: 'tx-2',
    business_id: 'ws-a-1111-1111',
    category_id: 'cat-exp-1',
    category_name: 'Cloud Hosting',
    category_color: '#6366F1',
    type: 'EXPENSE',
    amount: '340.00',
    currency: 'USD',
    transaction_date: '2026-11-21',
    description: 'AWS Production Cluster',
    counterparty: 'Amazon Web Services',
    reference_number: 'REC-991',
    payment_method: 'CREDIT_CARD',
    created_at: '2026-11-21T12:00:00Z',
    updated_at: '2026-11-21T12:00:00Z',
  },
];

const mockSummary: FinancialSummaryResponse = {
  period: { start_date: '2026-11-01', end_date: '2026-11-21' },
  currency: 'USD',
  total_income: '1250.50',
  total_expenses: '340.00',
  net_cash_flow: '910.50',
  transaction_count: 2,
  cumulative_net_movement: '5420.00',
  income_by_category: [
    {
      category_id: 'cat-inc-1',
      category_name: 'Consulting Income',
      category_color: '#10B981',
      total_amount: '1250.50',
      count: 1,
      percentage: '100.00',
    },
  ],
  expenses_by_category: [
    {
      category_id: 'cat-exp-1',
      category_name: 'Cloud Hosting',
      category_color: '#6366F1',
      total_amount: '340.00',
      count: 1,
      percentage: '100.00',
    },
  ],
};

describe('Transaction Ledger Component & Hook Tests', () => {
  let apiRequestSpy: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    apiRequestSpy = vi.spyOn(apiModule, 'apiRequest').mockImplementation((endpoint: string, options: any) => {
      if (endpoint.startsWith('/categories')) {
        return Promise.resolve({ items: mockCategories, total: mockCategories.length });
      }
      if (endpoint.startsWith('/transactions/summary')) {
        return Promise.resolve(mockSummary);
      }
      if (endpoint.startsWith('/transactions')) {
        return Promise.resolve({
          items: mockTransactions,
          total: mockTransactions.length,
          page: 1,
          page_size: 20,
          total_pages: 1,
        });
      }
      return Promise.resolve({});
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  const createMockWorkspaceContext = (
    overrides?: Partial<WorkspaceContextValue>
  ): WorkspaceContextValue => {
    const currentBusinessId = overrides?.activeWorkspace?.id ?? mockWorkspaceA.id;
    const currentGen = overrides?.workspaceGeneration ?? 1;

    return {
      workspaces: [mockWorkspaceA],
      activeWorkspace: mockWorkspaceA,
      workspaceGeneration: currentGen,
      isLoading: false,
      error: null,
      switchWorkspace: vi.fn().mockResolvedValue(true),
      refreshWorkspaces: vi.fn().mockResolvedValue(undefined),
      isCurrentWorkspace: (bizId, gen) =>
        bizId === currentBusinessId && gen === currentGen,
      ...overrides,
    };
  };

  const renderWithContext = (contextValue?: Partial<WorkspaceContextValue>) => {
    const ctx = createMockWorkspaceContext(contextValue);
    return render(
      <WorkspaceContext.Provider value={ctx}>
        <TransactionLedger />
      </WorkspaceContext.Provider>
    );
  };

  it('Scenario 1: Ledger Initial Load renders transactions and summary cards', async () => {
    renderWithContext();

    // Summary cards
    await waitFor(() => {
      expect(screen.getByText(/Period Income/i)).toBeInTheDocument();
      expect(screen.getAllByText(/\+USD 1,250\.50/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/-USD 340\.00/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/\+USD 910\.50/i)).toBeInTheDocument();
    });

    // Transaction rows
    expect(screen.getByText('Client Advisory Retainer')).toBeInTheDocument();
    expect(screen.getByText('AWS Production Cluster')).toBeInTheDocument();
    expect(screen.getByText('Apex Manufacturing')).toBeInTheDocument();
  });

  it('Scenario 2: Type Filtering filters by EXPENSE and re-fetches with query param', async () => {
    renderWithContext();

    await waitFor(() => {
      expect(screen.getByText('Client Advisory Retainer')).toBeInTheDocument();
    });

    const expensePill = screen.getByRole('button', { name: /^expense$/i });
    fireEvent.click(expensePill);

    await waitFor(() => {
      expect(apiRequestSpy).toHaveBeenCalledWith(
        expect.stringContaining('/transactions?type=EXPENSE'),
        expect.objectContaining({ scope: 'workspace' })
      );
    });
  });

  it('Scenario 3: Category Filtering updates category_id query param', async () => {
    renderWithContext();

    await waitFor(() => {
      expect(screen.getByLabelText(/filter by category/i)).toBeInTheDocument();
    });

    const categorySelect = screen.getByLabelText(/filter by category/i);
    fireEvent.change(categorySelect, { target: { value: 'cat-exp-1' } });

    await waitFor(() => {
      expect(apiRequestSpy).toHaveBeenCalledWith(
        expect.stringContaining('category_id=cat-exp-1'),
        expect.objectContaining({ scope: 'workspace' })
      );
    });
  });

  it('Scenario 4: Substring search queries description or counterparty', async () => {
    renderWithContext();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search description or counterparty/i)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search description or counterparty/i);
    fireEvent.change(searchInput, { target: { value: 'Apex' } });

    await waitFor(() => {
      expect(apiRequestSpy).toHaveBeenCalledWith(
        expect.stringContaining('search=Apex'),
        expect.objectContaining({ scope: 'workspace' })
      );
    });
  });

  it('Scenario 5: Pagination navigation requests page=2 when Next is clicked', async () => {
    apiRequestSpy.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('/transactions/summary')) return Promise.resolve(mockSummary);
      if (endpoint.startsWith('/categories')) return Promise.resolve({ items: mockCategories, total: 2 });
      if (endpoint.startsWith('/transactions')) {
        return Promise.resolve({
          items: mockTransactions,
          total: 40,
          page: 1,
          page_size: 20,
          total_pages: 2,
        });
      }
      return Promise.resolve({});
    });

    renderWithContext();

    await waitFor(() => {
      expect(screen.getByLabelText(/next page/i)).toBeInTheDocument();
    });

    const nextBtn = screen.getByLabelText(/next page/i);
    expect(nextBtn).not.toBeDisabled();
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(apiRequestSpy).toHaveBeenCalledWith(
        expect.stringContaining('page=2'),
        expect.objectContaining({ scope: 'workspace' })
      );
    });
  });

  it('Scenario 6: Monetary Validation rejects invalid amount strings in TransactionModal', async () => {
    renderWithContext();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new transaction/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /new transaction/i }));

    expect(screen.getByRole('heading', { name: /record new transaction/i })).toBeInTheDocument();

    const amountInput = screen.getByLabelText(/amount/i);
    const descInput = screen.getByLabelText(/description/i);

    // Enter invalid amount string
    fireEvent.change(amountInput, { target: { value: 'invalid-amount' } });
    fireEvent.change(descInput, { target: { value: 'Test description' } });

    fireEvent.click(screen.getByRole('button', { name: /record transaction/i }));

    await waitFor(() => {
      expect(screen.getByText(/enter a valid positive amount/i)).toBeInTheDocument();
    });

    // Enter valid amount string
    fireEvent.change(amountInput, { target: { value: '450.75' } });
    expect(screen.queryByText(/enter a valid positive amount/i)).not.toBeInTheDocument();
  });

  it('Scenario 7: Date Validation enforces non-future UTC dates in modal', async () => {
    renderWithContext();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new transaction/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /new transaction/i }));

    const dateInput = screen.getByLabelText(/date \(utc\)/i);
    const amountInput = screen.getByLabelText(/amount/i);
    const descInput = screen.getByLabelText(/description/i);

    fireEvent.change(amountInput, { target: { value: '100.00' } });
    fireEvent.change(descInput, { target: { value: 'Test item' } });

    // Set future date
    fireEvent.change(dateInput, { target: { value: '2099-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: /record transaction/i }));

    await waitFor(() => {
      expect(screen.getByText(/transaction date cannot be in the future/i)).toBeInTheDocument();
    });
  });

  it('Scenario 8: Category Type Matching filters category dropdown based on transaction type', async () => {
    renderWithContext();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new transaction/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /new transaction/i }));

    // Default type is Expense
    expect(screen.getByRole('combobox', { name: /category/i })).toHaveTextContent('Cloud Hosting');
    expect(screen.getByRole('combobox', { name: /category/i })).not.toHaveTextContent('Consulting Income');

    // Switch type to Income
    fireEvent.click(screen.getByRole('button', { name: /income \(\+\)/i }));
    expect(screen.getByRole('combobox', { name: /category/i })).toHaveTextContent('Consulting Income');
    expect(screen.getByRole('combobox', { name: /category/i })).not.toHaveTextContent('Cloud Hosting');
  });

  it('Scenario 9: RBAC - OWNER/ADMIN sees full create, edit, and delete controls', async () => {
    renderWithContext({ activeWorkspace: { ...mockWorkspaceA, role: 'OWNER' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new transaction/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/edit client advisory retainer/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/delete client advisory retainer/i)).toBeInTheDocument();
    });
  });

  it('Scenario 10: RBAC - MEMBER sees create and edit, but DELETE button is strictly absent', async () => {
    renderWithContext({ activeWorkspace: { ...mockWorkspaceA, role: 'MEMBER' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new transaction/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/edit client advisory retainer/i)).toBeInTheDocument();
    });

    // Delete button must NOT exist for MEMBER
    expect(screen.queryByLabelText(/delete client advisory retainer/i)).not.toBeInTheDocument();
  });

  it('Scenario 11: RBAC - VIEWER is strictly read-only with all mutation controls hidden', async () => {
    renderWithContext({ activeWorkspace: { ...mockWorkspaceA, role: 'VIEWER' } });

    await waitFor(() => {
      expect(screen.getByText('Client Advisory Retainer')).toBeInTheDocument();
    });

    // Create, Edit, Delete must all be hidden
    expect(screen.queryByRole('button', { name: /new transaction/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/edit client advisory retainer/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/delete client advisory retainer/i)).not.toBeInTheDocument();
  });

  it('Scenario 12: RFC 9457 Error Display renders problem detail banner on API failure', async () => {
    apiRequestSpy.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('/transactions/summary')) return Promise.resolve(mockSummary);
      if (endpoint.startsWith('/categories')) return Promise.resolve({ items: mockCategories, total: 2 });
      if (endpoint.startsWith('/transactions')) {
        const error = new apiModule.ApiClientError('Server down', 500, {
          type: 'https://errors.bizflow.ai/internal-error',
          title: 'Internal Server Error',
          status: 500,
          detail: 'Database connection failed under high load.',
        });
        return Promise.reject(error);
      }
      return Promise.resolve({});
    });

    renderWithContext();

    await waitFor(() => {
      expect(screen.getByText(/unable to complete transaction operation/i)).toBeInTheDocument();
      expect(screen.getByText(/database connection failed under high load\./i)).toBeInTheDocument();
    });
  });

  it('Scenario 13: Hook Scoped Isolation: useTransactions resets exposed state immediately upon workspace switch', async () => {
    let resolveTxB: (val: any) => void;
    const txBPromise = new Promise((res) => {
      resolveTxB = res;
    });

    const mockWorkspaceB = {
      id: 'ws-b-2222-2222',
      name: 'Workspace Beta',
      base_currency: 'EUR',
      role: 'OWNER' as const,
      created_at: '2026-01-01T00:00:00Z',
    };

    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      const bizId = options?.targetWorkspaceId;
      if (endpoint.startsWith('/categories')) {
        return Promise.resolve({ items: mockCategories, total: 2 });
      }
      if (endpoint.startsWith('/transactions/summary')) {
        return Promise.resolve(mockSummary);
      }
      if (endpoint.startsWith('/transactions')) {
        if (bizId === mockWorkspaceB.id) {
          return txBPromise;
        }
        return Promise.resolve({
          items: mockTransactions,
          total: mockTransactions.length,
          page: 1,
          page_size: 20,
          total_pages: 1,
        });
      }
      return Promise.resolve({});
    });

    let currentWorkspace = mockWorkspaceA;
    let currentGen = 1;
    let triggerSwitch: (ws: typeof mockWorkspaceB) => void;

    const TestComponent: React.FC = () => {
      const [ws, setWs] = React.useState(mockWorkspaceA);
      const [gen, setGen] = React.useState(1);
      const snapshotRef = React.useRef({ id: mockWorkspaceA.id, gen: 1 });

      triggerSwitch = (nextWs) => {
        snapshotRef.current = { id: nextWs.id, gen: snapshotRef.current.gen + 1 };
        act(() => {
          setWs(nextWs);
          setGen(snapshotRef.current.gen);
        });
      };

      const ctx: WorkspaceContextValue = {
        workspaces: [mockWorkspaceA, mockWorkspaceB],
        activeWorkspace: ws,
        workspaceGeneration: gen,
        isLoading: false,
        error: null,
        switchWorkspace: vi.fn(),
        refreshWorkspaces: vi.fn(),
        isCurrentWorkspace: (bizId, g) =>
          Boolean(bizId) &&
          snapshotRef.current.id === bizId &&
          snapshotRef.current.gen === g,
      };

      return (
        <WorkspaceContext.Provider value={ctx}>
          <TransactionLedger />
        </WorkspaceContext.Provider>
      );
    };

    render(<TestComponent />);

    // 1. Initial Workspace A renders transactions
    await waitFor(() => {
      expect(screen.getByText('Client Advisory Retainer')).toBeInTheDocument();
    });

    // 2. Switch to Workspace B while B request is deferred
    triggerSwitch!(mockWorkspaceB);

    // 3. Immediately under Workspace B: Workspace A data must NOT be rendered
    expect(screen.queryByText('Client Advisory Retainer')).not.toBeInTheDocument();
    expect(screen.queryByText('AWS Production Cluster')).not.toBeInTheDocument();

    // 4. Resolve Workspace B request
    await act(async () => {
      resolveTxB!({
        items: [
          {
            ...mockTransactions[0],
            id: 'tx-b-1',
            business_id: mockWorkspaceB.id,
            description: 'Beta Dedicated Server',
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      });
    });

    // 5. Workspace B renders its own data
    await waitFor(() => {
      expect(screen.getByText('Beta Dedicated Server')).toBeInTheDocument();
      expect(screen.queryByText('Client Advisory Retainer')).not.toBeInTheDocument();
    });
  });

  it('Scenario 14: TransactionModal Form-Reset Protection (Create Flow): Changing categories prop while modal is open does not erase entered form values', async () => {
    const handleClose = vi.fn();
    const handleSubmit = vi.fn();

    const initialCategories: CategoryResponse[] = [
      {
        id: 'cat-exp-1',
        business_id: mockWorkspaceA.id,
        name: 'Cloud Hosting',
        type: 'EXPENSE',
        description: null,
        color_hex: '#6366F1',
        is_system_default: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'cat-inc-1',
        business_id: mockWorkspaceA.id,
        name: 'Consulting Income',
        type: 'INCOME',
        description: null,
        color_hex: '#10B981',
        is_system_default: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];

    const { rerender } = render(
      <TransactionModal
        isOpen={true}
        onClose={handleClose}
        onSubmit={handleSubmit}
        categories={initialCategories}
        currency="USD"
      />
    );

    // Initial create modal state
    expect(screen.getByRole('heading', { name: /record new transaction/i })).toBeInTheDocument();

    // User fills out form fields
    const amountInput = screen.getByLabelText(/amount/i) as HTMLInputElement;
    const descInput = screen.getByLabelText(/description/i) as HTMLInputElement;
    const counterpartyInput = screen.getByLabelText(/counterparty/i) as HTMLInputElement;
    const refInput = screen.getByLabelText(/reference number/i) as HTMLInputElement;

    fireEvent.change(amountInput, { target: { value: '750.50' } });
    fireEvent.change(descInput, { target: { value: 'Annual Software License' } });
    fireEvent.change(counterpartyInput, { target: { value: 'JetBrains' } });
    fireEvent.change(refInput, { target: { value: 'JB-2026-99' } });

    expect(amountInput.value).toBe('750.50');
    expect(descInput.value).toBe('Annual Software License');
    expect(counterpartyInput.value).toBe('JetBrains');
    expect(refInput.value).toBe('JB-2026-99');

    // Category was auto-synchronized to the first EXPENSE category
    const categorySelect = screen.getByLabelText(/category/i) as HTMLSelectElement;
    expect(categorySelect.value).toBe('cat-exp-1');

    // REGRESSION TEST: Parent re-renders with a modified categories array (e.g. background refetch or new category added)
    const updatedCategories: CategoryResponse[] = [
      ...initialCategories,
      {
        id: 'cat-exp-2',
        business_id: mockWorkspaceA.id,
        name: 'Office Supplies',
        type: 'EXPENSE',
        description: null,
        color_hex: '#F59E0B',
        is_system_default: false,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];

    rerender(
      <TransactionModal
        isOpen={true}
        onClose={handleClose}
        onSubmit={handleSubmit}
        categories={updatedCategories}
        currency="USD"
      />
    );

    // Assert that entered form values have NOT been wiped or reset
    expect(amountInput.value).toBe('750.50');
    expect(descInput.value).toBe('Annual Software License');
    expect(counterpartyInput.value).toBe('JetBrains');
    expect(refInput.value).toBe('JB-2026-99');
    expect(categorySelect.value).toBe('cat-exp-1');

    // User changes category to the newly added category
    fireEvent.change(categorySelect, { target: { value: 'cat-exp-2' } });
    expect(categorySelect.value).toBe('cat-exp-2');

    // Switch transaction type to INCOME -> Category synchronizes to income category, entered values preserved
    const incomeButton = screen.getByRole('button', { name: /income \(\+\)/i });
    fireEvent.click(incomeButton);
    expect(categorySelect.value).toBe('cat-inc-1');
    expect(amountInput.value).toBe('750.50');
    expect(descInput.value).toBe('Annual Software License');

    // Switch back to EXPENSE -> Category synchronizes to first expense category, entered values preserved
    const expenseButton = screen.getByRole('button', { name: /expense \(-\)/i });
    fireEvent.click(expenseButton);
    expect(categorySelect.value).toBe('cat-exp-1');
    expect(amountInput.value).toBe('750.50');
    expect(descInput.value).toBe('Annual Software License');

    // Verify modal reset upon closing and reopening
    rerender(
      <TransactionModal
        isOpen={false}
        onClose={handleClose}
        onSubmit={handleSubmit}
        categories={updatedCategories}
        currency="USD"
      />
    );

    rerender(
      <TransactionModal
        isOpen={true}
        onClose={handleClose}
        onSubmit={handleSubmit}
        categories={updatedCategories}
        currency="USD"
      />
    );

    // Form must be cleanly reinitialized on open
    const newAmountInput = screen.getByLabelText(/amount/i) as HTMLInputElement;
    const newDescInput = screen.getByLabelText(/description/i) as HTMLInputElement;
    expect(newAmountInput.value).toBe('');
    expect(newDescInput.value).toBe('');
  });

  it('Scenario 15: TransactionModal Form-Reset Protection (Edit Flow): Changing categories prop while modal is open does not erase edited values; switching transaction reinitializes', async () => {
    const handleClose = vi.fn();
    const handleSubmit = vi.fn();

    const initialCategories: CategoryResponse[] = [
      {
        id: 'cat-inc-1',
        business_id: mockWorkspaceA.id,
        name: 'Consulting Income',
        type: 'INCOME',
        description: null,
        color_hex: '#10B981',
        is_system_default: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'cat-exp-1',
        business_id: mockWorkspaceA.id,
        name: 'Cloud Hosting',
        type: 'EXPENSE',
        description: null,
        color_hex: '#6366F1',
        is_system_default: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];

    const targetTx1 = mockTransactions[0]; // tx-1, INCOME, 1250.50, Client Advisory Retainer
    const targetTx2 = mockTransactions[1]; // tx-2, EXPENSE, 340.00, AWS Production Cluster

    const { rerender } = render(
      <TransactionModal
        isOpen={true}
        onClose={handleClose}
        onSubmit={handleSubmit}
        initialData={targetTx1}
        categories={initialCategories}
        currency="USD"
      />
    );

    expect(screen.getByRole('heading', { name: /edit transaction/i })).toBeInTheDocument();

    const amountInput = screen.getByLabelText(/amount/i) as HTMLInputElement;
    const descInput = screen.getByLabelText(/description/i) as HTMLInputElement;

    expect(amountInput.value).toBe('1250.50');
    expect(descInput.value).toBe('Client Advisory Retainer');

    // User edits form fields
    fireEvent.change(amountInput, { target: { value: '8888.00' } });
    fireEvent.change(descInput, { target: { value: 'Updated Client Advisory Retainer' } });

    expect(amountInput.value).toBe('8888.00');
    expect(descInput.value).toBe('Updated Client Advisory Retainer');

    // REGRESSION TEST: Parent re-renders with new categories array
    const updatedCategories: CategoryResponse[] = [
      ...initialCategories,
      {
        id: 'cat-inc-2',
        business_id: mockWorkspaceA.id,
        name: 'Affiliate Revenue',
        type: 'INCOME',
        description: null,
        color_hex: '#059669',
        is_system_default: false,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];

    rerender(
      <TransactionModal
        isOpen={true}
        onClose={handleClose}
        onSubmit={handleSubmit}
        initialData={targetTx1}
        categories={updatedCategories}
        currency="USD"
      />
    );

    // Edited values must NOT be overwritten by categories update
    expect(amountInput.value).toBe('8888.00');
    expect(descInput.value).toBe('Updated Client Advisory Retainer');

    // Switching to a DIFFERENT transaction re-initializes form to that transaction's values
    rerender(
      <TransactionModal
        isOpen={true}
        onClose={handleClose}
        onSubmit={handleSubmit}
        initialData={targetTx2}
        categories={updatedCategories}
        currency="USD"
      />
    );

    expect(amountInput.value).toBe('340.00');
    expect(descInput.value).toBe('AWS Production Cluster');
    const categorySelect = screen.getByLabelText(/category/i) as HTMLSelectElement;
    expect(categorySelect.value).toBe('cat-exp-1');
  });
});
