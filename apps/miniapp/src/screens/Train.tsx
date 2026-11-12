import { useCallback, useEffect, useState } from 'react';
import type { Tab } from '../App';
import { type AnswerResult, type Summary, type Task, api, errorText, formatWhen } from '../api';
import { haptic, speak } from '../telegram';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty'; message: string }
  | { kind: 'task'; task: Task; total: number | null; shown: boolean; result: AnswerResult | null; chosen: number | null }
  | { kind: 'done'; summary: Summary };

function Html({ html, className }: { html: string; className?: string }) {
  // Текст заданий экранирован на сервере (escapeHtml), разметка — только <b>, <i>, <code>.
  return <div className={className} dangerouslySetInnerHTML={{ __html: html.replace(/\n/g, '<br/>') }} />;
}

export function Train({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const showTask = (task: Task, total: number | null = null) => {
    setText('');
    setState({ kind: 'task', task, total, shown: false, result: null, chosen: null });
  };

  const start = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      // Если тренировка уже идёт (например, начата в боте) — продолжаем её.
      const current = await api.currentTask();
      if (current.kind === 'task') return showTask(current.task);
      const res = await api.startTraining();
      if (res.kind === 'task') return showTask(res.task, res.total);
      if (res.kind === 'no_words') {
        return setState({ kind: 'empty', message: 'Сначала добавь слова — во вкладке «Добавить» или просто напиши слово боту.' });
      }
      const when = res.nextDue ? ` Следующее повторение ${formatWhen(res.nextDue)}.` : '';
      setState({ kind: 'empty', message: `На сегодня всё 🎉${when}` });
    } catch (e) {
      setState({ kind: 'error', message: errorText(e) });
    }
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  const next = async () => {
    setState({ kind: 'loading' });
    try {
      const res = await api.currentTask();
      if (res.kind === 'task') showTask(res.task);
      else if (res.kind === 'done') setState({ kind: 'done', summary: res.summary });
      else void start();
    } catch (e) {
      setState({ kind: 'error', message: errorText(e) });
    }
  };

  const stop = async () => {
    try {
      const { summary } = await api.stopTraining();
      if (summary) setState({ kind: 'done', summary });
      else onNavigate('home');
    } catch (e) {
      setState({ kind: 'error', message: errorText(e) });
    }
  };

  if (state.kind === 'loading') return <div className="screen center muted">Загрузка…</div>;
  if (state.kind === 'error') {
    return (
      <div className="screen">
        <p className="error">{state.message}</p>
        <button className="button primary" onClick={() => void start()} type="button">Попробовать снова</button>
      </div>
    );
  }
  if (state.kind === 'empty') {
    return (
      <div className="screen center">
        <p className="lead">{state.message}</p>
        <button className="button secondary" onClick={() => onNavigate('add')} type="button">➕ Добавить слово</button>
      </div>
    );
  }
  if (state.kind === 'done') {
    const { summary } = state;
    return (
      <div className="screen center">
        <div className="huge">🏁</div>
        <h2>Тренировка окончена!</h2>
        <p className="lead">Верно: <b>{summary.correct}</b> из {summary.total}</p>
        <p>Перешли на новый уровень: <b>{summary.promoted}</b></p>
        {summary.nextDue && <p className="muted">Следующее повторение {formatWhen(summary.nextDue)}</p>}
        <button className="button primary" onClick={() => void start()} type="button">Ещё тренировка</button>
        <button className="button secondary" onClick={() => onNavigate('home')} type="button">На главную</button>
      </div>
    );
  }

  const { task, result, shown, chosen } = state;

  const submit = async (answer: Parameters<typeof api.answer>[0], chosenIndex: number | null = null) => {
    setBusy(true);
    try {
      const res = await api.answer(answer);
      haptic(res.correct ? 'success' : 'error');
      setState({ ...state, result: res, chosen: chosenIndex, shown: true });
    } catch (e) {
      if (errorText(e).startsWith('Задание устарело')) void next();
      else setState({ kind: 'error', message: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const canSpeakBefore = task.type === 'card' || task.type === 'en_ru';

  return (
    <div className="screen">
      <div className="row space">
        <span className="muted small">{task.retry ? '🔁 Повтор ошибки' : state.total ? `Слов в тренировке: ${state.total}` : 'Тренировка'}</span>
        <button className="link" onClick={() => void stop()} type="button">⏹ Закончить</button>
      </div>

      <div className="card task">
        <Html html={task.prompt} className="prompt" />
        {canSpeakBefore && (
          <button className="icon-button" onClick={() => speak(task.term)} type="button" aria-label="Произнести">🔊</button>
        )}
      </div>

      {/* Карточка: показать → помню / не помню */}
      {task.type === 'card' && !result && (
        shown && task.reveal ? (
          <>
            <Html html={task.reveal} className="card reveal" />
            <div className="row">
              <button className="button success" disabled={busy} onClick={() => void submit({ kind: 'card', seq: task.seq, remembered: true })} type="button">✅ Помню</button>
              <button className="button danger" disabled={busy} onClick={() => void submit({ kind: 'card', seq: task.seq, remembered: false })} type="button">❌ Не помню</button>
            </div>
          </>
        ) : (
          <button className="button primary" onClick={() => setState({ ...state, shown: true })} type="button">👀 Показать перевод</button>
        )
      )}

      {/* Выбор из вариантов */}
      {task.options && (
        <div className="options">
          {task.options.map((option, i) => {
            let cls = 'option';
            if (result) {
              if (i === result.correctIndex) cls += ' correct';
              else if (i === chosen) cls += ' wrong';
            }
            return (
              <button
                key={option}
                className={cls}
                disabled={busy || result !== null}
                onClick={() => void submit({ kind: 'choice', seq: task.seq, index: i }, i)}
                type="button"
              >
                {option}
              </button>
            );
          })}
        </div>
      )}

      {/* Ввод текста: «напиши слово» и «составь предложение» */}
      {(task.type === 'write' || task.type === 'sentence') && !result && (
        <form
          className="answer-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void submit({ kind: 'text', seq: task.seq, text: text.trim() });
          }}
        >
          {task.type === 'write' ? (
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ответ на английском" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoFocus />
          ) : (
            <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Твоё предложение…" rows={3} autoFocus />
          )}
          <div className="row">
            <button className="button primary" disabled={busy || !text.trim()} type="submit">
              {busy ? (task.type === 'sentence' ? 'Проверяю…' : '…') : 'Проверить'}
            </button>
            <button className="button secondary" disabled={busy} onClick={() => void submit({ kind: 'skip', seq: task.seq })} type="button">⏭ Пропустить</button>
          </div>
        </form>
      )}

      {/* Результат */}
      {result && (
        <div className={`card result ${result.correct ? 'ok' : 'bad'}`}>
          <div className="strong">
            {result.correct ? '✅ Верно!' : <>❌ Неверно. Правильно: <b>{result.answer}</b></>}
          </div>
          {result.note && <Html html={result.note} className="note" />}
          <div className="row reveal-row">
            <Html html={result.reveal} className="reveal" />
            <button className="icon-button" onClick={() => speak(task.term)} type="button" aria-label="Произнести">🔊</button>
          </div>
          <button className="button primary" onClick={() => void next()} type="button">▶️ Дальше</button>
        </div>
      )}
    </div>
  );
}
