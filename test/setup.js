import 'fake-indexeddb/auto';
import { vi } from 'vitest';

// Chrome Storage API Mock
const createStorageMock = () => {
	let storage = {};

	return {
		get: vi.fn((keys) => {
			return Promise.resolve(
				keys === null
					? { ...storage }
					: typeof keys === 'string'
						? { [keys]: storage[keys] }
						: Object.fromEntries(
							Object.keys(keys).map(k => [k, storage[k]])
						)
			);
		}),
		set: vi.fn((items) => {
			Object.assign(storage, items);
			return Promise.resolve();
		}),
		remove: vi.fn((keys) => {
			const keyArray = Array.isArray(keys) ? keys : [keys];
			keyArray.forEach(k => delete storage[k]);
			return Promise.resolve();
		}),
		clear: vi.fn(() => {
			storage = {};
			return Promise.resolve();
		}),
		// Expose for testing
		_getAll: () => ({ ...storage }),
		_reset: () => { storage = {}; }
	};
};

// Chrome Runtime API Mock
const createRuntimeMock = () => {
	const listeners = [];

	return {
		id: 'mock-extension-id',
		getURL: vi.fn((path) => `chrome-extension://mock-extension-id/${path}`),
		sendMessage: vi.fn((message) => {
			listeners.forEach(listener => listener(message, {}, () => { }));
			return Promise.resolve();
		}),
		onMessage: {
			addListener: vi.fn((callback) => {
				listeners.push(callback);
			}),
			removeListener: vi.fn((callback) => {
				const index = listeners.indexOf(callback);
				if (index > -1) listeners.splice(index, 1);
			})
		},
		getContexts: vi.fn(() => Promise.resolve([]))
	};
};

// Chrome Offscreen API Mock
const createOffscreenMock = () => ({
	createDocument: vi.fn(() => Promise.resolve())
});

// Global chrome mock
global.chrome = {
	storage: {
		local: createStorageMock()
	},
	runtime: createRuntimeMock(),
	offscreen: createOffscreenMock()
};

// Reset mocks before each test
beforeEach(() => {
	vi.clearAllMocks();
	global.chrome.storage.local._reset();
});
