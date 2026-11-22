import React from 'react';
import { clsx } from 'clsx';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  helperText,
  id,
  className,
  disabled,
  ...props
}) => {
  const generatedId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
  const errorId = generatedId ? `${generatedId}-error` : undefined;

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={generatedId}
          className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5"
        >
          {label}
        </label>
      )}
      <input
        id={generatedId}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        className={clsx(
          'w-full px-3.5 py-2 text-sm text-slate-900 bg-white border rounded-lg shadow-sm placeholder:text-slate-400 transition',
          'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500',
          error
            ? 'border-rose-400 text-rose-900 focus:ring-rose-500 focus:border-rose-500'
            : 'border-slate-300 hover:border-slate-400',
          disabled && 'bg-slate-50 text-slate-400 cursor-not-allowed',
          className
        )}
        {...props}
      />
      {error && (
        <p id={errorId} className="mt-1 text-xs text-rose-600 font-medium">
          {error}
        </p>
      )}
      {helperText && !error && (
        <p className="mt-1 text-xs text-slate-500">
          {helperText}
        </p>
      )}
    </div>
  );
};
