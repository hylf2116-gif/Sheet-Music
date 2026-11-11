import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Third-party PDF.js files copied into public/ (minified, not our code).
    "public/**",
    // Node build scripts (CommonJS by design).
    "scripts/**",
  ]),
  {
    rules: {
      // Annotation objects are free-form JSON synced over Socket.IO and are typed as `any`.
      // Kept visible as warnings until a shared Annotation type is introduced.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
]);

export default eslintConfig;
