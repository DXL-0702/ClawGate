import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useLang } from '../i18n/LanguageContext.js';

export default function Layout({ children }: { children: ReactNode }) {
  const { lang, t, toggleLang } = useLang();

  return (
    <div className="flex h-screen bg-bg-base text-text-primary antialiased">
      {/* 侧边栏 */}
      <aside className="w-56 shrink-0 glass-nav flex flex-col p-4">
        {/* Logo */}
        <div className="mb-5 px-2">
          <span className="text-lg font-bold tracking-tight text-gradient">
            ClawGate
          </span>
          <p className="text-[10px] text-text-tertiary mt-0.5 tracking-wider uppercase">DAG Workflow</p>
        </div>

        {/* 导航 */}
        <nav className="flex-1 space-y-0.5">
          <NavLink to="/" end className={navCls}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01" />
            </svg>
            {t('nav.dashboard')}
          </NavLink>

          <NavLink to="/agents" className={navCls}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L9.75 14.5M19.5 5.5a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zM13.5 10.5a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zM19.5 15.75a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
            {t('nav.agents')}
          </NavLink>

          <NavLink to="/sessions" className={navCls}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.727 9.728 0 01-8.28-4.205 7.94 7.94 0 01-1.72-1.795A9.008 9.008 0 013 12c0-4.418 4.03-8 9-8a9 9 0 018.28 4.205" />
            </svg>
            {t('nav.sessions')}
          </NavLink>

          <NavLink to="/router" className={navCls}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
            {t('nav.router')}
          </NavLink>

          <NavLink to="/dags" className={navCls}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9h2M8 13h2M14 9h2M14 13h2M8 9a1 1 0 100-2 1 1 0 000 2zM8 13a1 1 0 100-2 1 1 0 000 2zM14 9a1 1 0 100-2 1 1 0 000 2zM14 13a1 1 0 100-2 1 1 0 000 2z" />
            </svg>
            {t('nav.dags')}
          </NavLink>
        </nav>

        {/* 底部状态栏 */}
        <div className="mt-auto pt-4 space-y-2">
          {/* 语言切换 */}
          <button
            onClick={toggleLang}
            className="w-full flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-bg-overlay hover:bg-bg-subtle transition-colors"
            title={lang === 'zh' ? 'Switch to English' : '切换为中文'}
          >
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-.916 2.583M12.132 20.75A9 9 0 1121 12m0 0a9 9 0 00-2.132-4.917M3 12a9 9 0 019.132-4.917" />
            </svg>
            <span className={lang === 'zh' ? 'text-accent' : 'text-text-tertiary'}>ZH</span>
            <span className="text-text-tertiary">/</span>
            <span className={lang === 'en' ? 'text-accent' : 'text-text-tertiary'}>EN</span>
          </button>

          {/* 系统状态 */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-overlay">
            <div className="relative">
              <div className="w-2 h-2 rounded-full bg-success" />
              <div className="absolute inset-0 rounded-full bg-success animate-ping opacity-75" />
            </div>
            <span className="text-[11px] text-text-secondary">{t('nav.system_online')}</span>
          </div>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 overflow-auto p-6 relative">
        <div className="absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-bg-base to-transparent pointer-events-none z-10" />
        {children}
      </main>
    </div>
  );
}

const navCls = ({ isActive }: { isActive: boolean }) => {
  const base = `
    flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium
    transition-all duration-200 ease-out
    hover:bg-bg-overlay hover:text-text-primary
  `;
  const active = `
    bg-accent-subtle text-accent border-l-2 border-accent
    shadow-[0_0_20px_rgba(245,158,11,0.08)]
  `;
  const inactive = `
    text-text-secondary border-l-2 border-transparent
  `;
  return `${base} ${isActive ? active : inactive}`.trim();
};
