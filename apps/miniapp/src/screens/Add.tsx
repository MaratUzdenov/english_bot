import { type FormEvent, useState } from 'react';
import { type LookupResult, api, errorText } from '../api';
import { haptic, speak } from '../telegram';

function Highlighted({ sentence, form }: { sentence: string; form: string }) {
  const i = sentence.indexOf(form);
  if (i === -1) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, i)}
      <b>{form}</b>
      {sentence.slice(i + form.length)}
    </>
  );
}

export function Add() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);

  const lookup = async (e?: FormEvent, override?: string) => {
    e?.preventDefault();
    const text = (override ?? query).trim();
    if (!text) return;
    if (override) setQuery(override);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.lookup(text);
      setResult(res);
      setAdded(res.inExercises);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const add = async () => {
    if (!result) return;
    try {
      await api.addWord(result.lookupId);
      haptic('success');
      setAdded(true);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const entry = result?.entry;

  return (
    <div className="screen">
      <h1>Перевести слово</h1>
      <form className="row" onSubmit={(e) => void lookup(e)}>
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Например: take off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button className="button primary fit" disabled={loading || !query.trim()} type="submit">
          {loading ? '…' : 'Найти'}
        </button>
      </form>

      {loading && <p className="muted">Перевожу…</p>}
      {error && <p className="error">{error}</p>}

      {entry && !entry.is_valid && (
        <div className="card">
          <p>Не нашёл такое слово 🤔</p>
          {entry.suggestion && (
            <button className="button secondary" onClick={() => void lookup(undefined, entry.suggestion!)} type="button">
              Возможно, «{entry.suggestion}»?
            </button>
          )}
        </div>
      )}

      {entry?.is_valid && (
        <div className="card entry">
          <div className="row space">
            <div>
              <div className="entry-term">{entry.term}</div>
              <div className="muted small">
                {[entry.transcription, entry.part_of_speech, entry.level].filter(Boolean).join(' · ')}
              </div>
            </div>
            <button className="icon-button" onClick={() => speak(entry.term)} type="button" aria-label="Произнести">🔊</button>
          </div>

          <p className="lead">🇷🇺 {entry.translations.join('; ')}</p>

          {entry.examples.length > 0 && (
            <div className="examples">
              {entry.examples.slice(0, 3).map((ex) => (
                <div className="example" key={ex.en}>
                  <button className="example-en" onClick={() => speak(ex.en)} type="button">
                    <Highlighted sentence={ex.en} form={ex.form} /> 🔊
                  </button>
                  <div className="muted small">{ex.ru}</div>
                </div>
              ))}
            </div>
          )}

          {entry.collocations.length > 0 && (
            <p className="small"><b>Сочетания:</b> {entry.collocations.join(', ')}</p>
          )}

          <button className={`button ${added ? 'success' : 'primary'}`} disabled={added} onClick={() => void add()} type="button">
            {added ? '✅ В упражнениях' : '➕ В упражнения'}
          </button>
        </div>
      )}
    </div>
  );
}
