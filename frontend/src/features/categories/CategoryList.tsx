import React, { useState, useEffect } from 'react';
import { useCategories } from './useCategories';
import { useWorkspace } from '../workspaces/WorkspaceContext';
import { CategoryCard } from './CategoryCard';
import { CategoryModal } from './CategoryModal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button } from '../../components/Button';
import { CategoryResponse, CategoryCreateRequest, CategoryUpdateRequest } from '../../types/api';
import { ApiClientError } from '../../lib/api';
import { Plus, Tag, RefreshCw, AlertTriangle } from 'lucide-react';

export const CategoryList: React.FC = () => {
  const {
    categories,
    filteredCategories,
    typeFilter,
    setTypeFilter,
    isLoading,
    error,
    refreshCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    isCreating,
    isUpdating,
    isDeleting,
    isMutating,
    canManage,
  } = useCategories();
  const { activeWorkspace, workspaceGeneration } = useWorkspace();

  // Modal & Dialog state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [categoryToEdit, setCategoryToEdit] = useState<CategoryResponse | null>(null);
  const [categoryToDelete, setCategoryToDelete] = useState<CategoryResponse | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Deterministically close all open dialogs upon workspace transition
  useEffect(() => {
    setIsCreateOpen(false);
    setCategoryToEdit(null);
    setCategoryToDelete(null);
    setDeleteError(null);
  }, [activeWorkspace?.id, workspaceGeneration]);

  const incomeCount = categories.filter((c) => c.type === 'INCOME').length;
  const expenseCount = categories.filter((c) => c.type === 'EXPENSE').length;

  const handleCreateSubmit = async (data: CategoryCreateRequest | CategoryUpdateRequest) => {
    const result = await createCategory(data as CategoryCreateRequest);
    if (result.status === 'applied') {
      setIsCreateOpen(false);
    }
    return result;
  };

  const handleEditSubmit = async (data: CategoryCreateRequest | CategoryUpdateRequest) => {
    if (!categoryToEdit) {
      throw new Error('No category selected for editing.');
    }
    const result = await updateCategory(categoryToEdit.id, data as CategoryUpdateRequest);
    if (result.status === 'applied') {
      setCategoryToEdit(null);
    }
    return result;
  };

  const handleDeleteConfirm = async () => {
    if (!categoryToDelete) return;
    setDeleteError(null);

    try {
      const result = await deleteCategory(categoryToDelete.id);
      if (result.status === 'applied') {
        setCategoryToDelete(null);
      }
    } catch (err: unknown) {
      const message =
        err instanceof ApiClientError
          ? err.problem?.detail || err.message
          : (err as Error).message || 'Failed to delete category.';
      setDeleteError(message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Chart of Accounts</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage income and expense categories to organize your financial transactions.
          </p>
        </div>

        {canManage && (
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => setIsCreateOpen(true)}
            disabled={isMutating}
            icon={<Plus className="w-4 h-4" />}
          >
            New Category
          </Button>
        )}
      </div>

      {/* Filter Tabs & Counter */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <div className="flex space-x-2">
          <button
            type="button"
            onClick={() => setTypeFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              typeFilter === 'ALL'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            All Categories ({categories.length})
          </button>
          <button
            type="button"
            onClick={() => setTypeFilter('INCOME')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              typeFilter === 'INCOME'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            Income ({incomeCount})
          </button>
          <button
            type="button"
            onClick={() => setTypeFilter('EXPENSE')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              typeFilter === 'EXPENSE'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            Expense ({expenseCount})
          </button>
        </div>

        {!canManage && (
          <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200">
            Read-only mode (Member/Viewer)
          </span>
        )}
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-between">
          <div className="flex items-center space-x-3 text-rose-800 text-sm">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refreshCategories()}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Main Content Area */}
      {isLoading ? (
        <div className="py-16 flex flex-col items-center justify-center text-slate-500 space-y-3">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
          <p className="text-sm font-medium">Loading workspace categories...</p>
        </div>
      ) : filteredCategories.length === 0 ? (
        <div className="py-16 text-center bg-white rounded-2xl border border-dashed border-slate-300 p-8">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
            <Tag className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-800 mb-1">No categories found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mb-5">
            {typeFilter === 'ALL'
              ? 'No categories are currently defined for this workspace.'
              : `No ${typeFilter.toLowerCase()} categories found.`}
          </p>
          {canManage && typeFilter === 'ALL' && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setIsCreateOpen(true)}
              icon={<Plus className="w-4 h-4" />}
            >
              Create Category
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCategories.map((category) => (
            <CategoryCard
              key={category.id}
              category={category}
              onEdit={(cat) => setCategoryToEdit(cat)}
              onDelete={(cat) => {
                setDeleteError(null);
                setCategoryToDelete(cat);
              }}
              canManage={canManage}
              isMutating={isMutating}
            />
          ))}
        </div>
      )}

      {/* Create Modal */}
      {isCreateOpen && (
        <CategoryModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onSave={handleCreateSubmit}
          isLoading={isCreating}
        />
      )}

      {/* Edit Modal */}
      {categoryToEdit && (
        <CategoryModal
          isOpen={!!categoryToEdit}
          category={categoryToEdit}
          onClose={() => setCategoryToEdit(null)}
          onSave={handleEditSubmit}
          isLoading={isUpdating}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {categoryToDelete && (
        <ConfirmDialog
          isOpen={!!categoryToDelete}
          onClose={() => {
            if (!isDeleting) {
              setCategoryToDelete(null);
              setDeleteError(null);
            }
          }}
          onConfirm={handleDeleteConfirm}
          title="Delete Category"
          message={
            deleteError
              ? deleteError
              : `Are you sure you want to delete "${categoryToDelete.name}"? This action cannot be undone.`
          }
          confirmText="Delete"
          cancelText="Cancel"
          variant="danger"
          isLoading={isDeleting}
        />
      )}
    </div>
  );
};
