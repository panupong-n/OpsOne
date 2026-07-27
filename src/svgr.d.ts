/// <reference types="vite/client" />

// SVG imported as a React component via vite-plugin-svgr (named export, per vite.config)
declare module '*.svg?react' {
  import * as React from 'react';
  export const ReactComponent: React.FC<React.SVGProps<SVGSVGElement>>;
  const src: string;
  export default src;
}
