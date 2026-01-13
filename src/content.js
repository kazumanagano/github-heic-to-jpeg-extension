console.log('GitHub HEIC to JPEG Converter loaded (v5 - Converting placeholder).');

/**
 * Converts a file to a base64 string.
 * @param {File} file
 * @returns {Promise<string>}
 */
function fileToBase64(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

/**
 * Inserts placeholder text into textarea at cursor position.
 * @param {HTMLTextAreaElement} textarea
 * @param {string} text
 * @returns {number} - The start position where text was inserted
 */
function insertPlaceholder(textarea, text) {
	const start = textarea.selectionStart;
	const end = textarea.selectionEnd;
	const before = textarea.value.substring(0, start);
	const after = textarea.value.substring(end);

	textarea.value = before + text + after;
	textarea.selectionStart = textarea.selectionEnd = start + text.length;

	// Trigger input event so GitHub's JS updates properly
	textarea.dispatchEvent(new Event('input', { bubbles: true }));

	return start;
}

/**
 * Removes placeholder text from textarea.
 * @param {HTMLTextAreaElement} textarea
 * @param {string} placeholder
 * @param {number} insertPosition - The position where placeholder was inserted
 */
function removePlaceholder(textarea, placeholder, insertPosition) {
	const value = textarea.value;
	const placeholderIndex = value.indexOf(placeholder, insertPosition);

	if (placeholderIndex !== -1) {
		textarea.value = value.substring(0, placeholderIndex) + value.substring(placeholderIndex + placeholder.length);
		textarea.selectionStart = textarea.selectionEnd = placeholderIndex;

		// Trigger input event
		textarea.dispatchEvent(new Event('input', { bubbles: true }));
	}
}

/**
 * Displays an error banner on the page.
 * @param {string} message
 */
function showErrorBanner(message) {
	const banner = document.createElement('div');
	banner.style.position = 'fixed';
	banner.style.top = '0';
	banner.style.left = '0';
	banner.style.width = '100%';
	banner.style.backgroundColor = '#ff4444';
	banner.style.color = 'white';
	banner.style.textAlign = 'center';
	banner.style.padding = '10px';
	banner.style.zIndex = '999999';
	banner.style.fontWeight = 'bold';
	banner.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
	banner.textContent = message;

	const closeBtn = document.createElement('button');
	closeBtn.textContent = '✕';
	closeBtn.style.marginLeft = '20px';
	closeBtn.style.background = 'none';
	closeBtn.style.border = 'none';
	closeBtn.style.color = 'white';
	closeBtn.style.cursor = 'pointer';
	closeBtn.style.fontSize = '16px';
	closeBtn.onclick = () => banner.remove();
	banner.appendChild(closeBtn);

	document.body.prepend(banner);
}

/**
 * Wait for conversion result via storage polling
 * @param {string} requestId
 * @param {number} timeout
 * @returns {Promise<object>}
 */
function waitForResult(requestId, timeout = 60000) {
	return new Promise((resolve, reject) => {
		const resultKey = `result_${requestId}`;
		const startTime = Date.now();

		const checkResult = async () => {
			try {
				// Check if extension context is still valid
				if (!chrome?.storage?.local) {
					reject(new Error('Extension context invalidated - please refresh the page'));
					return;
				}

				const data = await chrome.storage.local.get(resultKey);
				if (data[resultKey]) {
					resolve(data[resultKey]);
					return;
				}

				if (Date.now() - startTime > timeout) {
					reject(new Error('Conversion timeout'));
					return;
				}

				// Poll every 500ms
				setTimeout(checkResult, 500);
			} catch (error) {
				reject(error);
			}
		};

		checkResult();
	});
}

/**
 * Handles file items from paste or drop events.
 * @param {DataTransferItemList} items - The list of items from the event.
 * @param {Event} originalEvent - The original paste or drop event.
 * @param {string} eventType - 'paste' or 'drop'.
 */
async function handleDataTransfer(items, originalEvent, eventType) {
	if (!items) return;

	// Early check for extension context
	if (!chrome?.runtime?.id) {
		showErrorBanner('GitHub HEIC Converter: Extension context invalidated. Please REFRESH this page to restore functionality.');
		return;
	}

	const heicItems = [];
	for (const item of items) {
		if (item.type === 'image/heic' || item.getAsFile()?.name.toLowerCase().endsWith('.heic')) {
			heicItems.push(item);
		}
	}

	if (heicItems.length === 0) return;

	// Prevent default behavior immediately
	originalEvent.preventDefault();
	originalEvent.stopPropagation();

	// Find textarea for placeholder insertion
	let textarea = originalEvent.target;
	if (textarea.tagName !== 'TEXTAREA') {
		textarea = textarea.closest('textarea') || document.activeElement;
	}
	const canUsePlaceholder = textarea && textarea.tagName === 'TEXTAREA';

	const convertedFiles = [];

	for (const item of heicItems) {
		const file = item.getAsFile();
		if (file) {
			// Insert placeholder text (like GitHub's "Uploading...")
			const placeholder = `![Converting ${file.name}...]()\n`;
			let placeholderPosition = -1;

			if (canUsePlaceholder) {
				placeholderPosition = insertPlaceholder(textarea, placeholder);
				console.log(`Inserted placeholder for ${file.name}`);
			}

			try {
				console.log(`Converting ${file.name}...`);

				// Check if extension context is still valid before storage access
				if (!chrome?.storage?.local) {
					throw new Error('Extension context invalidated');
				}

				const base64Data = await fileToBase64(file);
				const requestId = Date.now().toString();

				// Save request to storage
				await chrome.storage.local.set({
					[`request_${requestId}`]: {
						data: base64Data,
						fileName: file.name
					}
				});

				// Send message to background (fire-and-forget, no async wait)
				chrome.runtime.sendMessage({
					action: 'CONVERT_HEIC',
					requestId: requestId
				});

				// Wait for result via storage polling
				console.log(`Waiting for conversion result for ${requestId}...`);
				const result = await waitForResult(requestId);

				// Remove placeholder before proceeding
				if (canUsePlaceholder && placeholderPosition !== -1) {
					removePlaceholder(textarea, placeholder, placeholderPosition);
					console.log(`Removed placeholder for ${file.name}`);
				}

				if (result && result.data) {
					// Convert back to File
					const res = await fetch(result.data);
					const blob = await res.blob();
					const newFile = new File([blob], result.fileName, {
						type: 'image/jpeg',
						lastModified: new Date().getTime(),
					});
					convertedFiles.push(newFile);
					console.log(`Converted to ${newFile.name}`);

					// Cleanup
					chrome.storage.local.remove([`request_${requestId}`, `result_${requestId}`]);
				} else {
					throw new Error(result?.error || 'Conversion failed');
				}

			} catch (err) {
				// Remove placeholder on error too
				if (canUsePlaceholder && placeholderPosition !== -1) {
					removePlaceholder(textarea, placeholder, placeholderPosition);
				}

				console.error('Conversion failed for', file.name, err);
				if (err.message.includes('Extension context') || err.message.includes('invalidated') || !chrome?.runtime?.id) {
					showErrorBanner('GitHub HEIC Converter: Extension updated or invalidated. Please REFRESH this page to use the new version.');
				}
			}
		}
	}

	if (convertedFiles.length > 0) {
		const dataTransfer = new DataTransfer();
		for (const file of convertedFiles) {
			dataTransfer.items.add(file);
		}

		if (eventType === 'paste') {
			const newEvent = new ClipboardEvent('paste', {
				bubbles: true,
				cancelable: true,
				clipboardData: dataTransfer,
			});
			originalEvent.target.dispatchEvent(newEvent);
		} else if (eventType === 'drop') {
			const newEvent = new DragEvent('drop', {
				bubbles: true,
				cancelable: true,
				dataTransfer: dataTransfer,
				clientX: originalEvent.clientX,
				clientY: originalEvent.clientY,
				screenX: originalEvent.screenX,
				screenY: originalEvent.screenY,
			});
			originalEvent.target.dispatchEvent(newEvent);
		}
	}
}

document.addEventListener('paste', (event) => {
	handleDataTransfer(event.clipboardData?.items, event, 'paste');
}, true);

document.addEventListener('drop', (event) => {
	handleDataTransfer(event.dataTransfer?.items, event, 'drop');
}, true);
