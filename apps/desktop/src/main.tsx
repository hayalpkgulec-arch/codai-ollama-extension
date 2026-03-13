import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { DesktopProviders } from './store/DesktopProviders';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DesktopProviders>
      <App />
    </DesktopProviders>
  </React.StrictMode>,
);
