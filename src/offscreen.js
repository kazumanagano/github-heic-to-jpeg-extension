import { getImage, saveImage } from './db.js';

console.log('Offscreen script loaded (v8 - Detailed Logging)');

let sandboxFrame = null;
let sandboxReady = false;
let pendingRequests = new Map();

// Conversion queue to prevent sandbox reset during conversion
let conversionQueue = [];
let isProcessing = false;

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes) {
	if (!bytes) return '0 B';
	if (bytes < 1024) return bytes + ' B';
	if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
	return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// Reset sandbox iframe (cleanup for memory issues)
function resetSandbox() {
	if (sandboxFrame) {
		sandboxFrame.remove();
		sandboxFrame = null;
	}
	sandboxReady = false;
}

// Create sandbox iframe
function setupSandbox() {
	return new Promise((resolve) => {
		// If sandbox already exists and is ready, reuse it
		if (sandboxFrame && sandboxReady) {
			resolve();
			return;
		}

		// Reset if exists but not ready
		if (sandboxFrame) {
			console.log('Offscreen: Resetting sandbox');
			resetSandbox();
		}

		sandboxFrame = document.createElement('iframe');
		sandboxFrame.src = chrome.runtime.getURL('sandbox.html');
		sandboxFrame.style.display = 'none';
		document.body.appendChild(sandboxFrame);

		// Wait for sandbox ready message
		const readyHandler = (event) => {
			if (event.data.action === 'SANDBOX_READY') {
				console.log('Offscreen: Sandbox is ready');
				sandboxReady = true;
				window.removeEventListener('message', readyHandler);
				resolve();
			}
		};
		window.addEventListener('message', readyHandler);

		// Timeout fallback
		setTimeout(() => {
			if (!sandboxReady) {
				console.log('Offscreen: Sandbox ready timeout, proceeding anyway');
				sandboxReady = true;
				resolve();
			}
		}, 3000);
	});
}

// Listen for messages from sandbox
window.addEventListener('message', (event) => {
	// Relay sandbox logs to this console
	if (event.data.action === 'SANDBOX_LOG') {
		const { level, message } = event.data;
		if (level === 'error') {
			console.error('[Sandbox→]', message);
		} else if (level === 'warn') {
			console.warn('[Sandbox→]', message);
		} else {
			console.log('[Sandbox→]', message);
		}
		return;
	}

	if (event.data.action === 'CONVERT_RESULT') {
		const { requestId, success, data, fileName, error } = event.data;
		console.log('Offscreen: Received result from sandbox for:', requestId);

		const pendingResolve = pendingRequests.get(requestId);
		if (pendingResolve) {
			pendingRequests.delete(requestId);
			pendingResolve({ success, data, fileName, error });
		}
	}
});

/**
 * Process a single conversion
 * @param {string} requestId
 */
async function processConversion(requestId) {
	const requestKey = `request_${requestId}`;
	const startTime = performance.now();
	let fileName = 'unknown';
	let dataSize = 0;

	const log = (msg) => {
		const elapsed = (performance.now() - startTime).toFixed(0);
		console.log(`Offscreen [${requestId}] (${elapsed}ms): ${msg}`);
	};

	log('Starting conversion');

	// 1. Read from IndexedDB
	log('Reading request data from IndexedDB...');
	const data = await getImage(requestKey);

	if (!data || !data.data) {
		throw new Error('[Offscreen Step 1] No image data found in IndexedDB - data may have been cleared');
	}

	fileName = data.fileName || 'unknown';
	dataSize = data.data.length;
	log(`Data loaded: ${fileName}, Size: ${formatBytes(dataSize)}`);

	// 2. Setup sandbox if needed (will reuse existing if ready)
	log('Setting up sandbox...');
	await setupSandbox();
	log('Sandbox ready');

	// 3. Send to sandbox for conversion
	log('Sending to sandbox for conversion...');

	const timeoutMs = dataSize > 10 * 1024 * 1024 ? 90000 : 60000; // 90s for >10MB base64
	log(`Timeout set to ${timeoutMs/1000}s based on data size`);

	const result = await new Promise((resolve, reject) => {
		pendingRequests.set(requestId, resolve);

		// Timeout
		setTimeout(() => {
			if (pendingRequests.has(requestId)) {
				pendingRequests.delete(requestId);
				const elapsed = (performance.now() - startTime).toFixed(0);
				reject(new Error(`[Offscreen Step 3] Sandbox timeout after ${elapsed}ms (limit: ${timeoutMs}ms) - File: ${fileName}, Size: ${formatBytes(dataSize)}`));
			}
		}, timeoutMs);

		sandboxFrame.contentWindow.postMessage({
			action: 'CONVERT_HEIC',
			requestId: requestId,
			base64Data: data.data,
			fileName: data.fileName
		}, '*');
	});

	if (!result.success) {
		// Reset sandbox on error
		resetSandbox();
		throw new Error(result.error || '[Offscreen Step 3] Conversion failed in sandbox (unknown error)');
	}

	log(`Conversion successful, result size: ${formatBytes(result.data?.length || 0)}`);

	// 4. Save result to IndexedDB
	log('Saving result to IndexedDB...');
	const resultKey = `result_${requestId}`;
	const resultData = {
		success: true,
		data: result.data,
		fileName: result.fileName
	};

	await saveImage(resultKey, resultData);

	const totalTime = (performance.now() - startTime).toFixed(0);
	log(`SUCCESS - Total: ${totalTime}ms, Input: ${formatBytes(dataSize)}, Output: ${formatBytes(result.data?.length || 0)}`);
}

/**
 * Process the conversion queue sequentially
 */
async function processQueue() {
	if (isProcessing) {
		console.log('Offscreen: Queue already processing, skipping');
		return; // Already processing
	}

	isProcessing = true;
	console.log(`Offscreen: Starting queue processing, ${conversionQueue.length} items`);

	while (conversionQueue.length > 0) {
		const requestId = conversionQueue.shift();
		console.log(`Offscreen: Processing queue item ${requestId}, ${conversionQueue.length} remaining`);

		try {
			await processConversion(requestId);
		} catch (error) {
			console.error(`Offscreen [${requestId}]: FAILED -`, error.message);
			console.error('Offscreen: Full error:', error);

			// Save detailed error to IndexedDB
			const resultKey = `result_${requestId}`;
			await saveImage(resultKey, {
				error: error.message,
				errorTime: new Date().toISOString(),
				errorStack: error.stack
			});
		}
	}

	isProcessing = false;
	console.log('Offscreen: Queue empty, processing complete');
}

/**
 * Add a conversion request to the queue
 * @param {string} requestId
 */
function queueConversion(requestId) {
	console.log(`Offscreen: Queuing conversion for ${requestId}`);
	conversionQueue.push(requestId);
	processQueue(); // Start processing if not already
}

// Message listener (fire-and-forget, no response)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	// Only handle messages targeted at offscreen
	if (request.target !== 'offscreen') {
		return false;
	}

	if (request.action === 'CONVERT_HEIC') {
		console.log('Offscreen received CONVERT_HEIC for:', request.requestId);
		queueConversion(request.requestId);
		return false;
	}
});

console.log('Offscreen: Ready and listening for messages');
