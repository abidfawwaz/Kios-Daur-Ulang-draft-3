/** Seluruh token warna dibaca dari variabel CSS di src/styles/tokens.css (satu berkas, PRD R-06). */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        teal: { DEFAULT: 'var(--teal)', dark: 'var(--teal-dark)', tint: 'var(--teal-tint)' },
        gold: { DEFAULT: 'var(--gold)', tint: 'var(--gold-tint)' },
        ink: { DEFAULT: 'var(--ink)', soft: 'var(--ink-soft)' },
        line: 'var(--line)',
        page: 'var(--page)',
        danger: { DEFAULT: 'var(--danger)', tint: 'var(--danger-tint)' },
      },
      fontFamily: { sans: ['Lato', 'Arial', 'sans-serif'] },
      borderRadius: { card: '16px', ctl: '10px' },
      boxShadow: { card: '0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.08)' },
    },
  },
  plugins: [],
};
