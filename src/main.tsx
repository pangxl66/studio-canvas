import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import {
  isStaleDynamicImportError,
  reloadAfterStaleChunk,
} from '@/utils/staleChunkRecovery';

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  reloadAfterStaleChunk();
});

window.addEventListener('unhandledrejection', (event) => {
  if (!isStaleDynamicImportError(event.reason)) return;
  event.preventDefault();
  reloadAfterStaleChunk(event.reason);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
