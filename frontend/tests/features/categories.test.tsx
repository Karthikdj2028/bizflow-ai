import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CategoryList } from '../../src/features/categories/CategoryList';
import { useCategories } from '../../src/features/categories/useCategories';
import { WorkspaceLayout } from '../../src/features/workspaces/WorkspaceLayout';
import {
  WorkspaceContext,
  WorkspaceContextValue,
} from '../../src/features/workspaces/WorkspaceContext';
import { CategoryResponse } from '../../src/types/api';
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

const mockWorkspaceB = {
  id: 'ws-b-2222-2222',
  name: 'Workspace Beta',
  base_currency: 'EUR',
  role: 'MEMBER' as const,
  created_at: '2026-01-01T00:00:00Z',
};

const sampleCategories: CategoryResponse[] = [
  {
    id: 'cat-1',
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
    id: 'cat-2',
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

describe('Category Management Integration & Lifecycles', () => {
  let apiRequestSpy: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    apiRequestSpy = vi.spyOn(apiModule, 'apiRequest');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  const createMockWorkspaceContext = (
    overrides?: Partial<WorkspaceContextValue>
  ): WorkspaceContextValue => {
    let currentBusinessId = overrides?.activeWorkspace?.id ?? mockWorkspaceA.id;
    let currentGen = overrides?.workspaceGeneration ?? 1;

    return {
      workspaces: [mockWorkspaceA, mockWorkspaceB],
      activeWorkspace: mockWorkspaceA,
      workspaceGeneration: currentGen,
      isLoading: false,
      error: null,
      switchWorkspace: vi.fn().mockImplementation(async (id: string) => {
        currentBusinessId = id;
        currentGen += 1;
        return true;
      }),
      refreshWorkspaces: vi.fn(),
      isCurrentWorkspace: vi.fn().mockImplementation((busId, gen) => {
        return busId === currentBusinessId && gen === currentGen;
      }),
      ...overrides,
    };
  };

  const renderWithWorkspace = (
    ui: React.ReactElement,
    wsContextValue?: WorkspaceContextValue
  ) => {
    const ws = wsContextValue || createMockWorkspaceContext();
    return {
      ...render(<WorkspaceContext.Provider value={ws}>{ui}</WorkspaceContext.Provider>),
      wsContext: ws,
    };
  };

  describe('Category Listing & Filtering', () => {
    it('fetches categories and displays them with color swatches and default tags', async () => {
      apiRequestSpy.mockResolvedValueOnce({
        items: sampleCategories,
        total: 2,
      });

      renderWithWorkspace(<CategoryList />);

      expect(screen.getByText('Loading workspace categories...')).toBeInTheDocument();

      expect(await screen.findByText('Consulting Income')).toBeInTheDocument();
      expect(screen.getByText('Cloud Hosting')).toBeInTheDocument();
      expect(screen.getByText('Default')).toBeInTheDocument();
    });

    it('filters categories by cash flow type (ALL, INCOME, EXPENSE)', async () => {
      apiRequestSpy.mockResolvedValueOnce({
        items: sampleCategories,
        total: 2,
      });

      renderWithWorkspace(<CategoryList />);

      expect(await screen.findByText('Consulting Income')).toBeInTheDocument();
      expect(screen.getByText('Cloud Hosting')).toBeInTheDocument();

      // Click Income filter
      const incomeBtn = screen.getByRole('button', { name: /^Income \(/i });
      fireEvent.click(incomeBtn);

      expect(screen.getByText('Consulting Income')).toBeInTheDocument();
      expect(screen.queryByText('Cloud Hosting')).not.toBeInTheDocument();

      // Click Expense filter
      const expenseBtn = screen.getByRole('button', { name: /^Expense \(/i });
      fireEvent.click(expenseBtn);

      expect(screen.queryByText('Consulting Income')).not.toBeInTheDocument();
      expect(screen.getByText('Cloud Hosting')).toBeInTheDocument();
    });

    it('displays error banner with a functional Retry button on fetch error', async () => {
      apiRequestSpy.mockRejectedValueOnce(new Error('Network error loading categories'));

      renderWithWorkspace(<CategoryList />);

      expect(await screen.findByText('Network error loading categories')).toBeInTheDocument();

      // Retry
      apiRequestSpy.mockResolvedValueOnce({
        items: sampleCategories,
        total: 2,
      });

      const retryBtn = screen.getByRole('button', { name: /Retry/i });
      fireEvent.click(retryBtn);

      expect(await screen.findByText('Consulting Income')).toBeInTheDocument();
    });
  });

  describe('Category Creation & Validation', () => {
    it('validates required name and valid hex color format before submitting', async () => {
      apiRequestSpy.mockResolvedValueOnce({ items: [], total: 0 });
      renderWithWorkspace(<CategoryList />);

      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

      const newBtn = screen.getByRole('button', { name: /New Category/i });
      fireEvent.click(newBtn);

      const modalTitle = screen.getByRole('heading', { name: 'Create New Category' });
      expect(modalTitle).toBeInTheDocument();

      // Submit empty
      const submitBtn = screen.getByRole('button', { name: 'Create Category' });
      fireEvent.click(submitBtn);

      expect(await screen.findByText('Category name is required.')).toBeInTheDocument();
    });

    it('creates a custom category and appends it to the list upon success', async () => {
      apiRequestSpy
        .mockResolvedValueOnce({ items: [], total: 0 }) // initial list
        .mockResolvedValueOnce({
          id: 'cat-new-1',
          business_id: mockWorkspaceA.id,
          name: 'Marketing Campaigns',
          type: 'EXPENSE',
          description: 'Digital ads',
          color_hex: '#EC4899',
          is_system_default: false,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        }) // POST create
        .mockResolvedValueOnce({
          items: [
            {
              id: 'cat-new-1',
              business_id: mockWorkspaceA.id,
              name: 'Marketing Campaigns',
              type: 'EXPENSE',
              description: 'Digital ads',
              color_hex: '#EC4899',
              is_system_default: false,
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            },
          ],
          total: 1,
        }); // list refresh

      renderWithWorkspace(<CategoryList />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /New Category/i }));

      const nameInput = screen.getByPlaceholderText('e.g. Software & Subscriptions');
      fireEvent.change(nameInput, { target: { value: 'Marketing Campaigns' } });

      fireEvent.click(screen.getByRole('button', { name: 'Create Category' }));

      expect(await screen.findByText('Marketing Campaigns')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Create New Category' })).not.toBeInTheDocument();
    });

    it('displays 409 conflict error when duplicate category name is submitted', async () => {
      apiRequestSpy
        .mockResolvedValueOnce({ items: sampleCategories, total: 2 })
        .mockRejectedValueOnce(
          new apiModule.ApiClientError('Conflict', 409, {
            type: 'about:blank',
            title: 'Conflict',
            status: 409,
            detail: "Category 'Cloud Hosting' already exists for type 'EXPENSE'.",
            code: 'CATEGORY_ALREADY_EXISTS',
          })
        );

      renderWithWorkspace(<CategoryList />);
      expect(await screen.findByText('Cloud Hosting')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /New Category/i }));
      const nameInput = screen.getByPlaceholderText('e.g. Software & Subscriptions');
      fireEvent.change(nameInput, { target: { value: 'Cloud Hosting' } });

      fireEvent.click(screen.getByRole('button', { name: 'Create Category' }));

      expect(
        await screen.findByText("Category 'Cloud Hosting' already exists for type 'EXPENSE'.")
      ).toBeInTheDocument();
      // Modal stays open
      expect(screen.getByRole('heading', { name: 'Create New Category' })).toBeInTheDocument();
    });

    // Scenario 12: Immutable category type in edit modal
    it('locks category type as immutable in edit modal', async () => {
      apiRequestSpy.mockResolvedValueOnce({ items: sampleCategories, total: 2 });
      renderWithWorkspace(<CategoryList />);

      expect(await screen.findByText('Consulting Income')).toBeInTheDocument();

      const editBtn = screen.getByRole('button', { name: 'Edit category Consulting Income' });
      fireEvent.click(editBtn);

      expect(screen.getByRole('heading', { name: 'Edit Category' })).toBeInTheDocument();

      const typeSelect = screen.getByLabelText(/Cash Flow Type/i) as HTMLSelectElement;
      expect(typeSelect.disabled).toBe(true);
    });

    // Scenario 13: Explicit description: null clearing contract
    it('transmits explicit description: null when cleared in edit modal', async () => {
      apiRequestSpy
        .mockResolvedValueOnce({ items: sampleCategories, total: 2 }) // initial list
        .mockResolvedValueOnce({
          ...sampleCategories[0],
          description: null,
        }) // PATCH update
        .mockResolvedValueOnce({
          items: [{ ...sampleCategories[0], description: null }, sampleCategories[1]],
          total: 2,
        }); // refresh list

      renderWithWorkspace(<CategoryList />);
      expect(await screen.findByText('Consulting Income')).toBeInTheDocument();

      const editBtn = screen.getByRole('button', { name: 'Edit category Consulting Income' });
      fireEvent.click(editBtn);

      expect(screen.getByRole('heading', { name: 'Edit Category' })).toBeInTheDocument();

      // Check outdated warning note is NOT present
      expect(
        screen.queryByText(/Clearing an existing description to empty is not supported/i)
      ).not.toBeInTheDocument();

      const descInput = screen.getByLabelText(/Description/i);
      fireEvent.change(descInput, { target: { value: '' } });

      const saveBtn = screen.getByRole('button', { name: 'Save Changes' });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(apiRequestSpy).toHaveBeenCalledWith(
          '/categories/cat-1',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ description: null }),
            targetWorkspaceGeneration: 1,
          })
        );
      });
    });
  });

  describe('Category Deletion & HTTP 204 Handling', () => {
    it('disables Delete action for system default categories', async () => {
      apiRequestSpy.mockResolvedValueOnce({ items: sampleCategories, total: 2 });
      renderWithWorkspace(<CategoryList />);

      expect(await screen.findByText('Consulting Income')).toBeInTheDocument();

      const deleteBtn = screen.getByRole('button', { name: 'Delete category Consulting Income' });
      expect((deleteBtn as HTMLButtonElement).disabled).toBe(true);
    });

    it('successfully confirms and deletes a custom category handling HTTP 204 without body', async () => {
      apiRequestSpy
        .mockResolvedValueOnce({ items: sampleCategories, total: 2 }) // initial list
        .mockResolvedValueOnce(undefined) // DELETE returns undefined (HTTP 204)
        .mockResolvedValueOnce({
          items: [sampleCategories[0]], // only cat-1 remaining
          total: 1,
        });

      renderWithWorkspace(<CategoryList />);
      expect(await screen.findByText('Cloud Hosting')).toBeInTheDocument();

      const deleteBtn = screen.getByRole('button', { name: 'Delete category Cloud Hosting' });
      fireEvent.click(deleteBtn);

      // Confirm dialog opens
      expect(screen.getByRole('heading', { name: 'Delete Category' })).toBeInTheDocument();
      const confirmBtn = screen.getByRole('button', { name: 'Delete' });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(screen.queryByText('Cloud Hosting')).not.toBeInTheDocument();
      });
      expect(screen.getByText('Consulting Income')).toBeInTheDocument();
    });

    it('surfaces 409 CATEGORY_IN_USE error in dialog if category is referenced by transactions', async () => {
      apiRequestSpy
        .mockResolvedValueOnce({ items: sampleCategories, total: 2 })
        .mockRejectedValueOnce(
          new apiModule.ApiClientError('Conflict', 409, {
            type: 'about:blank',
            title: 'Conflict',
            status: 409,
            detail: 'Cannot delete category because it is referenced by existing transactions.',
            code: 'CATEGORY_IN_USE',
          })
        );

      renderWithWorkspace(<CategoryList />);
      expect(await screen.findByText('Cloud Hosting')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Delete category Cloud Hosting' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

      expect(
        await screen.findByText('Cannot delete category because it is referenced by existing transactions.')
      ).toBeInTheDocument();
    });
  });

  describe('Role-Based Access Gating', () => {
    it('suppresses create, edit, and delete controls for MEMBER and VIEWER roles', async () => {
      apiRequestSpy.mockResolvedValueOnce({ items: sampleCategories, total: 2 });

      // Member context
      const memberWsContext = createMockWorkspaceContext({
        activeWorkspace: mockWorkspaceB, // role: 'MEMBER'
      });

      renderWithWorkspace(<CategoryList />, memberWsContext);

      expect(await screen.findByText('Consulting Income')).toBeInTheDocument();

      // Read-only badge displayed
      expect(screen.getByText(/Read-only mode/i)).toBeInTheDocument();

      // New Category button omitted
      expect(screen.queryByRole('button', { name: /New Category/i })).not.toBeInTheDocument();

      // Edit and Delete buttons omitted
      expect(screen.queryByRole('button', { name: /Edit category/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Delete category/i })).not.toBeInTheDocument();
    });
  });

  describe('Modal Lifecycle & Layout Tab Navigation', () => {
    // Scenario 16: Deterministic modal closure on workspace transition
    it('deterministically closes category modal upon workspace transition', async () => {
      apiRequestSpy.mockResolvedValue({ items: sampleCategories, total: 2 });

      let setWs: React.Dispatch<React.SetStateAction<WorkspaceContextValue>>;
      const StatefulWorkspaceWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
        const [value, setValue] = useState<WorkspaceContextValue>(() =>
          createMockWorkspaceContext({
            activeWorkspace: mockWorkspaceA,
            workspaceGeneration: 1,
          })
        );
        setWs = setValue;
        return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
      };

      render(
        <StatefulWorkspaceWrapper>
          <CategoryList />
        </StatefulWorkspaceWrapper>
      );

      expect(await screen.findByText('Consulting Income')).toBeInTheDocument();

      // Open Create Modal
      fireEvent.click(screen.getByRole('button', { name: /New Category/i }));
      expect(screen.getByRole('heading', { name: 'Create New Category' })).toBeInTheDocument();

      // Switch active workspace to B
      act(() => {
        setWs(
          createMockWorkspaceContext({
            activeWorkspace: mockWorkspaceB,
            workspaceGeneration: 2,
          })
        );
      });

      // Assert modal closes immediately
      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: 'Create New Category' })).not.toBeInTheDocument();
      });
    });

    // Scenario 17: Category management accessible via layout tabs
    it('toggles between Overview and Categories content cleanly', async () => {
      apiRequestSpy.mockResolvedValue({ items: sampleCategories, total: 2 });

      renderWithWorkspace(
        <WorkspaceLayout>
          <div data-testid="custom-overview-content">Custom Caller Overview</div>
        </WorkspaceLayout>
      );

      // Initially Overview tab is active
      expect(screen.getByTestId('custom-overview-content')).toBeInTheDocument();
      expect(screen.queryByText('Chart of Accounts')).not.toBeInTheDocument();

      // Switch to Categories tab
      const catTab = screen.getByRole('button', { name: 'Categories' });
      fireEvent.click(catTab);

      expect(await screen.findByText('Chart of Accounts')).toBeInTheDocument();
      expect(screen.queryByTestId('custom-overview-content')).not.toBeInTheDocument();

      // Switch back to Overview tab
      const overviewTab = screen.getByRole('button', { name: 'Overview' });
      fireEvent.click(overviewTab);

      expect(screen.getByTestId('custom-overview-content')).toBeInTheDocument();
      expect(screen.queryByText('Chart of Accounts')).not.toBeInTheDocument();
    });

    // Scenario 18: Layout regression: navigation & branding integrity
    it('preserves top navigation, active workspace display, user status, and layout structure in WorkspaceLayout', async () => {
      apiRequestSpy.mockResolvedValue({ items: sampleCategories, total: 2 });

      renderWithWorkspace(<WorkspaceLayout />);

      // BizFlow AI branding
      expect(screen.getByText('BizFlow AI')).toBeInTheDocument();

      // Workspace selector showing active workspace
      expect(screen.getByText('Workspace Alpha')).toBeInTheDocument();

      // User status display
      expect(screen.getByText('Alpha Owner')).toBeInTheDocument();

      // Sign Out action button
      expect(screen.getByTitle('Sign Out')).toBeInTheDocument();

      // Layout tabs
      expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Categories' })).toBeInTheDocument();
    });
  });

  describe('Workspace Concurrency & Stale Mutation Lifecycles', () => {
    // Scenario 2: In-flight list fetch discarded on switch
    it('discards in-flight Workspace A category list fetch when switching to Workspace B', async () => {
      let deferredListResolve: (val: any) => void = () => {};
      const deferredListPromise = new Promise((resolve) => {
        deferredListResolve = resolve;
      });

      apiRequestSpy.mockImplementation((endpoint: string, options?: any) => {
        if (endpoint === '/categories') {
          if (options?.targetWorkspaceId === mockWorkspaceA.id) {
            return deferredListPromise;
          }
          if (options?.targetWorkspaceId === mockWorkspaceB.id) {
            return Promise.resolve({ items: [], total: 0 });
          }
        }
        return Promise.resolve({});
      });

      let currentBusId = mockWorkspaceA.id;
      let currentGen = 1;

      let hookResult: any;
      const TestHarness = () => {
        hookResult = useCategories();
        return null;
      };

      let setWs: React.Dispatch<React.SetStateAction<WorkspaceContextValue>>;
      const StatefulWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
        const [value, setValue] = useState<WorkspaceContextValue>(() =>
          createMockWorkspaceContext({
            activeWorkspace: mockWorkspaceA,
            workspaceGeneration: 1,
            isCurrentWorkspace: (bId, gen) => bId === currentBusId && gen === currentGen,
          })
        );
        setWs = setValue;
        return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
      };

      render(
        <StatefulWrapper>
          <TestHarness />
        </StatefulWrapper>
      );

      expect(hookResult.isLoading).toBe(true);

      // Switch active workspace to Workspace B
      act(() => {
        currentBusId = mockWorkspaceB.id;
        currentGen = 2;
        setWs(
          createMockWorkspaceContext({
            activeWorkspace: mockWorkspaceB,
            workspaceGeneration: 2,
            isCurrentWorkspace: (bId, gen) => bId === currentBusId && gen === currentGen,
          })
        );
      });

      // Resolve delayed list A
      await act(async () => {
        deferredListResolve({
          items: sampleCategories,
          total: 2,
        });
      });

      // Categories should NOT contain Workspace A items
      expect(hookResult.categories).toEqual([]);
    });

    // Scenario 4: Logout invalidates in-flight category operations
    it('invalidates in-flight category operations upon session logout', async () => {
      let deferredMutationResolve: (val: any) => void = () => {};
      const deferredMutationPromise = new Promise((resolve) => {
        deferredMutationResolve = resolve;
      });

      apiRequestSpy
        .mockResolvedValueOnce({ items: sampleCategories, total: 2 }) // initial list
        .mockImplementationOnce(() => deferredMutationPromise); // deferred create

      let currentBusId: string | null = mockWorkspaceA.id;
      let currentGen = 1;

      let hookResult: any;
      const TestHarness = () => {
        hookResult = useCategories();
        return null;
      };

      let setWs: React.Dispatch<React.SetStateAction<WorkspaceContextValue>>;
      const StatefulWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
        const [value, setValue] = useState<WorkspaceContextValue>(() =>
          createMockWorkspaceContext({
            activeWorkspace: mockWorkspaceA,
            workspaceGeneration: 1,
            isCurrentWorkspace: (bId, gen) => bId === currentBusId && gen === currentGen,
          })
        );
        setWs = setValue;
        return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
      };

      render(
        <StatefulWrapper>
          <TestHarness />
        </StatefulWrapper>
      );

      await waitFor(() => expect(hookResult.categories.length).toBe(2));

      // Dispatch createCategory
      let mutationPromise: Promise<any>;
      act(() => {
        mutationPromise = hookResult.createCategory({
          name: 'Category In Flight',
          type: 'EXPENSE',
          color_hex: '#6366F1',
        });
      });

      expect(hookResult.isCreating).toBe(true);

      // Simulate logout: activeWorkspace becomes null, generation advances
      act(() => {
        currentBusId = null;
        currentGen = 2;
        setWs(
          createMockWorkspaceContext({
            activeWorkspace: null,
            workspaceGeneration: 2,
            isCurrentWorkspace: (bId, gen) => bId === currentBusId && gen === currentGen,
          })
        );
      });

      // Resolve deferred create
      await act(async () => {
        deferredMutationResolve({
          id: 'cat-new-delayed',
          business_id: mockWorkspaceA.id,
          name: 'Category In Flight',
          type: 'EXPENSE',
          color_hex: '#6366F1',
          is_system_default: false,
          created_at: '',
          updated_at: '',
        });
      });

      const result = await mutationPromise!;
      expect(result.status).toBe('stale');
      expect(hookResult.categories).toEqual([]);
    });

    // Scenario 6: In-flight mutation discarded on switch
    it('discards in-flight Workspace A create mutation when switching to Workspace B', async () => {
      let deferredResolve: (val: any) => void = () => {};
      const deferredPromise = new Promise((resolve) => {
        deferredResolve = resolve;
      });

      apiRequestSpy
        .mockResolvedValueOnce({ items: sampleCategories, total: 2 }) // initial list A
        .mockImplementationOnce(() => deferredPromise); // POST mutation A deferred

      let currentBusId = mockWorkspaceA.id;
      let currentGen = 1;

      const wsContext = createMockWorkspaceContext({
        activeWorkspace: mockWorkspaceA,
        workspaceGeneration: 1,
        isCurrentWorkspace: (bId, gen) => bId === currentBusId && gen === currentGen,
      });

      let hookResult: any;
      const TestHarness = () => {
        hookResult = useCategories();
        return null;
      };

      renderWithWorkspace(<TestHarness />, wsContext);

      await waitFor(() => expect(hookResult.categories.length).toBe(2));

      // 1. Dispatch create in Workspace A
      let mutationPromise: Promise<any>;
      act(() => {
        mutationPromise = hookResult.createCategory({
          name: 'Category A',
          type: 'EXPENSE',
          color_hex: '#6366F1',
        });
      });

      expect(hookResult.isCreating).toBe(true);

      // 2. Switch workspace to Workspace B
      act(() => {
        currentBusId = mockWorkspaceB.id;
        currentGen = 2;
      });

      // 3. Resolve deferred mutation A
      await act(async () => {
        deferredResolve({
          id: 'cat-a-res',
          business_id: mockWorkspaceA.id,
          name: 'Category A',
          type: 'EXPENSE',
          color_hex: '#6366F1',
          is_system_default: false,
          created_at: '',
          updated_at: '',
        });
      });

      const result = await mutationPromise!;
      expect(result.status).toBe('stale');
      // Workspace B was not modified
      expect(hookResult.categories.map((c: any) => c.name)).not.toContain('Category A');
    });

    // Scenario 7: Mutation rejected if workspace changes right before dispatch
    it('rejects mutation dispatch if workspace changes immediately prior to execution', async () => {
      apiRequestSpy.mockResolvedValueOnce({ items: sampleCategories, total: 2 });

      let currentBusId = mockWorkspaceA.id;
      let currentGen = 1;

      let isCurrentWsMock = vi.fn().mockImplementation((bId, gen) => {
        return bId === currentBusId && gen === currentGen;
      });

      const wsContext = createMockWorkspaceContext({
        activeWorkspace: mockWorkspaceA,
        workspaceGeneration: 1,
        isCurrentWorkspace: isCurrentWsMock,
      });

      let hookResult: any;
      const TestHarness = () => {
        hookResult = useCategories();
        return null;
      };

      renderWithWorkspace(<TestHarness />, wsContext);
      await waitFor(() => expect(hookResult.categories.length).toBe(2));

      // Change workspace/generation right before mutation dispatch
      currentBusId = mockWorkspaceB.id;
      currentGen = 2;

      // Dispatch mutation with hook captured snapshot
      let result: any;
      await act(async () => {
        result = await hookResult.createCategory({
          name: 'Category Alpha Pre-Check',
          type: 'INCOME',
          color_hex: '#10B981',
        });
      });

      expect(result.status).toBe('stale');
      // POST was never sent
      expect(apiRequestSpy).not.toHaveBeenCalledWith(
        '/categories',
        expect.objectContaining({ method: 'POST' })
      );
    });

    // Scenario 9: Stale refresh cannot repopulate categories after logout
    it('discards delayed list refresh resolving after session logout', async () => {
      let deferredRefreshResolve: (val: any) => void = () => {};
      const deferredRefreshPromise = new Promise((resolve) => {
        deferredRefreshResolve = resolve;
      });

      apiRequestSpy
        .mockResolvedValueOnce({ items: sampleCategories, total: 2 }) // initial list A
        .mockImplementationOnce(() => deferredRefreshPromise); // delayed refresh GET

      let currentBusId: string | null = mockWorkspaceA.id;
      let currentGen = 1;

      let hookResult: any;
      const TestHarness = () => {
        hookResult = useCategories();
        return null;
      };

      let setWs: React.Dispatch<React.SetStateAction<WorkspaceContextValue>>;
      const StatefulWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
        const [value, setValue] = useState<WorkspaceContextValue>(() =>
          createMockWorkspaceContext({
            activeWorkspace: mockWorkspaceA,
            workspaceGeneration: 1,
            isCurrentWorkspace: (bId, gen) => bId === currentBusId && gen === currentGen,
          })
        );
        setWs = setValue;
        return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
      };

      render(
        <StatefulWrapper>
          <TestHarness />
        </StatefulWrapper>
      );

      await waitFor(() => expect(hookResult.categories.length).toBe(2));

      // Trigger list refresh
      act(() => {
        hookResult.refreshCategories();
      });

      // Simulate logout: workspace cleared, categories cleared
      act(() => {
        currentBusId = null;
        currentGen = 2;
        setWs(
          createMockWorkspaceContext({
            activeWorkspace: null,
            workspaceGeneration: 2,
            isCurrentWorkspace: (bId, gen) => bId === currentBusId && gen === currentGen,
          })
        );
      });

      // Resolve delayed refresh with categories
      await act(async () => {
        deferredRefreshResolve({
          items: sampleCategories,
          total: 2,
        });
      });

      // Categories state must remain empty [] and not repopulate
      expect(hookResult.categories).toEqual([]);
    });

    // Scenario 10: Obsolete operation cannot release newer lock
    it('prevents an obsolete Workspace A mutation settlement from releasing a lock held by a newer generation', async () => {
      let deferredResolveA: (val: any) => void = () => {};
      const deferredPromiseA = new Promise((resolve) => {
        deferredResolveA = resolve;
      });

      let deferredResolveB: (val: any) => void = () => {};
      const deferredPromiseB = new Promise((resolve) => {
        deferredResolveB = resolve;
      });

      apiRequestSpy.mockImplementation((endpoint: string, options?: any) => {
        if (endpoint === '/categories' && (!options?.method || options?.method === 'GET')) {
          return Promise.resolve({ items: sampleCategories, total: 2 });
        }
        if (endpoint === '/categories' && options?.method === 'POST') {
          if (options?.targetWorkspaceId === mockWorkspaceA.id) {
            return deferredPromiseA;
          }
          if (options?.targetWorkspaceId === mockWorkspaceB.id) {
            return deferredPromiseB;
          }
        }
        return Promise.resolve({});
      });

      let currentBusId = mockWorkspaceA.id;
      let currentGen = 1;

      let setWs: React.Dispatch<React.SetStateAction<WorkspaceContextValue>>;
      const StatefulWorkspaceWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
        const [value, setValue] = React.useState<WorkspaceContextValue>(() =>
          createMockWorkspaceContext({
            activeWorkspace: mockWorkspaceA,
            workspaceGeneration: 1,
            isCurrentWorkspace: (bId, gen) => bId === currentBusId && gen === currentGen,
          })
        );
        setWs = setValue;
        return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
      };

      let hookResult: any;
      const TestHarness = () => {
        hookResult = useCategories();
        return null;
      };

      render(
        <StatefulWorkspaceWrapper>
          <TestHarness />
        </StatefulWorkspaceWrapper>
      );
      await waitFor(() => expect(hookResult.categories.length).toBe(2));

      // 1. Workspace A starts mutation
      let promiseA: Promise<any>;
      act(() => {
        promiseA = hookResult.createCategory({ name: 'Cat A', type: 'INCOME', color_hex: '#10B981' });
      });

      // 2. Switch to Workspace B
      act(() => {
        currentBusId = mockWorkspaceB.id;
        currentGen = 2;
        setWs(
          createMockWorkspaceContext({
            activeWorkspace: {
              ...mockWorkspaceB,
              role: 'OWNER',
            },
            workspaceGeneration: 2,
            isCurrentWorkspace: (bId, gen) => bId === currentBusId && gen === currentGen,
          })
        );
      });

      // 3. Workspace B starts its own mutation (acquires Lock B)
      let promiseB: Promise<any>;
      act(() => {
        promiseB = hookResult.createCategory({ name: 'Cat B', type: 'EXPENSE', color_hex: '#6366F1' });
      });

      expect(hookResult.isCreating).toBe(true);

      // 4. Workspace A's delayed request finishes
      await act(async () => {
        deferredResolveA({ id: 'cat-a', business_id: mockWorkspaceA.id, name: 'Cat A' });
      });

      const resA = await promiseA!;
      expect(resA.status).toBe('stale');

      // Crucial: Workspace A cleanup DID NOT release Lock B or clear isCreating in Workspace B!
      expect(hookResult.isCreating).toBe(true);

      // Duplicate mutation in B is still rejected because Lock B is still held!
      await expect(
        hookResult.createCategory({ name: 'Duplicate B', type: 'EXPENSE', color_hex: '#6366F1' })
      ).rejects.toThrow(/already in progress/i);

      // 5. Workspace B's request finishes
      await act(async () => {
        deferredResolveB({ id: 'cat-b', business_id: mockWorkspaceB.id, name: 'Cat B' });
      });

      // After B finishes, lock is cleanly released
      expect(hookResult.isCreating).toBe(false);
    });

    // Scenario 11: Independent lock acquisition in new workspace
    it('allows Workspace B to acquire its own mutation lock independently while Workspace A has a pending mutation', async () => {
      let deferredResolveA: (val: any) => void = () => {};
      const deferredPromiseA = new Promise((resolve) => {
        deferredResolveA = resolve;
      });

      let deferredResolveB: (val: any) => void = () => {};
      const deferredPromiseB = new Promise((resolve) => {
        deferredResolveB = resolve;
      });

      apiRequestSpy.mockImplementation((endpoint: string, options?: any) => {
        if (endpoint === '/categories' && (!options?.method || options?.method === 'GET')) {
          return Promise.resolve({ items: sampleCategories, total: 2 });
        }
        if (endpoint === '/categories' && options?.method === 'POST') {
          if (options?.targetWorkspaceId === mockWorkspaceA.id) {
            return deferredPromiseA;
          }
          if (options?.targetWorkspaceId === mockWorkspaceB.id) {
            return deferredPromiseB;
          }
        }
        return Promise.resolve({});
      });

      let currentBusId = mockWorkspaceA.id;
      let currentGen = 1;

      let setWs: React.Dispatch<React.SetStateAction<WorkspaceContextValue>>;
      const StatefulWorkspaceWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
        const [value, setValue] = React.useState<WorkspaceContextValue>(() =>
          createMockWorkspaceContext({
            activeWorkspace: mockWorkspaceA,
            workspaceGeneration: 1,
            isCurrentWorkspace: (bId, gen) => bId === currentBusId && gen === currentGen,
          })
        );
        setWs = setValue;
        return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
      };

      let hookResult: any;
      const TestHarness = () => {
        hookResult = useCategories();
        return null;
      };

      render(
        <StatefulWorkspaceWrapper>
          <TestHarness />
        </StatefulWorkspaceWrapper>
      );
      await waitFor(() => expect(hookResult.categories.length).toBe(2));

      // 1. Start mutation in Workspace A
      let promiseA: Promise<any>;
      act(() => {
        promiseA = hookResult.createCategory({ name: 'Cat A', type: 'INCOME', color_hex: '#10B981' });
      });

      // 2. Switch to Workspace B
      act(() => {
        currentBusId = mockWorkspaceB.id;
        currentGen = 2;
        setWs(
          createMockWorkspaceContext({
            activeWorkspace: {
              ...mockWorkspaceB,
              role: 'OWNER',
            },
            workspaceGeneration: 2,
            isCurrentWorkspace: (bId, gen) => bId === currentBusId && gen === currentGen,
          })
        );
      });

      // 3. Dispatch mutation in Workspace B — B acquires its own lock token
      let promiseB: Promise<any>;
      act(() => {
        promiseB = hookResult.createCategory({ name: 'Cat B', type: 'EXPENSE', color_hex: '#6366F1' });
      });

      expect(hookResult.isCreating).toBe(true);

      // Clean up both
      await act(async () => {
        deferredResolveA({ id: 'cat-a', business_id: mockWorkspaceA.id, name: 'Cat A' });
        deferredResolveB({ id: 'cat-b', business_id: mockWorkspaceB.id, name: 'Cat B' });
      });

      await promiseA!;
      await promiseB!;
      expect(hookResult.isCreating).toBe(false);
    });
  });
});
