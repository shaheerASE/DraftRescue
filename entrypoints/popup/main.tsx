import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../assets/tailwind.css';
import { Popup } from './Popup';

// The popup is a real HTML page served from the extension's own origin
// (chrome-extension://<id>/popup.html). No web page can see it and its CSS
// cannot collide with anything, so React and Tailwind are free here — unlike in
// the content script, where they would be dead weight on someone else's site.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>,
);
