// @ts-check
import { firebaseConfig } from '../config.js';
import { createFirebaseBackend } from './backend/firebase.js';
import { startApp } from './app.js';

startApp(createFirebaseBackend(firebaseConfig));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* app still works without offline support */ });
}
