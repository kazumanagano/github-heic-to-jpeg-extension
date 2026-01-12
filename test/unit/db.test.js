import { describe, it, expect, beforeEach } from 'vitest';
import { openDB, saveImage, getImage, deleteImage, clearAllImages } from '../../src/db.js';

describe('db.js - IndexedDB operations', () => {
	beforeEach(async () => {
		// Clear all data before each test
		await clearAllImages();
	});

	describe('openDB', () => {
		it('should open database successfully', async () => {
			const db = await openDB();
			expect(db).toBeDefined();
			expect(db.name).toBe('HeicConverterDB');
		});

		it('should create object store on first open', async () => {
			const db = await openDB();
			expect(db.objectStoreNames.contains('images')).toBe(true);
		});
	});

	describe('saveImage', () => {
		it('should save data with a key', async () => {
			const testData = { data: 'base64data', fileName: 'test.heic' };
			await saveImage('test-key', testData);

			const result = await getImage('test-key');
			expect(result).toEqual(testData);
		});

		it('should overwrite existing data with same key', async () => {
			await saveImage('test-key', { data: 'old' });
			await saveImage('test-key', { data: 'new' });

			const result = await getImage('test-key');
			expect(result.data).toBe('new');
		});
	});

	describe('getImage', () => {
		it('should return undefined for non-existent key', async () => {
			const result = await getImage('non-existent');
			expect(result).toBeUndefined();
		});

		it('should return saved data', async () => {
			const testData = { data: 'test-data', fileName: 'image.heic' };
			await saveImage('my-key', testData);

			const result = await getImage('my-key');
			expect(result).toEqual(testData);
		});
	});

	describe('deleteImage', () => {
		it('should delete existing data', async () => {
			await saveImage('delete-me', { data: 'temp' });
			await deleteImage('delete-me');

			const result = await getImage('delete-me');
			expect(result).toBeUndefined();
		});

		it('should not throw when deleting non-existent key', async () => {
			await expect(deleteImage('non-existent')).resolves.not.toThrow();
		});
	});

	describe('clearAllImages', () => {
		it('should clear all stored data', async () => {
			await saveImage('key1', { data: 'data1' });
			await saveImage('key2', { data: 'data2' });
			await saveImage('key3', { data: 'data3' });

			await clearAllImages();

			expect(await getImage('key1')).toBeUndefined();
			expect(await getImage('key2')).toBeUndefined();
			expect(await getImage('key3')).toBeUndefined();
		});
	});
});
