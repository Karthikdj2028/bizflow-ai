import React from 'react';
import { FinancialSummaryResponse } from '../../types/api';
import { safeFormatCurrencyAmount } from '../../lib/formatters';
import { TrendingUp, TrendingDown, ArrowRightLeft, DollarSign } from 'lucide-react';
import { clsx } from 'clsx';

export interface TransactionSummaryCardProps {
  summary: FinancialSummaryResponse | null;
  currency: string;
  isLoading?: boolean;
}

export const TransactionSummaryCard: React.FC<TransactionSummaryCardProps> = ({
  summary,
  currency,
  isLoading = false,
}) => {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="h-4 w-24 bg-slate-200 rounded mb-3" />
            <div className="h-7 w-32 bg-slate-200 rounded mb-1" />
            <div className="h-3 w-20 bg-slate-100 rounded" />
          </div>
        ))}
      </div>
    );
  }

  const totalIncomeStr = summary?.total_income || '0.00';
  const totalExpensesStr = summary?.total_expenses || '0.00';
  const netCashFlowStr = summary?.net_cash_flow || '0.00';
  const cumulativeStr = summary?.cumulative_net_movement || '0.00';

  const isNetPositive = !netCashFlowStr.startsWith('-');
  const isCumulativePositive = !cumulativeStr.startsWith('-');

  // Absolute representation for currency formatting (strip negative prefix before formatting)
  const cleanNetAbs = netCashFlowStr.startsWith('-') ? netCashFlowStr.slice(1) : netCashFlowStr;
  const cleanCumAbs = cumulativeStr.startsWith('-') ? cumulativeStr.slice(1) : cumulativeStr;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Total Income */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-start justify-between">
        <div>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Period Income
          </span>
          <div className="mt-1.5 text-xl sm:text-2xl font-bold text-emerald-600 tracking-tight">
            {`+${safeFormatCurrencyAmount(totalIncomeStr, currency)}`}
          </div>
          <span className="text-xs text-slate-400 mt-1 block">
            {summary?.income_by_category?.length || 0} active categories
          </span>
        </div>
        <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-600 shrink-0">
          <TrendingUp className="w-5 h-5" />
        </div>
      </div>

      {/* Total Expenses */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-start justify-between">
        <div>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Period Expenses
          </span>
          <div className="mt-1.5 text-xl sm:text-2xl font-bold text-rose-600 tracking-tight">
            {`-${safeFormatCurrencyAmount(totalExpensesStr, currency)}`}
          </div>
          <span className="text-xs text-slate-400 mt-1 block">
            {summary?.expenses_by_category?.length || 0} active categories
          </span>
        </div>
        <div className="p-2.5 rounded-lg bg-rose-50 text-rose-600 shrink-0">
          <TrendingDown className="w-5 h-5" />
        </div>
      </div>

      {/* Net Cash Flow */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-start justify-between">
        <div>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Net Cash Flow
          </span>
          <div
            className={clsx(
              'mt-1.5 text-xl sm:text-2xl font-bold tracking-tight',
              isNetPositive ? 'text-indigo-600' : 'text-rose-600'
            )}
          >
            {`${isNetPositive ? '+' : '-'}${safeFormatCurrencyAmount(cleanNetAbs, currency)}`}
          </div>
          <span className="text-xs text-slate-400 mt-1 block">
            {summary?.transaction_count || 0} total transactions
          </span>
        </div>
        <div
          className={clsx(
            'p-2.5 rounded-lg shrink-0',
            isNetPositive ? 'bg-indigo-50 text-indigo-600' : 'bg-rose-50 text-rose-600'
          )}
        >
          <DollarSign className="w-5 h-5" />
        </div>
      </div>

      {/* Cumulative Net Movement */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-start justify-between">
        <div>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Cumulative Net
          </span>
          <div
            className={clsx(
              'mt-1.5 text-xl sm:text-2xl font-bold tracking-tight',
              isCumulativePositive ? 'text-slate-900' : 'text-rose-600'
            )}
          >
            {`${isCumulativePositive ? '+' : '-'}${safeFormatCurrencyAmount(cleanCumAbs, currency)}`}
          </div>
          <span className="text-xs text-slate-400 mt-1 block">
            Workspace all-time movement
          </span>
        </div>
        <div className="p-2.5 rounded-lg bg-slate-100 text-slate-600 shrink-0">
          <ArrowRightLeft className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
};
