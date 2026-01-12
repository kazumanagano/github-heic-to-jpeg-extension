import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'jsdom',
		setupFiles: ['./test/setup.js'],
		include: ['test/unit/**/*.test.js'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['src/**/*.js'],
			exclude: ['src/content.js'] // content.js は DOM 依存が多いため除外
		}
	}
});
