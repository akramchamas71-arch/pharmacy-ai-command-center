/** @type {import('tailwindcss').Config} */
// مظهر "مرِح وودود" — مطابق لوحدة الصيدليات (حبر كحلي، أصفر شمس، مرجاني، ظلال صلبة).
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-tajawal)", "Tahoma", "Arial", "sans-serif"],
        display: ["var(--font-baloo)", "var(--font-tajawal)", "Tahoma", "sans-serif"],
      },
      colors: {
        // «slate» أصبح كحلياً مائلاً للأزرق (نفس حبر وحدة الصيدليات #1d2b4f)
        slate: {
          50: "#f3f7ff",
          100: "#e9f0ff",
          200: "#d3def5",
          300: "#b9c7e8",
          400: "#667396",
          500: "#55648a",
          600: "#46557c",
          700: "#34436b",
          800: "#263458",
          900: "#1d2b4f",
          950: "#141a33",
        },
        // اللون الأساسي: مرجاني (#ee4a34)
        brand: {
          50: "#fff1ee",
          100: "#ffe3dd",
          200: "#ffc6bb",
          300: "#ffa08e",
          400: "#ff7a64",
          500: "#f45f47",
          600: "#ee4a34",
          700: "#c93823",
          800: "#9f2c1b",
          900: "#7c2517",
          950: "#45130b",
        },
        sun: "#ffd34d",
        ink: "#1d2b4f",
      },
      boxShadow: {
        card: "0 5px 0 #1d2b4f",
        pop: "0 5px 0 #1d2b4f",
        "pop-sm": "0 3px 0 #1d2b4f",
        "pop-lg": "0 8px 0 #1d2b4f",
      },
      borderRadius: {
        "4xl": "28px",
      },
    },
  },
  plugins: [],
};
