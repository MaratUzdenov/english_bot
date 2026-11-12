import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// base = имя репозитория: Mini App живёт на https://maratuzdenov.github.io/english_bot/
export default defineConfig({
  base: '/english_bot/',
  plugins: [react()],
});
