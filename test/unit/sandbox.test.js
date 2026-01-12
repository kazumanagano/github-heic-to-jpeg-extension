import { describe, it, expect, vi } from 'vitest';

// sandbox.js からエクスポートされていない関数をテストするため、
// 同じロジックを再現してテスト
// 実際のプロダクションでは関数をエクスポートすることを推奨

/**
 * エラーメッセージを抽出する（sandbox.jsと同じロジック）
 */
function getErrorMessage(error) {
	if (typeof error === 'string') return error;
	if (error instanceof Error) return error.message;
	if (error && typeof error === 'object') {
		if (error.message) return error.message;
		if (error.error) return getErrorMessage(error.error);
		return JSON.stringify(error);
	}
	return 'Unknown error';
}

/**
 * BlobをBase64文字列に変換する（sandbox.jsと同じロジック）
 */
function blobToBase64(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => resolve(reader.result);
		reader.onerror = () => reject(new Error('Failed to read blob'));
		reader.readAsDataURL(blob);
	});
}

describe('sandbox.js utility functions', () => {
	describe('getErrorMessage', () => {
		it('should return string error as-is', () => {
			expect(getErrorMessage('simple error')).toBe('simple error');
		});

		it('should extract message from Error object', () => {
			const error = new Error('test error message');
			expect(getErrorMessage(error)).toBe('test error message');
		});

		it('should extract message from object with message property', () => {
			expect(getErrorMessage({ message: 'object error' })).toBe('object error');
		});

		it('should recursively extract from nested error property', () => {
			const nested = { error: { message: 'nested error' } };
			expect(getErrorMessage(nested)).toBe('nested error');
		});

		it('should JSON stringify object without message', () => {
			const obj = { code: 500, status: 'failed' };
			expect(getErrorMessage(obj)).toBe(JSON.stringify(obj));
		});

		it('should return "Unknown error" for null/undefined', () => {
			expect(getErrorMessage(null)).toBe('Unknown error');
			expect(getErrorMessage(undefined)).toBe('Unknown error');
		});
	});

	describe('blobToBase64', () => {
		it('should convert blob to base64 data URL', async () => {
			const blob = new Blob(['test content'], { type: 'text/plain' });
			const result = await blobToBase64(blob);

			expect(result).toMatch(/^data:text\/plain;base64,/);
		});

		it('should convert image blob to base64', async () => {
			// 1x1 red pixel PNG
			const pngData = new Uint8Array([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
				0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
				0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
				0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
				0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00,
				0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00,
				0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
			]);
			const blob = new Blob([pngData], { type: 'image/png' });
			const result = await blobToBase64(blob);

			expect(result).toMatch(/^data:image\/png;base64,/);
		});

		it('should handle empty blob', async () => {
			const blob = new Blob([], { type: 'application/octet-stream' });
			const result = await blobToBase64(blob);

			expect(result).toBe('data:application/octet-stream;base64,');
		});
	});
});
