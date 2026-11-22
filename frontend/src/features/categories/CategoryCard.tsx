import React from 'react';
import { CategoryResponse } from '../../types/api';
import { Button } from '../../components/Button';
import { Lock, Edit2, Trash2 } from 'lucide-react';

export interface CategoryCardProps {
  category: CategoryResponse;
  onEdit?: (category: CategoryResponse) => void;
  onDelete?: (category: CategoryResponse) => void;
  canManage: boolean;
  isMutating?: boolean;
}

export const CategoryCard: React.FC<CategoryCardProps> = ({
  category,
  onEdit,
  onDelete,
  canManage,
  isMutating = false,
}) => {
  const isIncome = category.type === 'INCOME';

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow transition flex flex-col justify-between">
      <div>
        <div className="flex items-start justify-between gap-3 mb-2.5">
          <div className="flex items-center space-x-2.5 min-w-0">
            {/* Color Swatch */}
            <span
              className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm border border-black/10"
              style={{ backgroundColor: category.color_hex }}
              aria-hidden="true"
            />
            <h4 className="text-sm font-bold text-slate-900 truncate" title={category.name}>
              {category.name}
            </h4>
          </div>

          <div className="flex items-center space-x-1.5 shrink-0">
            {/* Cash Flow Type Badge */}
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${
                isIncome
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
              }`}
            >
              {category.type}
            </span>

            {/* System Default Badge */}
            {category.is_system_default && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200"
                title="System default category (protected from deletion)"
              >
                <Lock className="w-2.5 h-2.5 mr-1" />
                Default
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-slate-500 line-clamp-2 min-h-[2rem]">
          {category.description || 'No description provided.'}
        </p>
      </div>

      {/* Action Footer (Role-gated) */}
      {canManage && (
        <div className="flex items-center justify-end space-x-2 pt-3 mt-3 border-t border-slate-100">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onEdit?.(category)}
            disabled={isMutating}
            icon={<Edit2 className="w-3.5 h-3.5" />}
            aria-label={`Edit category ${category.name}`}
          >
            Edit
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onDelete?.(category)}
            disabled={category.is_system_default || isMutating}
            className={
              category.is_system_default
                ? 'opacity-40 cursor-not-allowed text-slate-400'
                : 'text-rose-600 hover:text-rose-700 hover:bg-rose-50'
            }
            icon={<Trash2 className="w-3.5 h-3.5" />}
            title={
              category.is_system_default
                ? 'System default categories cannot be deleted'
                : `Delete category ${category.name}`
            }
            aria-label={`Delete category ${category.name}`}
          >
            Delete
          </Button>
        </div>
      )}
    </div>
  );
};
