// Firebase web configuration. Not a secret; access is enforced by Firestore rules.
export const firebaseConfig = {
  apiKey: 'AIzaSyABKSbT5WSZmZe5B_luoGDeKAi4EFkDZMQ',
  authDomain: 'tally-shared-expenses.vercel.app',
  projectId: 'family-money-3d5f7',
  storageBucket: 'family-money-3d5f7.firebasestorage.app',
  messagingSenderId: '178497882216',
  appId: '1:178497882216:web:26d8790493c0dcd32c93dd',
};

// Google Identity Services web client (from Firebase > Authentication > Google > Web SDK configuration).
// Public identifier, not a secret. Lets Android Chrome show Google's account sheet over the app.
export const googleWebClientId = '178497882216-itf6oiffbtvjvp2qh0o56jn39ovm6jf2.apps.googleusercontent.com';
