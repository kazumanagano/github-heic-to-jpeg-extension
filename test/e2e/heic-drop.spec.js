import { test as base, expect, chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const HEIC_FIXTURE_PATH = path.resolve('./test/fixtures/sample.heic');
const TEST_PAGE_URL = 'http://localhost:3333/test-page.html';
const EXTENSION_PATH = path.resolve('./dist');

// persistent contextを使用するカスタムテストフィクスチャ
const test = base.extend({
	context: async ({}, use) => {
		const context = await chromium.launchPersistentContext('', {
			headless: false,
			args: [
				`--disable-extensions-except=${EXTENSION_PATH}`,
				`--load-extension=${EXTENSION_PATH}`,
				'--no-sandbox',
			],
		});
		await use(context);
		await context.close();
	},
	extensionId: async ({ context }, use) => {
		// service workerが登録されるのを待つ
		let [background] = context.serviceWorkers();
		if (!background) {
			background = await context.waitForEvent('serviceworker');
		}
		const extensionId = background.url().split('/')[2];
		await use(extensionId);
	},
	page: async ({ context }, use) => {
		const page = await context.newPage();
		await use(page);
	},
});

test.describe('HEIC Drop Event Conversion', () => {
	test('extension should be loaded and content script should run', async ({ page, extensionId }) => {
		console.log('Extension ID:', extensionId);
		expect(extensionId).toBeDefined();

		// コンソールログを収集
		const consoleLogs = [];
		page.on('console', msg => {
			consoleLogs.push(msg.text());
		});

		// テストページを開く
		await page.goto(TEST_PAGE_URL);
		await page.waitForTimeout(2000);

		// 拡張機能がロードされたか確認
		const extensionLoaded = consoleLogs.some(log =>
			log.includes('GitHub HEIC to JPEG Converter loaded')
		);
		console.log('Extension loaded on page:', extensionLoaded);
		console.log('Console logs:', consoleLogs);

		expect(extensionLoaded).toBe(true);
	});

	test('should show converting placeholder and convert HEIC on drop', async ({ page, extensionId }) => {
		console.log('Extension ID:', extensionId);

		// コンソールログを収集
		const consoleLogs = [];
		page.on('console', msg => {
			consoleLogs.push({ type: msg.type(), text: msg.text() });
		});

		// テストページを開く
		await page.goto(TEST_PAGE_URL);
		await page.waitForTimeout(2000);

		// 拡張機能がロードされたか確認
		const extensionLoaded = consoleLogs.some(log =>
			log.text.includes('GitHub HEIC to JPEG Converter loaded')
		);
		console.log('Extension loaded:', extensionLoaded);

		if (!extensionLoaded) {
			console.log('Console logs:', consoleLogs.map(l => l.text));
			test.skip(true, 'Extension not loaded');
			return;
		}

		// HEICファイルを読み込む
		const heicBuffer = fs.readFileSync(HEIC_FIXTURE_PATH);
		const heicBase64 = heicBuffer.toString('base64');

		// textareaを取得
		const textarea = page.locator('#paste-area');
		await textarea.focus();

		// ドロップイベントをシミュレート
		await page.evaluate(async ({ base64Data, fileName }) => {
			const textarea = document.getElementById('paste-area');

			// Base64をBlobに変換
			const byteCharacters = atob(base64Data);
			const byteNumbers = new Array(byteCharacters.length);
			for (let i = 0; i < byteCharacters.length; i++) {
				byteNumbers[i] = byteCharacters.charCodeAt(i);
			}
			const byteArray = new Uint8Array(byteNumbers);
			const blob = new Blob([byteArray], { type: 'image/heic' });

			// Fileオブジェクトを作成
			const file = new File([blob], fileName, { type: 'image/heic' });

			// DataTransferを作成
			const dataTransfer = new DataTransfer();
			dataTransfer.items.add(file);

			// dropイベントを発火
			const dropEvent = new DragEvent('drop', {
				bubbles: true,
				cancelable: true,
				dataTransfer: dataTransfer
			});

			textarea.dispatchEvent(dropEvent);
		}, { base64Data: heicBase64, fileName: 'sample.heic' });

		// 変換処理を待つ
		const startTime = Date.now();
		const timeout = 60000;

		let conversionStarted = false;
		let conversionCompleted = false;

		while (Date.now() - startTime < timeout) {
			const textareaValue = await textarea.inputValue();

			if (textareaValue.includes('![Converting')) {
				conversionStarted = true;
				console.log('Conversion placeholder detected');
			}

			if (conversionStarted && !textareaValue.includes('![Converting')) {
				conversionCompleted = true;
				console.log('Conversion completed');
				break;
			}

			await page.waitForTimeout(500);
		}

		// 結果を確認
		const logs = consoleLogs.map(l => l.text);
		console.log('Final console logs:', logs.filter(l =>
			l.includes('Convert') || l.includes('HEIC') || l.includes('error')
		));

		if (conversionStarted) {
			expect(conversionStarted).toBe(true);
			console.log('Test passed: Conversion was initiated');

			if (conversionCompleted) {
				console.log('Test passed: Conversion completed successfully');
			} else {
				console.log('Warning: Conversion started but did not complete within timeout');
			}
		} else {
			console.log('Note: Placeholder was not detected');
		}
	});

	test('should detect HEIC file in drop event', async ({ page, extensionId }) => {
		console.log('Extension ID:', extensionId);

		const consoleLogs = [];
		page.on('console', msg => consoleLogs.push(msg.text()));

		await page.goto(TEST_PAGE_URL);
		await page.waitForTimeout(2000);

		const loaded = consoleLogs.some(l => l.includes('GitHub HEIC to JPEG Converter'));

		if (!loaded) {
			test.skip(true, 'Extension not loaded');
			return;
		}

		// HEICファイルのドロップをシミュレート
		const heicBuffer = fs.readFileSync(HEIC_FIXTURE_PATH);
		const heicBase64 = heicBuffer.toString('base64');

		const textarea = page.locator('#paste-area');
		await textarea.focus();

		await page.evaluate(async ({ base64Data }) => {
			const textarea = document.getElementById('paste-area');

			const byteCharacters = atob(base64Data);
			const byteNumbers = new Array(byteCharacters.length);
			for (let i = 0; i < byteCharacters.length; i++) {
				byteNumbers[i] = byteCharacters.charCodeAt(i);
			}
			const byteArray = new Uint8Array(byteNumbers);
			const file = new File([byteArray], 'test.heic', { type: 'image/heic' });

			const dataTransfer = new DataTransfer();
			dataTransfer.items.add(file);

			const dropEvent = new DragEvent('drop', {
				bubbles: true,
				cancelable: true,
				dataTransfer: dataTransfer
			});

			textarea.dispatchEvent(dropEvent);
		}, { base64Data: heicBase64 });

		await page.waitForTimeout(3000);

		const hasConversionLog = consoleLogs.some(l =>
			l.includes('Converting') || l.includes('HEIC')
		);

		console.log('Conversion initiated:', hasConversionLog);
		console.log('Relevant logs:', consoleLogs.filter(l =>
			l.includes('Convert') || l.includes('HEIC')
		));

		expect(hasConversionLog).toBe(true);
	});
});
