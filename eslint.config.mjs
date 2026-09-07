import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/** @type {import("eslint").Linter.Config[]} */
const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "prisma/migrations/**",
      "next-env.d.ts",
      "public/**",
    ],
  },
  ...coreWebVitals,
  ...typescript,
];

export default config;
