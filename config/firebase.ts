// config/firebase.ts
import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyB_b_l1q1PDPzBwOC4oktp6MENRie-y8no",
  authDomain: "sos-radar-app.firebaseapp.com",
  databaseURL: "https://sos-radar-app-default-rtdb.firebaseio.com",
  projectId: "sos-radar-app",
  storageBucket: "sos-radar-app.firebasestorage.app",
  messagingSenderId: "530274446161",
  appId: "1:530274446161:web:681118284a50a83ee50170"
};

const app = initializeApp(firebaseConfig);

export const rtdb = getDatabase(app);      
export default app;