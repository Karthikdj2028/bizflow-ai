import React, { useState } from 'react';
import { useWorkspace } from './WorkspaceContext';
import { ChevronDown, Check, Building2 } from 'lucide-react';
import { WorkspaceRole } from '../../types/api';

const ROLE_BADGE_STYLES: Record<WorkspaceRole, string> = {
  OWNER: 'bg-amber-100 text-amber-800 border-amber-200',
  ADMIN: 'bg-purple-100 text-purple-800 border-purple-200',
  MEMBER: 'bg-blue-100 text-blue-800 border-blue-200',
  VIEWER: 'bg-slate-100 text-slate-700 border-slate-200',
};

export const WorkspaceSelector: React.FC = () => {
  const { workspaces, activeWorkspace, switchWorkspace, isLoading } = useWorkspace();
  const [isOpen, setIsOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  if (!activeWorkspace && workspaces.length === 0) {
    return (
      <div className="flex items-center space-x-2 text-xs text-slate-400">
        <Building2 className="w-4 h-4" />
        <span>No workspaces available</span>
      </div>
    );
  }

  const handleSelect = async (candidateId: string) => {
    if (activeWorkspace && activeWorkspace.business.id === candidateId) {
      setIsOpen(false);
      return;
    }

    setIsSwitching(true);
    await switchWorkspace(candidateId);
    setIsSwitching(false);
    setIsOpen(false);
  };

  const role = activeWorkspace?.membership.role || 'VIEWER';

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading || isSwitching}
        className="inline-flex items-center space-x-3 px-3 py-2 text-sm font-medium text-slate-800 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition shadow-sm"
      >
        <Building2 className="w-4 h-4 text-indigo-600" />
        <span className="font-semibold text-slate-900 truncate max-w-[160px]">
          {activeWorkspace?.business.name || 'Select Workspace'}
        </span>
        <span
          className={`px-2 py-0.5 text-[11px] font-semibold border rounded-full ${ROLE_BADGE_STYLES[role]}`}
        >
          {role}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400 ml-1" />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute left-0 mt-2 w-72 origin-top-left bg-white rounded-xl shadow-xl ring-1 ring-black ring-opacity-5 divide-y divide-slate-100 z-20 focus:outline-none">
            <div className="p-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Your Workspaces
            </div>
            <div className="py-1 max-h-60 overflow-y-auto">
              {workspaces.map((item) => {
                const isSelected = activeWorkspace?.business.id === item.business.id;
                return (
                  <button
                    key={item.business.id}
                    onClick={() => handleSelect(item.business.id)}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center justify-between transition group"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-900 group-hover:text-indigo-600 transition">
                        {item.business.name}
                      </span>
                      <span className="text-xs text-slate-400">
                        Currency: {item.business.currency}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span
                        className={`px-2 py-0.5 text-[10px] font-semibold border rounded-full ${ROLE_BADGE_STYLES[item.membership.role]}`}
                      >
                        {item.membership.role}
                      </span>
                      {isSelected && <Check className="w-4 h-4 text-indigo-600" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
