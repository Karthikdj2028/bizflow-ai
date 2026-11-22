import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomerManagement } from '../../src/features/customers/CustomerManagement';
import { CustomerModal } from '../../src/features/customers/CustomerModal';
import {
  WorkspaceContext,
  WorkspaceContextValue,
} from '../../src/features/workspaces/WorkspaceContext';
import {
  CustomerCreateRequest,
  CustomerListResponse,
  CustomerResponse,
  CustomerUpdateRequest,
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
    name: 'Beta Global Industries',
    email: 'finance@betaglobal.com',
    phone: '+1 555-0200',
    billing_address: '200 Beta Blvd, Gotham',
    payment_terms_days: 0,
    is_active: true,
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  },
  {
    id: 'cust-3',
    business_id: 'ws-a-1111-1111',
    name: 'Stark Logistics',
    email: null,
    phone: null,
    billing_address: null,
    payment_terms_days: 15,
    is_active: false,
    created_at: '2026-01-03T00:00:00Z',
    updated_at: '2026-01-03T00:00:00Z',
  },
];

describe('Customer Management Component & Hook Tests', () => {
  let apiRequestSpy: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    apiRequestSpy = vi.spyOn(apiModule, 'apiRequest').mockImplementation((endpoint: string, options: any) => {
      if (endpoint.startsWith('/customers')) {
        return Promise.resolve({
          items: mockCustomers,
          total: mockCustomers.length,
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
  });

  const renderWithWorkspace = (
    ui: React.ReactElement,
    workspaceOverrides: Partial<WorkspaceContextValue> = {}
  ) => {
    const currentBusinessId = workspaceOverrides.activeWorkspace?.id ?? mockWorkspaceA.id;
    const currentGen = workspaceOverrides.workspaceGeneration ?? 1;

    const value: WorkspaceContextValue = {
      workspaces: [mockWorkspaceA],
      activeWorkspace: mockWorkspaceA,
      workspaceGeneration: currentGen,
      isLoading: false,
      error: null,
      switchWorkspace: vi.fn(),
      refreshWorkspaces: vi.fn(),
      isCurrentWorkspace: (bizId, gen) =>
        bizId === currentBusinessId && gen === currentGen,
      ...workspaceOverrides,
    };

    return render(
      <WorkspaceContext.Provider value={value}>
        {ui}
      </WorkspaceContext.Provider>
    );
  };

  it('Scenario 1: Renders customer directory list with terms and active status', async () => {
    renderWithWorkspace(<CustomerManagement />);

    await waitFor(() => {
      expect(screen.getByText('Customer Directory')).toBeInTheDocument();
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
      expect(screen.getByText('Beta Global Industries')).toBeInTheDocument();
      expect(screen.getByText('Stark Logistics')).toBeInTheDocument();
    });

    // Verify badges and terms
    expect(screen.getByText('Net 30')).toBeInTheDocument();
    expect(screen.getByText('Due on Receipt')).toBeInTheDocument();
    expect(screen.getByText('Net 15')).toBeInTheDocument();

    // Verify contact info
    expect(screen.getByText('billing@acme.com')).toBeInTheDocument();
    expect(screen.getByText('+1 555-0100')).toBeInTheDocument();
    expect(screen.getByText('100 Acme Way, Metropolis')).toBeInTheDocument();
  });

  it('Scenario 2: Status filtering triggers appropriate API requests', async () => {
    renderWithWorkspace(<CustomerManagement />);

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    // Click 'Active' filter pill
    const activePill = screen.getByRole('button', { name: /^active$/i });
    fireEvent.click(activePill);

    await waitFor(() => {
      expect(apiRequestSpy).toHaveBeenCalledWith(
        expect.stringContaining('is_active=true'),
        expect.anything()
      );
    });

    // Click 'Inactive' filter pill
    const inactivePill = screen.getByRole('button', { name: /^inactive$/i });
    fireEvent.click(inactivePill);

    await waitFor(() => {
      expect(apiRequestSpy).toHaveBeenCalledWith(
        expect.stringContaining('is_active=false'),
        expect.anything()
      );
    });
  });

  it('Scenario 3: Substring search triggers search query in API request', async () => {
    renderWithWorkspace(<CustomerManagement />);

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search by name, email, or phone/i);
    fireEvent.change(searchInput, { target: { value: 'Acme' } });

    await waitFor(() => {
      expect(apiRequestSpy).toHaveBeenCalledWith(
        expect.stringContaining('search=Acme'),
        expect.anything()
      );
    });
  });

  it('Scenario 4: Role-based permissions gate Create, Edit, and Deactivate buttons', async () => {
    // 1. As VIEWER: cannot create, edit, or deactivate
    const { unmount } = renderWithWorkspace(<CustomerManagement />, {
      activeWorkspace: { ...mockWorkspaceA, role: 'VIEWER' as const },
    });

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /new customer/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/edit acme corporation/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/deactivate acme corporation/i)).not.toBeInTheDocument();

    unmount();

    // 2. As MEMBER: can create and edit, but CANNOT deactivate
    renderWithWorkspace(<CustomerManagement />, {
      activeWorkspace: { ...mockWorkspaceA, role: 'MEMBER' as const },
    });

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /new customer/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/edit acme corporation/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/deactivate acme corporation/i)).not.toBeInTheDocument();
  });

  it('Scenario 5: Customer creation modal validates input and submits payload', async () => {
    renderWithWorkspace(<CustomerManagement />);

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    // Open create modal
    fireEvent.click(screen.getByRole('button', { name: /new customer/i }));

    expect(screen.getByRole('heading', { name: /add new customer/i })).toBeInTheDocument();

    // Attempt submitting without name -> validation error
    const submitBtn = screen.getByRole('button', { name: /create customer/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Customer name is required.')).toBeInTheDocument();
    });

    // Fill valid fields
    fireEvent.change(screen.getByLabelText(/customer \/ client name \*/i), {
      target: { value: 'Wayne Enterprises' },
    });
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'bruce@waynecorp.com' },
    });
    fireEvent.change(screen.getByLabelText(/payment terms/i), {
      target: { value: '45' },
    });

    // Mock API POST
    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      if (options?.method === 'POST') {
        const body = JSON.parse(options.body);
        expect(body.name).toBe('Wayne Enterprises');
        expect(body.email).toBe('bruce@waynecorp.com');
        expect(body.payment_terms_days).toBe(45);
        expect(body.phone).toBeNull();
        expect(body.billing_address).toBeNull();
        return Promise.resolve({
          id: 'cust-new',
          business_id: 'ws-a-1111-1111',
          ...body,
          is_active: true,
          created_at: '2026-11-22T00:00:00Z',
          updated_at: '2026-11-22T00:00:00Z',
        });
      }
      return Promise.resolve({
        items: mockCustomers,
        total: mockCustomers.length,
        page: 1,
        page_size: 20,
        total_pages: 1,
      });
    });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      // Modal should close on successful submission
      expect(screen.queryByRole('heading', { name: /add new customer/i })).not.toBeInTheDocument();
    });
  });

  it('Scenario 6: Customer edit modal allows updating and properly clears nullable fields with null', async () => {
    renderWithWorkspace(<CustomerManagement />);

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    // Click edit on Acme Corporation
    fireEvent.click(screen.getByLabelText(/edit acme corporation/i));

    expect(screen.getByRole('heading', { name: /edit customer/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Acme Corporation')).toBeInTheDocument();
    expect(screen.getByDisplayValue('billing@acme.com')).toBeInTheDocument();

    // Clear email and phone to test explicit null clearing
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: '' } });

    let sentPayload: any = null;
    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      if (options?.method === 'PATCH') {
        sentPayload = JSON.parse(options.body);
        return Promise.resolve({
          ...mockCustomers[0],
          ...sentPayload,
          updated_at: '2026-11-22T10:00:00Z',
        });
      }
      return Promise.resolve({
        items: mockCustomers,
        total: mockCustomers.length,
        page: 1,
        page_size: 20,
        total_pages: 1,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(sentPayload).not.toBeNull();
    });

    // Verify explicit null sent for cleared optional fields, non-null for required
    expect(sentPayload.name).toBe('Acme Corporation');
    expect(sentPayload.payment_terms_days).toBe(30);
    expect(sentPayload.is_active).toBe(true);
    expect(sentPayload.email).toBeNull();
    expect(sentPayload.phone).toBeNull();
    expect(sentPayload.billing_address).toBe('100 Acme Way, Metropolis');
  });

  it('Scenario 7: Deactivating a customer opens ConfirmDialog and soft-deletes via DELETE /customers/:id', async () => {
    renderWithWorkspace(<CustomerManagement />);

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    // Click deactivate on Acme Corporation
    fireEvent.click(screen.getByLabelText(/deactivate acme corporation/i));

    // Confirm dialog appears
    expect(screen.getByRole('heading', { name: /deactivate customer/i })).toBeInTheDocument();
    expect(screen.getByText(/are you sure you want to deactivate "Acme Corporation"/i)).toBeInTheDocument();

    let deleteCalled = false;
    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      if (options?.method === 'DELETE' && endpoint === '/customers/cust-1') {
        deleteCalled = true;
        return Promise.resolve();
      }
      return Promise.resolve({
        items: mockCustomers,
        total: mockCustomers.length,
        page: 1,
        page_size: 20,
        total_pages: 1,
      });
    });

    const confirmBtn = screen.getByRole('button', { name: /^deactivate customer$/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(deleteCalled).toBe(true);
      expect(screen.queryByText(/are you sure you want to deactivate/i)).not.toBeInTheDocument();
    });
  });

  it('Scenario 8: Already inactive customers have deactivate button disabled', async () => {
    renderWithWorkspace(<CustomerManagement />);

    await waitFor(() => {
      expect(screen.getByText('Stark Logistics')).toBeInTheDocument();
    });

    const deactivateStarkBtn = screen.getByLabelText(/deactivate stark logistics/i);
    expect(deactivateStarkBtn).toBeDisabled();
  });

  it('Scenario 9: CustomerModal form-reset protection prevents wiping user inputs on re-render', async () => {
    const handleSubmit = vi.fn().mockResolvedValue({ status: 'applied' });
    const { rerender } = render(
      <CustomerModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={handleSubmit}
        initialData={null}
      />
    );

    // User types in modal
    const nameInput = screen.getByLabelText(/customer \/ client name \*/i);
    fireEvent.change(nameInput, { target: { value: 'In-Progress Customer Name' } });
    expect(screen.getByDisplayValue('In-Progress Customer Name')).toBeInTheDocument();

    // Rerender with identical isOpen=true and initialData=null (e.g. parent hook re-render)
    rerender(
      <CustomerModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={handleSubmit}
        initialData={null}
      />
    );

    // User entered text must NOT be erased
    expect(screen.getByDisplayValue('In-Progress Customer Name')).toBeInTheDocument();
  });

  it('Scenario 10: Switching workspaces dismisses open modals deterministically and isolates data', async () => {
    const mockWorkspaceB = {
      id: 'ws-b-2222-2222',
      name: 'Workspace Beta',
      base_currency: 'EUR',
      role: 'OWNER' as const,
      created_at: '2026-02-01T00:00:00Z',
    };

    let triggerSwitch: (ws: typeof mockWorkspaceB) => void;

    const StatefulWrapper: React.FC = () => {
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
          bizId === snapshotRef.current.id && g === snapshotRef.current.gen,
      };

      return (
        <WorkspaceContext.Provider value={ctx}>
          <CustomerManagement />
        </WorkspaceContext.Provider>
      );
    };

    render(<StatefulWrapper />);

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    // Open create modal
    fireEvent.click(screen.getByRole('button', { name: /new customer/i }));
    expect(screen.getByRole('heading', { name: /add new customer/i })).toBeInTheDocument();

    // Trigger workspace transition to Workspace B
    triggerSwitch!(mockWorkspaceB);

    // Modal must be automatically dismissed upon workspace transition
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /add new customer/i })).not.toBeInTheDocument();
    });
  });

  it('Scenario 11: RFC 9457 API error displays in error banner and retry functions correctly', async () => {
    apiRequestSpy.mockRejectedValueOnce(
      new apiModule.ApiClientError('Customer service temporarily unavailable', 503, {
        type: 'https://errors.bizflow.ai/service-unavailable',
        title: 'Service Unavailable',
        status: 503,
        detail: 'The customer service is temporarily unavailable.',
      })
    );

    renderWithWorkspace(<CustomerManagement />);

    await waitFor(() => {
      expect(screen.getByText(/The customer service is temporarily unavailable/i)).toBeInTheDocument();
    });

    // Click Retry
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    apiRequestSpy.mockResolvedValueOnce({
      items: mockCustomers,
      total: mockCustomers.length,
      page: 1,
      page_size: 20,
      total_pages: 1,
    });

    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });
  });

  it('Scenario 12: ABA Workspace Switch Concurrency: delayed A(Gen 1) response does not overwrite A(Gen 3)', async () => {
    const mockWorkspaceB = {
      id: 'ws-b-2222-2222',
      name: 'Workspace Beta',
      base_currency: 'EUR',
      role: 'OWNER' as const,
      created_at: '2026-02-01T00:00:00Z',
    };

    const customerA_Gen1: CustomerResponse = {
      id: 'cust-a-gen1',
      business_id: mockWorkspaceA.id,
      name: 'Stale A Customer (Gen 1)',
      email: 'gen1@alpha.com',
      phone: null,
      billing_address: null,
      payment_terms_days: 30,
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const customerB_Gen2: CustomerResponse = {
      id: 'cust-b-gen2',
      business_id: mockWorkspaceB.id,
      name: 'Unique B Customer (Gen 2)',
      email: 'b@beta.com',
      phone: null,
      billing_address: null,
      payment_terms_days: 15,
      is_active: true,
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };

    const customerA_Gen3: CustomerResponse = {
      id: 'cust-a-gen3',
      business_id: mockWorkspaceA.id,
      name: 'Fresh A Customer (Gen 3)',
      email: 'gen3@alpha.com',
      phone: null,
      billing_address: null,
      payment_terms_days: 45,
      is_active: true,
      created_at: '2026-01-03T00:00:00Z',
      updated_at: '2026-01-03T00:00:00Z',
    };

    let resolveA_Gen1: (val: any) => void;
    const promiseA_Gen1 = new Promise((res) => {
      resolveA_Gen1 = res;
    });

    let resolveB_Gen2: (val: any) => void;
    const promiseB_Gen2 = new Promise((res) => {
      resolveB_Gen2 = res;
    });

    let resolveA_Gen3: (val: any) => void;
    const promiseA_Gen3 = new Promise((res) => {
      resolveA_Gen3 = res;
    });

    const recordedRequests: Array<{
      endpoint: string;
      targetWorkspaceId?: string;
      targetWorkspaceGeneration?: number;
    }> = [];

    apiRequestSpy.mockImplementation((endpoint: string, options: any) => {
      const bizId = options?.targetWorkspaceId;
      const gen = options?.targetWorkspaceGeneration;

      recordedRequests.push({
        endpoint,
        targetWorkspaceId: bizId,
        targetWorkspaceGeneration: gen,
      });

      if (endpoint.startsWith('/customers')) {
        if (bizId === mockWorkspaceA.id && gen === 1) {
          return promiseA_Gen1;
        }
        if (bizId === mockWorkspaceB.id && gen === 2) {
          return promiseB_Gen2;
        }
        if (bizId === mockWorkspaceA.id && gen === 3) {
          return promiseA_Gen3;
        }
      }
      return Promise.resolve({ items: [], total: 0, page: 1, page_size: 20, total_pages: 0 });
    });

    let triggerSwitch: (nextWs: typeof mockWorkspaceA, nextGen: number) => void;

    const StatefulWrapper: React.FC = () => {
      const [ws, setWs] = React.useState(mockWorkspaceA);
      const [gen, setGen] = React.useState(1);
      const snapshotRef = React.useRef({ id: mockWorkspaceA.id, gen: 1 });

      triggerSwitch = (nextWs, nextGen) => {
        snapshotRef.current = { id: nextWs.id, gen: nextGen };
        act(() => {
          setWs(nextWs);
          setGen(nextGen);
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
          bizId === snapshotRef.current.id && g === snapshotRef.current.gen,
      };

      return (
        <WorkspaceContext.Provider value={ctx}>
          <CustomerManagement />
        </WorkspaceContext.Provider>
      );
    };

    // 1. Render in Workspace A, Generation 1
    render(<StatefulWrapper />);

    // 2. Customer list request for A (Gen 1) is initiated and deliberately kept unresolved
    expect(recordedRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endpoint: expect.stringContaining('/customers'),
          targetWorkspaceId: mockWorkspaceA.id,
          targetWorkspaceGeneration: 1,
        }),
      ])
    );

    // 3. Switch to Workspace B, Generation 2, and resolve B's request with unique B-only customer
    triggerSwitch!(mockWorkspaceB, 2);

    await act(async () => {
      resolveB_Gen2!({
        items: [customerB_Gen2],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Unique B Customer (Gen 2)')).toBeInTheDocument();
    });

    // 4. Switch back to Workspace A, Generation 3, and resolve new A request with different A-only customer
    triggerSwitch!(mockWorkspaceA, 3);

    await act(async () => {
      resolveA_Gen3!({
        items: [customerA_Gen3],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Fresh A Customer (Gen 3)')).toBeInTheDocument();
    });

    // 5. Finally resolve the original, delayed Workspace A Generation 1 request with old customer
    await act(async () => {
      resolveA_Gen1!({
        items: [customerA_Gen1],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      });
    });

    // 6. Assert that only the Generation 3 Workspace A customer is displayed.
    // Neither the old A response nor B's customer may appear.
    expect(screen.getByText('Fresh A Customer (Gen 3)')).toBeInTheDocument();
    expect(screen.queryByText('Stale A Customer (Gen 1)')).not.toBeInTheDocument();
    expect(screen.queryByText('Unique B Customer (Gen 2)')).not.toBeInTheDocument();

    // Verify all 3 requests recorded targetWorkspaceId and targetWorkspaceGeneration
    expect(recordedRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetWorkspaceId: mockWorkspaceA.id,
          targetWorkspaceGeneration: 1,
        }),
        expect.objectContaining({
          targetWorkspaceId: mockWorkspaceB.id,
          targetWorkspaceGeneration: 2,
        }),
        expect.objectContaining({
          targetWorkspaceId: mockWorkspaceA.id,
          targetWorkspaceGeneration: 3,
        }),
      ])
    );
  });
});
