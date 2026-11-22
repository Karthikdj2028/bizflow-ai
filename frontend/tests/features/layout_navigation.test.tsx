import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { WorkspaceLayout } from '../../src/features/workspaces/WorkspaceLayout';
import {
  WorkspaceContext,
  WorkspaceContextValue,
} from '../../src/features/workspaces/WorkspaceContext';
import {
  CategoryResponse,
  FinancialSummaryResponse,
  TransactionResponse,
} from '../../src/types/api';
import * as apiModule from '../../src/lib/api';
import * as txHookModule from '../../src/features/transactions/useTransactions';

let lastCreatePromise: Promise<any> | undefined;
let lastUpdatePromise: Promise<any> | undefined;
let lastDeletePromise: Promise<any> | undefined;

const mockLogout = vi.fn();

vi.mock('../../src/features/auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', email: 'owner@bizflow.ai', full_name: 'Alpha Owner', is_active: true },
    isAuthenticated: true,
    isLoading: false,
    connectionError: false,
    error: null,
    login: vi.fn(),
    register: vi.fn(),
    logout: mockLogout,
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

const mockWorkspaceB = {
  id: 'ws-b-2222-2222',
  name: 'Workspace Beta',
  base_currency: 'EUR',
  role: 'OWNER' as const,
  created_at: '2026-01-01T00:00:00Z',
};

const sampleCategoriesA: CategoryResponse[] = [
  {
    id: 'cat-a-1',
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
    id: 'cat-a-2',
    business_id: 'ws-a-1111-1111',
    name: 'Cloud Hosting',
    type: 'EXPENSE',
    description: 'Servers and storage',
    color_hex: '#6366F1',
    is_system_default: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const sampleCategoriesB: CategoryResponse[] = [
  {
    id: 'cat-b-1',
    business_id: 'ws-b-2222-2222',
    name: 'European Sales',
    type: 'INCOME',
    description: 'EU market revenue',
    color_hex: '#10B981',
    is_system_default: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const sampleTransactionsA: TransactionResponse[] = [
  {
    id: 'tx-a-1',
    business_id: 'ws-a-1111-1111',
    category_id: 'cat-a-1',
    category_name: 'Consulting Income',
    category_color: '#10B981',
    type: 'INCOME',
    amount: '5000.00',
    currency: 'USD',
    transaction_date: '2026-11-20',
    description: 'US Consulting Retainer',
    counterparty: 'Acme Corp',
    reference_number: 'INV-101',
    payment_method: 'BANK_TRANSFER',
    created_at: '2026-11-20T10:00:00Z',
    updated_at: '2026-11-20T10:00:00Z',
  },
];

const sampleTransactionsB: TransactionResponse[] = [
  {
    id: 'tx-b-1',
    business_id: 'ws-b-2222-2222',
    category_id: 'cat-b-1',
    category_name: 'European Sales',
    category_color: '#10B981',
    type: 'INCOME',
    amount: '4200.00',
    currency: 'EUR',
    transaction_date: '2026-11-21',
    description: 'Berlin Consulting Contract',
    counterparty: 'EuroTech GmbH',
    reference_number: 'INV-202',
    payment_method: 'BANK_TRANSFER',
    created_at: '2026-11-21T10:00:00Z',
    updated_at: '2026-11-21T10:00:00Z',
  },
];

const summaryA: FinancialSummaryResponse = {
  period: { start_date: '2026-11-01', end_date: '2026-11-20' },
  currency: 'USD',
  total_income: '5000.00',
  total_expenses: '0.00',
  net_cash_flow: '5000.00',
  transaction_count: 1,
  cumulative_net_movement: '5000.00',
  income_by_category: [],
  expenses_by_category: [],
};

const summaryB: FinancialSummaryResponse = {
  period: { start_date: '2026-11-01', end_date: '2026-11-21' },
  currency: 'EUR',
  total_income: '4200.00',
  total_expenses: '0.00',
  net_cash_flow: '4200.00',
  transaction_count: 1,
  cumulative_net_movement: '4200.00',
  income_by_category: [],
  expenses_by_category: [],
};

describe('Layout Navigation, Concurrency & Category Regression Suite', () => {
  let apiRequestSpy: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    mockLogout.mockClear();

    lastCreatePromise = undefined;
    lastUpdatePromise = undefined;
    lastDeletePromise = undefined;

    const originalUseTransactions = txHookModule.useTransactions;
    vi.spyOn(txHookModule, 'useTransactions').mockImplementation(() => {
      const hook = originalUseTransactions();
      return {
        ...hook,
        createTransaction: (data) => {
          const p = hook.createTransaction(data);
          lastCreatePromise = p;
          return p;
        },
        updateTransaction: (id, data) => {
          const p = hook.updateTransaction(id, data);
          lastUpdatePromise = p;
          return p;
        },
        deleteTransaction: (id) => {
          const p = hook.deleteTransaction(id);
          lastDeletePromise = p;
          return p;
        },
      };
    });

    apiRequestSpy = vi.spyOn(apiModule, 'apiRequest').mockImplementation((endpoint: string, options: any) => {
      const bizId = options?.targetWorkspaceId || 'ws-a-1111-1111';

      if (endpoint.startsWith('/categories')) {
        const cats = bizId === 'ws-b-2222-2222' ? sampleCategoriesB : sampleCategoriesA;
        return Promise.resolve({ items: cats, total: cats.length });
      }
      if (endpoint.startsWith('/transactions/summary')) {
        return Promise.resolve(bizId === 'ws-b-2222-2222' ? summaryB : summaryA);
      }
      if (endpoint.startsWith('/transactions')) {
        const txs = bizId === 'ws-b-2222-2222' ? sampleTransactionsB : sampleTransactionsA;
        return Promise.resolve({
          items: txs,
          total: txs.length,
          page: 1,
          page_size: 20,
          total_pages: 1,
        });
      }
      if (endpoint.startsWith('/workspaces')) {
        return Promise.resolve({ items: [mockWorkspaceA, mockWorkspaceB], total: 2 });
      }
      return Promise.resolve({});
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  const TestWrapper: React.FC<{
    initialWorkspace?: typeof mockWorkspaceA;
    onRenderContext?: (ctx: WorkspaceContextValue) => void;
  }> = ({ initialWorkspace = mockWorkspaceA, onRenderContext }) => {
    const [currentWorkspace, setCurrentWorkspace] = useState(initialWorkspace);
    const [generation, setGeneration] = useState(1);
    const authoritativeSnapshotRef = React.useRef({
      businessId: initialWorkspace.id,
      generation: 1,
    });

    const switchWorkspace = async (id: string) => {
      const next = id === mockWorkspaceB.id ? mockWorkspaceB : mockWorkspaceA;
      const nextGen = authoritativeSnapshotRef.current.generation + 1;
      authoritativeSnapshotRef.current = {
        businessId: next.id,
        generation: nextGen,
      };
      act(() => {
        setCurrentWorkspace(next);
        setGeneration(nextGen);
      });
      return true;
    };

    const isCurrentWorkspace = React.useCallback(
      (bizId: string | null | undefined, gen: number): boolean => {
        return (
          Boolean(bizId) &&
          authoritativeSnapshotRef.current.businessId === bizId &&
          authoritativeSnapshotRef.current.generation === gen
        );
      },
      []
    );

    const ctxValue: WorkspaceContextValue = {
      workspaces: [mockWorkspaceA, mockWorkspaceB],
      activeWorkspace: currentWorkspace,
      workspaceGeneration: generation,
      isLoading: false,
      error: null,
      switchWorkspace,
      refreshWorkspaces: vi.fn().mockResolvedValue(undefined),
      isCurrentWorkspace,
    };

    if (onRenderContext) {
      onRenderContext(ctxValue);
    }

    return (
      <WorkspaceContext.Provider value={ctxValue}>
        <WorkspaceLayout />
      </WorkspaceContext.Provider>
    );
  };

  it('Scenario 13: Tab Navigation switches between Overview, Transactions, Categories', async () => {
    render(<TestWrapper />);

    // Initially Overview is active
    const overviewTab = screen.getByRole('tab', { name: /^overview$/i });
    const transactionsTab = screen.getByRole('tab', { name: /^transactions$/i });
    const categoriesTab = screen.getByRole('tab', { name: /^categories$/i });

    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    expect(transactionsTab).toHaveAttribute('aria-selected', 'false');
    expect(categoriesTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText(/Welcome to Workspace Alpha/i)).toBeInTheDocument();

    // Click Transactions tab
    fireEvent.click(transactionsTab);
    expect(transactionsTab).toHaveAttribute('aria-selected', 'true');
    expect(overviewTab).toHaveAttribute('aria-selected', 'false');
    await waitFor(() => {
      expect(screen.getByText('US Consulting Retainer')).toBeInTheDocument();
    });

    // Click Categories tab
    fireEvent.click(categoriesTab);
    expect(categoriesTab).toHaveAttribute('aria-selected', 'true');
    expect(transactionsTab).toHaveAttribute('aria-selected', 'false');
    await waitFor(() => {
      expect(screen.getByText('Chart of Accounts')).toBeInTheDocument();
    });

    // Click Overview tab again
    fireEvent.click(overviewTab);
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/Welcome to Workspace Alpha/i)).toBeInTheDocument();
  });

  it('Scenario 14: Modal Reset on Switch auto-closes Transaction modal when workspace changes', async () => {
    let capturedCtx: WorkspaceContextValue;
    render(<TestWrapper onRenderContext={(ctx) => (capturedCtx = ctx)} />);

    // Navigate to Transactions tab
    fireEvent.click(screen.getByRole('tab', { name: /^transactions$/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new transaction/i })).toBeInTheDocument();
    });

    // Open New Transaction modal
    fireEvent.click(screen.getByRole('button', { name: /new transaction/i }));
    expect(screen.getByRole('heading', { name: /record new transaction/i })).toBeInTheDocument();

    // Switch workspace to Workspace B
    await act(async () => {
      await capturedCtx.switchWorkspace(mockWorkspaceB.id);
    });

    // Modal must be automatically dismissed
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /record new transaction/i })).not.toBeInTheDocument();
      expect(screen.getByText('Berlin Consulting Contract')).toBeInTheDocument();
    });
  });

  it('Scenario 15: Modal Reset on Switch auto-closes Category modal when workspace changes', async () => {
    let capturedCtx: WorkspaceContextValue;
    render(<TestWrapper onRenderContext={(ctx) => (capturedCtx = ctx)} />);

    // Navigate to Categories tab
    fireEvent.click(screen.getByRole('tab', { name: /^categories$/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new category/i })).toBeInTheDocument();
    });

    // Open New Category modal
    fireEvent.click(screen.getByRole('button', { name: /new category/i }));
    expect(screen.getByRole('heading', { name: /create.*category/i })).toBeInTheDocument();

    // Switch workspace to Workspace B
    await act(async () => {
      await capturedCtx.switchWorkspace(mockWorkspaceB.id);
    });

    // Category modal must be automatically dismissed
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /create.*category/i })).not.toBeInTheDocument();
      expect(screen.getByText('European Sales')).toBeInTheDocument();
    });
  });

  it('Scenario 16: Stale Query Isolation drops delayed response from Workspace A after switch to B', async () => {
    let resolveTxA: (val: any) => void;
    const txAPromise = new Promise((res) => {
      resolveTxA = res;
    });

    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      const bizId = options?.targetWorkspaceId;
      if (endpoint.startsWith('/categories')) {
        const cats = bizId === mockWorkspaceB.id ? sampleCategoriesB : sampleCategoriesA;
        return Promise.resolve({ items: cats, total: cats.length });
      }
      if (endpoint.startsWith('/transactions/summary')) {
        return Promise.resolve(bizId === mockWorkspaceB.id ? summaryB : summaryA);
      }
      if (endpoint.startsWith('/transactions')) {
        if (bizId === mockWorkspaceA.id) {
          return txAPromise; // Delayed
        }
        return Promise.resolve({
          items: sampleTransactionsB,
          total: 1,
          page: 1,
          page_size: 20,
          total_pages: 1,
        });
      }
      return Promise.resolve({});
    });

    let capturedCtx: WorkspaceContextValue;
    render(<TestWrapper onRenderContext={(ctx) => (capturedCtx = ctx)} />);

    // Go to Transactions tab in Workspace A (request is in-flight and pending)
    fireEvent.click(screen.getByRole('tab', { name: /^transactions$/i }));

    // Switch to Workspace B immediately
    await act(async () => {
      await capturedCtx.switchWorkspace(mockWorkspaceB.id);
    });

    // Workspace B loads its data
    await waitFor(() => {
      expect(screen.getByText('Berlin Consulting Contract')).toBeInTheDocument();
    });

    // Now resolve delayed Workspace A response
    await act(async () => {
      resolveTxA!({
        items: sampleTransactionsA,
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      });
    });

    // Workspace A data must NOT overwrite Workspace B
    expect(screen.queryByText('US Consulting Retainer')).not.toBeInTheDocument();
    expect(screen.getByText('Berlin Consulting Contract')).toBeInTheDocument();
  });

  it('Scenario 17: ABA Race Protection prevents delayed A(Gen 1) response from corrupting A(Gen 3)', async () => {
    let resolveGen1: (val: any) => void;
    const gen1Promise = new Promise((res) => {
      resolveGen1 = res;
    });

    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      const bizId = options?.targetWorkspaceId;
      const gen = options?.targetWorkspaceGeneration;

      if (endpoint.startsWith('/categories')) {
        return Promise.resolve({ items: sampleCategoriesA, total: 2 });
      }
      if (endpoint.startsWith('/transactions/summary')) {
        return Promise.resolve(summaryA);
      }
      if (endpoint.startsWith('/transactions')) {
        if (bizId === mockWorkspaceA.id && gen === 1) {
          return gen1Promise; // Delayed Gen 1 response
        }
        return Promise.resolve({
          items: [
            {
              ...sampleTransactionsA[0],
              description: 'Fresh Gen 3 Retainer',
            },
          ],
          total: 1,
          page: 1,
          page_size: 20,
          total_pages: 1,
        });
      }
      return Promise.resolve({});
    });

    let capturedCtx: WorkspaceContextValue;
    render(<TestWrapper onRenderContext={(ctx) => (capturedCtx = ctx)} />);

    // In Gen 1, go to transactions (triggers delayed gen 1 request)
    fireEvent.click(screen.getByRole('tab', { name: /^transactions$/i }));

    // Switch A (Gen 1) -> B (Gen 2)
    await act(async () => {
      await capturedCtx.switchWorkspace(mockWorkspaceB.id);
    });

    // Switch B (Gen 2) -> A (Gen 3)
    await act(async () => {
      await capturedCtx.switchWorkspace(mockWorkspaceA.id);
    });

    // A at Gen 3 renders its fresh data
    await waitFor(() => {
      expect(screen.getByText('Fresh Gen 3 Retainer')).toBeInTheDocument();
    });

    // Now resolve old delayed Gen 1 response
    await act(async () => {
      resolveGen1!({
        items: [
          {
            ...sampleTransactionsA[0],
            description: 'Stale Gen 1 Retainer',
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      });
    });

    // Must still show Fresh Gen 3 and not Stale Gen 1
    expect(screen.queryByText('Stale Gen 1 Retainer')).not.toBeInTheDocument();
    expect(screen.getByText('Fresh Gen 3 Retainer')).toBeInTheDocument();
  });

  it('Scenario 18: Mutation After Switch (Create) discards in-flight create resolving after switch to B', async () => {
    let resolveCreate: (val: any) => void;
    const createPromise = new Promise((res) => {
      resolveCreate = res;
    });

    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      if (endpoint === '/transactions' && options?.method === 'POST') {
        return createPromise;
      }
      const bizId = options?.targetWorkspaceId;
      if (endpoint.startsWith('/categories')) {
        return Promise.resolve({ items: sampleCategoriesA, total: 2 });
      }
      if (endpoint.startsWith('/transactions/summary')) {
        return Promise.resolve(bizId === mockWorkspaceB.id ? summaryB : summaryA);
      }
      if (endpoint.startsWith('/transactions')) {
        const txs = bizId === mockWorkspaceB.id ? sampleTransactionsB : sampleTransactionsA;
        return Promise.resolve({ items: txs, total: txs.length, page: 1, page_size: 20, total_pages: 1 });
      }
      return Promise.resolve({});
    });

    let capturedCtx: WorkspaceContextValue;
    render(<TestWrapper onRenderContext={(ctx) => (capturedCtx = ctx)} />);

    fireEvent.click(screen.getByRole('tab', { name: /^transactions$/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new transaction/i })).toBeInTheDocument();
    });

    // Open modal and submit create
    fireEvent.click(screen.getByRole('button', { name: /new transaction/i }));
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '999.00' } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Pending Inflight Tx' } });
    fireEvent.click(screen.getByRole('button', { name: /record transaction/i }));

    // Inflight mutation is pending; switch to Workspace B
    await act(async () => {
      await capturedCtx.switchWorkspace(mockWorkspaceB.id);
    });

    // Resolve create
    await act(async () => {
      resolveCreate!({
        id: 'tx-new-999',
        business_id: mockWorkspaceA.id,
        category_id: 'cat-a-1',
        type: 'EXPENSE',
        amount: '999.00',
        currency: 'USD',
        transaction_date: '2026-11-20',
        description: 'Pending Inflight Tx',
        counterparty: null,
        reference_number: null,
        payment_method: 'OTHER',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    });

    // Workspace B must show only its own transactions, not Pending Inflight Tx
    await waitFor(() => {
      expect(screen.getByText('Berlin Consulting Contract')).toBeInTheDocument();
      expect(screen.queryByText('Pending Inflight Tx')).not.toBeInTheDocument();
    });
  });

  it('Scenario 19: Mutation After Switch (Update) discards in-flight update resolving after switch to B', async () => {
    let resolveUpdate: (val: any) => void;
    const updatePromise = new Promise((res) => {
      resolveUpdate = res;
    });

    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      if (options?.method === 'PATCH') {
        return updatePromise;
      }
      const bizId = options?.targetWorkspaceId;
      if (endpoint.startsWith('/categories')) {
        return Promise.resolve({ items: sampleCategoriesA, total: 2 });
      }
      if (endpoint.startsWith('/transactions/summary')) {
        return Promise.resolve(bizId === mockWorkspaceB.id ? summaryB : summaryA);
      }
      if (endpoint.startsWith('/transactions')) {
        const txs = bizId === mockWorkspaceB.id ? sampleTransactionsB : sampleTransactionsA;
        return Promise.resolve({ items: txs, total: txs.length, page: 1, page_size: 20, total_pages: 1 });
      }
      return Promise.resolve({});
    });

    let capturedCtx: WorkspaceContextValue;
    render(<TestWrapper onRenderContext={(ctx) => (capturedCtx = ctx)} />);

    fireEvent.click(screen.getByRole('tab', { name: /^transactions$/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/edit us consulting retainer/i)).toBeInTheDocument();
    });

    // Open edit modal
    fireEvent.click(screen.getByLabelText(/edit us consulting retainer/i));
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Updated While Switching' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    // Switch while update in flight
    await act(async () => {
      await capturedCtx.switchWorkspace(mockWorkspaceB.id);
    });

    // Resolve update
    await act(async () => {
      resolveUpdate!({
        ...sampleTransactionsA[0],
        description: 'Updated While Switching',
      });
    });

    // Workspace B must NOT reflect the update
    await waitFor(() => {
      expect(screen.getByText('Berlin Consulting Contract')).toBeInTheDocument();
      expect(screen.queryByText('Updated While Switching')).not.toBeInTheDocument();
    });
  });

  it('Scenario 20: Mutation After Switch (Delete) discards in-flight delete resolving after switch to B', async () => {
    let resolveDelete: (val: any) => void;
    const deletePromise = new Promise((res) => {
      resolveDelete = res;
    });

    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      if (options?.method === 'DELETE') {
        return deletePromise;
      }
      const bizId = options?.targetWorkspaceId;
      if (endpoint.startsWith('/categories')) {
        return Promise.resolve({ items: sampleCategoriesA, total: 2 });
      }
      if (endpoint.startsWith('/transactions/summary')) {
        return Promise.resolve(bizId === mockWorkspaceB.id ? summaryB : summaryA);
      }
      if (endpoint.startsWith('/transactions')) {
        const txs = bizId === mockWorkspaceB.id ? sampleTransactionsB : sampleTransactionsA;
        return Promise.resolve({ items: txs, total: txs.length, page: 1, page_size: 20, total_pages: 1 });
      }
      return Promise.resolve({});
    });

    let capturedCtx: WorkspaceContextValue;
    render(<TestWrapper onRenderContext={(ctx) => (capturedCtx = ctx)} />);

    fireEvent.click(screen.getByRole('tab', { name: /^transactions$/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/delete us consulting retainer/i)).toBeInTheDocument();
    });

    // Open delete confirmation
    fireEvent.click(screen.getByLabelText(/delete us consulting retainer/i));
    expect(screen.getByRole('heading', { name: /delete transaction/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Transaction' }));

    // Switch while delete in flight
    await act(async () => {
      await capturedCtx.switchWorkspace(mockWorkspaceB.id);
    });

    // Resolve delete
    await act(async () => {
      resolveDelete!({ message: 'Deleted', id: 'tx-a-1' });
    });

    // Workspace B retains its own transaction
    await waitFor(() => {
      expect(screen.getByText('Berlin Consulting Contract')).toBeInTheDocument();
    });
  });

  it('Scenario 21: Category Regression: List & Filter verifies categories filter properly in 3-tab layout', async () => {
    render(<TestWrapper />);

    fireEvent.click(screen.getByRole('tab', { name: /^categories$/i }));
    await waitFor(() => {
      expect(screen.getByText('Consulting Income')).toBeInTheDocument();
      expect(screen.getByText('Cloud Hosting')).toBeInTheDocument();
    });

    // Filter by INCOME
    fireEvent.click(screen.getByRole('button', { name: /^income/i }));
    expect(screen.getByText('Consulting Income')).toBeInTheDocument();
    expect(screen.queryByText('Cloud Hosting')).not.toBeInTheDocument();

    // Filter by EXPENSE
    fireEvent.click(screen.getByRole('button', { name: /^expense/i }));
    expect(screen.getByText('Cloud Hosting')).toBeInTheDocument();
    expect(screen.queryByText('Consulting Income')).not.toBeInTheDocument();
  });

  it('Scenario 22: Category Regression: Full CRUD operations function seamlessly', async () => {
    let currentCats = [...sampleCategoriesA];

    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      if (endpoint === '/categories' && options?.method === 'POST') {
        const body = JSON.parse(options.body);
        const newCat: CategoryResponse = {
          id: 'cat-new-1',
          business_id: mockWorkspaceA.id,
          name: body.name,
          type: body.type,
          description: body.description || null,
          color_hex: body.color_hex || '#10B981',
          is_system_default: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        currentCats.push(newCat);
        return Promise.resolve(newCat);
      }
      if (options?.method === 'PATCH') {
        const body = JSON.parse(options.body);
        const idx = currentCats.findIndex((c) => c.id === 'cat-a-2');
        if (idx !== -1) {
          currentCats[idx] = {
            ...currentCats[idx],
            description: body.description, // Can be null
          };
          return Promise.resolve(currentCats[idx]);
        }
      }
      if (options?.method === 'DELETE') {
        currentCats = currentCats.filter((c) => c.id !== 'cat-a-2');
        return Promise.resolve(undefined);
      }
      if (endpoint.startsWith('/categories')) {
        return Promise.resolve({ items: currentCats, total: currentCats.length });
      }
      return Promise.resolve({});
    });

    render(<TestWrapper />);

    fireEvent.click(screen.getByRole('tab', { name: /^categories$/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new category/i })).toBeInTheDocument();
    });

    // 1. Create Category
    fireEvent.click(screen.getByRole('button', { name: /new category/i }));
    fireEvent.change(screen.getByLabelText(/category name/i), { target: { value: 'Marketing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Category' }));

    await waitFor(() => {
      expect(screen.getByText('Marketing')).toBeInTheDocument();
    });

    // 2. Edit Category (clearing description)
    fireEvent.click(screen.getByRole('button', { name: /edit category cloud hosting/i }));
    const descInput = screen.getByLabelText(/description \(optional\)/i);
    fireEvent.change(descInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /edit category/i })).not.toBeInTheDocument();
    });

    // 3. Delete Category
    fireEvent.click(screen.getByRole('button', { name: /delete category cloud hosting/i }));
    expect(screen.getByRole('heading', { name: /delete category/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.queryByText('Cloud Hosting')).not.toBeInTheDocument();
    });
  });

  it('Scenario 23: Session Logout Cleanup purges session and triggers logout handler', async () => {
    render(<TestWrapper />);

    fireEvent.click(screen.getByRole('tab', { name: /^transactions$/i }));
    await waitFor(() => {
      expect(screen.getByTitle('Sign Out')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Sign Out'));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('Scenario 24: Immediate Data Isolation on Switch (A -> B) ensures Workspace A data never renders under Workspace B', async () => {
    let resolveTxB: (val: any) => void;
    let resolveSummaryB: (val: any) => void;
    const txBPromise = new Promise((res) => {
      resolveTxB = res;
    });
    const summaryBPromise = new Promise((res) => {
      resolveSummaryB = res;
    });

    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      const bizId = options?.targetWorkspaceId;
      if (endpoint.startsWith('/categories')) {
        return Promise.resolve({
          items: bizId === mockWorkspaceB.id ? sampleCategoriesB : sampleCategoriesA,
          total: 2,
        });
      }
      if (endpoint.startsWith('/transactions/summary')) {
        if (bizId === mockWorkspaceB.id) {
          return summaryBPromise;
        }
        return Promise.resolve(summaryA);
      }
      if (endpoint.startsWith('/transactions')) {
        if (bizId === mockWorkspaceB.id) {
          return txBPromise;
        }
        return Promise.resolve({
          items: sampleTransactionsA,
          total: 1,
          page: 1,
          page_size: 20,
          total_pages: 1,
        });
      }
      return Promise.resolve({});
    });

    let capturedCtx: WorkspaceContextValue;
    render(<TestWrapper onRenderContext={(ctx) => (capturedCtx = ctx)} />);

    // Go to transactions in Workspace A
    fireEvent.click(screen.getByRole('tab', { name: /^transactions$/i }));
    await waitFor(() => {
      expect(screen.getByText('US Consulting Retainer')).toBeInTheDocument();
      expect(screen.getAllByText('+USD 5,000.00').length).toBeGreaterThan(0);
    });

    // Switch to Workspace B (Workspace B data is pending in txBPromise and summaryBPromise)
    await act(async () => {
      await capturedCtx.switchWorkspace(mockWorkspaceB.id);
    });

    // Immediately under Workspace B: Workspace A data must NOT be rendered
    expect(screen.queryByText('US Consulting Retainer')).not.toBeInTheDocument();
    expect(screen.queryByText('+USD 5,000.00')).not.toBeInTheDocument();

    // Now resolve Workspace B data
    await act(async () => {
      resolveTxB!({
        items: sampleTransactionsB,
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      });
      resolveSummaryB!(summaryB);
    });

    // Workspace B data renders
    await waitFor(() => {
      expect(screen.getByText('Berlin Consulting Contract')).toBeInTheDocument();
      expect(screen.getAllByText('+EUR 4,200.00').length).toBeGreaterThan(0);
    });
  });

  it('Scenario 25: A -> B -> A Transition ensures only fresh generation data is rendered', async () => {
    let resolveTxA3: (val: any) => void;
    const txA3Promise = new Promise((res) => {
      resolveTxA3 = res;
    });

    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      const bizId = options?.targetWorkspaceId;
      const gen = options?.targetWorkspaceGeneration;

      if (endpoint.startsWith('/categories')) {
        return Promise.resolve({ items: sampleCategoriesA, total: 2 });
      }
      if (endpoint.startsWith('/transactions/summary')) {
        return Promise.resolve(bizId === mockWorkspaceB.id ? summaryB : summaryA);
      }
      if (endpoint.startsWith('/transactions')) {
        if (bizId === mockWorkspaceA.id && gen === 1) {
          return Promise.resolve({
            items: [{ ...sampleTransactionsA[0], description: 'A Gen 1 Retainer' }],
            total: 1,
            page: 1,
            page_size: 20,
            total_pages: 1,
          });
        }
        if (bizId === mockWorkspaceB.id) {
          return Promise.resolve({
            items: sampleTransactionsB,
            total: 1,
            page: 1,
            page_size: 20,
            total_pages: 1,
          });
        }
        if (bizId === mockWorkspaceA.id && gen === 3) {
          return txA3Promise; // Deferred
        }
      }
      return Promise.resolve({});
    });

    let capturedCtx: WorkspaceContextValue;
    render(<TestWrapper onRenderContext={(ctx) => (capturedCtx = ctx)} />);

    // 1. Initial Workspace A (Gen 1)
    fireEvent.click(screen.getByRole('tab', { name: /^transactions$/i }));
    await waitFor(() => {
      expect(screen.getByText('A Gen 1 Retainer')).toBeInTheDocument();
    });

    // 2. Switch to Workspace B (Gen 2)
    await act(async () => {
      await capturedCtx.switchWorkspace(mockWorkspaceB.id);
    });
    await waitFor(() => {
      expect(screen.getByText('Berlin Consulting Contract')).toBeInTheDocument();
      expect(screen.queryByText('A Gen 1 Retainer')).not.toBeInTheDocument();
    });

    // 3. Switch back to Workspace A (Gen 3) - data is deferred
    await act(async () => {
      await capturedCtx.switchWorkspace(mockWorkspaceA.id);
    });

    // Neither B nor old A Gen 1 data should be rendered
    expect(screen.queryByText('Berlin Consulting Contract')).not.toBeInTheDocument();
    expect(screen.queryByText('A Gen 1 Retainer')).not.toBeInTheDocument();

    // Now resolve A (Gen 3)
    await act(async () => {
      resolveTxA3!({
        items: [{ ...sampleTransactionsA[0], description: 'A Gen 3 Exclusive Retainer' }],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      });
    });

    // Fresh Gen 3 data renders
    await waitFor(() => {
      expect(screen.getByText('A Gen 3 Exclusive Retainer')).toBeInTheDocument();
      expect(screen.queryByText('A Gen 1 Retainer')).not.toBeInTheDocument();
    });
  });

  it('Scenario 26: Create Mutation with pending refresh returns stale when workspace switches', async () => {
    let resolveRefreshTx: (val: any) => void;
    let resolveRefreshSummary: (val: any) => void;
    const refreshTxPromise = new Promise((res) => {
      resolveRefreshTx = res;
    });
    const refreshSummaryPromise = new Promise((res) => {
      resolveRefreshSummary = res;
    });

    let createCallCount = 0;

    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      const bizId = options?.targetWorkspaceId;
      const method = options?.method || 'GET';

      if (endpoint === '/transactions' && method === 'POST') {
        createCallCount++;
        return Promise.resolve({
          id: 'tx-new-create-1',
          business_id: mockWorkspaceA.id,
          category_id: 'cat-a-1',
          type: 'INCOME',
          amount: '888.00',
          currency: 'USD',
          transaction_date: '2026-11-20',
          description: 'Refresh Pending Tx',
          counterparty: null,
          reference_number: null,
          payment_method: 'OTHER',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      if (endpoint.startsWith('/categories')) {
        return Promise.resolve({ items: sampleCategoriesA, total: 2 });
      }

      if (endpoint.startsWith('/transactions/summary')) {
        if (createCallCount > 0 && bizId === mockWorkspaceA.id) {
          return refreshSummaryPromise;
        }
        return Promise.resolve(bizId === mockWorkspaceB.id ? summaryB : summaryA);
      }

      if (endpoint.startsWith('/transactions')) {
        if (createCallCount > 0 && bizId === mockWorkspaceA.id) {
          return refreshTxPromise;
        }
        const txs = bizId === mockWorkspaceB.id ? sampleTransactionsB : sampleTransactionsA;
        return Promise.resolve({ items: txs, total: txs.length, page: 1, page_size: 20, total_pages: 1 });
      }

      return Promise.resolve({});
    });

    let capturedCtx: WorkspaceContextValue;
    render(<TestWrapper onRenderContext={(ctx) => (capturedCtx = ctx)} />);

    fireEvent.click(screen.getByRole('tab', { name: /^transactions$/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new transaction/i })).toBeInTheDocument();
    });

    // Open modal and submit create
    fireEvent.click(screen.getByRole('button', { name: /new transaction/i }));
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '888.00' } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Refresh Pending Tx' } });

    // Submit form: POST resolves immediately, but refresh is deferred
    fireEvent.click(screen.getByRole('button', { name: /record transaction/i }));
    const createMutationPromise = lastCreatePromise!;
    expect(createMutationPromise).toBeDefined();

    // Switch workspace while refresh is pending
    await act(async () => {
      await capturedCtx.switchWorkspace(mockWorkspaceB.id);
    });

    // Now resolve the refresh promises for Workspace A
    await act(async () => {
      resolveRefreshTx!({
        items: [
          ...sampleTransactionsA,
          {
            id: 'tx-new-create-1',
            business_id: mockWorkspaceA.id,
            category_id: 'cat-a-1',
            category_name: 'Consulting Income',
            type: 'INCOME',
            amount: '888.00',
            currency: 'USD',
            transaction_date: '2026-11-20',
            description: 'Refresh Pending Tx',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        total: 2,
        page: 1,
        page_size: 20,
        total_pages: 1,
      });
      resolveRefreshSummary!(summaryA);
    });

    // Assert that the create mutation resolves with { status: 'stale' }
    const createResult = await createMutationPromise;
    expect(createResult).toEqual({ status: 'stale' });

    // Workspace B must NOT render 'Refresh Pending Tx', only its own data
    await waitFor(() => {
      expect(screen.getByText('Berlin Consulting Contract')).toBeInTheDocument();
      expect(screen.queryByText('Refresh Pending Tx')).not.toBeInTheDocument();
    });
  });

  it('Scenario 27: Update Mutation with pending refresh returns stale when workspace switches', async () => {
    let resolveRefreshTx: (val: any) => void;
    let resolveRefreshSummary: (val: any) => void;
    const refreshTxPromise = new Promise((res) => {
      resolveRefreshTx = res;
    });
    const refreshSummaryPromise = new Promise((res) => {
      resolveRefreshSummary = res;
    });

    let updateCallCount = 0;

    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      const bizId = options?.targetWorkspaceId;
      const method = options?.method || 'GET';

      if (options?.method === 'PATCH') {
        updateCallCount++;
        return Promise.resolve({
          ...sampleTransactionsA[0],
          description: 'Updated During Refresh',
        });
      }

      if (endpoint.startsWith('/categories')) {
        return Promise.resolve({ items: sampleCategoriesA, total: 2 });
      }

      if (endpoint.startsWith('/transactions/summary')) {
        if (updateCallCount > 0 && bizId === mockWorkspaceA.id) {
          return refreshSummaryPromise;
        }
        return Promise.resolve(bizId === mockWorkspaceB.id ? summaryB : summaryA);
      }

      if (endpoint.startsWith('/transactions')) {
        if (updateCallCount > 0 && bizId === mockWorkspaceA.id) {
          return refreshTxPromise;
        }
        const txs = bizId === mockWorkspaceB.id ? sampleTransactionsB : sampleTransactionsA;
        return Promise.resolve({ items: txs, total: txs.length, page: 1, page_size: 20, total_pages: 1 });
      }

      return Promise.resolve({});
    });

    let capturedCtx: WorkspaceContextValue;
    render(<TestWrapper onRenderContext={(ctx) => (capturedCtx = ctx)} />);

    fireEvent.click(screen.getByRole('tab', { name: /^transactions$/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/edit us consulting retainer/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/edit us consulting retainer/i));
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Updated During Refresh' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    const updateMutationPromise = lastUpdatePromise!;
    expect(updateMutationPromise).toBeDefined();

    // Switch workspace while refresh is pending
    await act(async () => {
      await capturedCtx.switchWorkspace(mockWorkspaceB.id);
    });

    // Now resolve the refresh promises for Workspace A
    await act(async () => {
      resolveRefreshTx!({
        items: [
          {
            ...sampleTransactionsA[0],
            description: 'Updated During Refresh',
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      });
      resolveRefreshSummary!(summaryA);
    });

    // Assert update mutation resolves with { status: 'stale' }
    const updateResult = await updateMutationPromise;
    expect(updateResult).toEqual({ status: 'stale' });

    // Workspace B must NOT reflect the update
    await waitFor(() => {
      expect(screen.getByText('Berlin Consulting Contract')).toBeInTheDocument();
      expect(screen.queryByText('Updated During Refresh')).not.toBeInTheDocument();
    });
  });

  it('Scenario 28: Delete Mutation with pending refresh returns stale when workspace switches', async () => {
    let resolveRefreshTx: (val: any) => void;
    let resolveRefreshSummary: (val: any) => void;
    const refreshTxPromise = new Promise((res) => {
      resolveRefreshTx = res;
    });
    const refreshSummaryPromise = new Promise((res) => {
      resolveRefreshSummary = res;
    });

    let deleteCallCount = 0;

    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      const bizId = options?.targetWorkspaceId;

      if (options?.method === 'DELETE') {
        deleteCallCount++;
        return Promise.resolve({ message: 'Deleted', id: 'tx-a-1' });
      }

      if (endpoint.startsWith('/categories')) {
        return Promise.resolve({ items: sampleCategoriesA, total: 2 });
      }

      if (endpoint.startsWith('/transactions/summary')) {
        if (deleteCallCount > 0 && bizId === mockWorkspaceA.id) {
          return refreshSummaryPromise;
        }
        return Promise.resolve(bizId === mockWorkspaceB.id ? summaryB : summaryA);
      }

      if (endpoint.startsWith('/transactions')) {
        if (deleteCallCount > 0 && bizId === mockWorkspaceA.id) {
          return refreshTxPromise;
        }
        const txs = bizId === mockWorkspaceB.id ? sampleTransactionsB : sampleTransactionsA;
        return Promise.resolve({ items: txs, total: txs.length, page: 1, page_size: 20, total_pages: 1 });
      }

      return Promise.resolve({});
    });

    let capturedCtx: WorkspaceContextValue;
    render(<TestWrapper onRenderContext={(ctx) => (capturedCtx = ctx)} />);

    fireEvent.click(screen.getByRole('tab', { name: /^transactions$/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/delete us consulting retainer/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/delete us consulting retainer/i));
    expect(screen.getByRole('heading', { name: /delete transaction/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Transaction' }));
    const deleteMutationPromise = lastDeletePromise!;
    expect(deleteMutationPromise).toBeDefined();

    // Switch while delete refresh is in flight
    await act(async () => {
      await capturedCtx.switchWorkspace(mockWorkspaceB.id);
    });

    // Resolve refresh
    await act(async () => {
      resolveRefreshTx!({ items: [], total: 0, page: 1, page_size: 20, total_pages: 0 });
      resolveRefreshSummary!({ ...summaryA, total_income: '0.00', transaction_count: 0 });
    });

    // Assert delete mutation resolves with { status: 'stale' }
    const deleteResult = await deleteMutationPromise;
    expect(deleteResult).toEqual({ status: 'stale' });

    // Workspace B retains its own transaction
    await waitFor(() => {
      expect(screen.getByText('Berlin Consulting Contract')).toBeInTheDocument();
    });
  });

  it('Scenario 29: Accessible Tab Keyboard Navigation supports Arrow keys, Home/End, and roving tabIndex', async () => {
    render(<TestWrapper />);

    const overviewTab = screen.getByRole('tab', { name: /^overview$/i });
    const transactionsTab = screen.getByRole('tab', { name: /^transactions$/i });
    const categoriesTab = screen.getByRole('tab', { name: /^categories$/i });

    // Initial state: Overview is selected with roving tabIndex=0, others have tabIndex=-1
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    expect(overviewTab).toHaveAttribute('tabIndex', '0');
    expect(transactionsTab).toHaveAttribute('aria-selected', 'false');
    expect(transactionsTab).toHaveAttribute('tabIndex', '-1');
    expect(categoriesTab).toHaveAttribute('aria-selected', 'false');
    expect(categoriesTab).toHaveAttribute('tabIndex', '-1');

    // 1. Right Arrow from Overview -> Transactions
    overviewTab.focus();
    fireEvent.keyDown(overviewTab, { key: 'ArrowRight' });
    expect(transactionsTab).toHaveAttribute('aria-selected', 'true');
    expect(transactionsTab).toHaveAttribute('tabIndex', '0');
    expect(overviewTab).toHaveAttribute('tabIndex', '-1');
    expect(document.activeElement).toBe(transactionsTab);

    // 2. Right Arrow from Transactions -> Categories
    fireEvent.keyDown(transactionsTab, { key: 'ArrowRight' });
    expect(categoriesTab).toHaveAttribute('aria-selected', 'true');
    expect(categoriesTab).toHaveAttribute('tabIndex', '0');
    expect(transactionsTab).toHaveAttribute('tabIndex', '-1');
    expect(document.activeElement).toBe(categoriesTab);

    // 3. Right Arrow from Categories loops around -> Overview
    fireEvent.keyDown(categoriesTab, { key: 'ArrowRight' });
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    expect(overviewTab).toHaveAttribute('tabIndex', '0');
    expect(categoriesTab).toHaveAttribute('tabIndex', '-1');
    expect(document.activeElement).toBe(overviewTab);

    // 4. Left Arrow from Overview loops around -> Categories
    fireEvent.keyDown(overviewTab, { key: 'ArrowLeft' });
    expect(categoriesTab).toHaveAttribute('aria-selected', 'true');
    expect(categoriesTab).toHaveAttribute('tabIndex', '0');
    expect(document.activeElement).toBe(categoriesTab);

    // 5. Left Arrow from Categories -> Transactions
    fireEvent.keyDown(categoriesTab, { key: 'ArrowLeft' });
    expect(transactionsTab).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(transactionsTab);

    // 6. Home key -> Overview (first tab)
    fireEvent.keyDown(transactionsTab, { key: 'Home' });
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    expect(overviewTab).toHaveAttribute('tabIndex', '0');
    expect(document.activeElement).toBe(overviewTab);

    // 7. End key -> Categories (last tab)
    fireEvent.keyDown(overviewTab, { key: 'End' });
    expect(categoriesTab).toHaveAttribute('aria-selected', 'true');
    expect(categoriesTab).toHaveAttribute('tabIndex', '0');
    expect(document.activeElement).toBe(categoriesTab);
  });

  it('Scenario 30: Workspace-Scoped Mutation Errors prevents stale mutation error from displaying in a different workspace', async () => {
    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      const bizId = options?.targetWorkspaceId;
      if (endpoint === '/transactions' && options?.method === 'POST') {
        const error = new apiModule.ApiClientError('Server failure', 500, {
          type: 'https://errors.bizflow.ai/internal-error',
          title: 'Internal Error',
          status: 500,
          detail: 'Transaction write failed in Workspace Alpha.',
        });
        return Promise.reject(error);
      }
      if (endpoint.startsWith('/categories')) {
        return Promise.resolve({ items: sampleCategoriesA, total: 2 });
      }
      if (endpoint.startsWith('/transactions/summary')) {
        return Promise.resolve(bizId === mockWorkspaceB.id ? summaryB : summaryA);
      }
      if (endpoint.startsWith('/transactions')) {
        const txs = bizId === mockWorkspaceB.id ? sampleTransactionsB : sampleTransactionsA;
        return Promise.resolve({ items: txs, total: txs.length, page: 1, page_size: 20, total_pages: 1 });
      }
      return Promise.resolve({});
    });

    let capturedCtx: WorkspaceContextValue;
    render(<TestWrapper onRenderContext={(ctx) => (capturedCtx = ctx)} />);

    fireEvent.click(screen.getByRole('tab', { name: /^transactions$/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new transaction/i })).toBeInTheDocument();
    });

    // Attempt create in Workspace A
    fireEvent.click(screen.getByRole('button', { name: /new transaction/i }));
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '500.00' } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Failing Tx' } });
    fireEvent.click(screen.getByRole('button', { name: /record transaction/i }));

    // Verify error is shown in Workspace A modal
    await waitFor(() => {
      expect(screen.getByText('Transaction write failed in Workspace Alpha.')).toBeInTheDocument();
    });

    // Switch to Workspace B
    await act(async () => {
      await capturedCtx.switchWorkspace(mockWorkspaceB.id);
    });

    // In Workspace B: modal is dismissed and mutation error does NOT leak into Workspace B
    expect(screen.queryByText('Transaction write failed in Workspace Alpha.')).not.toBeInTheDocument();
  });
});
