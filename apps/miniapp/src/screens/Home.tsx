import { useEffect, useState } from 'react';
import type { Tab } from '../App';
import { type Stats, api, errorText } from '../api';
import { haptic, tg } from '../telegram';

const BOX_COLORS = ['#b0b0b0', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5'];
const BOX_LABELS = ['новые', 'ур. 1', 'ур. 2', 'ур. 3', 'ур. 4', 'ур. 5'];

export function Home({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportState, setExportState] = useState<'idle' | 'sending' | 'sent'>('idle');

  useEffect(() => {
    api.stats().then(setStats).catch((e: unknown) => setError(errorText(e)));
  }, []);

  const exportToChat = async () => {
    setExportState('sending');
    try {
      const res = await api.exportToChat();
      haptic('success');
      setExportState('sent');
      if (!res.sent) setError('Пока нечего выгружать — добавь слова.');
    } catch (e) {
      setExportState('idle');
      setError(errorText(e));
    }
  };

  const name = tg?.initDataUnsafe.user?.first_name ?? '';

  if (error && !stats) return <div className="screen"><p className="error">{error}</p></div>;
  if (!stats) return <div className="screen center muted">Загрузка…</div>;

  const maxBox = Math.max(1, ...stats.byBox);

  return (
    <div className="screen">
      <h1>Привет{name ? `, ${name}` : ''}! 👋</h1>

      <div className="card streak">
        <div className="big">🔥 {stats.streak}</div>
        <div>
          <div className="strong">{stats.streak === 1 ? 'день' : 'дн.'} подряд</div>
          <div className="muted small">
            {stats.trainedToday ? 'Сегодня уже занимался ✅' : 'Потренируйся сегодня, чтобы не прервать серию'}
          </div>
        </div>
      </div>

      <button className="button primary big-button" onClick={() => onNavigate('train')} type="button">
        {stats.dueNow > 0 ? `🏋️ Повторить слова (${stats.dueNow})` : '🏋️ Тренировка'}
      </button>

      <div className="grid">
        <div className="card stat">
          <div className="stat-value">{stats.totalWords}</div>
          <div className="muted small">в упражнениях</div>
        </div>
        <div className="card stat">
          <div className="stat-value">{stats.learned}</div>
          <div className="muted small">выучено</div>
        </div>
        <div className="card stat">
          <div className="stat-value">{stats.accuracy === null ? '—' : `${stats.accuracy}%`}</div>
          <div className="muted small">точность</div>
        </div>
        <div className="card stat">
          <div className="stat-value">{stats.lookups}</div>
          <div className="muted small">переведено</div>
        </div>
      </div>

      <div className="card">
        <div className="strong">Уровни слов</div>
        <div className="bars">
          {stats.byBox.map((count, box) => (
            <div className="bar-col" key={box}>
              <div className="bar-count small">{count}</div>
              <div className="bar" style={{ height: `${(count / maxBox) * 70 + 4}px`, background: BOX_COLORS[box] }} />
              <div className="muted tiny">{BOX_LABELS[box]}</div>
            </div>
          ))}
        </div>
      </div>

      <button className="button secondary" onClick={exportToChat} disabled={exportState === 'sending'} type="button">
        {exportState === 'sent' ? '✅ Файл отправлен в чат с ботом' : exportState === 'sending' ? 'Готовлю файл…' : '📤 Выгрузить слова в Excel'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
