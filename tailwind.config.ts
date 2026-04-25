import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      keyframes: {
        flashRed: {
          "0%, 100%": { backgroundColor: "#ef4444" },
          "50%": { backgroundColor: "#fca5a5" },
        },
      },
      animation: {
        "flash-red": "flashRed 0.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
