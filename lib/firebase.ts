import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  setPersistence,
  signInAnonymously,
} from 'firebase/auth';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyAXLXU0QjZCyxVSYfY4wGxp-dRgrcVbZfk',
  authDomain: 'appincontri-7c92c.firebaseapp.com',
  projectId: 'appincontri-7c92c',
  storageBucket: 'appincontri-7c92c.firebasestorage.app',
  messagingSenderId: '283738832016',
  appId: '1:283738832016:web:bf7a793651aa281f41ec15',
};

const app = initializeApp(firebaseConfig);

// Web usa getAuth, nativo usa initializeAuth con persistenza AsyncStorage
export const auth =
  Platform.OS === 'web'
    ? getAuth(app)
    : initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });

if (Platform.OS === 'web') {
  setPersistence(auth, browserLocalPersistence).catch(() => {});
}

export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

export async function ensureAnonAuth() {
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
}

export default app;
