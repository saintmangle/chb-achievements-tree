import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  cacheDir: ".cache/vite",
  base: "/chb-achievements-tree/",
  plugins: [react()],
});
