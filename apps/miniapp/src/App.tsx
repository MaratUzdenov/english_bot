import { useEffect, useState } from 'react';
import { Add } from './screens/Add';
import { Home } from './screens/Home';
import { Train } from './screens/Train';
import { Words } from './screens/Words';
import { haptic, tg } from './telegram';

export type Tab = 'home' | 'train' | 'words' | 'add';

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'home', icon: '📊', label: 'Главная' },
  { id: 'train', icon: '🏋️', label: 'Тренировка' },
  { id: 'words', icon: '📚', label: 'Слова' },
  { id: 'add', icon: '➕', label: 'Добавить' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('home');

  useEffect(() => {
    tg?.ready();
    tg?.expand();
  }, []);

  if (!tg?.initData) {
    return (
      <div className="screen center">
        <h2>English Words</h2>
        <p className="muted">Открой приложение через бота в Telegram 🙂</p>
      </div>
    );
  }

  const go = (next: Tab) => {
    haptic('light');
    setTab(next);
  };

  return (
    <div className="app">
      <main className="content">
        {tab === 'home' && <Home onNavigate={go} />}
        {tab === 'train' && <Train onNavigate={go} />}
        {tab === 'words' && <Words />}
        {tab === 'add' && <Add />}
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => go(t.id)}
            type="button"
          >
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
