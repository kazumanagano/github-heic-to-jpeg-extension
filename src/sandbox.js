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

// Listen for messages from parent (offscreen.html)
window.addEventListener('message', async (event) => {
	console.log('Sandbox received message:', event.data);

	if (event.data.action === 'CONVERT_HEIC') {
		try {
			const { base64Data, fileName, requestId } = event.data;

			// Convert base64 to blob
			console.log('Sandbox: Fetching blob from base64...');
			const response = await fetch(base64Data);
			const blob = await response.blob();
			console.log('Sandbox: Blob fetched. Size:', blob.size);

			// Convert HEIC to JPEG
			console.log('Sandbox: Starting heic2any conversion...');
			const conversionResult = await heic2any({
				blob: blob,
				toType: 'image/jpeg',
				quality: 0.8,
			});
			console.log('Sandbox: Conversion complete');

			// heic2any may return array
			const resultBlob = Array.isArray(conversionResult) ? conversionResult[0] : conversionResult;

			// Convert back to base64
			const resultBase64 = await blobToBase64(resultBlob);

			// Send result back to parent
			event.source.postMessage({
				action: 'CONVERT_RESULT',
				requestId: requestId,
				success: true,
				data: resultBase64,
				fileName: fileName.replace(/\.heic$/i, '.jpg')
			}, '*');

		} catch (error) {
			const errorMsg = getErrorMessage(error);
			console.error('Sandbox conversion error:', errorMsg);
			event.source.postMessage({
				action: 'CONVERT_RESULT',
				requestId: event.data.requestId,
				success: false,
				error: errorMsg
			}, '*');
		}
	}
});

// Signal that sandbox is ready
window.parent.postMessage({ action: 'SANDBOX_READY' }, '*');
console.log('Sandbox: Ready');
