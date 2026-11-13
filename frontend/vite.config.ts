import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: http://localhost:5183 with the Frappe site (baogee desk, :8009) behind the proxy.
// Build: biometric_sync/public/console, served by the site at /biometric (→ /assets/biometric_sync/console/).
const target = process.env.FRAPPE_URL || "http://127.0.0.1:8009";
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/assets/biometric_sync/console/" : "/",
  plugins: [react()],
  server: {
    port: 5183,
    host: true,
    proxy: Object.fromEntries(["/api", "/assets", "/files", "/login", "/checkin-display", "/app"].map((p) => [p, { target, changeOrigin: false }])),
  },
  build: {
    outDir: "../biometric_sync/public/console",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
}));
