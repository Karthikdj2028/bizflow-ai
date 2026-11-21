import React, { useState } from 'react';
import { AuthProvider, useAuth } from './features/auth/AuthContext';
import { WorkspaceProvider } from './features/workspaces/WorkspaceContext';
import { LoginForm } from './features/auth/LoginForm';
import { RegisterForm } from './features/auth/RegisterForm';
import { WorkspaceLayout } from './features/workspaces/WorkspaceLayout';
import { RefreshCw, WifiOff } from 'lucide-react';

const AppContent: React.FC = () => {
  const { isAuthenticated, isLoading, connectionError, error, retryInit } = useAuth();
  const [isRegisterMode, setIsRegisterMode] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-3">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
          <p className="text-sm font-medium text-slate-600">Initializing BizFlow session...</p>
        </div>
      </div>
    );
  }

  if (connectionError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md p-8 bg-white rounded-xl shadow-lg border border-slate-100 text-center">
          <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto mb-4">
            <WifiOff className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Connection Problem</h2>
          <p className="text-sm text-slate-600 mb-6">
            {error || 'Unable to connect to the BizFlow AI backend server.'}
          </p>
          <button
            onClick={() => retryInit()}
            className="w-full py-2.5 px-4 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        {isRegisterMode ? (
          <RegisterForm onToggleMode={() => setIsRegisterMode(false)} />
        ) : (
          <LoginForm onToggleMode={() => setIsRegisterMode(true)} />
        )}
      </div>
    );
  }

  return (
    <WorkspaceProvider>
      <WorkspaceLayout />
    </WorkspaceProvider>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

export default App;
