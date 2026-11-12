/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b172a",
        slate: "#243247",
        mist: "#f4f7fb",
        teal: { 50: "#ecfdf8", 100: "#d0f7ec", 500: "#0d9488", 600: "#0f766e", 700: "#115e59" },
        amber: { 50: "#fffbeb", 100: "#fef3c7", 500: "#f59e0b", 700: "#b45309" },
        danger: { 50: "#fff1f2", 100: "#ffe4e6", 500: "#e11d48", 600: "#be123c", 700: "#9f1239" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(11,23,42,.04), 0 8px 24px -16px rgba(11,23,42,.22)",
      },
      minHeight: { touch: "48px" },
      minWidth: { touch: "48px" },
    },
  },
  plugins: [],
};
