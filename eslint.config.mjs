import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

// eslint-config-next 15 still ships legacy shareable configs; FlatCompat
// turns them into flat config entries for ESLint 9.
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  { ignores: ["node_modules/**", ".next/**", "next-env.d.ts", "prisma/migrations/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];
