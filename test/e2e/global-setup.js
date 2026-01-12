/**
 * Playwright global setup
 * テスト開始前にmanifest.jsonをテストモードに変更し、テストページをdistにコピー
 */
import fs from 'fs';
import path from 'path';
import { enableTestMode } from './setup-test-manifest.js';

export default async function globalSetup() {
	enableTestMode();

	// テストページをdistフォルダにコピー
	const srcPage = path.resolve('./test/fixtures/test-page.html');
	const destPage = path.resolve('./dist/test-page.html');
	fs.copyFileSync(srcPage, destPage);
	console.log('Copied test-page.html to dist/');
}
