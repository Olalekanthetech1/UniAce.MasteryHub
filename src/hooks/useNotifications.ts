import { useState, useEffect } from 'react';
import { auth, messaging } from '../firebase';
import { getToken } from 'firebase/messaging';
import { useAuth } from '../context/AuthContext';

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  read: boolean;
  createdAt: any;
  link?: string;
}

export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission>('default');

  useEffect(() => {
    if ('Notification' in window) {
      setPermissionStatus(Notification.permission);
    }
  }, []);

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) {
      alert('This browser does not support desktop notifications.');
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      setPermissionStatus(permission);
      
      if (permission === 'granted') {
        const msg = await messaging();
        if (msg && user) {
          const token = await getToken(msg, {
            vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY || 'YOUR_PUBLIC_VAPID_KEY'
          });
          
          if (token) {
            // Updated via user profile endpoint
            await fetch('/api/user/profile', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${await user.getIdToken()}`
              },
              body: JSON.stringify({ fcmToken: token })
            }).catch(() => {});
            return true;
          }
        }
      } else if (permission === 'denied') {
        alert('Notifications are blocked. Please click the lock icon in your browser address bar to enable them.');
      }
    } catch (error) {
      console.error('Error requesting notification permission:', error);
    }
    return false;
  };

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    let isMounted = true;
    const fetchNotifications = async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/user/notifications', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok && isMounted) {
          const data = await res.json();
          const notifs = (data.notifications || []).map((n: any) => ({
            id: n.id,
            userId: n.uid || user.uid,
            title: n.title,
            message: n.message,
            type: n.type || 'info',
            read: Boolean(n.read),
            createdAt: n.created_at ? new Date(n.created_at) : new Date()
          }));
          setNotifications(notifs);
          setUnreadCount(notifs.filter((n: any) => !n.read).length);
        }
      } catch {
        // Non-fatal
      }
    };

    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [user]);

  const markAsRead = async (notificationId: string) => {
    setNotifications(prev => prev.map(n => n.id === notificationId ? { ...n, read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));

    try {
      const token = await user?.getIdToken();
      if (token) {
        await fetch('/api/user/notifications/mark-read', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ notificationId })
        });
      }
    } catch {
      // Non-fatal
    }
  };

  const markAllAsRead = async () => {
    const unreadNotifications = notifications.filter(n => !n.read);
    if (unreadNotifications.length === 0) return;

    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
    
    try {
      const token = await user?.getIdToken();
      if (token) {
        await fetch('/api/user/notifications/mark-read', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ notificationId: 'all' })
        });
      }
    } catch {
      // Non-fatal
    }
  };

  const deleteNotification = async (notificationId: string) => {
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
    setUnreadCount(prev => notifications.find(n => n.id === notificationId && !n.read) ? Math.max(0, prev - 1) : prev);
    
    try {
      const token = await user?.getIdToken();
      if (token) {
        await fetch(`/api/user/notifications/${notificationId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      }
    } catch (error) {
      console.error("useNotifications: Error deleting notification", error);
    }
  };

  const clearAllNotifications = async () => {
    if (notifications.length === 0) return;
    
    setNotifications([]);
    setUnreadCount(0);
    
    try {
      const token = await user?.getIdToken();
      if (token) {
        await fetch('/api/user/notifications', {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      }
    } catch (error) {
      console.error("useNotifications: Error clearing notifications", error);
    }
  };

  const sendNotification = async (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info', customId?: string) => {
    if (!user) return;

    try {
      const token = await user.getIdToken();
      await fetch('/api/user/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title, message, type, customId })
      });
    } catch (error) {
      console.error("useNotifications: Error sending notification", error);
    }
  };

  return { notifications, unreadCount, markAsRead, markAllAsRead, deleteNotification, clearAllNotifications, sendNotification, permissionStatus, requestNotificationPermission };
}
