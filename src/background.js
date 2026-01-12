import { saveImage, getImage, deleteImage, clearAllImages } from './db.js';

let creating; // A global promise to avoid concurrency issues

async function setupOffscreenDocument(path) {
	// Check if already exists
	const existingContexts = await chrome.runtime.getContexts({
		contextTypes: ['OFFSCREEN_DOCUMENT']
	});
	if (existingContexts.length > 0) {
		console.log('Offscreen document already exists');
		return true;
	}

	// create offscreen document
	if (creating) {
		await creating;
	} else {
		creating = chrome.offscreen.createDocument({
			url: path,
			reasons: ['BLOBS'],
			justification: 'To convert HEIC images to JPEG without CSP restrictions',
		});
		await creating;
		creating = null;
	}
	console.log('Offscreen document created');
	return true;
}

// 現在のリクエスト以外の古いデータをクリーンアップ
async function cleanupAllData(currentRequestId) {
	try {
		const currentKey = `request_${currentRequestId}`;

		// Get all keys from storage
		const allData = await chrome.storage.local.get(null);
		const keysToRemove = Object.keys(allData).filter(key =>
			key !== currentKey && (
				key.startsWith('request_') || key.startsWith('result_') || key.startsWith('convert_')
			)
		);

		if (keysToRemove.length > 0) {
			await chrome.storage.local.remove(keysToRemove);
			console.log('Cleaned up old storage keys:', keysToRemove.length);
		}

		// Also clear IndexedDB
		await clearAllImages();
	} catch (e) {
		console.error('Cleanup error:', e);
	}
}

// 変換を実行する関数
async function performConversion(requestId) {
	const requestKey = `request_${requestId}`;

	// Cleanup all old data first (except current request)
	await cleanupAllData(requestId);

	// 1. Get data from storage
	console.log(`Reading request data for ${requestId} from storage...`);
	const storedData = await chrome.storage.local.get(requestKey);
	const requestData = storedData[requestKey];

	if (!requestData) {
		throw new Error(`No data found for request ${requestId}`);
	}

	// 2. Save to IndexedDB for offscreen access
	console.log(`Saving request data to IndexedDB...`);
	await saveImage(requestKey, requestData);

	// 3. Setup offscreen document
	console.log('Setting up offscreen document...');
	await setupOffscreenDocument('offscreen.html');

	// 4. Wait a moment for offscreen to initialize
	await new Promise(resolve => setTimeout(resolve, 500));

	// 5. Send message to offscreen (fire-and-forget, no response expected)
	console.log('Sending conversion request to offscreen...');
	chrome.runtime.sendMessage({
		target: 'offscreen',
		action: 'CONVERT_HEIC',
		requestId: requestId
	});

	// 6. Wait for result in IndexedDB (polling)
	const resultKey = `result_${requestId}`;
	const startTime = Date.now();
	const timeout = 60000;

	while (Date.now() - startTime < timeout) {
		const resultData = await getImage(resultKey);
		if (resultData) {
			console.log(`Got result from IndexedDB for ${requestId}`);

			// Save result to chrome.storage.local for content script
			await chrome.storage.local.set({
				[resultKey]: resultData
			});

			// Cleanup IndexedDB
			await deleteImage(requestKey);
			await deleteImage(resultKey);

			console.log('Conversion complete');
			return;
		}

		await new Promise(resolve => setTimeout(resolve, 300));
	}

	throw new Error('Conversion timeout');
}

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	// Ignore messages meant for offscreen
	if (request.target === 'offscreen') {
		return false;
	}

	if (request.action === 'CONVERT_HEIC') {
		console.log('Background received CONVERT_HEIC request for:', request.requestId);

		// Start conversion asynchronously (don't wait for sendResponse)
		performConversion(request.requestId)
			.then(() => {
				console.log('Conversion completed for:', request.requestId);
			})
			.catch((error) => {
				console.error('Conversion error:', error);
				// Save error to storage so content script can see it
				chrome.storage.local.set({
					[`result_${request.requestId}`]: { error: error.message }
				});
			});

		// Return immediately (no async wait)
		return false;
	}
});
