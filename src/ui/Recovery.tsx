// Shown instead of the app when the saved vault could not be read. Nothing is written until the writer chooses.

import { useStore, startFresh } from '../store/store';
import { dumpRawStorage } from '../store/db';
import './crash.css';

function download(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function Recovery() {
  const error = useStore((s) => s.loadError);
  return (
    <div className="crash crash-full" role="alert" data-testid="recovery">
      <h1>Your saved world could not be opened</h1>
      <p>
        Nothing has been changed or overwritten. The app will not write anything until you decide. The browser said: <em>{error}</em>
      </p>
      <ul>
        <li>Try again first: a second tab holding the database open, or a restart, often clears this.</li>
        <li>If you have a folder connected or an export, your writing is safe there.</li>
        <li>Download the raw data to keep whatever can still be read before you do anything else.</li>
      </ul>
      <div className="crash-actions">
        <button className="btn" onClick={() => window.location.reload()} data-testid="recovery-retry">
          Try again
        </button>
        <button className="btn" onClick={() => void dumpRawStorage().then((text) => download(text, 'living-writing-raw.json'))} data-testid="recovery-dump">
          Download raw data
        </button>
        <button
          className="btn btn-danger"
          onClick={() => window.confirm('Delete the unreadable data and start with an empty vault? Download the raw data first if you want to keep it.') && void startFresh()}
          data-testid="recovery-fresh"
        >
          Start fresh…
        </button>
      </div>
    </div>
  );
}
