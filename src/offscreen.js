import { getImage, saveImage } from './db.js';

console.log('Offscreen script loaded (v7 - Queue)');

let sandboxFrame = null;
let sandboxReady = false;
let pendingRequests = new Map();

// Conversion queue to prevent sandbox reset during conversion
let conversionQueue = [];
let isProcessing = false;

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

// Listen for results from sandbox
window.addEventListener('message', (event) => {
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

	console.log(`Offscreen: Starting conversion for ${requestId}`);

	// 1. Read from IndexedDB
	console.log(`Reading request data for ${requestId} from IndexedDB...`);
	const data = await getImage(requestKey);

	if (!data || !data.data) {
		throw new Error('No image data found in IndexedDB');
	}

	// 2. Setup sandbox if needed (will reuse existing if ready)
	await setupSandbox();

	// 3. Send to sandbox for conversion
	console.log('Offscreen: Sending to sandbox for conversion...');

	const result = await new Promise((resolve, reject) => {
		pendingRequests.set(requestId, resolve);

		// Timeout
		setTimeout(() => {
			if (pendingRequests.has(requestId)) {
				pendingRequests.delete(requestId);
				reject(new Error('Sandbox conversion timeout'));
			}
		}, 60000);

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
		throw new Error(result.error || 'Conversion failed in sandbox');
	}

	// 4. Save result to IndexedDB
	console.log('Offscreen: Saving result to IndexedDB');
	const resultKey = `result_${requestId}`;
	const resultData = {
		success: true,
		data: result.data,
		fileName: result.fileName
	};

	await saveImage(resultKey, resultData);
	console.log('Offscreen: Conversion complete, result saved');
}

/**
 * Process the conversion queue sequentially
 */
async function processQueue() {
	if (isProcessing) {
		return; // Already processing
	}

	isProcessing = true;

	while (conversionQueue.length > 0) {
		const requestId = conversionQueue.shift();
		console.log(`Offscreen: Processing queue item ${requestId}, ${conversionQueue.length} remaining`);

		try {
			await processConversion(requestId);
			console.log(`Offscreen: Successfully converted ${requestId}`);
		} catch (error) {
			console.error(`Offscreen: Conversion error for ${requestId}:`, error);
			// Save error to IndexedDB
			const resultKey = `result_${requestId}`;
			await saveImage(resultKey, { error: error.message });
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
