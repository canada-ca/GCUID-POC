/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENV?: string;
}

export {};

declare global {
  const __BUILD_VERSION__: string;
}
