import { useEffect, useRef } from 'react';
import { useEventStore } from '../stores/eventStore.js';

export function useGatewayEvents() {
  const ws = useRef<WebSocket | null>(null);
  const destroyed = useRef(false);
  const { addEvent, setConnected } = useEventStore();

  useEffect(() => {
    destroyed.current = false;
    const url = `ws://${window.location.host}/ws/events`;

    function connect() {
      if (destroyed.current) return;
      const socket = new WebSocket(url);
      ws.current = socket;

      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        if (!destroyed.current) {
          setTimeout(connect, 3000);
        }
      };
      socket.onerror = () => socket.close();
      socket.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data as string);
          addEvent(event);
        } catch { /* ignore malformed */ }
      };
    }

    connect();
    return () => {
      destroyed.current = true;
      ws.current?.close();
    };
  }, [addEvent, setConnected]);
}
