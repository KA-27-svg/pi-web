/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // 对话区统一宽度：消息流与输入框共用，单点可调
      maxWidth: {
        content: '48rem',
      },
      colors: {
        background: "var(--background)",
        surface: "var(--surface)",
        "surface-hover": "var(--surface-hover)",
        foreground: "var(--foreground)",
        muted: "var(--muted)",
        border: "var(--border)",
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
          hover: "var(--accent-hover)",
        },
      },
    },
  },
  plugins: [],
}
