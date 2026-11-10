import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.asmo.inventory.v2',
  appName: 'ASMO Spare Parts Inventory',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true,
    allowNavigation: [
      'generativelanguage.googleapis.com',
      '*.googleapis.com',
      '*.run.app',
      '*',
    ],
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
