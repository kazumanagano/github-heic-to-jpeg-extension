import heic2any from 'heic2any';

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

// Listen for messages from parent (offscreen.html)
window.addEventListener('message', async (event) => {
	console.log('Sandbox received message:', event.data);

	if (event.data.action === 'CONVERT_HEIC') {
		const { base64Data, fileName, requestId } = event.data;

		// Prevent duplicate conversions
		if (isConverting) {
			console.warn('Sandbox: Already converting, ignoring duplicate request:', requestId);
			return;
		}

		isConverting = true;

		try {
			// Convert base64 to blob
			console.log('Sandbox: Fetching blob from base64...');
			const response = await fetch(base64Data);
			const blob = await response.blob();
			console.log('Sandbox: Blob fetched. Size:', blob.size, 'Type:', blob.type);

			// Validate blob
			if (blob.size === 0) {
				throw new Error('Empty blob received');
			}

			// Convert HEIC to JPEG with timeout (30 seconds)
			console.log('Sandbox: Starting heic2any conversion (30s timeout)...');
			const conversionResult = await withTimeout(
				heic2any({
					blob: blob,
					toType: 'image/jpeg',
					quality: 0.8,
				}),
				30000,
				'heic2any conversion'
			);
			console.log('Sandbox: heic2any conversion complete');

			// heic2any may return array
			const resultBlob = Array.isArray(conversionResult) ? conversionResult[0] : conversionResult;
			console.log('Sandbox: Result blob size:', resultBlob.size);

			// Convert back to base64
			console.log('Sandbox: Converting result to base64...');
			const resultBase64 = await blobToBase64(resultBlob);
			console.log('Sandbox: Base64 conversion complete, length:', resultBase64.length);

			// Send result back to parent
			event.source.postMessage({
				action: 'CONVERT_RESULT',
				requestId: requestId,
				success: true,
				data: resultBase64,
				fileName: fileName.replace(/\.heic$/i, '.jpg')
			}, '*');
			console.log('Sandbox: Result sent for', requestId);

		} catch (error) {
			const errorMsg = getErrorMessage(error);
			console.error('Sandbox conversion error for', requestId, ':', errorMsg);
			event.source.postMessage({
				action: 'CONVERT_RESULT',
				requestId: requestId,
				success: false,
				error: errorMsg
			}, '*');
		} finally {
			isConverting = false;
		}
	}
});

// Signal that sandbox is ready
window.parent.postMessage({ action: 'SANDBOX_READY' }, '*');
console.log('Sandbox: Ready');
