import { useState } from 'react';
import { api } from '../api.js';

const EXAMPLE = `cardId,name,setId,setName,number,variant,condition,quantity,acquiredPrice,notes
base1-4,,,,,Holofoil,Near Mint,1,150,
,Charizard,base1,,4,Holofoil,Lightly Played,2,,`;

export default function ImportCsvModal({ onClose, onImported }) {
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ''));
    reader.readAsText(file);
  }

  async function handleImport() {
    setImporting(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.importCollectionCsv(csvText);
      setResult(res);
      if (res.imported > 0) onImported?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2>Import CSV</h2>
        <p className="muted">
          Upload a CSV exported from this app (has a <code>cardId</code> column — matches exactly), or one you've
          put together with card names. Unmatched rows are reported back, never guessed.
        </p>

        <details className="import-help">
          <summary>Accepted columns &amp; example</summary>
          <p className="muted">
            <code>cardId</code> OR <code>name</code> is required (cardId is exact; name can be narrowed with{' '}
            <code>setId</code>/<code>setName</code>/<code>number</code>). Optional: <code>variant</code>,{' '}
            <code>condition</code>, <code>quantity</code>, <code>acquiredPrice</code>, <code>notes</code>.
          </p>
          <pre className="csv-example">{EXAMPLE}</pre>
        </details>

        <div className="import-input">
          <label className="btn-small file-label">
            {fileName || 'Choose CSV file…'}
            <input type="file" accept=".csv,text/csv" onChange={handleFile} hidden />
          </label>
          <p className="muted" style={{ margin: '0.5rem 0' }}>
            …or paste CSV text directly:
          </p>
          <textarea
            rows={6}
            className="csv-textarea"
            placeholder="cardId,name,setId,..."
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
          />
        </div>

        {error && <p className="error-text">{error}</p>}

        {result && (
          <div className="import-result">
            <p className={result.skipped.length ? '' : 'success-text'}>
              Imported {result.imported} of {result.total} rows.
            </p>
            {result.skipped.length > 0 && (
              <table className="import-skipped-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Card</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {result.skipped.map((s) => (
                    <tr key={s.row}>
                      <td>{s.row}</td>
                      <td>{s.name}</td>
                      <td>{s.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        <button type="button" className="btn-primary" onClick={handleImport} disabled={importing || !csvText.trim()}>
          {importing ? 'Importing…' : 'Import'}
        </button>
      </div>
    </div>
  );
}
