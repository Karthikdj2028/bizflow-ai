import React, { useState, useEffect } from 'react';
import { CategoryCreateRequest, CategoryResponse, CategoryUpdateRequest } from '../../types/api';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { Button } from '../../components/Button';
import { MutationResult } from './useCategories';
import { ApiClientError } from '../../lib/api';
import { AlertCircle } from 'lucide-react';

export interface CategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  category?: CategoryResponse | null;
  onSave: (
    data: CategoryCreateRequest | CategoryUpdateRequest
  ) => Promise<MutationResult<CategoryResponse>>;
  isLoading: boolean;
}

const PRESET_COLORS = [
  { hex: '#10B981', label: 'Emerald' },
  { hex: '#059669', label: 'Green' },
  { hex: '#34D399', label: 'Mint' },
  { hex: '#6366F1', label: 'Indigo' },
  { hex: '#8B5CF6', label: 'Purple' },
  { hex: '#EC4899', label: 'Pink' },
  { hex: '#F59E0B', label: 'Amber' },
  { hex: '#64748B', label: 'Slate' },
];

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export const CategoryModal: React.FC<CategoryModalProps> = ({
  isOpen,
  onClose,
  category,
  onSave,
  isLoading,
}) => {
  const isEditMode = !!category;

  const [name, setName] = useState('');
  const [type, setType] = useState<'INCOME' | 'EXPENSE'>('EXPENSE');
  const [description, setDescription] = useState('');
  const [colorHex, setColorHex] = useState('#6366F1');

  const [nameError, setNameError] = useState<string | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Sync state when category changes or modal opens
  useEffect(() => {
    if (category) {
      setName(category.name);
      setType(category.type);
      setDescription(category.description || '');
      setColorHex(category.color_hex);
    } else {
      setName('');
      setType('EXPENSE');
      setDescription('');
      setColorHex('#6366F1');
    }
    setNameError(null);
    setColorError(null);
    setSubmitError(null);
  }, [category, isOpen]);

  const validate = (): boolean => {
    let isValid = true;

    // Validate Name
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError('Category name is required.');
      isValid = false;
    } else if (trimmedName.length > 100) {
      setNameError('Category name cannot exceed 100 characters.');
      isValid = false;
    } else {
      setNameError(null);
    }

    // Validate Color Hex
    const trimmedColor = colorHex.trim().toUpperCase();
    if (!HEX_COLOR_REGEX.test(trimmedColor)) {
      setColorError('Color must be a valid 7-character hex code (e.g. #6366F1).');
      isValid = false;
    } else {
      setColorError(null);
    }

    return isValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || isLoading) return;

    setSubmitError(null);

    const trimmedName = name.trim();
    const trimmedColor = colorHex.trim().toUpperCase();
    const trimmedDesc = description.trim();

    try {
      let result: MutationResult<CategoryResponse>;

      if (isEditMode) {
        const updatePayload: CategoryUpdateRequest = {};

        if (trimmedName !== category.name) {
          updatePayload.name = trimmedName;
        }
        if (trimmedColor !== category.color_hex) {
          updatePayload.color_hex = trimmedColor;
        }
        if (trimmedDesc !== (category.description || '')) {
          updatePayload.description = trimmedDesc ? trimmedDesc : null;
        }

        result = await onSave(updatePayload);
      } else {
        const createPayload: CategoryCreateRequest = {
          name: trimmedName,
          type,
          color_hex: trimmedColor,
          description: trimmedDesc || undefined,
        };

        result = await onSave(createPayload);
      }

      // ONLY close the modal if the mutation was successfully applied to the current workspace
      if (result.status === 'applied') {
        onClose();
      }
    } catch (err: unknown) {
      const message =
        err instanceof ApiClientError
          ? err.problem?.detail || err.message
          : (err as Error).message || 'Failed to save category.';
      setSubmitError(message);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit Category' : 'Create New Category'}
      description={
        isEditMode
          ? 'Update the chart-of-accounts category details.'
          : 'Add a new category to organize your financial transactions.'
      }
      maxWidth="md"
      isLoading={isLoading}
      preventClose={isLoading}
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {submitError && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 flex items-start space-x-2.5 text-xs text-rose-800">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{submitError}</span>
          </div>
        )}

        {/* Category Name */}
        <Input
          label="Category Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(null);
          }}
          placeholder="e.g. Software & Subscriptions"
          error={nameError || undefined}
          disabled={isLoading}
          required
        />

        {/* Category Type */}
        <div>
          <Select
            label="Cash Flow Type"
            value={type}
            onChange={(e) => setType(e.target.value as 'INCOME' | 'EXPENSE')}
            disabled={isEditMode || isLoading}
            options={[
              { value: 'EXPENSE', label: 'Expense (Money Out)' },
              { value: 'INCOME', label: 'Income (Money In)' },
            ]}
            helperText={
              isEditMode
                ? 'Category type is immutable once created to maintain ledger integrity.'
                : undefined
            }
          />
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor="category-description"
            className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5"
          >
            Description (Optional)
          </label>
          <textarea
            id="category-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isLoading}
            maxLength={255}
            rows={2}
            className="w-full px-3.5 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition disabled:bg-slate-50 disabled:text-slate-400"
            placeholder="Brief explanation of transactions categorized here..."
          />
        </div>

        {/* Color Palette & Custom Hex */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            Color Badge
          </label>
          <div className="space-y-2.5">
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((preset) => (
                <button
                  key={preset.hex}
                  type="button"
                  disabled={isLoading}
                  onClick={() => {
                    setColorHex(preset.hex);
                    setColorError(null);
                  }}
                  className={`w-7 h-7 rounded-full border-2 transition transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500 ${
                    colorHex.toUpperCase() === preset.hex.toUpperCase()
                      ? 'border-slate-900 shadow-md scale-105'
                      : 'border-transparent shadow-sm'
                  }`}
                  style={{ backgroundColor: preset.hex }}
                  title={preset.label}
                  aria-label={`Select color ${preset.label}`}
                />
              ))}
            </div>

            <div className="flex items-center space-x-3">
              <div
                className="w-9 h-9 rounded-lg border border-slate-200 shrink-0 shadow-sm"
                style={{ backgroundColor: HEX_COLOR_REGEX.test(colorHex) ? colorHex : '#E2E8F0' }}
              />
              <Input
                value={colorHex}
                onChange={(e) => {
                  setColorHex(e.target.value);
                  if (colorError) setColorError(null);
                }}
                placeholder="#6366F1"
                error={colorError || undefined}
                disabled={isLoading}
                className="font-mono uppercase"
              />
            </div>
          </div>
        </div>

        {/* Actions */}
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
            isLoading={isLoading}
          >
            {isEditMode ? 'Save Changes' : 'Create Category'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
