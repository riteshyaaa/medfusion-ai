// vite.config.ts
import { defineConfig } from "file:///C:/Users/RITESH%20YADAV/Downloads/Skin-disease-detection-master/Skin-disease-detection-master/node_modules/.pnpm/vite@5.4.21_@types+node@22.20.5_lightningcss@1.32.0/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/RITESH%20YADAV/Downloads/Skin-disease-detection-master/Skin-disease-detection-master/node_modules/.pnpm/@vitejs+plugin-react@4.7.0__bf6e62bba417ca7e2e6ac94531b09ec2/node_modules/@vitejs/plugin-react/dist/index.js";
import tailwindcss from "file:///C:/Users/RITESH%20YADAV/Downloads/Skin-disease-detection-master/Skin-disease-detection-master/node_modules/.pnpm/@tailwindcss+vite@4.3.3_vit_cd3ec46a68a67d0b0c70479e96264af3/node_modules/@tailwindcss/vite/dist/index.mjs";
import path from "path";
var __vite_injected_original_dirname = "C:\\Users\\RITESH YADAV\\Downloads\\Skin-disease-detection-master\\Skin-disease-detection-master\\artifacts\\skin-ai";
var rawPort = process.env.PORT ?? "3000";
var port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}
var basePath = process.env.BASE_PATH ?? "/";
var vite_config_default = defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss()
  ],
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "src"),
      "@assets": path.resolve(__vite_injected_original_dirname, "..", "..", "attached_assets")
    },
    dedupe: ["react", "react-dom"]
  },
  root: path.resolve(__vite_injected_original_dirname),
  build: {
    outDir: path.resolve(__vite_injected_original_dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: process.env.API_BASE_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? "3001"}`,
        changeOrigin: false
      }
    },
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxSSVRFU0ggWUFEQVZcXFxcRG93bmxvYWRzXFxcXFNraW4tZGlzZWFzZS1kZXRlY3Rpb24tbWFzdGVyXFxcXFNraW4tZGlzZWFzZS1kZXRlY3Rpb24tbWFzdGVyXFxcXGFydGlmYWN0c1xcXFxza2luLWFpXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxSSVRFU0ggWUFEQVZcXFxcRG93bmxvYWRzXFxcXFNraW4tZGlzZWFzZS1kZXRlY3Rpb24tbWFzdGVyXFxcXFNraW4tZGlzZWFzZS1kZXRlY3Rpb24tbWFzdGVyXFxcXGFydGlmYWN0c1xcXFxza2luLWFpXFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9DOi9Vc2Vycy9SSVRFU0glMjBZQURBVi9Eb3dubG9hZHMvU2tpbi1kaXNlYXNlLWRldGVjdGlvbi1tYXN0ZXIvU2tpbi1kaXNlYXNlLWRldGVjdGlvbi1tYXN0ZXIvYXJ0aWZhY3RzL3NraW4tYWkvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdFwiO1xuaW1wb3J0IHRhaWx3aW5kY3NzIGZyb20gXCJAdGFpbHdpbmRjc3Mvdml0ZVwiO1xuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIjtcblxuY29uc3QgcmF3UG9ydCA9IHByb2Nlc3MuZW52LlBPUlQgPz8gXCIzMDAwXCI7XG5cbmNvbnN0IHBvcnQgPSBOdW1iZXIocmF3UG9ydCk7XG5cbmlmIChOdW1iZXIuaXNOYU4ocG9ydCkgfHwgcG9ydCA8PSAwKSB7XG4gIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBQT1JUIHZhbHVlOiBcIiR7cmF3UG9ydH1cImApO1xufVxuXG5jb25zdCBiYXNlUGF0aCA9IHByb2Nlc3MuZW52LkJBU0VfUEFUSCA/PyBcIi9cIjtcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgYmFzZTogYmFzZVBhdGgsXG4gIHBsdWdpbnM6IFtcbiAgICByZWFjdCgpLFxuICAgIHRhaWx3aW5kY3NzKCksXG4gIF0sXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgXCJAXCI6IHBhdGgucmVzb2x2ZShpbXBvcnQubWV0YS5kaXJuYW1lLCBcInNyY1wiKSxcbiAgICAgIFwiQGFzc2V0c1wiOiBwYXRoLnJlc29sdmUoaW1wb3J0Lm1ldGEuZGlybmFtZSwgXCIuLlwiLCBcIi4uXCIsIFwiYXR0YWNoZWRfYXNzZXRzXCIpLFxuICAgIH0sXG4gICAgZGVkdXBlOiBbXCJyZWFjdFwiLCBcInJlYWN0LWRvbVwiXSxcbiAgfSxcbiAgcm9vdDogcGF0aC5yZXNvbHZlKGltcG9ydC5tZXRhLmRpcm5hbWUpLFxuICBidWlsZDoge1xuICAgIG91dERpcjogcGF0aC5yZXNvbHZlKGltcG9ydC5tZXRhLmRpcm5hbWUsIFwiZGlzdC9wdWJsaWNcIiksXG4gICAgZW1wdHlPdXREaXI6IHRydWUsXG4gIH0sXG4gIHNlcnZlcjoge1xuICAgIHBvcnQsXG4gICAgaG9zdDogXCIwLjAuMC4wXCIsXG4gICAgYWxsb3dlZEhvc3RzOiB0cnVlLFxuICAgIHByb3h5OiB7XG4gICAgICBcIi9hcGlcIjoge1xuICAgICAgICB0YXJnZXQ6IHByb2Nlc3MuZW52LkFQSV9CQVNFX1VSTCA/PyBgaHR0cDovLzEyNy4wLjAuMToke3Byb2Nlc3MuZW52LkFQSV9QT1JUID8/IFwiMzAwMVwifWAsXG4gICAgICAgIGNoYW5nZU9yaWdpbjogZmFsc2UsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZnM6IHtcbiAgICAgIHN0cmljdDogdHJ1ZSxcbiAgICAgIGRlbnk6IFtcIioqLy4qXCJdLFxuICAgIH0sXG4gIH0sXG4gIHByZXZpZXc6IHtcbiAgICBwb3J0LFxuICAgIGhvc3Q6IFwiMC4wLjAuMFwiLFxuICAgIGFsbG93ZWRIb3N0czogdHJ1ZSxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUEyZ0IsU0FBUyxvQkFBb0I7QUFDeGlCLE9BQU8sV0FBVztBQUNsQixPQUFPLGlCQUFpQjtBQUN4QixPQUFPLFVBQVU7QUFIakIsSUFBTSxtQ0FBbUM7QUFLekMsSUFBTSxVQUFVLFFBQVEsSUFBSSxRQUFRO0FBRXBDLElBQU0sT0FBTyxPQUFPLE9BQU87QUFFM0IsSUFBSSxPQUFPLE1BQU0sSUFBSSxLQUFLLFFBQVEsR0FBRztBQUNuQyxRQUFNLElBQUksTUFBTSx3QkFBd0IsT0FBTyxHQUFHO0FBQ3BEO0FBRUEsSUFBTSxXQUFXLFFBQVEsSUFBSSxhQUFhO0FBRTFDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLE1BQU07QUFBQSxFQUNOLFNBQVM7QUFBQSxJQUNQLE1BQU07QUFBQSxJQUNOLFlBQVk7QUFBQSxFQUNkO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLEtBQUssUUFBUSxrQ0FBcUIsS0FBSztBQUFBLE1BQzVDLFdBQVcsS0FBSyxRQUFRLGtDQUFxQixNQUFNLE1BQU0saUJBQWlCO0FBQUEsSUFDNUU7QUFBQSxJQUNBLFFBQVEsQ0FBQyxTQUFTLFdBQVc7QUFBQSxFQUMvQjtBQUFBLEVBQ0EsTUFBTSxLQUFLLFFBQVEsZ0NBQW1CO0FBQUEsRUFDdEMsT0FBTztBQUFBLElBQ0wsUUFBUSxLQUFLLFFBQVEsa0NBQXFCLGFBQWE7QUFBQSxJQUN2RCxhQUFhO0FBQUEsRUFDZjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ047QUFBQSxJQUNBLE1BQU07QUFBQSxJQUNOLGNBQWM7QUFBQSxJQUNkLE9BQU87QUFBQSxNQUNMLFFBQVE7QUFBQSxRQUNOLFFBQVEsUUFBUSxJQUFJLGdCQUFnQixvQkFBb0IsUUFBUSxJQUFJLFlBQVksTUFBTTtBQUFBLFFBQ3RGLGNBQWM7QUFBQSxNQUNoQjtBQUFBLElBQ0Y7QUFBQSxJQUNBLElBQUk7QUFBQSxNQUNGLFFBQVE7QUFBQSxNQUNSLE1BQU0sQ0FBQyxPQUFPO0FBQUEsSUFDaEI7QUFBQSxFQUNGO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUDtBQUFBLElBQ0EsTUFBTTtBQUFBLElBQ04sY0FBYztBQUFBLEVBQ2hCO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
