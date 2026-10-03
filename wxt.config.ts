import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'DesignLens',
    description:
      "Personal-use tool that extracts a website's design and generates a design.md for AI coding agents.",
    permissions: ['sidePanel', 'activeTab', 'scripting', 'storage', 'downloads', 'tabs', 'debugger'],
    host_permissions: ['<all_urls>'],
    // icons/ are auto-discovered from public/icon (npm run icons regenerates them).
    // An action is required so the toolbar icon exists; the background script makes
    // clicking it open the side panel (there is no popup).
    action: {
      default_title: 'Open DesignLens',
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    },
  },
});
