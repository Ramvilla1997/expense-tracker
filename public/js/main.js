// @ts-check
import { firebaseConfig, googleWebClientId } from '../config.js';
import { createFirebaseBackend } from './backend/firebase.js';
import { startApp } from './app.js';

startApp(createFirebaseBackend(firebaseConfig, { googleClientId: googleWebClientId }));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* app still works without offline support */ });
}
