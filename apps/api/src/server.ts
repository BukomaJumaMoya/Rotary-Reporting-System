import { createApp } from './app.js';
import { config } from './platform/config.js';

const app = createApp();

app.listen(config.PORT, () => {
  console.log(`[api] listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
});
