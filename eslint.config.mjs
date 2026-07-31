import coreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/** @type {import('eslint').Linter.Config[]} */
const config = [
  { ignores: [".next/**", "out/**", "build/**", "node_modules/**"] },
  ...coreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // CLAUDE.md §6：TypeScript strict，禁 any
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
];

export default config;
