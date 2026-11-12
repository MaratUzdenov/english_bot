import { useEffect, useState } from 'react';
import { type WordsPage, api, errorText } from '../api';
import { confirm, haptic, speak } from '../telegram';

const BOX_ICONS = ['⚪', '🔴', '🟠', '🟡', '🟢', '🔵'];

export function Words() {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<WordsPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (p: number) => {
    api
      .words(p)
      .then((res) => {
        setData(res);
        setPage(res.page);
      })
      .catch((e: unknown) => setError(errorText(e)));
  };

  useEffect(() => load(0), []);

  const remove = async (id: number, term: string) => {
    if (!(await confirm(`Удалить «${term}» из упражнений?`))) return;
    try {
      await api.deleteWord(id);
      haptic('success');
      load(page);
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (error) return <div className="screen"><p className="error">{error}</p></div>;
  if (!data) return <div className="screen center muted">Загрузка…</div>;
  if (data.total === 0) {
    return <div className="screen center"><p className="lead">Пока пусто. Добавь первое слово во вкладке «Добавить» ➕</p></div>;
  }

  return (
    <div className="screen">
      <h1>Мои слова <span className="muted">({data.total})</span></h1>
      <div className="list">
        {data.items.map((item) => (
          <div className="card word-row" key={item.id}>
            <span className="box-icon">{BOX_ICONS[item.box] ?? '⚪'}</span>
            <button className="word-main" onClick={() => speak(item.term)} type="button">
              <span className="strong">{item.term}</span>
              <span className="muted small">{item.translation ?? ''}</span>
            </button>
            <button className="icon-button" onClick={() => void remove(item.id, item.term)} type="button" aria-label="Удалить">🗑</button>
          </div>
        ))}
      </div>
      {data.totalPages > 1 && (
        <div className="row center-row">
          <button className="button secondary small-button" disabled={page === 0} onClick={() => load(page - 1)} type="button">◀️</button>
          <span className="muted">{page + 1} / {data.totalPages}</span>
          <button className="button secondary small-button" disabled={page >= data.totalPages - 1} onClick={() => load(page + 1)} type="button">▶️</button>
        </div>
      )}
      <p className="muted tiny">Нажми на слово, чтобы услышать произношение. ⚪ новое → 🔴🟠🟡🟢 → 🔵 почти выучено</p>
    </div>
  );
}
