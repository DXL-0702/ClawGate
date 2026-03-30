import { useQuery } from '@tanstack/react-query';
import { useGatewayEvents } from '../hooks/useGatewayEvents.js';
import { useEventStore } from '../stores/eventStore.js';
import type { SessionListResponse } from '@clawgate/shared';

async function fetchSessions(agentId?: string): Promise<SessionListResponse> {
  const url = agentId ? `/api/sessions?agentId=${agentId}` : '/api/sessions';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch sessions');
  return res.json() as Promise<SessionListResponse>;
}

export default function SessionsPage() {
  useGatewayEvents();
  const { events, connected, clearEvents } = useEventStore();
  const { data, isLoading, error } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => fetchSessions(),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sessions</h1>
        <span className={`text-xs px-2 py-1 rounded ${
          connected ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-400'
        }`}>
          {connected ? 'Live' : 'Connecting...'}
        </span>
      </div>

      {/* Session 列表 */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 mb-2">Active Sessions</h2>
        {isLoading && <p className="text-gray-400 text-sm">Loading...</p>}
        {error && <p className="text-red-400 text-sm">Error: {String(error)}</p>}
        {data?.sessions.length === 0 && (
          <p className="text-gray-400 text-sm">No sessions found.</p>
        )}
        <ul className="space-y-2">
          {data?.sessions.map((s) => (
            <li key={s.key} className="border border-gray-800 rounded p-3 text-sm">
              <div className="flex justify-between">
                <span className="font-mono text-gray-200">{s.key}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  s.status === 'active' ? 'bg-green-900 text-green-300' :
                  s.status === 'ended' ? 'bg-gray-700 text-gray-400' :
                  'bg-red-900 text-red-300'
                }`}>{s.status}</span>
              </div>
              <div className="text-gray-500 mt-1">Agent: {s.agentId}</div>
            </li>
          ))}
        </ul>
      </div>

      {/* 实时事件流 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-400">Live Events</h2>
          <button
            onClick={clearEvents}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            Clear
          </button>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded p-3 h-64 overflow-y-auto font-mono text-xs space-y-1">
          {events.length === 0 && (
            <p className="text-gray-600">Waiting for events...</p>
          )}
          {events.map((e, i) => (
            <div key={i} className="text-gray-300">
              <span className="text-gray-500">{e.timestamp?.slice(11, 19)}</span>
              {' '}
              <span className="text-blue-400">[{e.type}]</span>
              {' '}
              {e.sessionKey && <span className="text-yellow-400">{e.sessionKey} </span>}
              {e.content && <span>{String(e.content).slice(0, 80)}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
