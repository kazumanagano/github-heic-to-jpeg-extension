import { describe, it, expect, vi, beforeEach } from 'vitest';

// content.js からエクスポートされていない関数をテストするため、
// 同じロジックを再現してテスト

/**
 * テキストエリアにプレースホルダーテキストを挿入
 */
function insertPlaceholder(textarea, text) {
	const start = textarea.selectionStart;
	const end = textarea.selectionEnd;
	const before = textarea.value.substring(0, start);
	const after = textarea.value.substring(end);

	textarea.value = before + text + after;
	textarea.selectionStart = textarea.selectionEnd = start + text.length;

	textarea.dispatchEvent(new Event('input', { bubbles: true }));

	return start;
}

/**
 * テキストエリアからプレースホルダーテキストを削除
 */
function removePlaceholder(textarea, placeholder, insertPosition) {
	const value = textarea.value;
	const placeholderIndex = value.indexOf(placeholder, insertPosition);

	if (placeholderIndex !== -1) {
		textarea.value = value.substring(0, placeholderIndex) + value.substring(placeholderIndex + placeholder.length);
		textarea.selectionStart = textarea.selectionEnd = placeholderIndex;

		textarea.dispatchEvent(new Event('input', { bubbles: true }));
	}
}

/**
 * ファイルをBase64文字列に変換
 */
function fileToBase64(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

describe('content.js utility functions', () => {
	describe('insertPlaceholder', () => {
		let textarea;

		beforeEach(() => {
			textarea = document.createElement('textarea');
			document.body.appendChild(textarea);
		});

		it('should insert text at cursor position', () => {
			textarea.value = 'Hello World';
			textarea.selectionStart = textarea.selectionEnd = 6; // After "Hello "

			insertPlaceholder(textarea, '[PLACEHOLDER]');

			expect(textarea.value).toBe('Hello [PLACEHOLDER]World');
		});

		it('should insert at beginning when cursor is at start', () => {
			textarea.value = 'existing text';
			textarea.selectionStart = textarea.selectionEnd = 0;

			insertPlaceholder(textarea, 'NEW: ');

			expect(textarea.value).toBe('NEW: existing text');
		});

		it('should insert at end when cursor is at end', () => {
			textarea.value = 'text';
			textarea.selectionStart = textarea.selectionEnd = 4;

			insertPlaceholder(textarea, ' END');

			expect(textarea.value).toBe('text END');
		});

		it('should replace selected text', () => {
			textarea.value = 'replace THIS word';
			textarea.selectionStart = 8;
			textarea.selectionEnd = 12; // "THIS" selected

			insertPlaceholder(textarea, 'THAT');

			expect(textarea.value).toBe('replace THAT word');
		});

		it('should return insertion position', () => {
			textarea.value = 'test';
			textarea.selectionStart = textarea.selectionEnd = 2;

			const position = insertPlaceholder(textarea, 'XX');

			expect(position).toBe(2);
		});

		it('should dispatch input event', () => {
			const inputHandler = vi.fn();
			textarea.addEventListener('input', inputHandler);

			insertPlaceholder(textarea, 'test');

			expect(inputHandler).toHaveBeenCalled();
		});

		it('should update cursor position after insertion', () => {
			textarea.value = '';
			textarea.selectionStart = textarea.selectionEnd = 0;

			insertPlaceholder(textarea, '12345');

			expect(textarea.selectionStart).toBe(5);
			expect(textarea.selectionEnd).toBe(5);
		});
	});

	describe('removePlaceholder', () => {
		let textarea;

		beforeEach(() => {
			textarea = document.createElement('textarea');
			document.body.appendChild(textarea);
		});

		it('should remove placeholder text', () => {
			textarea.value = 'Hello [PLACEHOLDER] World';

			removePlaceholder(textarea, '[PLACEHOLDER]', 0);

			expect(textarea.value).toBe('Hello  World');
		});

		it('should search from insertPosition', () => {
			textarea.value = '[A] text [A] more';
			// Should find the second [A] starting from position 5
			removePlaceholder(textarea, '[A]', 5);

			expect(textarea.value).toBe('[A] text  more');
		});

		it('should not modify if placeholder not found', () => {
			textarea.value = 'no placeholder here';

			removePlaceholder(textarea, '[MISSING]', 0);

			expect(textarea.value).toBe('no placeholder here');
		});

		it('should dispatch input event on removal', () => {
			textarea.value = 'text [X] more';
			const inputHandler = vi.fn();
			textarea.addEventListener('input', inputHandler);

			removePlaceholder(textarea, '[X]', 0);

			expect(inputHandler).toHaveBeenCalled();
		});

		it('should set cursor to removal position', () => {
			textarea.value = 'ABC[DEL]XYZ';

			removePlaceholder(textarea, '[DEL]', 0);

			expect(textarea.selectionStart).toBe(3);
			expect(textarea.selectionEnd).toBe(3);
		});
	});

	describe('fileToBase64', () => {
		it('should convert file to base64 data URL', async () => {
			const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
			const result = await fileToBase64(file);

			expect(result).toMatch(/^data:text\/plain;base64,/);
		});

		it('should handle image file', async () => {
			// 1x1 transparent PNG
			const pngData = new Uint8Array([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
			]);
			const file = new File([pngData], 'image.png', { type: 'image/png' });
			const result = await fileToBase64(file);

			expect(result).toMatch(/^data:image\/png;base64,/);
		});

		it('should preserve file content', async () => {
			const originalContent = 'Hello, World!';
			const file = new File([originalContent], 'test.txt', { type: 'text/plain' });
			const result = await fileToBase64(file);

			// Decode and verify
			const base64Part = result.split(',')[1];
			const decoded = atob(base64Part);
			expect(decoded).toBe(originalContent);
		});
	});

	describe('placeholder integration', () => {
		it('should insert and remove placeholder correctly', () => {
			const textarea = document.createElement('textarea');
			textarea.value = 'Comment: ';
			textarea.selectionStart = textarea.selectionEnd = 9;

			const placeholder = '![Converting test.heic...]()\n';
			const position = insertPlaceholder(textarea, placeholder);

			expect(textarea.value).toBe('Comment: ![Converting test.heic...]()\n');

			removePlaceholder(textarea, placeholder, position);

			expect(textarea.value).toBe('Comment: ');
		});
	});
});
