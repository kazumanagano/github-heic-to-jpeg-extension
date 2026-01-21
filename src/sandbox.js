import heic2any from 'heic2any';

// Send logs to parent (offscreen) so they appear in the same console
function logToParent(message, level = 'log') {
	console.log(message); // Local console too
	window.parent.postMessage({
		action: 'SANDBOX_LOG',
		level: level,
		message: message
	}, '*');
}

logToParent(`Sandbox: Script loaded, heic2any type: ${typeof heic2any}`);

/**
 * BlobをBase64文字列に変換する
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function blobToBase64(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => resolve(reader.result);
		reader.onerror = () => reject(new Error('Failed to read blob'));
		reader.readAsDataURL(blob);
	});
}

/**
 * エラーメッセージを抽出する
 * @param {any} error
 * @returns {string}
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
 * タイムアウト付きでPromiseを実行する
 * @param {Promise} promise
 * @param {number} timeoutMs
 * @param {string} operationName
 * @returns {Promise}
 */
function withTimeout(promise, timeoutMs, operationName) {
	return Promise.race([
		promise,
		new Promise((_, reject) =>
			setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
		)
	]);
}

// Track if conversion is in progress to prevent duplicate processing
let isConverting = false;

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes) {
	if (bytes < 1024) return bytes + ' B';
	if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
	return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// Listen for messages from parent (offscreen.html)
window.addEventListener('message', async (event) => {
	logToParent(`Sandbox received message: ${JSON.stringify(event.data?.action)}`);

	if (event.data.action === 'CONVERT_HEIC') {
		const { base64Data, fileName, requestId } = event.data;
		const startTime = performance.now();
		let stepStartTime = startTime;
		let blobSize = 0;

		// Prevent duplicate conversions
		if (isConverting) {
			logToParent(`Sandbox: Already converting, ignoring duplicate request: ${requestId}`, 'warn');
			return;
		}

		isConverting = true;

		const logStep = (step, details = '') => {
			const elapsed = (performance.now() - stepStartTime).toFixed(0);
			const total = (performance.now() - startTime).toFixed(0);
			logToParent(`Sandbox [${requestId}]: ${step} (${elapsed}ms, total: ${total}ms) ${details}`);
			stepStartTime = performance.now();
		};

		try {
			// Step 1: Convert base64 to blob
			logStep('Fetching blob from base64...');
			const response = await fetch(base64Data);
			const blob = await response.blob();
			blobSize = blob.size;
			logStep('Blob fetched', `Size: ${formatBytes(blob.size)}, Type: ${blob.type}`);

			// Validate blob
			if (blob.size === 0) {
				throw new Error('[Step 1] Empty blob received - base64 data may be corrupted');
			}

			// Debug: Check blob header (HEIC files start with ftyp box)
			const headerBytes = await blob.slice(0, 12).arrayBuffer();
			const header = new Uint8Array(headerBytes);
			const headerHex = Array.from(header).map(b => b.toString(16).padStart(2, '0')).join(' ');
			logToParent(`Sandbox [${requestId}]: Blob header (first 12 bytes): ${headerHex}`);

			// Check if it looks like a valid HEIC file (should contain 'ftyp' at offset 4)
			const ftyp = String.fromCharCode(header[4], header[5], header[6], header[7]);
			logToParent(`Sandbox [${requestId}]: File signature: "${ftyp}" (expected: "ftyp")`);

			// Step 2: Convert HEIC to JPEG with timeout
			const timeoutMs = blob.size > 10 * 1024 * 1024 ? 60000 : 30000; // 60s for >10MB
			logStep(`Starting heic2any (${timeoutMs/1000}s timeout)`, `Input: ${formatBytes(blob.size)}, heic2any=${typeof heic2any}`);

			logToParent(`Sandbox [${requestId}]: Calling heic2any()...`);

			// Wrap heic2any with additional error handling
			let conversionPromise;
			try {
				conversionPromise = heic2any({
					blob: blob,
					toType: 'image/jpeg',
					quality: 0.8,
				});
				logToParent(`Sandbox [${requestId}]: heic2any() returned promise successfully`);
			} catch (syncError) {
				logToParent(`Sandbox [${requestId}]: heic2any() threw sync error: ${syncError}`, 'error');
				throw syncError;
			}

			logToParent(`Sandbox [${requestId}]: Awaiting heic2any promise...`);

			const conversionResult = await withTimeout(
				conversionPromise,
				timeoutMs,
				`heic2any conversion (input: ${formatBytes(blob.size)})`
			);
			logStep('heic2any complete');

			// Step 3: Process result
			const resultBlob = Array.isArray(conversionResult) ? conversionResult[0] : conversionResult;
			logStep('Result blob created', `Size: ${formatBytes(resultBlob.size)}, Compression: ${((1 - resultBlob.size / blob.size) * 100).toFixed(1)}%`);

			// Step 4: Convert back to base64
			logStep('Converting result to base64...');
			const resultBase64 = await blobToBase64(resultBlob);
			logStep('Base64 conversion complete', `Length: ${formatBytes(resultBase64.length)}`);

			// Step 5: Send result
			event.source.postMessage({
				action: 'CONVERT_RESULT',
				requestId: requestId,
				success: true,
				data: resultBase64,
				fileName: fileName.replace(/\.heic$/i, '.jpg')
			}, '*');

			const totalTime = (performance.now() - startTime).toFixed(0);
			logToParent(`Sandbox [${requestId}]: SUCCESS - Total: ${totalTime}ms, Input: ${formatBytes(blobSize)}, Output: ${formatBytes(resultBlob.size)}`);

		} catch (error) {
			const totalTime = (performance.now() - startTime).toFixed(0);
			const errorMsg = getErrorMessage(error);
			const detailedError = `[File: ${fileName}, Size: ${formatBytes(blobSize)}, Time: ${totalTime}ms] ${errorMsg}`;

			logToParent(`Sandbox [${requestId}]: FAILED after ${totalTime}ms - ${detailedError}`, 'error');
			logToParent(`Sandbox: Full error: ${error}`, 'error');

			event.source.postMessage({
				action: 'CONVERT_RESULT',
				requestId: requestId,
				success: false,
				error: detailedError
			}, '*');
		} finally {
			isConverting = false;
		}
	}
});

// Signal that sandbox is ready
window.parent.postMessage({ action: 'SANDBOX_READY' }, '*');
logToParent('Sandbox: Ready');
