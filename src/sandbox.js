console.log('Sandbox: Script starting...');

let heic2any;
try {
	console.log('Sandbox: Importing heic2any...');
	const module = await import('heic2any');
	heic2any = module.default;
	console.log('Sandbox: heic2any imported successfully');
} catch (e) {
	console.error('Sandbox: Failed to import heic2any:', e);
}

console.log('Sandbox script loaded');

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
	console.log('Sandbox received message:', event.data);

	if (event.data.action === 'CONVERT_HEIC') {
		const { base64Data, fileName, requestId } = event.data;
		const startTime = performance.now();
		let stepStartTime = startTime;
		let blobSize = 0;

		// Prevent duplicate conversions
		if (isConverting) {
			console.warn('Sandbox: Already converting, ignoring duplicate request:', requestId);
			return;
		}

		isConverting = true;

		const logStep = (step, details = '') => {
			const elapsed = (performance.now() - stepStartTime).toFixed(0);
			const total = (performance.now() - startTime).toFixed(0);
			console.log(`Sandbox [${requestId}]: ${step} (${elapsed}ms, total: ${total}ms) ${details}`);
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

			// Step 2: Convert HEIC to JPEG with timeout
			const timeoutMs = blob.size > 10 * 1024 * 1024 ? 60000 : 30000; // 60s for >10MB
			logStep(`Starting heic2any conversion (${timeoutMs/1000}s timeout)...`, `Input: ${formatBytes(blob.size)}`);

			// Check if heic2any is available
			if (!heic2any) {
				throw new Error('[Step 2] heic2any library not loaded - import may have failed');
			}
			logStep('heic2any library confirmed available');

			console.log(`Sandbox [${requestId}]: Calling heic2any() now...`);
			const conversionPromise = heic2any({
				blob: blob,
				toType: 'image/jpeg',
				quality: 0.8,
			});
			console.log(`Sandbox [${requestId}]: heic2any() called, waiting for result...`);

			const conversionResult = await withTimeout(
				conversionPromise,
				timeoutMs,
				`heic2any conversion (input: ${formatBytes(blob.size)})`
			);
			logStep('heic2any conversion complete');

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
			console.log(`Sandbox [${requestId}]: SUCCESS - Total time: ${totalTime}ms, Input: ${formatBytes(blobSize)}, Output: ${formatBytes(resultBlob.size)}`);

		} catch (error) {
			const totalTime = (performance.now() - startTime).toFixed(0);
			const errorMsg = getErrorMessage(error);
			const detailedError = `[File: ${fileName}, Size: ${formatBytes(blobSize)}, Time: ${totalTime}ms] ${errorMsg}`;

			console.error(`Sandbox [${requestId}]: FAILED after ${totalTime}ms -`, detailedError);
			console.error('Sandbox: Full error object:', error);

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
console.log('Sandbox: Ready');
