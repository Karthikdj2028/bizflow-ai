import React, { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from './WorkspaceContext';
import { WorkspaceSelector } from './WorkspaceSelector';
import { CategoryList } from '../categories/CategoryList';
import { LogOut, User as UserIcon, ShieldAlert } from 'lucide-react';
import { clsx } from 'clsx';

export const WorkspaceLayout: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth();
  const { activeWorkspace, error: workspaceError } = useWorkspace();
  const [activeTab, setActiveTab] = useState<'overview' | 'categories'>('overview');

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
          <nav className="flex space-x-8" aria-label="Workspace views">
            <button
              type="button"
              id="tab-overview"
              onClick={() => setActiveTab('overview')}
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
              id="tab-categories"
              onClick={() => setActiveTab('categories')}
              className={clsx(
                activeTab === 'categories'
                  ? 'border-indigo-600 text-indigo-600 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
                'py-3 px-1 border-b-2 text-sm font-medium transition'
              )}
            >
              Categories
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
        {activeTab === 'categories' ? (
          <CategoryList />
        ) : (
          children || (
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
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h3 className="text-base font-semibold text-slate-800">Phase 1 Integration Ready</h3>
                <p className="text-sm text-slate-600 mt-2">
                  Multi-tenant workspace context and role-based authorization are active.
                  Financial ledgers and invoicing workflows will activate in Phase 2.
                </p>
              </div>
            </div>
          )
        )}
      </main>
    </div>
  );
};
