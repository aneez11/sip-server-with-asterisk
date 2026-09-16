import ReactDOM from 'react-dom/client';
import { App } from '@/App/App';
import '@/main.scss';

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(<App />);

  // Hide the splash screen once the app mounts.
  setTimeout(() => {
    const splash = document.getElementById('splash');
    if (splash) splash.classList.add('hidden');
  }, 400);
}
