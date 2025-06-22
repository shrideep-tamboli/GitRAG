"use client"

import { createContext, useContext, useState, ReactNode } from 'react';

interface RepoContextType {
  isRepoConnected: boolean;
  setIsRepoConnected: (connected: boolean) => void;
}

const RepoContext = createContext<RepoContextType | undefined>(undefined);

export function RepoProvider({ children }: { children: ReactNode }) {
  const [isRepoConnected, setIsRepoConnected] = useState(false);

  return (
    <RepoContext.Provider value={{ isRepoConnected, setIsRepoConnected }}>
      {children}
    </RepoContext.Provider>
  );
}

export function useRepo() {
  const context = useContext(RepoContext);
  if (context === undefined) {
    throw new Error('useRepo must be used within a RepoProvider');
  }
  return context;
}
