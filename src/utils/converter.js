import heic2any from 'heic2any';

/**
 * Converts a HEIC Blob/File to a JPEG Blob.
 * @param {Blob} heicBlob - The HEIC blob to convert.
 * @returns {Promise<Blob>} - The converted JPEG blob.
 */
export async function convertHeicToJpeg(heicBlob) {
	try {
		const result = await heic2any({
			blob: heicBlob,
			toType: 'image/jpeg',
			quality: 0.8, // Adjust quality as needed
		});

		// heic2any can return a single blob or an array of blobs.
		// We assume single file conversion here.
		if (Array.isArray(result)) {
			return result[0];
		}
		return result;
	} catch (error) {
		console.error('Error converting HEIC to JPEG:', error);
		throw error;
	}
}
