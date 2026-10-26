import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/styles.css';
import { startAgent } from './agent/run';
import { watchStorage } from './store/health';
import { startTrackingWriting } from './store/stats';
import { BACKEND } from './store/server';
import { initPersistence } from './store/store';
import { App } from './ui/App';
import { AccountGate } from './ui/Login';

let booted = false;
function boot() {
  if (booted) return;
  booted = true;
  void initPersistence().then(() => {
    watchStorage();
    startTrackingWriting();
    startAgent();
  });
}
// In server mode nothing loads until an account has signed in.
if (!BACKEND) boot();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccountGate onSignedIn={boot}>
      <App />
    </AccountGate>
  </StrictMode>,
);
