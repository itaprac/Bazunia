import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import './react-shell.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing React root element.');
}

flushSync(() => {
  createRoot(rootElement).render(<App />);
});

if (!window.__BAZUNIA_STARTED__) {
  window.__BAZUNIA_STARTED__ = true;
  import('../js/app.js')
    .then(({ initBazunia }) => initBazunia())
    .catch((error) => {
      console.error('Initialization failed:', error);
      const authMessage = document.getElementById('auth-message');
      if (authMessage) {
        authMessage.textContent = `Błąd startu aplikacji: ${error.message}`;
        authMessage.className = 'auth-message error';
      }
    });
}
