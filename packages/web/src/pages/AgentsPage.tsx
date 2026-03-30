import { useQuery } from '@tanstack/react-query';
import type { AgentListResponse } from '@clawgate/shared';

async function fetchAgents(): Promise<AgentListResponse> {
  const res = await fetch('/api/agents');
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json() as Promise<AgentListResponse>;
}

export default function AgentsPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['agents'], queryFn: fetchAgents });

  if (isLoading) return <p className="text-gray-400">Loading agents...</p>;
  if (error) return <p className="text-red-400">Error: {String(error)}</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Agents</h1>
      {data?.agents.length === 0 && (
        <p className="text-gray-400">No agents found in ~/.openclaw/agents/</p>
      )}
      <ul className="space-y-2">
        {data?.agents.map((agent) => (
          <li key={agent.id} className="border border-gray-800 rounded p-4">
            <div className="font-medium">{agent.name}</div>
            <div className="text-sm text-gray-400">{agent.id}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
