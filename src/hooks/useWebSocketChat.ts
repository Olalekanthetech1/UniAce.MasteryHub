import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { jsonrepair } from 'jsonrepair';

export const useWebSocketChat = () => {
  const { user } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const activeStreamCleanupRef = useRef<((reason?: string) => void) | null>(null);
  const activeTokenRef = useRef<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setIsConnected(false);
      return;
    }

    let isMounted = true;

    const connect = async () => {
      try {
        if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
          return;
        }

        const token = await user.getIdToken();
        if (!token || !isMounted) return;

        // Use wss:// for https, ws:// for http
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}/api/chat?token=${encodeURIComponent(token)}`;

        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          if (isMounted && wsRef.current === ws) {
            setIsConnected(true);
            setError(null);
          }
        };

        ws.onclose = () => {
          if (activeStreamCleanupRef.current) {
            activeStreamCleanupRef.current('Connection closed mid-stream. Unused pre-authorized sparks have been automatically refunded.');
          }
          if (isMounted && wsRef.current === ws) {
            setIsConnected(false);
          }
        };

        ws.onerror = () => {
          // In iframe or restricted environments, WebSocket may be blocked.
          // Silently mark as disconnected so ChatBot smoothly uses HTTP streaming.
          if (isMounted && wsRef.current === ws) {
            setIsConnected(false);
            setError('WebSocket unavailable');
          }
        };

        wsRef.current = ws;
      } catch (e: any) {
        if (isMounted) {
          setIsConnected(false);
          setError('Failed to setup connection');
        }
      }
    };

    connect().catch(() => {
      if (isMounted) {
        setIsConnected(false);
      }
    });

    const handleBeforeUnload = () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && activeTokenRef.current) {
        try {
          wsRef.current.send(JSON.stringify({
            type: 'abort',
            idempotency_token: activeTokenRef.current
          }));
        } catch (_) {}
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      isMounted = false;
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (wsRef.current) {
        try {
          if (wsRef.current.readyState === WebSocket.OPEN && activeTokenRef.current) {
            wsRef.current.send(JSON.stringify({
              type: 'abort',
              idempotency_token: activeTokenRef.current
            }));
          }
          wsRef.current.close();
        } catch (_) {}
        wsRef.current = null;
      }
    };
  }, [user?.uid]);

  const abortStream = useCallback((idempotencyToken?: string) => {
    const tokenToAbort = idempotencyToken || activeTokenRef.current;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({
          type: 'abort',
          idempotency_token: tokenToAbort || undefined
        }));
      } catch (e) {
        console.error('Error sending WS abort signal', e);
      }
    }
  }, []);

  const sendMessage = useCallback((data: any, onChunk: (text: string) => void, onDone: () => void, onError: (err: string) => void, onMeta?: (data: any) => void) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      onError('WebSocket not connected');
      return;
    }

    activeTokenRef.current = data?.idempotency_token || data?.idempotencyToken || null;

    const cleanupListener = () => {
      wsRef.current?.removeEventListener('message', handleMessage);
      activeStreamCleanupRef.current = null;
      activeTokenRef.current = null;
    };

    const handleMessage = (event: MessageEvent) => {
      try {
        let response;
        try {
          response = JSON.parse(event.data);
        } catch (parseError) {
          // Attempt repair if standard parse fails
          const repaired = jsonrepair(event.data);
          response = JSON.parse(repaired);
        }
        
        if (response.type === 'chunk') {
          onChunk(response.text);
        } else if (response.type === 'done') {
          cleanupListener();
          onDone();
        } else if (response.type === 'error') {
          cleanupListener();
          onError(response.error);
        } else if (response.type === 'meta') {
          if (onMeta) onMeta(response);
        }
      } catch (e) {
        console.error('Error parsing WS message', e);
      }
    };

    activeStreamCleanupRef.current = (disconnectReason?: string) => {
      cleanupListener();
      if (disconnectReason) {
        onError(disconnectReason);
      }
    };

    wsRef.current.addEventListener('message', handleMessage);
    try {
      wsRef.current.send(JSON.stringify(data));
    } catch (e) {
      cleanupListener();
      console.error('Error sending WS message', e);
      onError('Failed to send message');
    }
  }, []);

  return { isConnected, sendMessage, abortStream, error };
};
