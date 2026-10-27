import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { getMessaging, isSupported } from "firebase/messaging";
import firebaseConfig from "../firebase-applet-config.json";

// Initialize Firebase app strictly for Authentication, Storage, and Cloud Messaging (all application data lives in Neon PostgreSQL)
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const storage = getStorage(app);

// Messaging (FCM) - only if supported in browser
export const messaging = async () => {
  const supported = await isSupported();
  return supported ? getMessaging(app) : null;
};

