import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <aside className="w-56 shrink-0 border-r border-gray-800 flex flex-col gap-1 p-4">
        <span className="text-lg font-bold text-white mb-4">ClawGate</span>
        <NavLink to="/" end className={navCls}>Dashboard</NavLink>
        <NavLink to="/agents" className={navCls}>Agents</NavLink>
        <NavLink to="/sessions" className={navCls}>Sessions</NavLink>
        <NavLink to="/router" className={navCls}>Router</NavLink>
        <NavLink to="/dags" className={navCls}>DAG 工作流</NavLink>
      </aside>
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}

const navCls = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded text-sm ${
    isActive ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
  }`;
