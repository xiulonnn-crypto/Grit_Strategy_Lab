import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app-runtime';
import './styles.css';
import './app-shell-frame.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
