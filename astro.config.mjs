import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://yetzironet.co.il',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
