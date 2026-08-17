import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  /**
   * The app is light-only, like ManyChat's builder.
   *
   * Setting the strategy to `class` without ever adding the class means the
   * `dark:` variants below never fire. Before this, `body` was hard-coded
   * light while node components carried `dark:` variants that followed the
   * OS — so a viewer on a dark system got a light chrome around a dark
   * canvas, with unreadable pairs like near-black text on a dark card.
   */
  darkMode: "class",
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
