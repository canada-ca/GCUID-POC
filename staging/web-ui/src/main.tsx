/*!
 * GCUID — Government of Canada Unique Identifier System
 *
 * @license
 * Copyright (c) 2024-2026 NOETRONIQ Strategic Initiatives. All rights reserved.
 * Author: Philippe R. Beauchamp <prb@noetroniq.com>
 *
 * Licensed for use and modification by the Treasury Board of Canada Secretariat.
 * See LICENSE in the project root for full terms.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { DateTimeFormatProvider } from './context/DateTimeFormatContext';
import { PortalModeProvider } from './context/PortalModeContext';
import { UXThemeProvider } from './context/UXThemeContext';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <DateTimeFormatProvider>
          <PortalModeProvider>
            <UXThemeProvider>
              <App />
            </UXThemeProvider>
          </PortalModeProvider>
        </DateTimeFormatProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
