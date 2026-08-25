/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand / GulfTax dark-theme tokens (kept for existing screens)
        gold: '#C9A84C',
        'gold-lt': '#E8C96A',
        'gold-pale': 'rgba(201,168,76,0.12)',
        deep: '#040D1F',
        navy: '#071226',
        card: {
          DEFAULT: '#0A1A35',
          foreground: '#e2e8f0',
        },
        card2: '#0E2040',
        border: {
          DEFAULT: 'rgba(78,168,255,0.12)',
        },
        'border-g': 'rgba(201,168,76,0.22)',
        muted: {
          DEFAULT: '#7A9BB5',
          foreground: '#4b5563',
        },
        muted2: '#3A5070',
        green: '#2DD4A0',
        blue: '#4EA8FF',
        'blue-bright': '#60BFFF',
        red: '#FF6B6B',
        amber: '#FFA940',

        // shadcn/ui light-surface tokens (dialogs, buttons, selects, etc.)
        background: '#ffffff',
        foreground: '#111827',
        popover: {
          DEFAULT: '#ffffff',
          foreground: '#111827',
        },
        primary: {
          DEFAULT: '#0A4B8F',
          foreground: '#ffffff',
        },
        secondary: {
          DEFAULT: '#f3f4f6',
          foreground: '#111827',
        },
        accent: {
          DEFAULT: '#f3f4f6',
          foreground: '#111827',
        },
        destructive: {
          DEFAULT: '#dc2626',
          foreground: '#ffffff',
        },
        input: '#e5e7eb',
        ring: '#0A4B8F',
      },
    },
  },
  plugins: [],
}
