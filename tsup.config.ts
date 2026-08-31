import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: {
    compilerOptions: {
      // tsup injects `baseUrl` into its dts build; TS 6 deprecates it (TS5101,
      // gone in 7). Our own tsconfig sets no deprecated options — this silences
      // only tsup's internal usage. Remove once tsup stops injecting baseUrl.
      ignoreDeprecations: '6.0',
    },
  },
  sourcemap: true,
  treeshake: true,
  clean: true,
});
