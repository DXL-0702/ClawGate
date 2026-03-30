import { create } from 'zustand';

export interface GatewayEvent {
  type: string;
  timestamp: string;
  sessionKey?: string;
  agentId?: string;
  content?: string;
  [key: string]: unknown;
}

interface EventStore {
  events: GatewayEvent[];
  connected: boolean;
  addEvent: (event: GatewayEvent) => void;
  setConnected: (v: boolean) => void;
  clearEvents: () => void;
}

export const useEventStore = create<EventStore>((set) => ({
  events: [],
  connected: false,
  addEvent: (event) =>
    set((s) => ({ events: [event, ...s.events].slice(0, 200) })),
  setConnected: (connected) => set({ connected }),
  clearEvents: () => set({ events: [] }),
}));
