import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// base "/partner/" only for production builds (served at :3001/partner);
// dev server stays at the root of :5174
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/partner/" : "/",
  server: {
    port: 5174,
    proxy: {
      "/api": "http://localhost:3001",
      "/socket.io": { target: "http://localhost:3001", ws: true },
    },
  },
}));
