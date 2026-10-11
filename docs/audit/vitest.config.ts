import { defineConfig } from 'vitest/config';
import projectConfig from '../../vitest.config';

// Keep defect-observation assertions out of the ordinary correctness test suite.
export default defineConfig({
  ...projectConfig,
  test: { ...projectConfig.test, include: ['docs/audit/*.probe.ts'] },
});
