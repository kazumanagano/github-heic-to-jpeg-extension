/**
 * Playwright global teardown
 * テスト終了後にmanifest.jsonを元に戻す
 */
import { disableTestMode } from './setup-test-manifest.js';

export default async function globalTeardown() {
	disableTestMode();
}
