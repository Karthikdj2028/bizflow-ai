import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User } from '../../types/api';
import {
  apiRequest,
  registerUnauthorizedHandler,
  ACCESS_TOKEN_KEY,
  ACTIVE_WORKSPACE_KEY,
  NetworkError,
} from '../../lib/api';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  connectionError: boolean;
  login: (token: string) => Promise<void>;
  logout: () => void;
  retryInit: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(ACCESS_TOKEN_KEY));
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<boolean>(false);

  const fetchCurrentUser = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setConnectionError(false);

    const savedToken = sessionStorage.getItem(ACCESS_TOKEN_KEY);
    if (!savedToken) {
      setUser(null);
      setToken(null);
      setIsAuthenticated(false);
      setIsLoading(false);
      return;
    }

    try {
      const currentUser = await apiRequest<User>('/auth/me', {
        scope: 'auth',
        method: 'GET',
      });
      setUser(currentUser);
      setToken(savedToken);
      setIsAuthenticated(true);
      setError(null);
      setConnectionError(false);
    } catch (err: unknown) {
      if (err instanceof NetworkError) {
        // Network drop: preserve token in sessionStorage!
        setConnectionError(true);
        setError('Network connection failed. Click Retry to reconnect.');
        setIsAuthenticated(false);
      } else {
        const status = (err as { status?: number }).status;
        if (status === 401) {
          // Token expired or invalid
          sessionStorage.removeItem(ACCESS_TOKEN_KEY);
          sessionStorage.removeItem(ACTIVE_WORKSPACE_KEY);
          setUser(null);
          setToken(null);
          setIsAuthenticated(false);
          setError(null);
        } else {
          // Server/protocol error: preserve token
          setError((err as Error).message || 'Protocol error during authentication.');
          setIsAuthenticated(false);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Register unauthorized listener unconditionally upon mount
  useEffect(() => {
    const unregister = registerUnauthorizedHandler(() => {
      // Session expired via authenticated 401
      sessionStorage.removeItem(ACCESS_TOKEN_KEY);
      sessionStorage.removeItem(ACTIVE_WORKSPACE_KEY);
      setUser(null);
      setToken(null);
      setIsAuthenticated(false);
      setError(null);
    });

    return unregister;
  }, []);

  // Initial verification on mount
  useEffect(() => {
    fetchCurrentUser();
  }, [fetchCurrentUser]);

  const login = useCallback(
    async (newToken: string) => {
      sessionStorage.setItem(ACCESS_TOKEN_KEY, newToken);
      setToken(newToken);
      await fetchCurrentUser();
    },
    [fetchCurrentUser]
  );

  const logout = useCallback(() => {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(ACTIVE_WORKSPACE_KEY);
    setUser(null);
    setToken(null);
    setIsAuthenticated(false);
    setError(null);
    setConnectionError(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated,
        isLoading,
        error,
        connectionError,
        login,
        logout,
        retryInit: fetchCurrentUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
