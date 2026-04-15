import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen bg-bg-base text-text-primary antialiased">
      {/* 侧边栏：毛玻璃效果 */}
      <aside className="w-56 shrink-0 glass-nav flex flex-col p-4">
        {/* Logo 区域 */}
        <div className="mb-6 px-2">
          <span className="text-lg font-semibold tracking-tight text-gradient">
            ClawGate
          </span>
          <p className="text-xs text-text-tertiary mt-1">v0.5 DAG Workflow</p>
        </div>

        {/* 导航链接 */}
        <nav className="flex-1 space-y-1">
          <NavLink to="/" end className={navCls}>
            Dashboard
          </NavLink>
          <NavLink to="/agents" className={navCls}>
            Agents
          </NavLink>
          <NavLink to="/sessions" className={navCls}>
            Sessions
          </NavLink>
          <NavLink to="/router" className={navCls}>
            Router
          </NavLink>
          <NavLink to="/dags" className={navCls}>
            DAG 工作流
          </NavLink>
        </nav>

        {/* 底部状态栏 */}
        <div className="mt-auto pt-4 border-t border-border-subtle">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-overlay">
            <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <span className="text-xs text-text-secondary">System Online</span>
          </div>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 overflow-auto p-6 relative">
        {/* 顶部淡化遮罩 - Linear 风格 */}
        <div className="absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-bg-base to-transparent pointer-events-none z-10" />
        {children}
      </main>
    </div>
  );
}

/* 导航链接样式 - Linear 风格 */
const navCls = ({ isActive }: { isActive: boolean }) => {
  const base = `
    flex items-center px-3 py-2 rounded-lg text-sm font-medium
    transition-all duration-200 ease-out
    hover:bg-bg-overlay hover:text-text-primary
  `;

  const active = `
    bg-accent-subtle text-accent border-l-2 border-accent
    shadow-[0_0_20px_rgba(124,58,237,0.1)]
  `;

  const inactive = `
    text-text-secondary border-l-2 border-transparent
  `;

  return `${base} ${isActive ? active : inactive}`.trim();
};
