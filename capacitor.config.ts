import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.oxmmatch.app',
  appName: 'OXM傳產媒合',
  webDir: 'dist/public',
  server: {
    url: 'https://www.oxmmatch.com',
    androidScheme: 'https',
    cleartext: false,
  },
};

export default config;
