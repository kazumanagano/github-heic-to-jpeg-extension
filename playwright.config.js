import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
	testDir: './test/e2e',
	fullyParallel: false, // 拡張機能テストは並列実行しない
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1, // 拡張機能テストは1ワーカーで実行
	reporter: 'html',
	timeout: 60000, // HEIC変換に時間がかかる場合があるため長めに設定

	// テスト用にmanifest.jsonを一時的に変更
	globalSetup: './test/e2e/global-setup.js',
	globalTeardown: './test/e2e/global-teardown.js',

	// ローカルテストサーバー（distフォルダを提供）
	webServer: {
		command: 'pnpm exec serve dist -p 3333',
		port: 3333,
		reuseExistingServer: !process.env.CI,
	},

	use: {
		trace: 'on-first-retry',
		video: 'on-first-retry',
		baseURL: 'http://localhost:3333',
	},

	projects: [
		{
			name: 'chromium-extension',
			use: {
				browserName: 'chromium',
				// 拡張機能をロードするための設定
				launchOptions: {
					args: [
						`--disable-extensions-except=${path.resolve('./dist')}`,
						`--load-extension=${path.resolve('./dist')}`,
						'--no-sandbox',
						'--allow-file-access-from-files',
						'--allow-file-access',
					],
					headless: false, // 拡張機能はヘッドレスでは動作しない
				},
			},
		},
	],
});
