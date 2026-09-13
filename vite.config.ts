import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'api-server',
      configureServer(server) {
        import('./server/index.js').then(({ app, initDb }) => {
          initDb().then(() => {
            server.middlewares.use(app);
            console.log('API server mounted on Vite dev server');
          }).catch(err => console.error('DB init failed:', err.message));
        });
      },
    },
  ],
});
