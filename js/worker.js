// Background processing (Web Worker): parsing → classification → intelligence never blocks the UI.
import { ingest } from './core/ingest.js';
import { StatementError } from './core/parsers.js';
self.onmessage = ({ data }) => {
  const { state, input } = data;
  try {
    const summary = ingest(state, input, step => self.postMessage({ type: 'step', step }));
    self.postMessage({ type: 'done', state, summary });
  } catch (e) {
    self.postMessage({ type: 'error', message: e instanceof StatementError ? e.userMessage : 'Unable to read this statement.', code: e.detail ? 'PARSE' : 'INTERNAL' });
  }
};
