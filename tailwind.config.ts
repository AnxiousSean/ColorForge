import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Overlay colours shared by the editor and the preflight report.
        bleed: "#ef4444",
        trim: "#0ea5e9",
        safe: "#22c55e",
      },
    },
  },
  plugins: [],
};

export default config;
