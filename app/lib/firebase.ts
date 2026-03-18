import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// כאן אנחנו מדביקים את ה-firebaseConfig מהדפדפן
const firebaseConfig = {
  apiKey: "AIzaSyDbD0xdStOj2nXor385Iz5kr_CGGMOfKa4",
  authDomain: "tiger-app-c6ff0.firebaseapp.com",
  projectId: "tiger-app-c6ff0",
  storageBucket: "tiger-app-c6ff0.firebasestorage.app",
  messagingSenderId: "343801070614",
  appId: "1:343801070614:web:95bd2c5208418760022137"
};

// אתחול האפליקציה
const app = initializeApp(firebaseConfig);

// ייצוא השירותים שבהם נשתמש
export const db = getFirestore(app);
export const storage = getStorage(app);