import React, { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from './WorkspaceContext';
import { WorkspaceSelector } from './WorkspaceSelector';
import { CategoryList } from '../categories/CategoryList';
import { TransactionLedger } from '../transactions/TransactionLedger';
import { CustomerManagement } from '../customers/CustomerManagement';
import { InvoiceManagement } from '../invoices/InvoiceManagement';
import { LogOut, User as UserIcon, ShieldAlert } from 'lucide-react';
import { clsx } from 'clsx';

export type WorkspaceTab = 'overview' | 'transactions' | 'categories' | 'customers' | 'invoices';

export const WorkspaceLayout: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth();
  const { activeWorkspace, error: workspaceError } = useWorkspace();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');

  const TAB_ORDER: WorkspaceTab[] = [
    'overview',
    'transactions',
    'categories',
    'customers',
    'invoices',
  ];

  const handleTabKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    currentTab: WorkspaceTab
  ) => {
    const currentIndex = TAB_ORDER.indexOf(currentTab);
    let targetIndex = -1;

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        targetIndex = (currentIndex + 1) % TAB_ORDER.length;
        break;
      case 'ArrowLeft':
        e.preventDefault();
        targetIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
        break;
      case 'Home':
        e.preventDefault();
        targetIndex = 0;
        break;
      case 'End':
        e.preventDefault();
        targetIndex = TAB_ORDER.length - 1;
        break;
      default:
        return;
    }

    if (targetIndex !== -1) {
      const nextTab = TAB_ORDER[targetIndex];
      setActiveTab(nextTab);
      const nextBtn = document.getElementById(`tab-${nextTab}`);
      nextBtn?.focus();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-black text-lg shadow-sm">
                B
              </div>
              <span className="text-lg font-bold text-slate-900 tracking-tight">BizFlow AI</span>
            </div>

            <div className="h-6 w-px bg-slate-200" />

            <WorkspaceSelector />
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-sm text-slate-700">
              <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 border border-slate-200">
                <UserIcon className="w-4 h-4" />
              </div>
              <span className="font-medium hidden sm:inline">{user?.full_name || user?.email}</span>
            </div>

            <button
              onClick={logout}
              title="Sign Out"
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Sub-Navigation Tabs */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8" role="tablist" aria-label="Workspace views">
            <button
              type="button"
              id="tab-overview"
              role="tab"
              aria-selected={activeTab === 'overview'}
              aria-controls="panel-overview"
              tabIndex={activeTab === 'overview' ? 0 : -1}
              onClick={() => setActiveTab('overview')}
              onKeyDown={(e) => handleTabKeyDown(e, 'overview')}
              className={clsx(
                activeTab === 'overview'
                  ? 'border-indigo-600 text-indigo-600 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
                'py-3 px-1 border-b-2 text-sm font-medium transition'
              )}
            >
              Overview
            </button>
            <button
              type="button"
              id="tab-transactions"
              role="tab"
              aria-selected={activeTab === 'transactions'}
              aria-controls="panel-transactions"
              tabIndex={activeTab === 'transactions' ? 0 : -1}
              onClick={() => setActiveTab('transactions')}
              onKeyDown={(e) => handleTabKeyDown(e, 'transactions')}
              className={clsx(
                activeTab === 'transactions'
                  ? 'border-indigo-600 text-indigo-600 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
                'py-3 px-1 border-b-2 text-sm font-medium transition'
              )}
            >
              Transactions
            </button>
            <button
              type="button"
              id="tab-categories"
              role="tab"
              aria-selected={activeTab === 'categories'}
              aria-controls="panel-categories"
              tabIndex={activeTab === 'categories' ? 0 : -1}
              onClick={() => setActiveTab('categories')}
              onKeyDown={(e) => handleTabKeyDown(e, 'categories')}
              className={clsx(
                activeTab === 'categories'
                  ? 'border-indigo-600 text-indigo-600 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
                'py-3 px-1 border-b-2 text-sm font-medium transition'
              )}
            >
              Categories
            </button>
            <button
              type="button"
              id="tab-customers"
              role="tab"
              aria-selected={activeTab === 'customers'}
              aria-controls="panel-customers"
              tabIndex={activeTab === 'customers' ? 0 : -1}
              onClick={() => setActiveTab('customers')}
              onKeyDown={(e) => handleTabKeyDown(e, 'customers')}
              className={clsx(
                activeTab === 'customers'
                  ? 'border-indigo-600 text-indigo-600 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
                'py-3 px-1 border-b-2 text-sm font-medium transition'
              )}
            >
              Customers
            </button>
            <button
              type="button"
              id="tab-invoices"
              role="tab"
              aria-selected={activeTab === 'invoices'}
              aria-controls="panel-invoices"
              tabIndex={activeTab === 'invoices' ? 0 : -1}
              onClick={() => setActiveTab('invoices')}
              onKeyDown={(e) => handleTabKeyDown(e, 'invoices')}
              className={clsx(
                activeTab === 'invoices'
                  ? 'border-indigo-600 text-indigo-600 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
                'py-3 px-1 border-b-2 text-sm font-medium transition'
              )}
            >
              Invoices
            </button>
          </nav>
        </div>
      </div>

      {/* Workspace Level Alert / Error */}
      {workspaceError && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
          <div className="max-w-7xl mx-auto flex items-center space-x-3 text-sm text-amber-800">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
            <span>{workspaceError}</span>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'transactions' && (
          <div id="panel-transactions" role="tabpanel" aria-labelledby="tab-transactions">
            <TransactionLedger />
          </div>
        )}

        {activeTab === 'categories' && (
          <div id="panel-categories" role="tabpanel" aria-labelledby="tab-categories">
            <CategoryList />
          </div>
        )}

        {activeTab === 'customers' && (
          <div id="panel-customers" role="tabpanel" aria-labelledby="tab-customers">
            <CustomerManagement />
          </div>
        )}

        {activeTab === 'invoices' && (
          <div id="panel-invoices" role="tabpanel" aria-labelledby="tab-invoices">
            <InvoiceManagement />
          </div>
        )}

        {activeTab === 'overview' && (
          <div id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">
            {children || (
              <div className="space-y-6">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                  <h2 className="text-xl font-bold text-slate-900">
                    Welcome to {activeWorkspace?.name || 'BizFlow AI'}
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Workspace Currency:{' '}
                    <span className="font-semibold text-slate-700">
                      {activeWorkspace?.base_currency}
                    </span>{' '}
                    | Role:{' '}
                    <span className="font-semibold text-indigo-600">
                      {activeWorkspace?.role}
                    </span>
                  </p>

                  <div className="flex flex-wrap gap-3 mt-6 pt-6 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setActiveTab('transactions')}
                      className="inline-flex items-center px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition"
                    >
                      Go to Transactions
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('categories')}
                      className="inline-flex items-center px-4 py-2 text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-sm transition"
                    >
                      Manage Categories
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};
