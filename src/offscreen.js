import { getImage, saveImage } from './db.js';

console.log('Offscreen script loaded (v6 - Sandbox)');

let sandboxFrame = null;
let sandboxReady = false;
let pendingRequests = new Map();
let conversionCount = 0;

// Reset sandbox iframe (cleanup for memory issues)
function resetSandbox() {
	if (sandboxFrame) {
		sandboxFrame.remove();
		sandboxFrame = null;
	}
	sandboxReady = false;
	conversionCount = 0;
}

// Create sandbox iframe
function setupSandbox() {
	return new Promise((resolve) => {
		// Always reset sandbox for each conversion to prevent memory issues
		if (sandboxFrame) {
			console.log('Offscreen: Resetting sandbox for new conversion');
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
 * HEIC変換を処理する
 * @param {string} requestId
 */
async function handleConversion(requestId) {
	const requestKey = `request_${requestId}`;

	console.log(`Offscreen: Starting conversion for ${requestId}`);

	// 1. Read from IndexedDB
	console.log(`Reading request data for ${requestId} from IndexedDB...`);
	const data = await getImage(requestKey);

	if (!data || !data.data) {
		throw new Error('No image data found in IndexedDB');
	}

	// 2. Setup sandbox if needed
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

	// Increment conversion count
	conversionCount++;

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

// Message listener (fire-and-forget, no response)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	// Only handle messages targeted at offscreen
	if (request.target !== 'offscreen') {
		return false;
	}

	if (request.action === 'CONVERT_HEIC') {
		console.log('Offscreen received CONVERT_HEIC for:', request.requestId);

		// Execute conversion (no response sent back)
		handleConversion(request.requestId)
			.then(() => {
				console.log(`Offscreen: Successfully converted ${request.requestId}`);
			})
			.catch((error) => {
				console.error(`Offscreen: Conversion error for ${request.requestId}:`, error);
				// Save error to IndexedDB
				const resultKey = `result_${request.requestId}`;
				saveImage(resultKey, { error: error.message });
			});

		// Don't wait for async, return immediately
		return false;
	}
});

console.log('Offscreen: Ready and listening for messages');
